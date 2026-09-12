import assert from "node:assert/strict";
import test from "node:test";
import { observeWrikeShadow, wrikeShadowKey, createDynamoWrikeShadowStore, type WrikeShadowInput, type WrikeShadowRecord, type WrikeShadowStore } from "../src/wrike-shadow-observation.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { runWrikeScheduledIntake, runWrikeScheduledSubmits, runWrikeScheduledStatusWritebacks } from "../src/wrike-scheduled-intake.js";
import type { WrikeScopedIntakeDiscoveryResult } from "@pathfinder/wrike-adapter";

const environment = { PATHFINDER_ENABLE_INTAKE_SHADOW: "true", PATHFINDER_STORAGE_DRIVER: "dynamodb",
  PATHFINDER_INTAKE_ATTEMPTS_TABLE: "synthetic-intake", PATHFINDER_INTAKE_SHADOW_SCOPE: "1|customer|method|connection|READY",
  PATHFINDER_INTAKE_SHADOW_LIMITS: "1|3|3600|100" };
const scope = { customer_id: "customer", import_method_id: "method", connection_id: "connection", configured_status_id: "READY", configured_status_label: "Sent to Print – LTL" };
function discovery(count = 1, inStatus = true, second = 0): WrikeScopedIntakeDiscoveryResult {
  const tasks = Array.from({ length: count }, (_, i) => ({ task_id: `TASK${i}`, custom_status_id: inStatus ? "READY" : "OTHER", updated_at: `2026-09-10T12:00:0${second}Z`,
    account_id: "ACCOUNT", root_folder_ids: ["ROOT"] }));
  return { checked_at: `2026-09-10T12:00:0${second}Z`, order_candidates: inStatus ? tasks : [],
    pending_order_candidates: inStatus ? [] : tasks.map(t => ({ ...t, identity_matches: true, reasons: [{ code: "trigger_status" }] })),
    summary: { resolved_order_status_ids: ["READY"] } } as unknown as WrikeScopedIntakeDiscoveryResult;
}
function memory() {
  const rows = new Map<string, WrikeShadowRecord>(); let reads = 0; let writes = 0; let factories = 0;
  const store: WrikeShadowStore = {
    read: async identity => { reads++; return structuredClone(rows.get(wrikeShadowKey(identity).attempt_id) ?? null); },
    write: async (row, revision) => {
      const key = wrikeShadowKey(row.scope).attempt_id;
      assert.equal(rows.get(key)?.revision ?? null, revision); writes++; rows.set(key, structuredClone(row));
    }
  };
  return { rows, store, factory: () => { factories++; return store; }, counts: () => ({ reads, writes, factories }) };
}
async function ordinary(d = discovery()) {
  const calls = { discovery: 0, preparation: 0, submission: 0, writeback: 0 };
  const intake = await runWrikeScheduledIntake({
    config: { enabled: true, customer_id: "customer", import_method_id: "method", max_candidates: 25, lift_submit_enabled: true, status_writeback_enabled: true },
    discover: async () => { calls.discovery++; return d.order_candidates.map(t => ({ task_id: t.task_id, contract_number: "C", trigger_status_id: "READY" })); },
    prepare: async t => { calls.preparation++; return { task_id: t.task_id, status: "Created" as const, job_ids: [`job-${t.task_id}`] }; }
  });
  const candidates = intake.results.flatMap(r => r.job_ids.map(job_id => ({ job_id })));
  const submits = await runWrikeScheduledSubmits({ candidates, submit: async () => { calls.submission++; return { reused: false }; } });
  const writes = await runWrikeScheduledStatusWritebacks({ candidates, writeBack: async () => { calls.writeback++; return { reused: false }; } });
  const input: WrikeShadowInput = { scope: { ...scope }, discovery: d, result: { ...intake, scheduled_submit: submits, status_writeback: writes } };
  return { input, calls, frozen: structuredClone(input) };
}
test("dark mode has zero persistence/telemetry/config I/O and preserves ordinary outputs", async () => {
  const f = memory(); const run = await ordinary(); let logs = 0;
  const env = new Proxy({}, { get: (_o, key) => { assert.equal(key, "PATHFINDER_ENABLE_INTAKE_SHADOW"); return "false"; } });
  await observeWrikeShadow({ environment: env, input: run.input, store: f.factory, report: () => logs++ });
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, factories: 0 }); assert.equal(logs, 0);
  assert.deepEqual(run.input, run.frozen); assert.deepEqual(run.calls, { discovery: 1, preparation: 1, submission: 1, writeback: 1 });
});
test("first-seen and repeated intent remain observational, without inferring unseen status exits", async () => {
  const f = memory();
  for (const [second, ready] of [[0, true], [1, false], [2, true]] as const) {
    const run = await ordinary(discovery(1, ready, second));
    await observeWrikeShadow({ environment, input: run.input, store: f.factory, report: () => {} });
    assert.deepEqual(run.input, run.frozen);
    assert.deepEqual(run.calls, { discovery: 1, preparation: ready ? 1 : 0, submission: ready ? 1 : 0, writeback: ready ? 1 : 0 });
  }
  const row = [...f.rows.values()][0]!;
  assert.equal(row.cursor.generation, 1); assert.equal(row.cursor.entry_proven, false);
  assert.equal(row.attempt!.state, "manual_review"); assert.equal(row.attempt!.next_action_at, "2026-09-10T13:00:00.000Z");
  assert.deepEqual(row.outcomes.jobs, ["job-TASK0"]); assert.equal(row.outcomes.submits[0]!.outcome, "submitted");
  assert.equal(row.outcomes.writebacks[0]!.outcome, "posted");
  assert.equal(wrikeShadowKey(row.scope).customer_id, "intake-shadow#customer");
});
test("out-of-status pending records never touch storage; mixed batches persist exact-status tasks only", async () => {
  const f = memory(); const outside = await ordinary(discovery(1, false));
  await observeWrikeShadow({ environment, input: outside.input, store: f.factory, report: () => {} });
  assert.deepEqual(f.counts(), { reads: 0, writes: 0, factories: 0 }); assert.deepEqual(outside.input, outside.frozen);
  const mixed = discovery(1); mixed.pending_order_candidates = discovery(2, false).pending_order_candidates.slice(1);
  const run = await ordinary(mixed);
  await observeWrikeShadow({ environment, input: run.input, store: f.factory, report: () => {} });
  assert.equal(f.rows.size, 1); assert.equal([...f.rows.values()][0]!.scope.task_id, "TASK0");
  assert.deepEqual(run.input, run.frozen); assert.deepEqual(run.calls, { discovery: 1, preparation: 1, submission: 1, writeback: 1 });
  const ambiguous = await ordinary(discovery(1)); ambiguous.input.discovery.pending_order_candidates = discovery(1, false).pending_order_candidates;
  const g = memory(); await observeWrikeShadow({ environment, input: ambiguous.input, store: g.factory, report: () => {} });
  assert.deepEqual(g.counts(), { reads: 0, writes: 0, factories: 0 });
});
test("same discovery/outcomes replay without a second write and bounded batch has one row per task", async () => {
  const f = memory(); const run = await ordinary(discovery(3));
  for (let i = 0; i < 2; i++) await observeWrikeShadow({ environment, input: run.input, store: f.factory, report: () => {} });
  assert.equal(f.rows.size, 3); assert.deepEqual(f.counts(), { reads: 6, writes: 3, factories: 2 });
  assert.deepEqual(run.calls, { discovery: 1, preparation: 3, submission: 3, writeback: 3 });
});
test("scope, status, metadata, duplicate and candidate limits fail before any table access", async () => {
  const cases: Array<(input: WrikeShadowInput) => void> = [
    input => { input.scope.customer_id = "other"; }, input => { input.scope.import_method_id = "other"; },
    input => { input.scope.connection_id = "other"; }, input => { input.scope.configured_status_id = "other"; },
    input => { input.scope.configured_status_label = "other"; }, input => { input.result.customer_id = "other"; },
    input => { input.discovery.summary.resolved_order_status_ids = ["other"]; },
    input => { input.discovery.order_candidates[0]!.updated_at = null; },
    input => { input.discovery.order_candidates.push(input.discovery.order_candidates[0]!); }
  ];
  for (const change of cases) {
    const f = memory(); const run = await ordinary(); change(run.input); const reports: unknown[] = [];
    await observeWrikeShadow({ environment, input: run.input, store: f.factory, report: x => reports.push(x) });
    assert.deepEqual(f.counts(), { reads: 0, writes: 0, factories: 0 }); assert.equal((reports[0] as { status: string }).status, "failed");
  }
  const f = memory(); const run = await ordinary(discovery(4));
  await observeWrikeShadow({ environment, input: run.input, store: f.factory, report: () => {} });
  assert.equal(f.counts().writes, 0); assert.equal(run.calls.preparation, 4); assert.equal(run.calls.discovery, 1);
});
test("invalid/dual-mode configuration skips observation, without wrapping preparation", async () => {
  for (const patch of [
    { PATHFINDER_INTAKE_SHADOW_LIMITS: "1|1000|3600|100" }, { PATHFINDER_INTAKE_SHADOW_LIMITS: "1|3|3600|1001" },
    { PATHFINDER_INTAKE_SHADOW_SCOPE: "1|customer|method|connection|READY|extra" },
    { PATHFINDER_ENABLE_INTAKE_ASSURANCE_CAPTURE: "true" }, { PATHFINDER_ENABLE_INTAKE_RECOVERY_SWEEP: "true" },
    { PATHFINDER_STORAGE_DRIVER: "local" }
  ]) {
    const f = memory(); const run = await ordinary();
    await observeWrikeShadow({ environment: { ...environment, ...patch }, input: run.input, store: f.factory, report: () => {} });
    assert.equal(f.counts().factories, 0); assert.deepEqual(run.input, run.frozen);
  }
});
test("persistence, CAS and telemetry failures are aggregate-only and do not change completed work", async () => {
  for (const stage of ["read", "write", "report"] as const) {
    const f = memory(); const run = await ordinary(discovery(2)); const messages: unknown[] = [];
    if (stage !== "report") f.store[stage] = async () => { throw new Error("CUSTOMER TASK PROVIDER SECRET"); };
    await observeWrikeShadow({ environment, input: run.input, store: f.factory, report: x => { messages.push(x); if (stage === "report") throw Error("sink failed"); } });
    assert.deepEqual(run.input, run.frozen); assert.equal(run.calls.preparation, 2); assert.equal(run.calls.discovery, 1);
    assert.doesNotMatch(JSON.stringify(messages), /CUSTOMER|TASK|PROVIDER|SECRET|customer|connection|job-/);
    assert.equal((messages[0] as { status: string }).status, stage === "report" ? "observed" : "failed");
  }
});
test("shared abort deadline stops a stalled read and starts no later write", async () => {
  const run = await ordinary(); let aborted = false; let writes = 0;
  await observeWrikeShadow({ environment: { ...environment, PATHFINDER_INTAKE_SHADOW_LIMITS: "1|3|3600|50" }, input: run.input,
    store: () => ({ read: async (_scope, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(Error("aborted")); }, { once: true })),
      write: async () => { writes++; } }), report: () => {} });
  assert.equal(aborted, true); assert.equal(writes, 0); assert.deepEqual(run.input, run.frozen);
});
test("Lambda skips when completion margin is insufficient or unavailable", async () => {
  for (const remainingTimeMs of [undefined, () => 2000, () => NaN, () => { throw Error("bad context"); }]) {
    const f = memory(); const run = await ordinary();
    await observeWrikeShadow({ environment: { ...environment, PATHFINDER_RUNTIME: "lambda" }, remainingTimeMs, input: run.input, store: f.factory, report: () => {} });
    assert.equal(f.counts().factories, 0); assert.deepEqual(run.input, run.frozen);
  }
});

