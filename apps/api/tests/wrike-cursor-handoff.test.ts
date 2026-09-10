import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { DynamoDBClient, GetItemCommand, PutItemCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
const originalSend = DynamoDBClient.prototype.send;
const records = new Map<string, Record<string, AttributeValue>>();
const key = (item: Record<string, AttributeValue>) => JSON.stringify([item.customer_id, item.attempt_id]);
const conflict = () => Object.assign(new Error("conditional conflict"), { name: "TransactionCanceledException" });
const scope = { customer_id: "synthetic", connection_id: "connection", import_method_id: "method", task_id: "TASK", trigger_status_id: "READY" };
const obs = (second: number, status: string) => ({ task_id: "TASK", custom_status_id: status, source_updated_at: `2026-09-10T10:00:0${second}Z`, observed_at: `2026-09-10T10:01:0${second}Z`, scope_verified: true, identity_matches: true });
before(() => {
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb"; process.env.PATHFINDER_INTAKE_ATTEMPTS_TABLE = "synthetic-intake";
  DynamoDBClient.prototype.send = (async (command: GetItemCommand | PutItemCommand | TransactWriteItemsCommand) => {
    if (command instanceof GetItemCommand) return { Item: records.get(key(command.input.Key!)) };
    if (command instanceof PutItemCommand) {
      const old = records.get(key(command.input.Item!));
      if (command.input.ConditionExpression?.includes("attribute_not_exists") ? !!old : old?.revision?.N !== command.input.ExpressionAttributeValues?.[":expected"]?.N) throw Object.assign(new Error("conflict"), { name: "ConditionalCheckFailedException" });
      records.set(key(command.input.Item!), structuredClone(command.input.Item!)); return {};
    }
    assert.ok(command instanceof TransactWriteItemsCommand);
    const [condition, write] = command.input.TransactItems!;
    const check = condition!.ConditionCheck!; const put = write!.Put!;
    assert.match(check.ConditionExpression!, /#data = :cursor/);
    const cursor = records.get(key(check.Key!)); const previous = records.get(key(put.Item!));
    if (cursor?.revision?.N !== check.ExpressionAttributeValues![":expected"]!.N || cursor?.data?.S !== check.ExpressionAttributeValues![":cursor"]!.S) throw conflict();
    if (put.ConditionExpression!.includes("attribute_not_exists") ? !!previous : previous?.revision?.N !== put.ExpressionAttributeValues![":expected"]!.N) throw conflict();
    records.set(key(put.Item!), structuredClone(put.Item!)); return {};
  }) as typeof DynamoDBClient.prototype.send;
});
beforeEach(() => records.clear());
after(() => { DynamoDBClient.prototype.send = originalSend; });
test("crash after cursor commit recovers one deterministic attempt; concurrent handoffs cannot duplicate", async () => {
  const store = await import("../src/store.js");
  await store.recordWrikeIntentObservation(scope, obs(0, "OTHER"));
  const cursor = await store.recordWrikeIntentObservation(scope, obs(1, "READY"));
  assert.equal(await store.getIntakeAttempt(scope.customer_id, cursor.attempt_id!), null);
  const recovered = (await store.getWrikeIntentCursor(scope))!;
  const results = await Promise.allSettled([store.reserveWrikeCursorAttempt(recovered, "2026-09-10T11:01:01Z", false), store.reserveWrikeCursorAttempt(recovered, "2026-09-10T11:01:01Z", false)]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  const first = (await store.getIntakeAttempt(scope.customer_id, cursor.attempt_id!))!;
  assert.deepEqual(await store.reserveWrikeCursorAttempt(recovered, "2026-09-10T11:01:01Z", false), first);
  assert.equal(records.size, 2);
});
test("exit racing handoff prevents any attempt write, and guarded handoff starts in manual review", async () => {
  const store = await import("../src/store.js");
  const ready = await store.recordWrikeIntentObservation(scope, obs(0, "READY"));
  await store.recordWrikeIntentObservation(scope, obs(1, "OTHER"));
  await assert.rejects(store.reserveWrikeCursorAttempt(ready, "2026-09-10T11:01:00Z", false));
  assert.equal(records.size, 1);
  const reentry = await store.recordWrikeIntentObservation(scope, obs(2, "READY"));
  const attempt = await store.reserveWrikeCursorAttempt(reentry, "2026-09-10T11:01:02Z", true);
  assert.equal(attempt.state, "manual_review"); assert.equal(attempt.job_id, null);
  assert.equal((await store.reserveWrikeCursorAttempt(reentry, "2026-09-10T12:01:02Z", false)).state, "manual_review");
});
