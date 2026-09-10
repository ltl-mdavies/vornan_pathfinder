import { createHash } from "node:crypto";
import { validatePersistedIntakeAttempt, type IntakeAttempt } from "./intake-assurance.js";
import { draftIntakeCustomerFeedback, draftIntakeInternalNotification } from "./intake-follow-up.js";
import type { TransactionalEmail } from "./email.js";

export type IntakeDeliveryKind = "source_feedback" | "internal_notification";
export type IntakeDeliveryPayload = { kind: "source_feedback"; provider: "wrike"; connection_id: string; task_id: string; text: string } |
  { kind: "internal_notification"; message: TransactionalEmail };
export interface IntakeDeliveryReceipt {
  schema_version: 1; receipt_id: string; customer_id: string; attempt_id: string; kind: IntakeDeliveryKind;
  revision: number; intake_revision: number; payload_sha256: string;
  state: "prepared" | "cancelled" | "uncertain" | "sent";
  created_at: string; updated_at: string; dispatch_started_at: string | null;
  provider_message_id: string | null;
}
export class IntakeDeliveryConflictError extends Error {
  constructor() { super("Intake delivery changed; reread before proceeding"); this.name = "IntakeDeliveryConflictError"; }
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function intakeDeliveryId(customer: string, attempt: string, kind: IntakeDeliveryKind) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(customer) || !/^intake_[a-f0-9]{64}$/.test(attempt) ||
      !["source_feedback", "internal_notification"].includes(kind)) throw new Error("Invalid intake delivery identity");
  return `delivery_${digest([customer, attempt, kind])}`;
}
export function deliveryTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Invalid intake delivery time");
  return time;
}
export function intakeDeliveryPayload(attempt: IntakeAttempt, kind: IntakeDeliveryKind, now: string): IntakeDeliveryPayload | null {
  validatePersistedIntakeAttempt(attempt); deliveryTime(now);
  if (kind === "source_feedback") {
    const draft = draftIntakeCustomerFeedback(attempt);
    return draft && attempt.signal.provider === "wrike" ? { kind, provider: "wrike", connection_id: attempt.signal.connection_id,
      task_id: attempt.signal.source_id, text: draft.text } : null;
  }
  if (kind !== "internal_notification") throw new Error("Invalid intake delivery kind");
  const draft = draftIntakeInternalNotification(attempt, now);
  return draft ? { kind, message: draft.message } : null;
}
export function validateIntakeDelivery(value: unknown): IntakeDeliveryReceipt {
  const row = value as IntakeDeliveryReceipt | null;
  if (!row || row.schema_version !== 1 || row.receipt_id !== intakeDeliveryId(row.customer_id, row.attempt_id, row.kind) ||
    !Number.isSafeInteger(row.revision) || row.revision < 0 || !Number.isSafeInteger(row.intake_revision) || row.intake_revision < 0 ||
    !/^[a-f0-9]{64}$/.test(row.payload_sha256) || !["prepared", "cancelled", "uncertain", "sent"].includes(row.state)) throw new Error("Invalid intake delivery receipt");
  if (deliveryTime(row.updated_at) < deliveryTime(row.created_at)) throw new Error("Invalid intake delivery chronology");
  const dispatched = row.state === "uncertain" || row.state === "sent";
  if (dispatched ? !row.dispatch_started_at : row.dispatch_started_at !== null) throw new Error("Invalid intake delivery dispatch marker");
  if (row.dispatch_started_at && (deliveryTime(row.dispatch_started_at) < deliveryTime(row.created_at) || deliveryTime(row.dispatch_started_at) > deliveryTime(row.updated_at))) throw new Error("Invalid intake delivery dispatch time");
  if (row.state === "sent" ? typeof row.provider_message_id !== "string" || !row.provider_message_id.trim() || row.provider_message_id.length > 512 : row.provider_message_id !== null) throw new Error("Invalid intake delivery acknowledgement");
  return row;
}
/** One channel slot per intake: once dispatch starts it cannot automatically rearm, even on a new intake revision. */
export function prepareIntakeDelivery(current: IntakeDeliveryReceipt | null, attempt: IntakeAttempt, kind: IntakeDeliveryKind, now: string): IntakeDeliveryReceipt | null {
  const id = intakeDeliveryId(attempt.signal.customer_id, attempt.attempt_id, kind);
  if (current) {
    validateIntakeDelivery(current);
    if (current.receipt_id !== id) throw new IntakeDeliveryConflictError();
    if (current.state === "uncertain" || current.state === "sent") return current;
    if (deliveryTime(now) < deliveryTime(current.updated_at) || attempt.revision < current.intake_revision) throw new IntakeDeliveryConflictError();
  }
  const payload = intakeDeliveryPayload(attempt, kind, now);
  if (!payload && !current) return null;
  const hash = payload ? digest(payload) : current!.payload_sha256;
  const state = payload ? "prepared" : "cancelled";
  if (current && current.intake_revision === attempt.revision && current.payload_sha256 === hash && current.state === state) return current;
  return validateIntakeDelivery({ schema_version: 1, receipt_id: id, customer_id: attempt.signal.customer_id, attempt_id: attempt.attempt_id, kind,
    revision: current ? current.revision + 1 : 0, intake_revision: attempt.revision, payload_sha256: hash, state,
    created_at: current?.created_at ?? now, updated_at: now, dispatch_started_at: null, provider_message_id: null });
}
export function claimIntakeDelivery(current: IntakeDeliveryReceipt, attempt: IntakeAttempt, now: string) {
  validateIntakeDelivery(current);
  const prepared = prepareIntakeDelivery(current, attempt, current.kind, now);
  if (current.state !== "prepared" || prepared !== current) throw new IntakeDeliveryConflictError();
  return validateIntakeDelivery({ ...current, revision: current.revision + 1, state: "uncertain", updated_at: now, dispatch_started_at: now });
}
export function acknowledgeIntakeDelivery(current: IntakeDeliveryReceipt, providerMessageId: string, now: string) {
  validateIntakeDelivery(current);
  if (current.state === "sent" && current.provider_message_id === providerMessageId) return current;
  if (current.state !== "uncertain" || deliveryTime(now) < deliveryTime(current.updated_at)) throw new IntakeDeliveryConflictError();
  return validateIntakeDelivery({ ...current, revision: current.revision + 1, state: "sent", updated_at: now, provider_message_id: providerMessageId });
}
export interface IntakeDeliveryLedger {
  get(customer: string, attempt: string, kind: IntakeDeliveryKind): Promise<IntakeDeliveryReceipt | null>;
  prepare(attempt: IntakeAttempt, kind: IntakeDeliveryKind, now: string): Promise<IntakeDeliveryReceipt | null>;
  claim(receipt: IntakeDeliveryReceipt, attempt: IntakeAttempt, now: string): Promise<IntakeDeliveryReceipt>;
  acknowledge(receipt: IntakeDeliveryReceipt, providerMessageId: string, now: string): Promise<IntakeDeliveryReceipt>;
}
