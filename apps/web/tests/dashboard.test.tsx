import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dashboardAttention, dashboardIssue, dashboardProofOrders, dashboardRecent, readDashboardProof } from "../src/dashboard-model";
import { configurePathfinderApiAuth } from "../src/api-client";
import type { OperationsJob, OperationsProofLine } from "../src/operations-model";

const now = Date.parse("2026-10-23T16:00:00Z");
const job = (id: string, patch: Partial<OperationsJob> = {}): OperationsJob => ({ id, label: id, customerId: "1", customer: "One", sourceOrder: id, intake: "Wrike", liftOrder: null, processing: "Submitted", production: "—", createdAt: "2026-10-23T14:00:00Z", confirmedAt: null, activityAt: "2026-10-23T15:00:00Z", archived: false, ...patch });
const line = (id: string, patch: Partial<OperationsProofLine> = {}): OperationsProofLine => ({ id, customerId: "1", customer: "One", orderNumber: "A001", orderTitle: null, lineNumber: "1", product: "Print", state: "pending", creativeCount: 1, since: "2026-10-22T14:00:00Z", lastSynced: "2026-10-23T15:55:00Z", stale: false, ...patch });

test("dashboard attention excludes ordinary confirming, confirmed historical failures and archived jobs", () => {
  const jobs = [job("confirming"), job("ready", { processing: "Ready" }), job("old", { processing: "Failed", liftOrder: "A001" }), job("archived", { processing: "Failed", archived: true }), job("mapping", { processing: "Needs Mapping" }), job("failed", { processing: "Submit Failed" }), job("retry", { processing: "Retry" })];
  assert.deepEqual(dashboardAttention(jobs).map(j => j.id), ["failed", "mapping", "retry"]);
  assert.equal(jobs[0].id, "confirming");
  assert.equal(dashboardIssue(jobs[5]), "Lift submission needs review");
  assert.deepEqual(dashboardAttention([job("unknown", { processing: "toString" })]), []);
});
test("recent orders are across customers and intakes, newest created first, bounded and nonmutating", () => {
  const jobs = [job("old-active", { createdAt: "2026-01-01", activityAt: "2026-10-24" }), ...Array.from({ length: 6 }, (_, i) => job(`j${i}`, { customerId: String(i), intake: i % 2 ? "JSON API" : "Wrike", createdAt: `2026-10-${20 + i}T12:00:00Z` })), job("archived", { createdAt: "2026-12-01", archived: true })];
  assert.deepEqual(dashboardRecent(jobs).map(j => j.id), ["j5", "j4", "j3", "j2", "j1"]);
  assert.equal(jobs[0].id, "old-active");
});
test("proof preview groups pending lines by customer/order, deduplicates and never includes reviewed/reference work", () => {
  const rows = [line("1"), line("1"), line("2", { lineNumber: "2" }), line("3", { state: "reviewed" }), line("4", { state: "changes" }), line("5", { state: "waiting" }), line("6", { customerId: "2", customer: "Two" })];
  const groups = dashboardProofOrders(rows, now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].pending, 2);
  assert.equal(groups[1].pending, 1);
  assert.equal(groups[1].customerId, "2");
});
test("proof stale cache and missing dates are visible instead of inferred approval freshness", () => {
  assert.equal(dashboardProofOrders([line("1", { lastSynced: "2026-10-23T15:00:00Z" })], now)[0].stale, true);
  assert.equal(dashboardProofOrders([line("1", { lastSynced: "invalid", since: "invalid" })], now)[0].since, null);
  assert.equal(dashboardProofOrders([line("1", { stale: true })], now)[0].stale, true);
  assert.equal(dashboardProofOrders([line("1")], now)[0].stale, false);
});
test("mixed creative states still contribute a pending line to the Dashboard", () => {
  const groups = dashboardProofOrders([line("mixed", { state: "changes", stateCounts: { changes: 1, pending: 2, reference: 1 } })], now);
  assert.equal(groups[0]?.pending, 1);
});
test("proof preview uses a single bounded authenticated no-store cache read even when more pages exist", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  configurePathfinderApiAuth({ apiBaseUrl: "https://api.example.test", token: "test-only-token" });
  globalThis.fetch = async (input, init = {}) => { calls.push({ url: String(input), init }); return new Response(JSON.stringify({ lines: [line("1")], coverage: "cached_orders_only", checked_at: new Date(now).toISOString(), next_cursor: "more" }), { status: 200 }); };
  try {
    const controller = new AbortController();
    const page = await readDashboardProof("https://api.example.test", controller.signal);
    assert.equal(page.next_cursor, "more");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.example.test/api/operations/proof-queue");
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(calls[0].init.signal, controller.signal);
    assert.equal(calls[0].init.method, undefined);
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer test-only-token");
  } finally { globalThis.fetch = original; configurePathfinderApiAuth({ apiBaseUrl: "", token: null }); }
});
test("disabled, failed and malformed queue reads do not become successful empty queues", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [404, 503]) {
      globalThis.fetch = async () => new Response("", { status });
      await assert.rejects(readDashboardProof("https://api.example.test", new AbortController().signal), status === 404 ? /not enabled/ : /could not be refreshed/);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ lines: [] }), { status: 200 });
    await assert.rejects(readDashboardProof("https://api.example.test", new AbortController().signal), /incomplete data/);
  } finally { globalThis.fetch = original; }
});
test("dashboard drilldown uses existing guarded Proof tools and does not mutate any provider", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const dashboard = await readFile(new URL("../src/OperationsDashboard.tsx", import.meta.url), "utf8");
  const model = await readFile(new URL("../src/dashboard-model.ts", import.meta.url), "utf8");
  assert.match(app, /onOpenProof=\{\(order, customer\) => \{ setOperationsProofOrder\(\{ order, customer \}\); setActiveGlobalView\("Proof"\); \}\}/);
  assert.match(app, /expectedCustomerId=\{operationsProofOrder.customer\}/);
  assert.match(app, /warning: scheduledSubmissionHealth\?\.state === "unhealthy"/);
  assert.match(dashboard, /generation.current\+\+; controller.abort\(\)/);
  assert.match(dashboard, /Last loaded preview retained/);
  assert.match(dashboard, /Open job issues · All dates/);
  assert.match(dashboard, /Partial cache preview/);
  assert.doesNotMatch(dashboard + model, /method: "POST"|method: "PUT"|method: "DELETE"|\/sync|\/grants|status.vornan/);
});
