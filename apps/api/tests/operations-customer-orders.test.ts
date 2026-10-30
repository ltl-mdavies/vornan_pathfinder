import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { customerOrderAccumulator, createCustomerOrderSummaryReader } from "../src/operations/customer-order-summary.js";
import { listCustomerOrderSummaries } from "../src/store.js";
import { createOperationsRouter } from "../src/operations/router.js";
import { parseLiftCustomerCsv, enrichLiftCustomers } from "@pathfinder/customer-directory";

const job = (extra = {}) => ({ customer_id: "c1", state: "Order Confirmed", target_order_number: "A1", order_confirmed_at: "2026-10-01T12:00:00Z", ...extra });
test("summary read coalesces concurrent navigation, preserves check time, and expires after one minute", async () => {
  let clock = 1_000, reads = 0;
  const read = createCustomerOrderSummaryReader(async ids => {
    reads++;
    await new Promise(resolve => setImmediate(resolve));
    return ids.map(customer_id => ({ customer_id, status: "none" as const }));
  }, () => clock);
  const results = await Promise.all(Array.from({ length: 20 }, () => read(["c1"])));
  assert.equal(reads, 1);
  results[0]!.items[0]!.customer_id = "tampered";
  clock = 60_999;
  assert.deepEqual(await read(["c1"]), { items: [{ customer_id: "c1", status: "none" }], checked_at: new Date(1_000).toISOString() });
  clock = 61_000;
  assert.equal((await read(["c1"])).checked_at, new Date(clock).toISOString());
  assert.equal(reads, 2);
});
test("summary cache isolates changing membership, serializes distinct scans, and never serves expired data on error", async () => {
  let clock = 0, fail = false, active = 0, peak = 0, reads = 0;
  const read = createCustomerOrderSummaryReader(async ids => {
    reads++; peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (fail) throw new Error("unavailable");
    return [...ids, "outside"].map(customer_id => ({ customer_id, status: "none" as const }));
  }, () => clock);
  const results = await Promise.all([read(["c1"]), read(["c2"])]);
  assert.deepEqual(results.map(r => r.items.map(i => i.customer_id)), [["c1"], ["c2"]]);
  assert.equal(peak, 1);
  assert.equal(reads, 2);
  clock = 60_000; fail = true;
  await assert.rejects(read(["c2"]));
  fail = false;
  assert.equal((await read(["c2"])).items[0]?.customer_id, "c2");
  assert.equal(reads, 4);
});
test("summary covers all records, deduplicates retries, and excludes failed, archived, sandbox and out-of-scope jobs", () => {
  const summary = customerOrderAccumulator(["c1", "c2"]);
  [job(), job({ order_confirmed_at: "2026-10-30T12:00:00Z" }), job({ target_order_number: "A2", order_confirmed_at: "2026-10-02T12:00:00Z" }),
    job({ state: "Submit Failed", target_order_number: "FAILED" }), job({ state: "Submitted" }), job({ sandbox: true }), job({ archived_at: "2026-10-01" }), job({ customer_id: "outside" })].forEach(summary.add);
  assert.deepEqual(summary.finish(), [{ customer_id: "c1", status: "confirmed", order_number: "A2", confirmed_at: "2026-10-02T12:00:00.000Z" }, { customer_id: "c2", status: "none" }]);
});
test("missing or invalid confirmation dates never fall back to created/updated dates", () => {
  for (const date of [null, undefined, "not-a-date", "2026-10-29"]) {
    const summary = customerOrderAccumulator(["c1"]);
    summary.add(job());
    summary.add(job({ target_order_number: "A2", order_confirmed_at: date, created_at: "2026-10-29T12:00:00Z", updated_at: "2026-10-30T12:00:00Z" }));
    assert.deepEqual(summary.finish(), [{ customer_id: "c1", status: "date_unavailable" }]);
  }
});
test("summary route is dark by default and keeps unavailable distinct from no qualifying orders", async () => {
  let reads = 0;
  const customerOrders = async () => { reads++; throw new Error("private details"); };
  const workspaceIds = async () => ["c1"];
  assert.equal((await request(express().use(createOperationsRouter({ enabled: false, workspaceIds, customerOrders }))).get("/customer-orders")).status, 404);
  assert.equal(reads, 0);
  const failed = await request(express().use(createOperationsRouter({ enabled: true, workspaceIds, customerOrders }))).get("/customer-orders");
  assert.equal(failed.status, 503);
  assert.equal(failed.body.items, undefined);
  assert.ok(!JSON.stringify(failed.body).includes("private details"));
  const app = express().use(createOperationsRouter({ enabled: true, workspaceIds, customerOrders: async ids => { assert.deepEqual(ids, ["c1"]); return [{ customer_id: "c1", status: "none" }, { customer_id: "outside", status: "none" }]; } }));
  const response = await request(app).get("/customer-orders");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.body.items, [{ customer_id: "c1", status: "none" }]);
  assert.equal((await request(app).post("/customer-orders")).status, 404);
});
test("summary follows every DynamoDB jobs page without whole-store reads or writes; corrupt later page fails closed", async () => {
  const previous = { ...process.env };
  const original = DynamoDBClient.prototype.send;
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_JOBS_TABLE = "fixture-jobs";
  let reads = 0;
  let corrupt = false;
  DynamoDBClient.prototype.send = (async (command: ScanCommand) => {
    assert.ok(command instanceof ScanCommand);
    assert.equal(command.input.TableName, "fixture-jobs");
    assert.equal(command.input.ProjectionExpression, "#data");
    assert.equal(command.input.ConsistentRead, true);
    reads++;
    if (!command.input.ExclusiveStartKey) return { Items: [{ data: { S: JSON.stringify(job()) } }], LastEvaluatedKey: { job_id: { S: "first" } } };
    return { Items: [{ data: { S: corrupt ? "broken" : JSON.stringify(job({ target_order_number: "A2", order_confirmed_at: "2026-10-28T12:00:00Z" })) } }] };
  }) as typeof DynamoDBClient.prototype.send;
  try {
    assert.equal((await listCustomerOrderSummaries(["c1"]))[0]?.order_number, "A2");
    assert.equal(reads, 2);
    corrupt = true;
    await assert.rejects(listCustomerOrderSummaries(["c1"]));
  } finally {
    DynamoDBClient.prototype.send = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
test("market adapter preserves stable customer identities and missing versus blank fields", () => {
  const rows = parseLiftCustomerCsv('CUSTOMER_ID,CUSTOMER_NAME,PRIMARY_MARKET,SALES_REP\n1,Same name,Retail,Rep A\n2,Same name,,\n');
  assert.equal(rows[0]?.primary_market, "Retail");
  assert.equal(rows[1]?.primary_market, null);
  assert.equal(parseLiftCustomerCsv('CUSTOMER_ID,CUSTOMER_NAME\n3,Legacy\n')[0]?.primary_market, undefined);
  const enriched = enrichLiftCustomers(rows, [{ lift_customer_id: "2", customer_status: "Inactive" }]);
  assert.equal(enriched.find(c => c.lift_customer_id === "1")?.primary_market, "Retail");
  assert.equal(enriched.length, 2);
});

test("summary scan stops at the page/capacity budgets without returning a partial result", async () => {
  const previous = { ...process.env };
  const original = DynamoDBClient.prototype.send;
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_JOBS_TABLE = "fixture-jobs";
  let reads = 0, cost = 0;
  DynamoDBClient.prototype.send = (async (command: ScanCommand) => {
    assert.equal(command.input.ReturnConsumedCapacity, "TOTAL");
    reads++;
    return { Items: [], ConsumedCapacity: { CapacityUnits: cost }, LastEvaluatedKey: { job_id: { S: String(reads) } } };
  }) as typeof DynamoDBClient.prototype.send;
  try {
    await assert.rejects(listCustomerOrderSummaries(["c1"]), /read budget/);
    assert.equal(reads, 25);
    reads = 0; cost = 2_600;
    await assert.rejects(listCustomerOrderSummaries(["c1"]), /read budget/);
    assert.equal(reads, 2);
  } finally {
    DynamoDBClient.prototype.send = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
