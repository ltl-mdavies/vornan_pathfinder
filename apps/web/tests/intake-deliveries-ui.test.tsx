import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntakeDeliveriesTable } from "../src/IntakeDeliveries.js";
test("receipt visibility distinguishes uncertain outcome and acknowledgement without offering retries", () => {
  const row = { receipt_id: "receipt", attempt_id: "<script>bad()</script>", kind: "source_feedback", state: "uncertain", updated_at: "2026-09-10T12:00:00Z", dispatch_started_at: "2026-09-10T12:00:00Z", provider_message_id: null, needs_review: true };
  const html = renderToStaticMarkup(<IntakeDeliveriesTable rows={[row, { ...row, receipt_id: "sent", state: "sent", needs_review: false, provider_message_id: "comment" },
    { ...row, receipt_id: "closed", state: "closed_without_delivery", needs_review: false, review: { outcome: "confirmed_not_delivered", evidence_ref: "case:123", reviewed_at: row.updated_at } }]} />);
  assert.match(html, /review required/); assert.match(html, /Provider acknowledged/); assert.match(html, /including resolved intake requests/);
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<button"));
  assert.match(html, /not delivered; retry blocked/); assert.match(html, /case:123/);
});
