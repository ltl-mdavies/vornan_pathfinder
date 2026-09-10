import { Router } from "express";
import { IntakeDeliveryConflictError, intakeDeliveryId, type IntakeDeliveryKind, type IntakeDeliveryReceipt } from "./intake-delivery.js";
import { validateDeliveryReview, type IntakeDeliveryReview } from "./intake-delivery-reconciliation.js";
import { buildIntakeDeliveryPage } from "./intake-delivery-view.js";
export function createIntakeDeliveryReviewRouter(args: {
  enabled: boolean; customer_ids: string[]; operator_uids: string[];
  reconcile: (customer: string, attempt: string, kind: IntakeDeliveryKind, review: IntakeDeliveryReview, now: string) => Promise<IntakeDeliveryReceipt>;
  now?: () => Date;
}) {
  const router = Router();
  router.post("/customers/:customerId/intake-deliveries/:attemptId/:kind/reconcile", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!args.enabled || !args.customer_ids.includes(req.params.customerId)) { res.status(423).json({ error: "Delivery reconciliation is disabled." }); return; }
    const uid = res.locals.authUser?.uid;
    if (typeof uid !== "string" || !uid || !args.operator_uids.includes(uid)) { res.status(403).json({ error: "Delivery review requires an authorized operator." }); return; }
    const body = req.body;
    let review: IntakeDeliveryReview;
    try {
      intakeDeliveryId(req.params.customerId, req.params.attemptId, req.params.kind as IntakeDeliveryKind);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["event_id", "expected_revision", "outcome", "evidence_ref", "provider_message_id"].includes(key))) throw new Error();
      review = { event_id: body.event_id, expected_revision: body.expected_revision, outcome: body.outcome, evidence_ref: body.evidence_ref, provider_message_id: body.provider_message_id ?? null, actor_uid: uid };
      validateDeliveryReview(review);
    } catch { res.status(400).json({ error: "Invalid delivery review request." }); return; }
    try {
      const receipt = await args.reconcile(req.params.customerId, req.params.attemptId, req.params.kind as IntakeDeliveryKind, review, (args.now ?? (() => new Date()))().toISOString());
      res.json(buildIntakeDeliveryPage({ receipts: [receipt], next_cursor: null }, req.params.customerId).rows[0]);
    } catch (error) {
      res.status(error instanceof IntakeDeliveryConflictError ? 409 : 503).json({ error: error instanceof IntakeDeliveryConflictError ? "Delivery changed. Reload the receipt before reviewing." : "Delivery review is temporarily unavailable." });
    }
  });
  return router;
}
