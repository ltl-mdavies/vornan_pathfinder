import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { createIntakeAttempt } from "../src/intake-assurance.js";
import { prepareIntakeDelivery, claimIntakeDelivery, validateIntakeDelivery } from "../src/intake-delivery.js";
import { reconcileIntakeDelivery, type IntakeDeliveryReview } from "../src/intake-delivery-reconciliation.js";
import { createIntakeDeliveryReviewRouter } from "../src/intake-delivery-review-router.js";
const time = "2026-09-10T12:00:00Z";
const attempt = createIntakeAttempt({ schema_version: 1, customer_id: "synthetic", provider: "wrike", connection_id: "connection", source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: "2026-09-10T10:00:00Z" }, "2026-09-10T11:00:00Z");
const uncertain = () => claimIntakeDelivery(prepareIntakeDelivery(null, attempt, "internal_notification", time)!, attempt, time);
const review = (outcome: IntakeDeliveryReview["outcome"]): IntakeDeliveryReview => ({ event_id: "review-1", expected_revision: uncertain().revision, actor_uid: "operator", outcome, evidence_ref: "case:123", provider_message_id: outcome === "provider_acknowledged" ? "message-id" : null });
test("operator reconciliation is immutable, replayable and never rearms a delivery", () => {
  for (const outcome of ["provider_acknowledged", "confirmed_not_delivered"] as const) {
    const receipt = reconcileIntakeDelivery(uncertain(), review(outcome), time);
    assert.equal(receipt.state, outcome === "provider_acknowledged" ? "sent" : "closed_without_delivery");
    assert.equal(prepareIntakeDelivery(receipt, attempt, "internal_notification", time), receipt);
    assert.equal(reconcileIntakeDelivery(receipt, review(outcome), "2026-09-10T13:00:00Z"), receipt);
    assert.throws(() => reconcileIntakeDelivery(receipt, { ...review(outcome), evidence_ref: "case:other" }, time));
    assert.throws(() => validateIntakeDelivery({ ...receipt, reconciliation: { ...receipt.reconciliation, actor_uid: "forged" } }));
  }
  assert.throws(() => reconcileIntakeDelivery(uncertain(), { ...review("provider_acknowledged"), expected_revision: 99 }, time));
});
test("review endpoint requires separate gate, tenant and authenticated operator; body cannot supply authority", async () => {
  let writes = 0;
  const args = { customer_ids: ["synthetic"], operator_uids: ["operator"], now: () => new Date(time),
    reconcile: async (_customer: string, _attempt: string, _kind: unknown, command: IntakeDeliveryReview) => { writes++; assert.equal(command.actor_uid, "operator"); return reconcileIntakeDelivery(uncertain(), command, time); } };
  const url = `/customers/synthetic/intake-deliveries/${attempt.attempt_id}/internal_notification/reconcile`;
  const { actor_uid, ...body } = review("provider_acknowledged");
  const app = (enabled: boolean, uid?: string) => express().use(express.json()).use((_req, res, next) => { res.locals.authUser = { uid }; next(); }).use(createIntakeDeliveryReviewRouter({ ...args, enabled }));
  await request(app(false, "operator")).post(url).send(body).expect(423);
  await request(app(true)).post(url).send(body).expect(403);
  await request(app(true, "outsider")).post(url).send(body).expect(403);
  await request(app(true, "operator")).post(url.replace("synthetic", "other")).send(body).expect(423);
  await request(app(true, "operator")).post(url).send({ ...body, actor_uid: "operator" }).expect(400);
  assert.equal(writes, 0);
  const result = await request(app(true, "operator")).post(url).send(body).expect(200);
  assert.equal(result.body.state, "sent"); assert.equal(result.body.review.evidence_ref, "case:123");
  assert.equal(result.headers["cache-control"], "no-store"); assert.equal(writes, 1);
});
