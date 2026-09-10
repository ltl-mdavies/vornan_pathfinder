import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { createIntakeAttempt } from "../src/intake-assurance.js";
import { prepareIntakeDelivery, claimIntakeDelivery } from "../src/intake-delivery.js";
import { deliveryPageCursor, deliveryPageRequest, buildIntakeDeliveryPage } from "../src/intake-delivery-view.js";
import { createIntakeExceptionsRouter } from "../src/intake-exceptions-router.js";
const now = "2026-09-10T12:00:00Z";
const attempt = createIntakeAttempt({ schema_version: 1, customer_id: "customer", provider: "wrike", connection_id: "connection", source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: "2026-09-10T10:00:00Z" }, "2026-09-10T11:00:00Z");
const receipt = claimIntakeDelivery(prepareIntakeDelivery(null, attempt, "internal_notification", now)!, attempt, now);
test("delivery cursors are bounded, tenant-specific and incompatible with intake cursors", () => {
  const cursor = deliveryPageCursor("customer", receipt.receipt_id);
  assert.equal(deliveryPageRequest("customer", 1, cursor).after, receipt.receipt_id);
  assert.throws(() => deliveryPageRequest("other", 1, cursor));
  for (const limit of [0, 101, 1.5]) assert.throws(() => deliveryPageRequest("customer", limit));
  assert.throws(() => deliveryPageRequest("customer", 1, "bad"));
  const page = buildIntakeDeliveryPage({ receipts: [receipt], next_cursor: cursor }, "customer");
  assert.equal(page.rows[0]!.needs_review, true); assert.equal(page.next_cursor, cursor);
  assert.ok(!JSON.stringify(page).includes("payload_sha256"));
  assert.throws(() => buildIntakeDeliveryPage({ receipts: [receipt], next_cursor: null }, "other"));
});
test("receipt route stays gated, rejects malformed pagination and sanitizes failures", async () => {
  let reads = 0; let fail = false;
  const args = { customer_ids: ["customer"], list: async () => ({ attempts: [], next_cursor: null }),
    listDeliveries: async () => { reads++; if (fail) throw new Error("SECRET"); return { receipts: [receipt], next_cursor: null }; } };
  await request(express().use(createIntakeExceptionsRouter({ ...args, enabled: false }))).get("/customers/customer/intake-deliveries").expect(423);
  assert.equal(reads, 0);
  const app = express().use(createIntakeExceptionsRouter({ ...args, enabled: true }));
  await request(app).get("/customers/other/intake-deliveries").expect(423);
  for (const query of ["limit=0", "limit=101", "limit=1&limit=2", "cursor=bad"]) await request(app).get(`/customers/customer/intake-deliveries?${query}`).expect(400);
  assert.equal(reads, 0);
  const response = await request(app).get("/customers/customer/intake-deliveries").expect(200);
  assert.equal(response.headers["cache-control"], "no-store"); assert.equal(response.body.rows[0].state, "uncertain");
  fail = true; const error = await request(app).get("/customers/customer/intake-deliveries").expect(503);
  assert.ok(!JSON.stringify(error.body).includes("SECRET"));
});
