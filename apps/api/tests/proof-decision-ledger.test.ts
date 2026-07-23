import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type {
  ProofDecisionCanonicalIntent,
  ProofDecisionIntegrityContract,
  ProofDecisionLedgerRecord,
  ProofDecisionOutcomeState
} from "@pathfinder/proof-domain";

let testDirectory = "";
let storePath = "";
let createProofDecisionLedger: typeof import("../src/proof/decision-ledger.ts")["createProofDecisionLedger"];
let ProofDecisionLedgerError: typeof import("../src/proof/decision-ledger.ts")["ProofDecisionLedgerError"];
let ttlSeconds = 0;

const baselineIntent: ProofDecisionCanonicalIntent = {
  decision: "approve",
  order_number: "A0221132",
  task_id: "ptask_ledger",
  attachment_id: "25435041",
  participant_id: "pparticipant_ledger",
  grant_id: "pgrant_ledger",
  expected_task_version: 7,
  expected_version_id: "pversion_ledger_v1",
  feedback_fingerprint: "feedback-ledger-v1",
  note: "Ready for production"
};

function hash(intent: ProofDecisionCanonicalIntent) {
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

function contract(options: {
  key?: string;
  note?: string | null;
} = {}): ProofDecisionIntegrityContract {
  const intent = { ...baselineIntent, note: options.note === undefined ? baselineIntent.note : options.note };
  return {
    idempotency_key: options.key ?? "approval-ledger-0001",
    canonical_body_hash: hash(intent),
    intent,
    outcome: "prepared"
  };
}

function expectLedgerFailure(code: string) {
  return (error: unknown) => error instanceof ProofDecisionLedgerError && error.code === code;
}

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "vornan-proof-decision-ledger-"));
  storePath = join(testDirectory, "proof-store.json");
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = storePath;
  const ledgerModule = await import("../src/proof/decision-ledger.ts");
  createProofDecisionLedger = ledgerModule.createProofDecisionLedger;
  ProofDecisionLedgerError = ledgerModule.ProofDecisionLedgerError;
  ttlSeconds = ledgerModule.PROOF_DECISION_LEDGER_TTL_SECONDS;
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("reserves one minimal sanitized record with an exact fixed 30-day TTL", async () => {
  const now = new Date("2026-07-23T12:00:00.500Z");
  const ledger = createProofDecisionLedger();
  const reservation = await ledger.reserve(contract(), now);
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;
  assert.deepEqual(Object.keys(reservation.record).sort(), [
    "canonical_body_hash",
    "created_at",
    "expires_at_epoch",
    "idempotency_key",
    "intent",
    "outcome",
    "record_version",
    "updated_at"
  ]);
  assert.equal(reservation.record.record_version, 1);
  assert.equal(reservation.record.outcome, "prepared");
  assert.equal(
    reservation.record.expires_at_epoch,
    Math.floor(now.getTime() / 1_000) + 30 * 24 * 60 * 60
  );
  assert.equal(ttlSeconds, 30 * 24 * 60 * 60);

  const serialized = (await readFile(storePath, "utf8")).toLowerCase();
  for (const forbidden of [
    "session_hash",
    "token_hash",
    "\"email\"",
    "signed_url",
    "\"jwt\"",
    "credential",
    "creative",
    "approved_by",
    "audit_events\": {\\n    \""
  ]) {
    assert.equal(serialized.includes(forbidden), false, `ledger persisted ${forbidden}`);
  }
});

test("returns an exact replay, rejects a changed body, and never extends the initial TTL", async () => {
  const key = "approval-ledger-0002";
  const started = new Date("2026-07-23T13:00:00.000Z");
  const ledger = createProofDecisionLedger();
  const first = await ledger.reserve(contract({ key }), started);
  assert.equal(first.status, "new");
  if (first.status !== "new") return;

  const replay = await ledger.reserve(contract({ key }), new Date("2026-07-24T13:00:00.000Z"));
  assert.equal(replay.status, "replay");
  if (replay.status !== "replay") return;
  assert.equal(replay.record.created_at, first.record.created_at);
  assert.equal(replay.record.updated_at, first.record.updated_at);
  assert.equal(replay.record.expires_at_epoch, first.record.expires_at_epoch);

  const conflict = await ledger.reserve(
    contract({ key, note: "A different canonical decision body" }),
    new Date("2026-07-24T13:00:00.000Z")
  );
  assert.deepEqual(conflict, { status: "conflict" });

  await assert.rejects(
    () => ledger.read(baselineIntent.order_number, key, new Date("2026-08-22T13:00:00.000Z")),
    expectLedgerFailure("record_stale")
  );
});

test("serializes concurrent reservations into one new record and deterministic replays or conflicts", async () => {
  const ledger = createProofDecisionLedger();
  const now = new Date("2026-07-23T14:00:00.000Z");
  const same = contract({ key: "approval-ledger-race-01" });
  const results = await Promise.all(Array.from({ length: 20 }, () => ledger.reserve(same, now)));
  assert.equal(results.filter((result) => result.status === "new").length, 1);
  assert.equal(results.filter((result) => result.status === "replay").length, 19);

  const raceKey = "approval-ledger-race-02";
  const changed = await Promise.all([
    ledger.reserve(contract({ key: raceKey, note: "Canonical body A" }), now),
    ledger.reserve(contract({ key: raceKey, note: "Canonical body B" }), now)
  ]);
  assert.deepEqual(changed.map((result) => result.status).sort(), ["conflict", "new"]);
});

