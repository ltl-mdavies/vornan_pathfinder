import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { WrikeConnectionError } from "@pathfinder/wrike-adapter";
import { applyIntakeObservation, safePreparationFailure, type IntakeDiagnostic, type IntakeObservation } from "../src/intake-diagnostics.js";
import { decodeDiagnosticCursor, readIntakeDiagnostics, recordIntakeDiagnostic } from "../src/intake-diagnostics-store.js";
import { observeWrikePreparation } from "../src/wrike-preparation-observer.js";
import { createOperationsRouter } from "../src/operations/router.js";
import type { WrikeManualIntakeResult } from "../src/wrike-manual-intake.js";

const identity = { customer_id: "284619", import_method_id: "method-1", task_id: "MAAAAAERUQie", contract_number: "C317112", task_url: "https://www.wrike.com/open.htm?id=4585490590", observed_at: "2026-10-28T20:00:00.000Z" };
const error = new WrikeConnectionError("attachment_validation_failed", "PRIVATE https://secret.invalid?token=secret", undefined,
  { kind: "reference_pdf", file_name: "reference.pdf", reason: "file_too_large", observed_bytes: 27673344, size_source: "content_length", limit_bytes: 25 * 1024 * 1024 });
const failed = (values: Partial<IntakeObservation> = {}) => applyIntakeObservation(null, { ...identity, error, ...values })!;

