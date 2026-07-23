import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type {
  ProofAuditEvent,
  ProofDecisionCanonicalIntent,
  ProofDecisionIntegrityContract,
  ProofDecisionLedgerRecord,
  ProofDecisionOutcomeState
} from "@pathfinder/proof-domain";
import {
  buildProofDecisionPreparedAuditEvent,
  type ProofDecisionPreparedAuditContext
} from "../src/proof/decision-atomicity.ts";

let testDirectory = "";
let storePath = "";
let createProofDecisionLedger: typeof import("../src/proof/decision-ledger.ts")["createProofDecisionLedger"];
let ProofDecisionLedgerError: typeof import("../src/proof/decision-ledger.ts")["ProofDecisionLedgerError"];
let appendProofAuditEvent: typeof import("../src/proof/store.ts")["appendProofAuditEvent"];
let listProofAuditEvents: typeof import("../src/proof/store.ts")["listProofAuditEvents"];
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
const auditContext: ProofDecisionPreparedAuditContext = {
  actor_id: "psession_ledger",
  order_line_id: "9301338"
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

function recordWithAudit(
  prepared: ProofDecisionIntegrityContract,
  options: {
    outcome?: ProofDecisionOutcomeState;
    recordVersion?: number;
    createdAt?: string;
  } = {}
) {
  const createdAt = options.createdAt ?? "2026-07-23T15:00:00.000Z";
  const audit = buildProofDecisionPreparedAuditEvent(prepared, auditContext, createdAt);
  const record: ProofDecisionLedgerRecord = {
    ...prepared,
    outcome: options.outcome ?? "prepared",
    prepared_audit_event_id: audit.event_id,
    record_version: options.recordVersion ?? 1,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at_epoch: Math.floor(Date.parse(createdAt) / 1_000) + ttlSeconds
  };
  return {
    record,
    audit
  };
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
  ({ appendProofAuditEvent, listProofAuditEvents } = await import("../src/proof/store.ts"));
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("reserves one minimal sanitized record with an exact fixed 30-day TTL", async () => {
  const now = new Date("2026-07-23T12:00:00.500Z");
  const ledger = createProofDecisionLedger();
  const reservation = await ledger.reserve(contract(), auditContext, now);
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;
  assert.deepEqual(Object.keys(reservation.record).sort(), [
    "canonical_body_hash",
    "created_at",
    "expires_at_epoch",
    "idempotency_key",
    "intent",
    "outcome",
    "prepared_audit_event_id",
    "record_version",
    "updated_at"
  ]);
  assert.equal(reservation.record.record_version, 1);
  assert.equal(reservation.record.outcome, "prepared");
  assert.equal(
    reservation.record.prepared_audit_event_id,
    "paudit_decision-0d8f2a1b6ea1940b53750f72cb6867adca1ad6db776668765f5a1413f74151c8"
  );
  assert.equal(
    reservation.record.expires_at_epoch,
    Math.floor(now.getTime() / 1_000) + 30 * 24 * 60 * 60
  );
  assert.equal(ttlSeconds, 30 * 24 * 60 * 60);

  const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
    audit_events: Record<string, ProofAuditEvent>;
    decision_records: Record<string, ProofDecisionLedgerRecord>;
  };
  assert.equal(Object.keys(persisted.decision_records).length, 1);
  assert.equal(Object.keys(persisted.audit_events).length, 1);
  const preparedAudit = persisted.audit_events[reservation.record.prepared_audit_event_id];
  assert.ok(preparedAudit);
  assert.equal(preparedAudit.action, "proof.decision_prepared");
  assert.equal(preparedAudit.occurred_at, reservation.record.created_at);
  assert.equal(
    preparedAudit.correlation_id,
    "pcorrelation_decision_f21ab5ec3cbe4b9885baa2fb41da622ddf46988ab1f51df1ec8732f1f85ae98c"
  );
  assert.equal("ttl_epoch" in preparedAudit, false);
  assert.deepEqual(preparedAudit.metadata, {
    source: "public_api",
    decision_kind: "approve",
    decision_outcome: "prepared"
  });

  const serialized = JSON.stringify(preparedAudit).toLowerCase();
  for (const forbidden of [
    "session_hash",
    "token_hash",
    "\"email\"",
    "signed_url",
    "\"jwt\"",
    "credential",
    "creative",
    "approved_by",
    baselineIntent.note!.toLowerCase(),
    contract().idempotency_key.toLowerCase(),
    contract().canonical_body_hash
  ]) {
    assert.equal(serialized.includes(forbidden), false, `audit persisted ${forbidden}`);
  }

  await appendProofAuditEvent({
    event_id: "paudit_cursor-older",
    occurred_at: "2026-07-23T11:59:00.000Z",
    action: "proof.sync_completed",
    outcome: "succeeded",
    order_number: baselineIntent.order_number,
    task_id: null,
    order_line_id: null,
    attachment_id: null,
    grant_id: null,
    participant_id: null,
    actor_type: "system",
    actor_id: "proof-sync-worker",
    correlation_id: "sync-cursor-compatibility",
    metadata: { source: "sync_worker" }
  });
  const pageOne = await listProofAuditEvents(baselineIntent.order_number, { limit: 1 });
  assert.equal(pageOne.events[0]?.event_id, reservation.record.prepared_audit_event_id);
  assert.ok(pageOne.next_cursor);
  const pageTwo = await listProofAuditEvents(baselineIntent.order_number, {
    limit: 1,
    cursor: pageOne.next_cursor
  });
  assert.equal(pageTwo.events[0]?.event_id, "paudit_cursor-older");
});

test("returns an exact replay, rejects a changed body, and never extends the initial TTL", async () => {
  const key = "approval-ledger-0002";
  const started = new Date("2026-07-23T13:00:00.000Z");
  const ledger = createProofDecisionLedger();
  const first = await ledger.reserve(contract({ key }), auditContext, started);
  assert.equal(first.status, "new");
  if (first.status !== "new") return;

  const replay = await ledger.reserve(contract({ key }), auditContext, new Date("2026-07-24T13:00:00.000Z"));
  assert.equal(replay.status, "replay");
  if (replay.status !== "replay") return;
  assert.equal(replay.record.created_at, first.record.created_at);
  assert.equal(replay.record.updated_at, first.record.updated_at);
  assert.equal(replay.record.expires_at_epoch, first.record.expires_at_epoch);

  const conflict = await ledger.reserve(
    contract({ key, note: "A different canonical decision body" }),
    auditContext,
    new Date("2026-07-24T13:00:00.000Z")
  );
  assert.deepEqual(conflict, { status: "conflict" });
  const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
    audit_events: Record<string, ProofAuditEvent>;
  };
  assert.equal(
    Object.values(persisted.audit_events).filter((event) =>
      event.event_id === first.record.prepared_audit_event_id
    ).length,
    1
  );

  await assert.rejects(
    () => ledger.read(baselineIntent.order_number, key, new Date("2026-08-22T13:00:00.000Z")),
    expectLedgerFailure("record_stale")
  );
});

