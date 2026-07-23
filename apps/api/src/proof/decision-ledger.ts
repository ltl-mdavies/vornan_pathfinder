import { createHash } from "node:crypto";
import {
  classifyProofDecisionIdempotency,
  InvalidProofDecisionOutcomeTransitionError,
  transitionProofDecisionOutcome,
  type ProofDecisionCanonicalIntent,
  type ProofDecisionIntegrityContract,
  type ProofDecisionLedgerRecord,
  type ProofDecisionOutcomeState
} from "@pathfinder/proof-domain";
import {
  createProofDecisionRecord,
  getProofDecisionRecord,
  replaceProofDecisionRecord
} from "./store.js";

export const PROOF_DECISION_LEDGER_TTL_DAYS = 30;
export const PROOF_DECISION_LEDGER_TTL_SECONDS = PROOF_DECISION_LEDGER_TTL_DAYS * 24 * 60 * 60;

export type ProofDecisionLedgerFailureCode =
  | "contract_invalid"
  | "record_malformed"
  | "record_stale"
  | "record_not_found"
  | "canonical_hash_mismatch"
  | "record_version_mismatch"
  | "transition_invalid"
  | "concurrent_update";

export class ProofDecisionLedgerError extends Error {
  constructor(public readonly code: ProofDecisionLedgerFailureCode, message: string) {
    super(message);
    this.name = "ProofDecisionLedgerError";
  }
}

export type ProofDecisionReservation =
  | { status: "new"; record: ProofDecisionLedgerRecord }
  | { status: "replay"; record: ProofDecisionLedgerRecord }
  | { status: "conflict" };

export interface TransitionProofDecisionInput {
  order_number: string;
  idempotency_key: string;
  canonical_body_hash: string;
  expected_record_version: number;
  next_outcome: ProofDecisionOutcomeState;
}

export interface ProofDecisionLedgerPersistence {
  get: typeof getProofDecisionRecord;
  create: typeof createProofDecisionRecord;
  replace: typeof replaceProofDecisionRecord;
}

const defaultPersistence: ProofDecisionLedgerPersistence = {
  get: getProofDecisionRecord,
  create: createProofDecisionRecord,
  replace: replaceProofDecisionRecord
};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,180}$/;
const HASH = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set<ProofDecisionOutcomeState>([
  "prepared",
  "submission_uncertain",
  "reconciling",
  "confirmed",
  "failed"
]);
const RECORD_KEYS = [
  "canonical_body_hash",
  "created_at",
  "expires_at_epoch",
  "idempotency_key",
  "intent",
  "outcome",
  "record_version",
  "updated_at"
] as const;
const INTENT_KEYS = [
  "attachment_id",
  "decision",
  "expected_task_version",
  "expected_version_id",
  "feedback_fingerprint",
  "grant_id",
  "note",
  "order_number",
  "participant_id",
  "task_id"
] as const;

function fail(code: ProofDecisionLedgerFailureCode, message: string): never {
  throw new ProofDecisionLedgerError(code, message);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalHash(intent: ProofDecisionCanonicalIntent) {
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validIntent(value: unknown): value is ProofDecisionCanonicalIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const intent = value as Record<string, unknown>;
  return exactKeys(intent, INTENT_KEYS) &&
    intent.decision === "approve" &&
    typeof intent.order_number === "string" &&
    /^A\d{7,8}$/.test(intent.order_number) &&
    typeof intent.task_id === "string" &&
    IDENTIFIER.test(intent.task_id) &&
    typeof intent.attachment_id === "string" &&
    IDENTIFIER.test(intent.attachment_id) &&
    typeof intent.participant_id === "string" &&
    IDENTIFIER.test(intent.participant_id) &&
    typeof intent.grant_id === "string" &&
    IDENTIFIER.test(intent.grant_id) &&
    Number.isInteger(intent.expected_task_version) &&
    Number(intent.expected_task_version) > 0 &&
    typeof intent.expected_version_id === "string" &&
    IDENTIFIER.test(intent.expected_version_id) &&
    typeof intent.feedback_fingerprint === "string" &&
    intent.feedback_fingerprint.length > 0 &&
    intent.feedback_fingerprint.length <= 256 &&
    (intent.note === null || (
      typeof intent.note === "string" &&
      intent.note.length <= 2_000 &&
      intent.note === intent.note.trim() &&
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(intent.note)
    ));
}

function validRecord(value: unknown): value is ProofDecisionLedgerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, RECORD_KEYS) ||
      typeof record.idempotency_key !== "string" ||
      !IDEMPOTENCY_KEY.test(record.idempotency_key) ||
      typeof record.canonical_body_hash !== "string" ||
      !HASH.test(record.canonical_body_hash) ||
      !validIntent(record.intent) ||
      record.canonical_body_hash !== canonicalHash(record.intent) ||
      !OUTCOMES.has(record.outcome as ProofDecisionOutcomeState) ||
      !Number.isInteger(record.record_version) ||
      Number(record.record_version) < 1 ||
      !validTimestamp(record.created_at) ||
      !validTimestamp(record.updated_at) ||
      !Number.isInteger(record.expires_at_epoch)) {
    return false;
  }
  const createdAtMs = Date.parse(record.created_at as string);
  const updatedAtMs = Date.parse(record.updated_at as string);
  const createdAtEpoch = Math.floor(createdAtMs / 1_000);
  return record.expires_at_epoch === createdAtEpoch + PROOF_DECISION_LEDGER_TTL_SECONDS &&
    updatedAtMs >= createdAtMs &&
    Math.floor(updatedAtMs / 1_000) < record.expires_at_epoch;
}

