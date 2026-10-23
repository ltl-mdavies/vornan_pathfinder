import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import type { ProofOrder, ProofTask } from "@pathfinder/proof-domain";
import { projectProofQueue } from "../src/operations/proof-queue.js";
import { decodeQueueCursor } from "../src/operations/proof-queue-store.js";
import { createOperationsRouter } from "../src/operations/router.js";

const date = "2026-10-23T14:20:00.000Z";
const task = (patch: Partial<ProofTask> = {}): ProofTask => ({ task_id: "task-1", order_line_id: "line-1", line_number: "1", attachment_id: "art-1", product_name: "Print", quantity: 10, state: "pending", actionable: true, sibling_index: 0, sibling_count: 1, version: 1, current_version: null, versions: [], created_at: date, updated_at: date, archived_at: null, ...patch });
const order = (patch: Partial<ProofOrder> = {}): ProofOrder => ({ order_number: "A0233914", order_title: "Order", customer_id: "284619", customer_name: "Momentara", order_status: "Proof", health: "active", version: 1, lines: [], tasks: [task()], archived_tasks: [], warnings: [], created_at: date, updated_at: date, last_synced_at: date, ...patch });

test("groups multiple creatives into one line without fabricating approvals", () => {
  const rows = projectProofQueue(order({ tasks: [task(), task({ task_id: "task-2", state: "approved", actionable: false })] }), Date.parse(date));
  assert.equal(rows.length, 1); assert.equal(rows[0]?.state, "pending"); assert.equal(rows[0]?.stale, false);
});
test("current normalized state can move both forward and backward", () => {
  assert.equal(projectProofQueue(order({ tasks: [task({ state: "approved", actionable: false })] }))[0]?.state, "approved");
  assert.equal(projectProofQueue(order())[0]?.state, "pending");
  assert.equal(projectProofQueue(order({ tasks: [task({ state: "waiting", actionable: false })] }))[0]?.state, "waiting");
});
test("mixed lines retain pending creatives and distinguish every recorded decision from Lift outcomes", () => {
  const decision = (action: "CANCEL_LINE" | "REVISED_ART_WILL_BE_SENT" | "REJECT", state: "cancel_requested" | "revised_art_pending" | "rejected_pending_action") => task({ task_id: action, actionable: false, decision_context: { action, state, attachment_id: "art", recorded_at: date, source: "pathfinder_customer_decision" } });
  const row = projectProofQueue(order({ tasks: [task(), decision("CANCEL_LINE", "cancel_requested"), decision("REVISED_ART_WILL_BE_SENT", "revised_art_pending"), decision("REJECT", "rejected_pending_action"), task({ task_id: "approved", state: "approved", actionable: false }), task({ task_id: "reference", state: "reference", actionable: false, updated_at: "2026-10-23T15:00:00Z" })] }))[0]!;
  assert.equal(row.state, "pending");
  assert.deepEqual(row.stateCounts, { pending: 1, cancel_requested: 1, revision_pending: 1, changes: 1, approved: 1, reference: 1 });
  assert.equal(row.since, "2026-10-23T15:00:00Z");
});
test("reference, cancelled, missing orders, archived tasks and decisions are not pending approvals", () => {
  assert.equal(projectProofQueue(order({ tasks: [task({ state: "reference", actionable: false })] }))[0]?.state, "reference");
  assert.deepEqual(projectProofQueue(order({ tasks: [task({ state: "cancelled" })] })), []);
  assert.deepEqual(projectProofQueue(order({ health: "missing" })), []);
  assert.deepEqual(projectProofQueue(order({ tasks: [task({ archived_at: date })] })), []);
  assert.equal(projectProofQueue(order({ tasks: [task({ decision_context: { state: "sent_back_to_artist", action: "SEND_BACK_TO_ARTIST", attachment_id: "art-1", recorded_at: date, source: "pathfinder_operator_action" } })] }))[0]?.state, "changes");
});
test("stale or invalid timestamps are explicit, unknown customer identities are excluded", () => {
  assert.equal(projectProofQueue(order(), Date.parse(date) + 16 * 60_000)[0]?.stale, true);
  assert.equal(projectProofQueue(order({ last_synced_at: "invalid" }))[0]?.stale, true);
  assert.deepEqual(projectProofQueue(order({ customer_id: null })), []);
});
test("cursor is bound to customer scope and malformed values are rejected", () => {
  const cursor = Buffer.from(JSON.stringify({ customer: "284619", offset: 20 })).toString("base64url");
  assert.equal(decodeQueueCursor(cursor, "284619")?.offset, 20);
  assert.throws(() => decodeQueueCursor(cursor, "1249"));
  assert.throws(() => decodeQueueCursor("not-json", ""));
});
function app(enabled: boolean, list = async () => ({ orders: [order(), order({ customer_id: "inactive" }), order({ customer_id: "1249", order_number: "A0233886" })], next_cursor: "next" as string | null })) {
  return express().use("/api/operations", createOperationsRouter({ enabled, list, customers: async () => [{ lift_customer_id: "284619", customer_status: "Active" }, { lift_customer_id: "1249", customer_status: "Active" }, { lift_customer_id: "inactive", customer_status: "Inactive" }] }));
}
test("feature is default-dark and does not read when disabled", async () => {
  let reads = 0; const response = await request(app(false, async () => { reads++; return { orders: [], next_cursor: null }; })).get("/api/operations/proof-queue");
  assert.equal(response.status, 404); assert.equal(reads, 0);
});
test("global and fixed-customer queues enforce active workspace scope without provider calls", async () => {
  const global = await request(app(true)).get("/api/operations/proof-queue");
  assert.equal(global.status, 200); assert.equal(global.body.lines.length, 2);
  assert.equal(global.body.coverage, "cached_orders_only"); assert.equal(global.body.next_cursor, "next");
  assert.equal(global.headers["cache-control"], "no-store");
  const customer = await request(app(true)).get("/api/operations/proof-queue?customer=1249");
  assert.equal(customer.body.lines.length, 1); assert.equal(customer.body.lines[0].customerId, "1249");
  assert.equal((await request(app(true)).get("/api/operations/proof-queue?customer=inactive")).status, 403);
});
test("queue returns sanitized source failures and rejects writes", async () => {
  const server = app(true, async () => { throw new Error("private-token"); });
  const result = await request(server).get("/api/operations/proof-queue");
  assert.equal(result.status, 503); assert.ok(!JSON.stringify(result.body).includes("private-token"));
  assert.equal((await request(server).post("/api/operations/proof-queue")).status, 404);
});

test("operations API is mounted after the existing authentication boundary", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const auth = source.indexOf('app.use("/api", requirePathfinderAuth)');
  const operations = source.indexOf('app.use("/api/operations", createOperationsRouter())');
  assert.ok(auth >= 0 && operations > auth);
});
