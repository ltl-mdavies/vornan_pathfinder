import { createHash } from "node:crypto";
import { acknowledgeIntakeDelivery, deliveryTime, IntakeDeliveryConflictError, validateIntakeDelivery, type IntakeDeliveryReceipt } from "./intake-delivery.js";
export interface IntakeDeliveryReview {
  event_id: string; expected_revision: number; actor_uid: string;
  outcome: "provider_acknowledged" | "confirmed_not_delivered";
  evidence_ref: string; provider_message_id: string | null;
}
export interface IntakeDeliveryReviewAudit extends IntakeDeliveryReview { reviewed_at: string; request_sha256: string }
export function validateDeliveryReview(review: IntakeDeliveryReview) {
  if (!review || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(review.event_id) || !Number.isSafeInteger(review.expected_revision) || review.expected_revision < 0 ||
    typeof review.actor_uid !== "string" || !review.actor_uid.trim() || review.actor_uid.length > 256 ||
    !["provider_acknowledged", "confirmed_not_delivered"].includes(review.outcome) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,255}$/.test(review.evidence_ref) ||
    (review.outcome === "provider_acknowledged" ? typeof review.provider_message_id !== "string" || !review.provider_message_id.trim() || review.provider_message_id.length > 512 : review.provider_message_id !== null)) throw new Error("Invalid delivery review");
}
function reviewHash(review: IntakeDeliveryReview) {
  return createHash("sha256").update(JSON.stringify([review.event_id, review.expected_revision, review.actor_uid, review.outcome, review.evidence_ref, review.provider_message_id])).digest("hex");
}
export function validateDeliveryReviewAudit(audit: IntakeDeliveryReviewAudit) {
  validateDeliveryReview(audit); deliveryTime(audit.reviewed_at);
  if (audit.request_sha256 !== reviewHash(audit)) throw new Error("Invalid delivery review audit");
}
/** Operator attestation backed by a review reference; never reopens dispatch. */
export function reconcileIntakeDelivery(current: IntakeDeliveryReceipt, review: IntakeDeliveryReview, now: string) {
  validateIntakeDelivery(current); validateDeliveryReview(review); deliveryTime(now);
  const hash = reviewHash(review);
  if (current.reconciliation?.event_id === review.event_id) {
    if (current.reconciliation.request_sha256 !== hash) throw new IntakeDeliveryConflictError();
    return current;
  }
  if (current.state !== "uncertain" || current.reconciliation || current.revision !== review.expected_revision || deliveryTime(now) < deliveryTime(current.updated_at)) throw new IntakeDeliveryConflictError();
  const audit = { ...review, reviewed_at: now, request_sha256: hash };
  const next = review.outcome === "provider_acknowledged" ? acknowledgeIntakeDelivery(current, review.provider_message_id!, now) :
    { ...current, revision: current.revision + 1, state: "closed_without_delivery" as const, updated_at: now };
  return validateIntakeDelivery({ ...next, reconciliation: audit });
}
