import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { DynamoDBClient, GetItemCommand, PutItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
const originalSend = DynamoDBClient.prototype.send;
const rows = new Map<string, Record<string, AttributeValue>>();
let unavailable = false; let puts = 0;
const scope = { customer_id: "synthetic", connection_id: "connection", import_method_id: "method", task_id: "TASK", trigger_status_id: "READY" };
const observation = (second: number, status = "READY") => ({ task_id: "TASK", custom_status_id: status, source_updated_at: `2026-09-10T10:00:0${second}Z`, observed_at: `2026-09-10T10:01:0${second}Z`, scope_verified: true, identity_matches: true });
before(() => {
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_INTAKE_ATTEMPTS_TABLE = "synthetic-intake";
  DynamoDBClient.prototype.send = (async (command: GetItemCommand | PutItemCommand) => {
    if (unavailable) throw new Error("unavailable");
    assert.ok(command instanceof GetItemCommand || command instanceof PutItemCommand);
    assert.equal(command.input.TableName, "synthetic-intake");
    const item = command instanceof GetItemCommand ? command.input.Key! : command.input.Item!;
    assert.match(item.customer_id!.S!, /^wrike-intent#/);
    const key = JSON.stringify([item.customer_id, item.attempt_id]);
    const previous = rows.get(key);
    if (command instanceof GetItemCommand) {
      assert.equal(command.input.ConsistentRead, true);
      return { Item: previous ? structuredClone(previous) : undefined };
    }
    puts++;
    const create = command.input.ConditionExpression?.includes("attribute_not_exists");
    if (create ? previous : previous?.revision?.N !== command.input.ExpressionAttributeValues?.[":expected"]?.N) {
      throw Object.assign(new Error("conflict"), { name: "ConditionalCheckFailedException" });
    }
    rows.set(key, structuredClone(item)); return {};
  }) as typeof DynamoDBClient.prototype.send;
});
beforeEach(() => { rows.clear(); puts = 0; unavailable = false; });
after(() => { DynamoDBClient.prototype.send = originalSend; });
test("concurrent duplicate entries and re-entries advance once with CAS and recover the same identity", async () => {
  const { recordWrikeIntentObservation, getWrikeIntentCursor } = await import("../src/store.js");
  const entry = await Promise.all(Array.from({ length: 8 }, () => recordWrikeIntentObservation(scope, observation(0))));
  assert.equal(new Set(entry.map(row => row.attempt_id)).size, 1);
  assert.ok(entry.every(row => row.generation === 1 && row.revision === 1));
  await recordWrikeIntentObservation(scope, observation(1, "OTHER"));
  const next = await Promise.all(Array.from({ length: 8 }, () => recordWrikeIntentObservation(scope, observation(2))));
  assert.ok(next.every(row => row.generation === 2 && row.revision === 3));
  assert.notEqual(next[0]!.attempt_id, entry[0]!.attempt_id);
  assert.deepEqual(await getWrikeIntentCursor(scope), next[0]);
  const beforeReplay = puts;
  assert.deepEqual(await recordWrikeIntentObservation(scope, observation(2)), next[0]);
  assert.equal(puts, beforeReplay);
  assert.equal(rows.size, 1); // No IntakeAttempt record or other ledger was written.
  assert.equal(await getWrikeIntentCursor({ ...scope, customer_id: "other" }), null);
  await assert.rejects(recordWrikeIntentObservation(scope, observation(1, "OTHER")), /Stale/);
});
test("impossible persisted cursor/native revision fails get and mutation without overwriting", async () => {
  const { recordWrikeIntentObservation, getWrikeIntentCursor } = await import("../src/store.js");
  await recordWrikeIntentObservation(scope, observation(0));
  const [key, item] = [...rows.entries()][0]!;
  for (const corrupted of [{ ...item, data: { S: JSON.stringify({ ...JSON.parse(item.data!.S!), in_intent: false }) } },
    { ...item, revision: { N: "99" } }, { ...item, data: { S: "null" } }]) {
    rows.set(key, corrupted);
    const before = puts;
    await assert.rejects(getWrikeIntentCursor(scope));
    await assert.rejects(recordWrikeIntentObservation(scope, observation(1)));
    assert.equal(puts, before);
  }
});
test("storage outage propagates and cannot manufacture a new generation", async () => {
  const { recordWrikeIntentObservation } = await import("../src/store.js");
  unavailable = true;
  await assert.rejects(recordWrikeIntentObservation(scope, observation(0)), /unavailable/);
  assert.equal(rows.size, 0);
});
test("racing exit and later entry reread the winning revision without double advancement", async () => {
  const { recordWrikeIntentObservation, getWrikeIntentCursor } = await import("../src/store.js");
  await recordWrikeIntentObservation(scope, observation(0));
  const results = await Promise.allSettled([recordWrikeIntentObservation(scope, observation(1, "OTHER")),
    recordWrikeIntentObservation(scope, observation(2))]);
  assert.ok(results.some(result => result.status === "fulfilled"));
  const final = (await getWrikeIntentCursor(scope))!;
  assert.equal(final.in_intent, true);
  assert.equal(final.source_updated_at, observation(2).source_updated_at);
  assert.ok(final.generation === 1 || final.generation === 2);
  // If the later ready edit wins before the exit, the missed exit cannot be inferred.
  assert.equal((await recordWrikeIntentObservation(scope, observation(2))).generation, final.generation);
});