test("Dynamo adapter uses only scoped Get/conditional Put and forwards the shared abort signal", async () => {
  const f = memory(); const run = await ordinary();
  await observeWrikeShadow({ environment, input: run.input, store: f.factory, report: () => {} });
  const row = [...f.rows.values()][0]!; const requests: Array<Record<string, unknown>> = [];
  const abort = new AbortController(); let wrongTenant = false; let conflict = false;
  const client = new DynamoDBClient({ region: "us-east-1", maxAttempts: 1, credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
    requestHandler: { handle: async (request, options) => {
      assert.equal(options?.abortSignal, abort.signal);
      requests.push(JSON.parse(request.body as string));
      if (conflict) throw Error("ConditionalCheckFailedException");
      const isGet = request.headers["x-amz-target"]?.endsWith("GetItem");
      return { response: { statusCode: 200, headers: {}, body: Buffer.from(JSON.stringify(isGet ? { Item: {
        customer_id: { S: wrongTenant ? "intake-shadow#other" : "intake-shadow#customer" },
        attempt_id: { S: wrikeShadowKey(row.scope).attempt_id }, revision: { N: "1" }, data: { S: JSON.stringify(row) }
      } } : {})) } };
    } } });
  const store = createDynamoWrikeShadowStore("synthetic-intake", client);
  try {
    assert.deepEqual(await store.read(row.scope, abort.signal), row);
    await store.write(row, null, abort.signal);
    await store.write({ ...row, revision: 2 }, 1, abort.signal);
    assert.equal(requests[0]!.ConsistentRead, true);
    assert.deepEqual(requests[0]!.Key, { customer_id: { S: "intake-shadow#customer" }, attempt_id: { S: wrikeShadowKey(row.scope).attempt_id } });
    assert.equal(requests[1]!.ConditionExpression, "attribute_not_exists(customer_id) AND attribute_not_exists(attempt_id)");
    assert.equal(requests[2]!.ConditionExpression, "#revision = :previous");
    assert.ok(requests.every(r => r.TableName === "synthetic-intake"));
    wrongTenant = true; await assert.rejects(store.read(row.scope, abort.signal), /tenant/);
    conflict = true; const before = requests.length; await assert.rejects(store.write(row, 1, abort.signal));
    assert.equal(requests.length - before, 1);
  } finally { store.close?.(); }
});
