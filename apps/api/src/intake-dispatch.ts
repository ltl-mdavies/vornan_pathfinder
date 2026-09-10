import type { IntakeAttempt, IntakeLedger } from "./intake-assurance.js";
import { IntakeDeliveryConflictError, intakeDeliveryPayload, type IntakeDeliveryKind, type IntakeDeliveryLedger, type IntakeDeliveryPayload } from "./intake-delivery.js";
import type { IntakeSweepFence } from "./intake-recovery-sweep.js";

/** Claims are durable before transport. Exceptions and missing acknowledgements never authorize a retry. */
export async function dispatchIntakeDelivery(args: {
  enabled: boolean; customer_id: string; attempt_id: string; kind: IntakeDeliveryKind;
  intake: IntakeLedger; receipts: IntakeDeliveryLedger;
  send: (payload: IntakeDeliveryPayload) => Promise<{ provider_message_id: string }>;
  prepareTransport?: (payload: IntakeDeliveryPayload, attempt: IntakeAttempt) => Promise<(() => Promise<{ provider_message_id: string }>) | null>;
  canDispatch?: () => boolean; fence?: () => IntakeSweepFence; now?: () => Date;
}) {
  if (!args.enabled) return { status: "disabled" as const };
  const now = () => (args.now ?? (() => new Date()))().toISOString();
  const attempt = await args.intake.get(args.customer_id, args.attempt_id);
  if (!attempt || attempt.signal.customer_id !== args.customer_id || attempt.attempt_id !== args.attempt_id) throw new Error("Intake dispatch identity mismatch");
  let receipt;
  try {
    receipt = await args.receipts.prepare(attempt, args.kind, now());
  } catch (error) {
    if (error instanceof IntakeDeliveryConflictError) return { status: "conflict" as const };
    throw error;
  }
  if (!receipt) return { status: "ineligible" as const };
  if (receipt.state === "uncertain" || receipt.state === "sent") return { status: "suppressed" as const };
  if (receipt.state === "cancelled") return { status: "cancelled" as const };
  if (args.canDispatch && !args.canDispatch()) return { status: "deferred" as const };
  // Re-read immediately before claim. Persistence atomically checks this revision
  // and (for scheduled dispatch) the sweep lease in the same write as the claim.
  const current = await args.intake.get(args.customer_id, args.attempt_id);
  if (!current || current.revision !== attempt.revision) return { status: "conflict" as const };
  const timestamp = now();
  const payload = intakeDeliveryPayload(current, args.kind, timestamp);
  if (!payload) return { status: "cancelled" as const };
  const preparedSend = args.prepareTransport ? await args.prepareTransport(payload, current) : () => args.send(payload);
  if (!preparedSend) return { status: "blocked" as const };
  try {
    receipt = await args.receipts.claim(receipt, current, now(), args.fence?.());
  } catch (error) {
    if (error instanceof IntakeDeliveryConflictError) return { status: "conflict" as const };
    throw error;
  }
  try {
    const result = await preparedSend();
    await args.receipts.acknowledge(receipt, result.provider_message_id, now());
    return { status: "sent" as const };
  } catch {
    // Includes successful transport followed by a lost storage acknowledgement.
    // The pre-send uncertain marker survives. Never include raw provider errors.
    return { status: "uncertain" as const };
  }
}