test("serializes concurrent reservations into one new record and deterministic replays or conflicts", async () => {
  const ledger = createProofDecisionLedger();
  const now = new Date("2026-07-23T14:00:00.000Z");
  const same = contract({ key: "approval-ledger-race-01" });
  const results = await Promise.all(Array.from({ length: 20 }, () => ledger.reserve(same, auditContext, now)));
  assert.equal(results.filter((result) => result.status === "new").length, 1);
  assert.equal(results.filter((result) => result.status === "replay").length, 19);

  const raceKey = "approval-ledger-race-02";
  const changed = await Promise.all([
    ledger.reserve(contract({ key: raceKey, note: "Canonical body A" }), auditContext, now),
    ledger.reserve(contract({ key: raceKey, note: "Canonical body B" }), auditContext, now)
  ]);
  assert.deepEqual(changed.map((result) => result.status).sort(), ["conflict", "new"]);
});

test("reclassifies transaction ambiguity only from a valid durable intent-and-audit pair", async () => {
  const prepared = contract({ key: "approval-ledger-ambiguous" });
  const pair = recordWithAudit(prepared, { createdAt: "2026-07-23T14:30:00.000Z" });
  let committed = false;
  const ledger = createProofDecisionLedger({
    get: async () => committed ? pair.record : null,
    getPreparedAudit: async () => committed ? pair.audit : null,
    reservePrepared: async () => {
      committed = true;
      return false;
    },
    replace: async () => false
  });
  const result = await ledger.reserve(prepared, auditContext, new Date(pair.record.created_at));
  assert.equal(result.status, "replay");

  const canceled = createProofDecisionLedger({
    get: async () => null,
    getPreparedAudit: async () => null,
    reservePrepared: async () => false,
    replace: async () => false
  });
  await assert.rejects(
    () => canceled.reserve(prepared, auditContext, new Date(pair.record.created_at)),
    expectLedgerFailure("concurrent_update")
  );
});