test("failure before job is durable-shaped, sanitized, scoped and deduplicated", () => {
  const first = failed(); assert.equal(first.state, "open"); assert.deepEqual(first.job_ids, []);
  assert.equal(first.attachment?.observed_bytes, 27673344); assert.equal(first.task_url, identity.task_url);
  assert.ok(!JSON.stringify(first).includes("PRIVATE")); assert.ok(!JSON.stringify(first).includes("secret"));
  const second = applyIntakeObservation(first, { ...identity, observed_at: "2026-10-28T20:01:00Z", error })!;
  assert.equal(second.diagnostic_id, first.diagnostic_id); assert.equal(second.occurrences, 2);
  assert.equal(second.first_seen_at, first.first_seen_at); assert.notEqual(second.last_seen_at, first.last_seen_at);
  assert.notEqual(failed({ import_method_id: "another" }).diagnostic_id, first.diagnostic_id);
  assert.equal(failed({ customer_id: "1249" }).customer_id, "1249");
});
test("verified preparation resolves, absence does not, newer failure reopens, stale observations cannot reverse it", () => {
  const first = failed();
  assert.equal(applyIntakeObservation(first, { ...identity, observed_at: "2026-10-28T20:01:00Z", job_ids: [] }), first);
  const recovered = applyIntakeObservation(first, { ...identity, observed_at: "2026-10-28T20:02:00Z", job_ids: ["job_1"] })!;
  assert.equal(recovered.state, "resolved"); assert.equal(recovered.occurrences, 1);
  assert.equal(applyIntakeObservation(recovered, { ...identity, observed_at: "2026-10-28T20:01:00Z", error }), recovered);
  const reopened = applyIntakeObservation(recovered, { ...identity, observed_at: "2026-10-28T20:03:00Z", error })!;
  assert.equal(reopened.state, "open"); assert.equal(reopened.resolved_at, null); assert.equal(reopened.occurrences, 2);
  assert.equal(applyIntakeObservation(reopened, { ...identity, observed_at: "2026-10-28T20:02:00Z", job_ids: ["job_1"] }), reopened);
  assert.throws(() => applyIntakeObservation(first, { ...identity, customer_id: "1249", error }));
});
test("untrusted messages, URL-shaped filenames and task links are never copied", () => {
  assert.equal(safePreparationFailure(new Error("token=secret")).reason_code, "preparation_failed");
  const unsafe = new WrikeConnectionError("attachment_validation_failed", "secret", undefined, { ...error.attachment_failure!, file_name: "https://secret.invalid?signature=abc" });
  assert.equal(safePreparationFailure(unsafe).attachment?.file_name, "Attachment");
  assert.equal(failed({ task_url: "https://evil.invalid/" }).task_url, null);
});
test("observer preserves original failure and success even when diagnostic storage fails", async () => {
  const warnings: string[] = []; const broken = async () => { throw new Error("private database details"); };
  await assert.rejects(() => observeWrikePreparation(identity, async () => { throw error; }, broken, value => warnings.push(value)), value => value === error);
  const result = { summary: { blocked_count: 0, workbook_count: 1 }, workbooks: [{ job_id: "job_1" }] } as WrikeManualIntakeResult;
  assert.equal(await observeWrikePreparation(identity, async () => result, broken, value => warnings.push(value)), result);
  assert.equal(warnings.length, 2); assert.ok(!warnings.join().includes("private database"));
  let calls = 0;
  await observeWrikePreparation(identity, async () => ({ summary: { blocked_count: 0, workbook_count: 0 }, workbooks: [] } as unknown as WrikeManualIntakeResult), async () => { calls++; });
  assert.equal(calls, 0);
});
test("Dynamo conditional conflict re-reads newer state and cannot overwrite recovered record", async () => {
  const original = DynamoDBClient.prototype.send; const oldDriver = process.env.PATHFINDER_STORAGE_DRIVER; const oldTable = process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE;
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb"; process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE = "test-diagnostics";
  let gets = 0; let puts = 0;
  const recovered = applyIntakeObservation(failed(), { ...identity, observed_at: "2026-10-28T20:03:00Z", job_ids: ["job_1"] });
  DynamoDBClient.prototype.send = (async (command: any) => {
    if (command instanceof GetItemCommand) { gets++; assert.equal(command.input.ConsistentRead, true); return { Item: { data: { S: JSON.stringify(gets === 1 ? failed() : recovered) } } }; }
    assert.ok(command instanceof PutItemCommand); puts++; assert.equal(command.input.ConditionExpression, "#data = :previous");
    throw Object.assign(new Error(), { name: "ConditionalCheckFailedException" });
  }) as typeof original;
  try { await recordIntakeDiagnostic({ ...identity, observed_at: "2026-10-28T20:02:00Z", error }); assert.equal(gets, 2); assert.equal(puts, 1); }
  finally { DynamoDBClient.prototype.send = original; if (oldDriver === undefined) delete process.env.PATHFINDER_STORAGE_DRIVER; else process.env.PATHFINDER_STORAGE_DRIVER = oldDriver; if (oldTable === undefined) delete process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE; else process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE = oldTable; }
});
test("bounded query pagination stays within eligible customers and binds cursor to filter", async () => {
  const original = DynamoDBClient.prototype.send; const oldDriver = process.env.PATHFINDER_STORAGE_DRIVER; const oldTable = process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE;
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb"; process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE = "test-diagnostics";
  const row = failed(); let calls = 0;
  DynamoDBClient.prototype.send = (async (command: any) => {
    assert.ok(command instanceof QueryCommand); assert.equal(command.input.Limit, 20); assert.equal(command.input.ExpressionAttributeValues?.[":customer"]?.S, "284619"); calls++;
    if (calls === 1) return { Items: Array.from({ length: 20 }, () => ({ data: { S: JSON.stringify(row) } })), LastEvaluatedKey: { diagnostic_id: { S: row.diagnostic_id } } };
    assert.equal(command.input.ExclusiveStartKey?.diagnostic_id?.S, row.diagnostic_id); return { Items: [] };
  }) as typeof original;
  try {
    const first = await readIntakeDiagnostics(["284619"], "284619"); assert.equal(first.items.length, 20); assert.ok(first.next_cursor);
    assert.throws(() => decodeDiagnosticCursor(first.next_cursor!, "1249"));
    assert.equal((await readIntakeDiagnostics(["284619"], "284619", first.next_cursor!)).next_cursor, null);
  } finally { DynamoDBClient.prototype.send = original; if (oldDriver === undefined) delete process.env.PATHFINDER_STORAGE_DRIVER; else process.env.PATHFINDER_STORAGE_DRIVER = oldDriver; if (oldTable === undefined) delete process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE; else process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE = oldTable; }
});
test("newer success with no prior alert stores only a watermark and blocks a late failure", async () => {
  const original = DynamoDBClient.prototype.send; const oldDriver = process.env.PATHFINDER_STORAGE_DRIVER; const oldTable = process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE;
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb"; process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE = "test-diagnostics";
  let stored: any; let puts = 0;
  DynamoDBClient.prototype.send = (async (command: any) => {
    if (command instanceof GetItemCommand) return { Item: stored };
    if (command instanceof QueryCommand) return { Items: stored ? [stored] : [] };
    assert.ok(command instanceof PutItemCommand); puts++; stored = command.input.Item; return {};
  }) as typeof original;
  try {
    await recordIntakeDiagnostic({ ...identity, observed_at: "2026-10-28T20:03:00Z", job_ids: ["job_1"] });
    assert.equal(stored.state.S, "watermark"); assert.equal(stored.data, undefined);
    await recordIntakeDiagnostic({ ...identity, observed_at: "2026-10-28T20:02:00Z", error });
    assert.equal(puts, 1);
    assert.equal((await readIntakeDiagnostics(["284619"], "284619", undefined, "all")).items.length, 0);
    await recordIntakeDiagnostic({ ...identity, observed_at: "2026-10-28T20:04:00Z", error });
    assert.equal(puts, 2); assert.equal(JSON.parse(stored.data.S).occurrences, 1);
  } finally { DynamoDBClient.prototype.send = original; if (oldDriver === undefined) delete process.env.PATHFINDER_STORAGE_DRIVER; else process.env.PATHFINDER_STORAGE_DRIVER = oldDriver; if (oldTable === undefined) delete process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE; else process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE = oldTable; }
});
test("operations route is read-only, gated, workspace-scoped, no-store and fails honestly", async () => {
  let calls = 0; const dependencies = { enabled: true, customers: async () => [{ lift_customer_id: "284619" }], diagnostics: async () => { calls++; return { items: [failed(), failed({ customer_id: "1249" })], next_cursor: null }; } };
  const app = express().use(createOperationsRouter(dependencies));
  assert.equal((await request(app).get("/intake-diagnostics?customer=1249")).status, 403); assert.equal(calls, 0);
  const response = await request(app).get("/intake-diagnostics"); assert.equal(response.status, 200); assert.equal(response.body.items.length, 1);
  assert.equal(response.headers["cache-control"], "no-store"); assert.equal(response.body.total, undefined);
  assert.equal((await request(app).post("/intake-diagnostics")).status, 404);
  assert.equal((await request(express().use(createOperationsRouter({ ...dependencies, enabled: false }))).get("/intake-diagnostics")).status, 404);
  const broken = await request(express().use(createOperationsRouter({ ...dependencies, diagnostics: async () => { throw new Error("private storage"); } }))).get("/intake-diagnostics");
  assert.equal(broken.status, 503); assert.ok(!JSON.stringify(broken.body).includes("private storage"));
});
