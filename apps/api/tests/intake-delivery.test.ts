import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake } from "../src/intake-assurance.js";
import { prepareIntakeDelivery, claimIntakeDelivery, acknowledgeIntakeDelivery, validateIntakeDelivery, intakeDeliveryPayload } from "../src/intake-delivery.js";
const time = "2026-09-10T10:00:00Z";
export function deliveryAttempt() {
  const row = createIntakeAttempt({ schema_version: 1, customer_id: "synthetic", provider: "wrike", connection_id: "connection", source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: time }, "2026-09-10T11:00:00Z");
  return transitionIntake(row, { event_id: "failure", expected_revision: row.revision, occurred_at: time, state: "customer_action_required", reason: "unmapped_product", next_action_at: row.next_action_at });
}
test("delivery slots freeze once dispatch starts and require a provider acknowledgement", () => {
  const attempt = deliveryAttempt();
  const prepared = prepareIntakeDelivery(null, attempt, "source_feedback", time)!;
  assert.equal(prepareIntakeDelivery(prepared, attempt, "source_feedback", time), prepared);
  const uncertain = claimIntakeDelivery(prepared, attempt, time);
  assert.equal(uncertain.state, "uncertain");
  assert.throws(() => claimIntakeDelivery(uncertain, attempt, time));
  assert.throws(() => acknowledgeIntakeDelivery(uncertain, "", time));
  const sent = acknowledgeIntakeDelivery(uncertain, "comment-id", time);
  assert.equal(acknowledgeIntakeDelivery(sent, "comment-id", time), sent);
  const later = transitionIntake(attempt, { event_id: "changed", expected_revision: attempt.revision, occurred_at: time, state: "customer_action_required", reason: "missing_required_data", next_action_at: attempt.next_action_at });
  assert.equal(prepareIntakeDelivery(uncertain, later, "source_feedback", time), uncertain);
  assert.equal(prepareIntakeDelivery(sent, later, "source_feedback", time), sent);
});
test("stale drafts cancel before dispatch and can refresh only while no send has started", () => {
  const attempt = deliveryAttempt();
  const receipt = prepareIntakeDelivery(null, attempt, "source_feedback", time)!;
  const corrected = transitionIntake(attempt, { event_id: "corrected", expected_revision: attempt.revision, occurred_at: time, state: "preparing", reason: null, next_action_at: attempt.next_action_at });
  assert.throws(() => claimIntakeDelivery(receipt, corrected, time));
  const cancelled = prepareIntakeDelivery(receipt, corrected, "source_feedback", time)!;
  assert.equal(cancelled.state, "cancelled");
  const returned = transitionIntake(corrected, { event_id: "correction-needed", expected_revision: corrected.revision, occurred_at: time, state: "customer_action_required", reason: "missing_required_data", next_action_at: corrected.next_action_at });
  const refreshed = prepareIntakeDelivery(cancelled, returned, "source_feedback", time)!;
  assert.equal(refreshed.state, "prepared"); assert.equal(refreshed.created_at, receipt.created_at);
  assert.notEqual(refreshed.payload_sha256, receipt.payload_sha256);
});
test("safe payloads and persisted receipts reject wrong channels, corruption and chronology", () => {
  const attempt = deliveryAttempt();
  assert.equal(intakeDeliveryPayload(attempt, "internal_notification", time), null);
  const email = intakeDeliveryPayload(attempt, "internal_notification", "2026-09-10T12:00:00Z")!;
  assert.equal(email.kind, "internal_notification");
  if (email.kind === "internal_notification") assert.deepEqual(email.message.to, ["pathfinder@vornan.co"]);
  const row = prepareIntakeDelivery(null, attempt, "source_feedback", time)!;
  for (const patch of [{ revision: -1 }, { state: "sent" }, { payload_sha256: "bad" }, { customer_id: "other" }, { updated_at: "bad" }]) assert.throws(() => validateIntakeDelivery({ ...row, ...patch }));
});
