import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
const original = DynamoDBClient.prototype.send;
type Item = Record<string, AttributeValue>;
const records = new Map<string, Item>();
const commands: unknown[] = [];
const scope = { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" };
const time = "2026-09-10T10:00:00Z";
const key = (item: Item) => JSON.stringify([item.customer_id, item.attempt_id]);
let query: (command: QueryCommand) => unknown = () => ({ Items: [] });
function condition(item: Item | undefined, expression: string, values: Item = {}) {
  if (expression.includes("attribute_not_exists")) return !item;
  if (!item) return false;
  if (values[":expected"] && item.revision?.N !== values[":expected"].N) return false;
  if (values[":owner"] && item.lease_token?.S !== values[":owner"].S) return false;
  if (expression.includes("lease_until > :now") && Number(item.lease_until?.N) <= Number(values[":now"]?.N)) return false;
  if (expression.includes("lease_until <= :now") && Number(item.lease_until?.N) > Number(values[":now"]?.N)) return false;
  return true;
}
before(() => {
  Object.assign(process.env, { PATHFINDER_STORAGE_DRIVER: "dynamodb", PATHFINDER_INTAKE_ATTEMPTS_TABLE: "synthetic-intake", PATHFINDER_JOBS_TABLE: "synthetic-jobs", PATHFINDER_SUBMIT_ATTEMPTS_TABLE: "synthetic-submits" });
  DynamoDBClient.prototype.send = (async (command: GetItemCommand | PutItemCommand | QueryCommand | TransactWriteItemsCommand) => {
    commands.push(command);
    if (command instanceof QueryCommand) {
      assert.equal(command.input.ConsistentRead, true);
      assert.equal(command.input.ExpressionAttributeValues?.[":customer"]?.S, "synthetic");
      assert.ok(command.input.Limit! <= 100);
      return query(command);
    }
    if (command instanceof GetItemCommand) { assert.equal(command.input.ConsistentRead, true); return { Item: records.get(key(command.input.Key!)) }; }
    if (command instanceof TransactWriteItemsCommand) {
      const [fence, update] = command.input.TransactItems!;
      assert.equal(command.input.TransactItems!.length, 2);
      assert.equal(fence!.ConditionCheck!.Key!.customer_id!.S, "intake-sweep#synthetic");
      const check = fence!.ConditionCheck!; const put = update!.Put!;
      if (!condition(records.get(key(check.Key!)), check.ConditionExpression!, check.ExpressionAttributeValues) ||
          !condition(records.get(key(put.Item!)), put.ConditionExpression!, put.ExpressionAttributeValues)) {
        throw Object.assign(new Error("transaction rejected"), { name: "TransactionCanceledException" });
      }
      records.set(key(put.Item!), structuredClone(put.Item!)); return {};
    }
    const put = command.input;
    if (!condition(records.get(key(put.Item!)), put.ConditionExpression!, put.ExpressionAttributeValues)) throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
    records.set(key(put.Item!), structuredClone(put.Item!)); return {};
  }) as typeof DynamoDBClient.prototype.send;
});
beforeEach(() => { records.clear(); commands.length = 0; query = () => ({ Items: [] }); });
after(() => { DynamoDBClient.prototype.send = original; });
test("Dynamo leases use conditional acquisition and atomically fence attempt writes after takeover", async () => {
  const store = await import("../src/store.js");
  const attempts = await Promise.all(["first", "second"].map(token => store.acquireIntakeSweep(scope, token, time, 30)));
  assert.equal(attempts.filter(Boolean).length, 1);
  const first = attempts.find(Boolean)!;
  assert.equal(await store.acquireIntakeSweep(scope, "busy", time, 30), null);
  const { attempt } = await store.reserveIntakeAttempt({ schema_version: 1, ...scope, source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: time }, "2026-09-10T11:00:00Z");
  const next = await store.acquireIntakeSweep(scope, "takeover", "2026-09-10T10:01:00Z", 30);
  assert.ok(next);
  const event = { event_id: "prepare", expected_revision: 0, occurred_at: "2026-09-10T10:01:00Z", state: "preparing" as const, reason: null, next_action_at: attempt.next_action_at };
  // Even a former owner with a stale pre-expiry timestamp cannot write after takeover.
  await assert.rejects(store.transitionIntakeAttempt("synthetic", attempt.attempt_id, event, { scope, lease_token: first.lease_token!, now: time }), /lease/);
  assert.equal((await store.getIntakeAttempt("synthetic", attempt.attempt_id))!.revision, 0);
  await assert.rejects(store.saveIntakeSweep(first, { ...first, revision: first.revision + 1 }, time), /lease/);
  await store.transitionIntakeAttempt("synthetic", attempt.attempt_id, event, { scope, lease_token: "takeover", now: event.occurred_at });
  assert.equal((await store.getIntakeAttempt("synthetic", attempt.attempt_id))!.revision, 1);
  assert.equal(commands.filter(command => command instanceof TransactWriteItemsCommand).length, 2);
});
test("snapshot queries are tenant-bounded, reject partial evidence, corruption and non-progressing pages", async () => {
  const { readIntakeRecoverySnapshot } = await import("../src/store.js");
  const data = { data: { S: JSON.stringify({ customer_id: "synthetic", job_id: "job" }) } };
  query = command => command.input.TableName === "synthetic-jobs" ? { Items: [data] } : { Items: [] };
  assert.equal((await readIntakeRecoverySnapshot("synthetic", 1)).jobs.length, 1);
  query = () => ({ Items: [data, data] });
  await assert.rejects(readIntakeRecoverySnapshot("synthetic", 1), /limit exceeded/);
  query = () => ({ Items: [{ data: { S: "null" } }] });
  await assert.rejects(readIntakeRecoverySnapshot("synthetic", 1), /Invalid/);
  query = () => ({ Items: [], LastEvaluatedKey: { customer_id: { S: "synthetic" }, job_id: { S: "same" } } });
  await assert.rejects(readIntakeRecoverySnapshot("synthetic", 5), /cursor repeated/);
  let page = 0;
  query = () => ({ Items: [], LastEvaluatedKey: { customer_id: { S: "synthetic" }, job_id: { S: String(++page) } } });
  await assert.rejects(readIntakeRecoverySnapshot("synthetic", 1), /page limit exceeded/);
  assert.ok(commands.every(command => command instanceof QueryCommand));
});
