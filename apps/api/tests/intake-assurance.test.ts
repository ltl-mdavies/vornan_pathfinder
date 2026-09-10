import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, IntakePreparationError, intakeAttemptId, intakeAssurancePosture, intakeEffectKey, intakeFailures,
  intakeWatchdog, reserveThenPrepare, transitionIntake, type IntakeEvent, type IntakeSignal, type IntakeLedger } from "../src/intake-assurance.js";
const signal: IntakeSignal = { schema_version: 1, customer_id: "customer", provider: "wrike", connection_id: "connection",
  source_id: "task", intent_key: "Sent to Print – LTL", intent_occurrence: "initial", observed_at: "2026-09-10T10:00:00Z" };
const deadline = "2026-09-10T11:00:00Z";
const fresh = () => createIntakeAttempt(signal, deadline);
const event = (state: IntakeEvent["state"], expected_revision = 0, extra: Partial<IntakeEvent> = {}): IntakeEvent => ({
  event_id: `event-${expected_revision}`, expected_revision, state, reason: null,
  occurred_at: signal.observed_at, next_action_at: deadline, ...extra
});
function ready() {
  return transitionIntake(transitionIntake(fresh(), event("preparing")), event("ready", 1, { job_id: "job" }));
}
function reconciling() {
  return transitionIntake(ready(), event("reconciling", 2, { submit_attempt_id: "submit" }));
}
test("intent identity is independent of polling and isolated across every scope dimension", () => {
  const id = intakeAttemptId(signal);
  assert.equal(intakeAttemptId({ ...signal, observed_at: deadline }), id);
  for (const key of ["customer_id", "provider", "connection_id", "source_id", "intent_key", "intent_occurrence"] as const) {
    assert.notEqual(intakeAttemptId({ ...signal, [key]: "different" }), id);
    assert.throws(() => intakeAttemptId({ ...signal, [key]: " " }));
  }
  assert.notEqual(intakeAttemptId({ ...signal, source_id: "a:b", intent_key: "c" }), intakeAttemptId({ ...signal, source_id: "a", intent_key: "b:c" }));
  assert.throws(() => createIntakeAttempt(signal, "invalid"));
});
test("confirmation retains transport identity and exposes missing success feedback for repair", () => {
  const confirmed = transitionIntake(reconciling(), event("confirmed", 3, { confirmed_order_number: "LTL123", next_action_at: null }));
  assert.equal(confirmed.owner, "none");
  assert.equal(intakeWatchdog(confirmed, deadline).status_link_repair_required, true);
  const repaired = transitionIntake(confirmed, event("confirmed", 4, { writeback_id: "existing-writeback", next_action_at: null }));
  assert.equal(intakeWatchdog(repaired, deadline).status_link_repair_required, false);
  assert.throws(() => transitionIntake(repaired, event("confirmed", 5, { confirmed_order_number: "OTHER", next_action_at: null })));
});
test("all customer-safe and internal failures retain explicit ownership", () => {
  for (const [reason, owner] of Object.entries(intakeFailures)) {
    const next = transitionIntake(fresh(), event(owner === "customer" ? "customer_action_required" : "internal_action_required", 0,
      { reason: reason as keyof typeof intakeFailures }));
    assert.equal(next.owner, owner);
    assert.throws(() => transitionIntake(fresh(), event(owner === "customer" ? "internal_action_required" : "customer_action_required", 0,
      { reason: reason as keyof typeof intakeFailures })));
  }
});
test("uncertain attempts cannot be prepared, withdrawn, superseded or customer-owned", () => {
  const internal = transitionIntake(reconciling(), event("internal_action_required", 3, { reason: "submission_timeout" }));
  for (const state of ["preparing", "withdrawn", "superseded", "customer_action_required"] as const) {
    assert.throws(() => transitionIntake(internal, event(state, 4, { next_action_at: ["withdrawn", "superseded"].includes(state) ? null : deadline, superseded_by: "other" })));
  }
  assert.equal(transitionIntake(internal, event("reconciling", 4)).state, "reconciling");
  assert.throws(() => transitionIntake(fresh(), event("confirmed", 0, { next_action_at: null })));
  assert.throws(() => transitionIntake(ready(), event("reconciling", 2)));
});
test("revisions and event identity reject stale or changed retries; replay is idempotent", () => {
  const e = event("preparing");
  const next = transitionIntake(fresh(), e);
  assert.equal(transitionIntake(next, e), next);
  assert.equal(transitionIntake(next, Object.fromEntries(Object.entries(e).reverse()) as unknown as IntakeEvent), next);
  assert.throws(() => transitionIntake(next, { ...e, state: "ready" }));
  assert.throws(() => transitionIntake(next, { ...e, event_id: "stale" }));
  assert.throws(() => transitionIntake(next, event("ready", 1, { job_id: "job", next_action_at: null })));
  assert.throws(() => transitionIntake(next, event("ready", 1, { job_id: "job", occurred_at: "2020-01-01" })));
});
test("withdrawal and supersession are terminal and watchdog deadlines do not drift on reads", () => {
  assert.throws(() => transitionIntake(fresh(), event("superseded", 0, { next_action_at: null })));
  const withdrawn = transitionIntake(fresh(), event("withdrawn", 0, { next_action_at: null }));
  assert.throws(() => transitionIntake(withdrawn, event("preparing", 1)));
  assert.equal(intakeWatchdog(withdrawn, deadline).overdue, false);
  assert.equal(intakeWatchdog(fresh(), signal.observed_at).overdue, false);
  assert.equal(intakeWatchdog(fresh(), deadline).overdue, true);
  assert.equal(intakeEffectKey(fresh(), "internal_notification"), intakeEffectKey(fresh(), "internal_notification"));
  assert.notEqual(intakeEffectKey(fresh(), "internal_notification"), intakeEffectKey(fresh(), "source_feedback"));
  assert.ok(Object.values(intakeAssurancePosture).every((value) => value === false));
});
test("reservation is durable before parsing; duplicates and failed reservations never prepare", async () => {
  let stored: ReturnType<typeof fresh> | null = null;
  let calls = 0;
  const ledger: IntakeLedger = {
    reserve: async () => { if (stored) return { attempt: stored, created: false }; stored = fresh(); return { attempt: stored, created: true }; },
    get: async () => stored,
    transition: async (_customer, _id, e) => stored = transitionIntake(stored!, e)
  };
  const prepare = async () => { calls++; assert.equal(stored?.state, "preparing"); return { job_id: "job" }; };
  await reserveThenPrepare(ledger, signal, deadline, prepare);
  await reserveThenPrepare(ledger, signal, deadline, prepare);
  assert.equal(calls, 1);
  await assert.rejects(reserveThenPrepare({ ...ledger, reserve: async () => { throw new Error("disk unavailable"); } }, signal, deadline, prepare));
  assert.equal(calls, 1);
  stored = null;
  await assert.rejects(reserveThenPrepare(ledger, signal, deadline, async () => { throw new Error("sensitive parser error"); }));
  assert.equal((stored as ReturnType<typeof fresh> | null)?.state, "internal_action_required");
  assert.ok(!JSON.stringify(stored).includes("sensitive"));
  stored = null;
  await assert.rejects(reserveThenPrepare(ledger, signal, deadline, async () => { throw new IntakePreparationError("missing_order_grid"); }));
  assert.equal((stored as ReturnType<typeof fresh> | null)?.state, "customer_action_required");
});

test("lost preparation completion acknowledgment leaves recovery to durable state, without preparing again", async () => {
  let stored = fresh();
  let first = true;
  let calls = 0;
  const ledger: IntakeLedger = {
    reserve: async () => { const created = first; first = false; return { attempt: stored, created }; },
    get: async () => stored,
    transition: async (_customer, _id, e) => {
      stored = transitionIntake(stored, e);
      if (e.state === "ready") throw new Error("lost write acknowledgment");
      return stored;
    }
  };
  const prepare = async () => { calls++; return { job_id: "durable-job" }; };
  await assert.rejects(reserveThenPrepare(ledger, signal, deadline, prepare), /lost write acknowledgment/);
  assert.equal(stored.state, "ready");
  assert.equal((await reserveThenPrepare(ledger, signal, deadline, prepare)).attempt.job_id, "durable-job");
  assert.equal(calls, 1);
});
