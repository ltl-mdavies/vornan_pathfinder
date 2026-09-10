import assert from "node:assert/strict";
import test from "node:test";
import { observeWrikeIntent, validateWrikeIntentCursor, wrikeIntentSignal, wrikeIntentCursorId, type WrikeIntentScope } from "../src/wrike-intent-observation.js";
const scope: WrikeIntentScope = { customer_id: "synthetic", connection_id: "connection", import_method_id: "method", task_id: "TASK", trigger_status_id: "READY" };
const observation = (second: number, status = "READY") => ({ task_id: "TASK", custom_status_id: status,
  source_updated_at: `2026-09-10T12:00:${String(second).padStart(2, "0")}Z`, observed_at: `2026-09-10T12:01:${String(second).padStart(2, "0")}Z`, scope_verified: true, identity_matches: true });

test("continuous ready edits/polls and exact replay retain generation and deterministic signal", () => {
  const first = observeWrikeIntent(null, scope, observation(0));
  assert.equal(first.generation, 1);
  assert.equal(observeWrikeIntent(first, scope, observation(0)), first);
  const edited = observeWrikeIntent(first, scope, observation(1));
  const polled = observeWrikeIntent(edited, scope, { ...observation(1), observed_at: observation(2).observed_at });
  assert.equal(polled.generation, 1);
  assert.deepEqual(wrikeIntentSignal(polled), wrikeIntentSignal(first));
  // No unobserved exit is inferred from a newer task edit or later polling time.
  assert.equal(observeWrikeIntent(polled, scope, observation(30)).attempt_id, first.attempt_id);
});
test("observed exit and re-entry advance once; initial outside status creates no attempt identity", () => {
  const outside = observeWrikeIntent(null, scope, observation(0, "OTHER"));
  assert.equal(outside.generation, 0); assert.equal(wrikeIntentSignal(outside), null);
  const first = observeWrikeIntent(outside, scope, observation(1));
  const exit = observeWrikeIntent(first, scope, observation(2, "OTHER"));
  assert.equal(exit.generation, 1); assert.equal(exit.attempt_id, first.attempt_id);
  const reentry = observeWrikeIntent(exit, scope, observation(3));
  assert.equal(reentry.generation, 2); assert.notEqual(reentry.attempt_id, first.attempt_id);
  assert.equal(observeWrikeIntent(reentry, scope, observation(3)), reentry);
});
test("ambiguous, stale, missing, wrong-task and unqualified observations never arm exit", () => {
  const first = observeWrikeIntent(null, scope, observation(1));
  for (const patch of [{ source_updated_at: "" }, { source_updated_at: observation(0).source_updated_at },
    { observed_at: observation(0).observed_at }, { source_updated_at: observation(1).source_updated_at },
    { observed_at: observation(1).observed_at }, { scope_verified: false }, { identity_matches: false },
    { task_id: "OTHER" }, { custom_status_id: "" }, { source_updated_at: "2027-01-01T00:00:00Z" }]) {
    assert.throws(() => observeWrikeIntent(first, scope, { ...observation(2, "OTHER"), ...patch }));
  }
  const exit = observeWrikeIntent(first, scope, observation(2, "OTHER"));
  assert.throws(() => observeWrikeIntent(exit, scope, { ...observation(3), source_updated_at: exit.source_updated_at }));
});
test("all scope dimensions bind both cursor and future attempt identity", () => {
  const first = observeWrikeIntent(null, scope, observation(0));
  for (const key of Object.keys(scope) as (keyof WrikeIntentScope)[]) {
    const changed = { ...scope, [key]: "OTHER" };
    const next = observeWrikeIntent(null, changed, { ...observation(0), task_id: changed.task_id, custom_status_id: changed.trigger_status_id });
    assert.notEqual(next.cursor_id, first.cursor_id); assert.notEqual(next.attempt_id, first.attempt_id);
    assert.throws(() => validateWrikeIntentCursor(first, changed));
  }
  assert.throws(() => wrikeIntentCursorId({ ...scope, customer_id: "" }));
});
test("corrupt lifecycle and deterministic identity fields fail closed", () => {
  const first = observeWrikeIntent(null, scope, observation(0));
  for (const patch of [{ schema_version: 2 }, { revision: 0 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { generation: 2 }, { generation: -1 }, { in_intent: false }, { last_status_id: "OTHER" },
    { entry_observed_at: null }, { entry_source_updated_at: null }, { attempt_id: "wrong" },
    { cursor_id: "wrong" }, { source_updated_at: "invalid" }, { entry_observed_at: "2027-01-01T00:00:00Z" }]) {
    assert.throws(() => validateWrikeIntentCursor({ ...first, ...patch }, scope));
    assert.throws(() => observeWrikeIntent({ ...first, ...patch } as typeof first, scope, observation(1)));
  }
});