function activeRecord(value: unknown, now: Date) {
  if (!validRecord(value)) {
    fail("record_malformed", "Proof decision ledger record is malformed.");
  }
  if (value.expires_at_epoch <= Math.floor(now.getTime() / 1_000)) {
    fail("record_stale", "Proof decision ledger record has expired.");
  }
  return value;
}

function boundRecord(value: unknown, orderNumber: string, idempotencyKey: string, now: Date) {
  const record = activeRecord(value, now);
  if (record.intent.order_number !== orderNumber || record.idempotency_key !== idempotencyKey) {
    fail("record_malformed", "Proof decision ledger record does not match its storage identity.");
  }
  return record;
}

function validContract(contract: ProofDecisionIntegrityContract) {
  return IDEMPOTENCY_KEY.test(contract.idempotency_key) &&
    HASH.test(contract.canonical_body_hash) &&
    validIntent(contract.intent) &&
    contract.canonical_body_hash === canonicalHash(contract.intent) &&
    contract.outcome === "prepared";
}

export function createProofDecisionLedger(
  persistence: ProofDecisionLedgerPersistence = defaultPersistence
) {
  return {
    async read(orderNumber: string, idempotencyKey: string, now = new Date()) {
      const record = await persistence.get(orderNumber, idempotencyKey);
      return record === null ? null : boundRecord(record, orderNumber, idempotencyKey, now);
    },

    async reserve(contract: ProofDecisionIntegrityContract, now = new Date()): Promise<ProofDecisionReservation> {
      if (!validContract(contract) || contract.intent.order_number.trim() !== contract.intent.order_number) {
        fail("contract_invalid", "Proof decision integrity contract is invalid.");
      }
      const createdAt = now.toISOString();
      const record: ProofDecisionLedgerRecord = {
        idempotency_key: contract.idempotency_key,
        canonical_body_hash: contract.canonical_body_hash,
        intent: contract.intent,
        outcome: "prepared",
        record_version: 1,
        created_at: createdAt,
        updated_at: createdAt,
        expires_at_epoch: Math.floor(now.getTime() / 1_000) + PROOF_DECISION_LEDGER_TTL_SECONDS
      };
      const existing = await persistence.get(contract.intent.order_number, contract.idempotency_key);
      if (existing) {
        const active = boundRecord(existing, contract.intent.order_number, contract.idempotency_key, now);
        const disposition = classifyProofDecisionIdempotency(active, contract);
        return disposition.status === "replay"
          ? { status: "replay", record: active }
          : { status: "conflict" };
      }
      if (await persistence.create(record)) {
        return { status: "new", record };
      }
      const raced = await persistence.get(contract.intent.order_number, contract.idempotency_key);
      if (!raced) {
        fail("concurrent_update", "Proof decision reservation could not be established.");
      }
      const active = boundRecord(raced, contract.intent.order_number, contract.idempotency_key, now);
      const disposition = classifyProofDecisionIdempotency(active, contract);
      return disposition.status === "replay"
        ? { status: "replay", record: active }
        : { status: "conflict" };
    },

    async transition(input: TransitionProofDecisionInput, now = new Date()) {
      const existing = await persistence.get(input.order_number, input.idempotency_key);
      if (!existing) {
        fail("record_not_found", "Proof decision ledger record was not found.");
      }
      const current = boundRecord(existing, input.order_number, input.idempotency_key, now);
      if (current.canonical_body_hash !== input.canonical_body_hash) {
        fail("canonical_hash_mismatch", "Proof decision canonical body does not match the durable intent.");
      }
      if (current.record_version !== input.expected_record_version) {
        fail("record_version_mismatch", "Proof decision ledger record version is stale.");
      }
      let nextOutcome: ProofDecisionOutcomeState;
      try {
        nextOutcome = transitionProofDecisionOutcome(current.outcome, input.next_outcome);
      } catch (error) {
        if (error instanceof InvalidProofDecisionOutcomeTransitionError) {
          fail("transition_invalid", "Proof decision ledger transition is invalid.");
        }
        throw error;
      }
      const updated: ProofDecisionLedgerRecord = {
        ...current,
        outcome: nextOutcome,
        record_version: current.record_version + 1,
        updated_at: now.toISOString()
      };
      if (!validRecord(updated)) {
        fail("record_stale", "Proof decision ledger transition exceeded the fixed retention boundary.");
      }
      const replaced = await persistence.replace(updated, {
        canonical_body_hash: current.canonical_body_hash,
        record_version: current.record_version,
        outcome: current.outcome,
        expires_at_epoch: current.expires_at_epoch
      });
      if (!replaced) {
        fail("concurrent_update", "Proof decision ledger changed concurrently.");
      }
      return updated;
    }
  };
}

export const proofDecisionLedger = createProofDecisionLedger();