test("fails closed on orphaned or mismatched prepared audit records", async () => {
  const prepared = contract({ key: "approval-ledger-orphaned" });
  const pair = recordWithAudit(prepared, { createdAt: "2026-07-23T14:40:00.000Z" });
  const orphaned = createProofDecisionLedger({
    get: async () => pair.record,
    getPreparedAudit: async () => null,
    reservePrepared: async () => false,
    replace: async () => false
  });
  await assert.rejects(
    () => orphaned.read(pair.record.intent.order_number, pair.record.idempotency_key),
    expectLedgerFailure("prepared_audit_missing")
  );

  for (const alteredAudit of [
    { ...pair.audit, actor_id: "unsafe@example.invalid" },
    { ...pair.audit, actor_id: "psession_ledger_other" },
    { ...pair.audit, order_line_id: "9301339" }
  ]) {
    const mismatched = createProofDecisionLedger({
      get: async () => pair.record,
      getPreparedAudit: async () => alteredAudit,
      reservePrepared: async () => false,
      replace: async () => false
    });
    await assert.rejects(
      () => mismatched.read(pair.record.intent.order_number, pair.record.idempotency_key),
      expectLedgerFailure("prepared_audit_mismatch")
    );
  }
});

test("keeps the local reservation all-or-none and rejects sensitive audit context", async () => {
  const prepared = contract({ key: "approval-ledger-local-atomic" });
  const now = new Date("2026-07-23T14:50:00.000Z");
  const pair = recordWithAudit(prepared, { createdAt: now.toISOString() });
  await writeFile(storePath, JSON.stringify({
    decision_records: {},
    audit_events: { [pair.audit.event_id]: pair.audit }
  }), "utf8");
  const ledger = createProofDecisionLedger();
  await assert.rejects(
    () => ledger.reserve(prepared, auditContext, now),
    expectLedgerFailure("concurrent_update")
  );
  const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
    decision_records: Record<string, ProofDecisionLedgerRecord>;
    audit_events: Record<string, ProofAuditEvent>;
  };
  assert.equal(Object.keys(persisted.decision_records).length, 0);
  assert.equal(Object.keys(persisted.audit_events).length, 1);

  await assert.rejects(
    () => ledger.reserve(
      contract({ key: "approval-ledger-unsafe-context" }),
      { actor_id: "reviewer@example.invalid", order_line_id: "9301338" },
      now
    ),
    expectLedgerFailure("contract_invalid")
  );
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
      const pair = recordWithAudit(prepared, { outcome: current, recordVersion: 4, createdAt });
      let stored = pair.record;
      const ledger = createProofDecisionLedger({
        get: async () => stored,
        getPreparedAudit: async () => pair.audit,
        reservePrepared: async () => false,
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
  const reservation = await ledger.reserve(contract({ key }), auditContext, now);
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
    getPreparedAudit: async () => buildProofDecisionPreparedAuditEvent(contract({ key }), auditContext, reservation.record.created_at),
    reservePrepared: async () => false,
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
  const record = recordWithAudit(prepared, { createdAt }).record;
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
