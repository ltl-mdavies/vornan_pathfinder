import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake, validatePersistedIntakeAttempt, type IntakeAttempt, type IntakeEvent } from "../src/intake-assurance.js";
const time = "2026-09-10T10:00:00Z";
const deadline = "2026-09-10T11:00:00Z";
const fresh = () => createIntakeAttempt({ schema_version: 1, customer_id: "synthetic", provider: "wrike", connection_id: "connection", source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: time }, deadline);
function step(attempt: IntakeAttempt, state: IntakeEvent["state"], extra: Partial<IntakeEvent> = {}) {
  return transitionIntake(attempt, { event_id: `event-${attempt.revision}`, expected_revision: attempt.revision, occurred_at: time, state, reason: null, next_action_at: deadline, ...extra });
}
const ready = () => step(step(fresh(), "preparing"), "ready", { job_id: "job" });
const reconciling = () => step(ready(), "reconciling", { submit_attempt_id: "submit" });
const confirmed = () => step(reconciling(), "confirmed", { confirmed_order_number: "ORDER1", next_action_at: null });
// Keep the event snapshot consistent to prove lifecycle rules independently of drift detection.
function corrupt(row: IntakeAttempt, patch: Partial<IntakeAttempt>) {
  const next = structuredClone({ ...row, ...patch });
  if (next.last_event) {
    Object.assign(next.last_event.projection, patch);
    Object.assign(next.last_event, { state: next.state, reason: next.reason, occurred_at: next.updated_at, next_action_at: next.next_action_at });
    for (const key of ["job_id", "submit_attempt_id", "confirmed_order_number", "writeback_id", "superseded_by"] as const) {
      if (next.last_event[key] !== undefined) {
        if (next[key] === null) delete next.last_event[key]; else next.last_event[key] = next[key]!;
      }
    }
  }
  return next;
}
test("persisted lifecycle rejects impossible records even when the event snapshot agrees", () => {
  const cases: [IntakeAttempt, Partial<IntakeAttempt>][] = [
    [fresh(), { owner: "none" }], [fresh(), { next_action_at: null }], [fresh(), { reason: "pathfinder_failure" }],
    [fresh(), { job_id: "job" }], [fresh(), { updated_at: deadline }], [fresh(), { created_at: "2026-09-10T09:00:00Z" }],
    [ready(), { job_id: null }], [ready(), { submit_attempt_id: "submit" }],
    [reconciling(), { submit_attempt_id: null }], [reconciling(), { job_id: null }],
    [confirmed(), { job_id: null, submit_attempt_id: null, confirmed_order_number: null }],
    [confirmed(), { next_action_at: deadline }], [confirmed(), { reason: "pathfinder_failure" }],
    [step(fresh(), "preparing"), { writeback_id: "writeback" }],
    [step(fresh(), "customer_action_required", { reason: "unmapped_product" }), { reason: "pathfinder_failure" }],
    [step(fresh(), "internal_action_required", { reason: "pathfinder_failure" }), { reason: "unmapped_product" }],
    [step(fresh(), "withdrawn", { next_action_at: null }), { superseded_by: "other" }],
    [step(fresh(), "superseded", { superseded_by: "different-intake", next_action_at: null }), { superseded_by: fresh().attempt_id }],
    [step(fresh(), "superseded", { superseded_by: "different-intake", next_action_at: null }), { superseded_by: null }]
  ];
  for (const [row, patch] of cases) assert.throws(() => validatePersistedIntakeAttempt(corrupt(row, patch)), JSON.stringify(patch));
});
test("every stored event projection field must match current state, including inherited associations", () => {
  const row = step(confirmed(), "internal_action_required", { reason: "success_writeback_missing" });
  assert.equal(row.last_event!.job_id, undefined);
  assert.equal(row.last_event!.projection.job_id, "job");
  assert.equal(validatePersistedIntakeAttempt(row), row);
  for (const key of Object.keys(row.last_event!.projection)) {
    const bad = structuredClone(row);
    (bad.last_event!.projection as unknown as Record<string, unknown>)[key] = "corrupt";
    assert.throws(() => validatePersistedIntakeAttempt(bad), key);
  }
  for (const patch of [{ reason: "lift_failure" }, { occurred_at: deadline }, { next_action_at: null }, { job_id: "other" }, { expected_revision: 0 }, { event_id: "" }, { projection: undefined }]) {
    assert.throws(() => validatePersistedIntakeAttempt({ ...row, last_event: { ...row.last_event, ...patch } }), JSON.stringify(patch));
  }
  assert.throws(() => validatePersistedIntakeAttempt({ ...row, revision: Number.MAX_SAFE_INTEGER + 1 }));
});
test("writeback association is one-way, preserved when omitted and immutable on every later transition", () => {
  const row = step(confirmed(), "confirmed", { writeback_id: "W1", next_action_at: null });
  assert.equal(step(row, "confirmed", { next_action_at: null }).writeback_id, "W1");
  assert.equal(step(row, "internal_action_required", { reason: "pathfinder_failure" }).writeback_id, "W1");
  assert.throws(() => step(row, "confirmed", { writeback_id: "W2", next_action_at: null }), /immutable/);
  assert.throws(() => step(row, "internal_action_required", { writeback_id: "W2", reason: "pathfinder_failure" }), /immutable/);
  assert.equal(transitionIntake(row, row.last_event!), row);
});
