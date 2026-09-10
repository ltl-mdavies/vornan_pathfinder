import { IntakeQueryError, intakePageRequest } from "./intake-exceptions.js";
import { validateIntakeDelivery, type IntakeDeliveryReceipt } from "./intake-delivery.js";
export function deliveryPageRequest(customer: string, limit = 50, cursor?: string) {
  intakePageRequest(customer, limit);
  let after: string | undefined;
  if (cursor !== undefined) {
    try {
      if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (value.version !== 1 || value.customer_id !== customer || value.kind !== "delivery" || !/^delivery_[a-f0-9]{64}$/.test(value.after)) throw new Error();
      after = value.after;
    } catch { throw new IntakeQueryError("Invalid delivery cursor"); }
  }
  return { limit, after };
}
export function deliveryPageCursor(customer: string, after: string) {
  return Buffer.from(JSON.stringify({ version: 1, kind: "delivery", customer_id: customer, after })).toString("base64url");
}
export interface IntakeDeliveryPage { receipts: IntakeDeliveryReceipt[]; next_cursor: string | null }
export function buildIntakeDeliveryPage(page: IntakeDeliveryPage, customer: string) {
  if (page.receipts.length > 100) throw new Error("Invalid delivery page size");
  return { rows: page.receipts.map(value => {
    const row = validateIntakeDelivery(value);
    if (row.customer_id !== customer) throw new Error("Delivery tenant mismatch");
    return { receipt_id: row.receipt_id, attempt_id: row.attempt_id, kind: row.kind, state: row.state,
      created_at: row.created_at, updated_at: row.updated_at, dispatch_started_at: row.dispatch_started_at,
      provider_message_id: row.provider_message_id, needs_review: row.state === "uncertain",
      review: row.reconciliation ? { outcome: row.reconciliation.outcome, evidence_ref: row.reconciliation.evidence_ref, reviewed_at: row.reconciliation.reviewed_at } : null };
  }), next_cursor: page.next_cursor, page_uncertain_count: page.receipts.filter(row => row.state === "uncertain").length };
}
