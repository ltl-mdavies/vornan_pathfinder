import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake, type IntakeLedger } from "../src/intake-assurance.js";
import { prepareIntakeDelivery, claimIntakeDelivery, acknowledgeIntakeDelivery, IntakeDeliveryConflictError, type IntakeDeliveryReceipt, type IntakeDeliveryLedger } from "../src/intake-delivery.js";
import { dispatchIntakeDelivery } from "../src/intake-dispatch.js";
const time = "2026-09-10T10:00:00Z";
function fixture() {
  let attempt = createIntakeAttempt({ schema_version: 1, customer_id: "synthetic", provider: "wrike", connection_id: "connection", source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: time }, "2026-09-10T11:00:00Z");
  attempt = transitionIntake(attempt, { event_id: "failure", expected_revision: 0, occurred_at: time, state: "internal_action_required", reason: "pathfinder_failure", next_action_at: attempt.next_action_at });
  let receipt: IntakeDeliveryReceipt | null = null; let sends = 0;
  const intake: IntakeLedger = { get: async () => attempt, reserve: async () => { throw new Error("unexpected reserve"); }, transition: async () => { throw new Error("unexpected transition"); } };
  const receipts: IntakeDeliveryLedger = {
    get: async () => receipt,
    prepare: async (row, kind, now) => receipt = prepareIntakeDelivery(receipt, row, kind, now),
    claim: async (row, current, now) => { if (row.revision !== receipt?.revision || current.revision !== attempt.revision) throw new IntakeDeliveryConflictError(); return receipt = claimIntakeDelivery(row, current, now); },
    acknowledge: async (row, id, now) => receipt = acknowledgeIntakeDelivery(row, id, now)
  };
  const args = { enabled: true, customer_id: "synthetic", attempt_id: attempt.attempt_id, kind: "internal_notification" as const, intake, receipts, now: () => new Date(time),
    send: async () => { sends++; assert.equal(receipt?.state, "uncertain"); return { provider_message_id: "message-id" }; } };
  return { args, receipt: () => receipt, sends: () => sends, change: () => { attempt = { ...attempt, revision: attempt.revision + 1 }; } };
}
test("disabled dispatch has no reads or sends and dispatch budgets defer before claim", async () => {
  const f = fixture();
  assert.equal((await dispatchIntakeDelivery({ ...f.args, enabled: false })).status, "disabled");
  assert.equal(f.receipt(), null);
  assert.equal((await dispatchIntakeDelivery({ ...f.args, canDispatch: () => false })).status, "deferred");
  assert.equal(f.receipt()?.state, "prepared"); assert.equal(f.sends(), 0);
});
test("concurrent dispatch sends once and suppresses replay across later revisions", async () => {
  const f = fixture();
  const results = await Promise.all([dispatchIntakeDelivery(f.args), dispatchIntakeDelivery(f.args)]);
  assert.equal(results.filter(row => row.status === "sent").length, 1); assert.equal(f.sends(), 1);
  f.change(); assert.equal((await dispatchIntakeDelivery(f.args)).status, "suppressed"); assert.equal(f.sends(), 1);
});
test("timeouts, missing provider IDs and acknowledgement-store failure remain uncertain", async () => {
  for (const mode of ["timeout", "missing-id", "lost-ack"]) {
    const f = fixture();
    const result = await dispatchIntakeDelivery({ ...f.args,
      send: mode === "timeout" ? async () => { throw new Error("private transport error"); } : mode === "missing-id" ? async () => ({ provider_message_id: "" }) : f.args.send,
      receipts: mode === "lost-ack" ? { ...f.args.receipts, acknowledge: async () => { throw new Error("store unavailable"); } } : f.args.receipts });
    assert.equal(result.status, "uncertain"); assert.equal(f.receipt()?.state, "uncertain");
    assert.equal((await dispatchIntakeDelivery(f.args)).status, "suppressed");
  }
});
test("a changed intake or unavailable claim store prevents any transport call", async () => {
  const f = fixture(); const prepare = f.args.receipts.prepare;
  f.args.receipts.prepare = async (...args) => { const receipt = await prepare(...args); f.change(); return receipt; };
  assert.equal((await dispatchIntakeDelivery(f.args)).status, "conflict"); assert.equal(f.sends(), 0);
  const g = fixture();
  await assert.rejects(dispatchIntakeDelivery({ ...g.args, receipts: { ...g.args.receipts, claim: async () => { throw new Error("store unavailable"); } } }), /unavailable/);
  assert.equal(g.sends(), 0);
});
