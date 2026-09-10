import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntakeExceptionsTable } from "../src/IntakeExceptions.js";
test("Exceptions table preserves pre-job visibility, ownership, urgency and escaped source content", () => {
  const html = renderToStaticMarkup(<IntakeExceptionsTable rows={[{
    attempt_id: "id", provider: "wrike", source_id: "<script>secret()</script>",
    state: "customer_action_required", owner: "customer", reason: "missing_order_grid",
    created_at: "2026-09-10T10:00:00Z", next_action_at: "2026-09-10T11:00:00Z", overdue: true,
    job_id: null, confirmed_order_number: null
  }]} />);
  assert.match(html, /No job created/);
  assert.match(html, /customer action required/);
  assert.match(html, /missing order grid/);
  assert.match(html, /Overdue/);
  assert.match(html, /scope="col"/);
  assert.ok(!html.includes("<script>"));
});