test("guards every outcome transition and keeps the fixed TTL and terminal states immutable", async () => {
  const states: ProofDecisionOutcomeState[] = [
    "prepared",
    "submission_uncertain",
    "reconciling",
    "confirmed",
    "failed"
  ];
  const allowed = new Set([
    "prepared>submission_uncertain",
    "prepared>confirmed",
    "prepared>failed",
    "submission_uncertain>reconciling",
    "submission_uncertain>confirmed",
    "submission_uncertain>failed",
    "reconciling>confirmed",
    "reconciling>failed"
  ]);
  const createdAt = "2026-07-23T15:00:00.000Z";

  for (const current of states) {
    for (const next of states) {
      const prepared = contract({ key: `approval-matrix-${current}-${next}` });
      let stored: ProofDecisionLedgerRecord = {
        ...prepared,
        outcome: current,
        record_version: 4,
        created_at: createdAt,
        updated_at: createdAt,
        expires_at_epoch: Math.floor(Date.parse(createdAt) / 1_000) + ttlSeconds
      };
      const ledger = createProofDecisionLedger({
        get: async () => stored,
        create: async () => false,
        replace: async (record) => {
          stored = record;
          return true;
        }
      });
      const transition = () => ledger.transition({
        order_number: stored.intent.order_number,
        idempotency_key: stored.idempotency_key,
        canonical_body_hash: stored.canonical_body_hash,
        expected_record_version: 4,
        next_outcome: next
      }, new Date("2026-07-23T15:01:00.000Z"));
      if (allowed.has(`${current}>${next}`)) {
        const initialTtl = stored.expires_at_epoch;
        const result = await transition();
        assert.equal(result.outcome, next);
        assert.equal(result.record_version, 5);
        assert.equal(result.expires_at_epoch, initialTtl);
      } else {
        await assert.rejects(transition, expectLedgerFailure("transition_invalid"));
      }
    }
  }
});

test("fails closed on hash mismatches, version races, and conditional replacement races", async () => {
  const key = "approval-ledger-0003";
  const now = new Date("2026-07-23T16:00:00.000Z");
  const ledger = createProofDecisionLedger();
  const reservation = await ledger.reserve(contract({ key }), now);
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;

  await assert.rejects(
    () => ledger.transition({
      order_number: baselineIntent.order_number,
      idempotency_key: key,
      canonical_body_hash: "0".repeat(64),
      expected_record_version: 1,
      next_outcome: "confirmed"
    }, new Date("2026-07-23T16:01:00.000Z")),
    expectLedgerFailure("canonical_hash_mismatch")
  );
  await assert.rejects(
    () => ledger.transition({
      order_number: baselineIntent.order_number,
      idempotency_key: key,
      canonical_body_hash: reservation.record.canonical_body_hash,
      expected_record_version: 2,
      next_outcome: "confirmed"
    }, new Date("2026-07-23T16:01:00.000Z")),
    expectLedgerFailure("record_version_mismatch")
  );

  const racingLedger = createProofDecisionLedger({
    get: async () => reservation.record,
    create: async () => false,
    replace: async () => false
  });
  await assert.rejects(
    () => racingLedger.transition({
      order_number: baselineIntent.order_number,
      idempotency_key: key,
      canonical_body_hash: reservation.record.canonical_body_hash,
      expected_record_version: 1,
      next_outcome: "confirmed"
    }, new Date("2026-07-23T16:01:00.000Z")),
    expectLedgerFailure("concurrent_update")
  );
});

test("rejects malformed, sensitive, TTL-extended, and stale durable records", async () => {
  const malformedKey = "approval-ledger-malformed";
  const createdAt = "2026-07-23T17:00:00.000Z";
  const prepared = contract({ key: malformedKey });
  const record = {
    ...prepared,
    record_version: 1,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at_epoch: Math.floor(Date.parse(createdAt) / 1_000) + ttlSeconds
  };
  const ledger = createProofDecisionLedger();

  for (const malformed of [
    { ...record, email: "must-not-persist@example.invalid" },
    { ...record, expires_at_epoch: record.expires_at_epoch + 1 },
    { ...record, canonical_body_hash: "0".repeat(64) }
  ]) {
    await writeFile(storePath, JSON.stringify({
      decision_records: { [`${baselineIntent.order_number}:${malformedKey}`]: malformed }
    }), "utf8");
    await assert.rejects(
      () => ledger.read(baselineIntent.order_number, malformedKey, new Date("2026-07-23T17:01:00.000Z")),
      expectLedgerFailure("record_malformed")
    );
  }

  await writeFile(storePath, JSON.stringify({
    decision_records: {
      [`${baselineIntent.order_number}:${malformedKey}`]: {
        ...record,
        idempotency_key: "approval-ledger-wrong-key"
      }
    }
  }), "utf8");
  await assert.rejects(
    () => ledger.read(baselineIntent.order_number, malformedKey, new Date("2026-07-23T17:01:00.000Z")),
    expectLedgerFailure("record_malformed")
  );

  await writeFile(storePath, JSON.stringify({
    decision_records: { [`${baselineIntent.order_number}:${malformedKey}`]: record }
  }), "utf8");
  await assert.rejects(
    () => ledger.read(baselineIntent.order_number, malformedKey, new Date("2026-08-22T17:00:00.000Z")),
    expectLedgerFailure("record_stale")
  );
});
