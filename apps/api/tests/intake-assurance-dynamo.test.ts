import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import type { IntakeSignal } from "../src/intake-assurance.js";
const originalSend = DynamoDBClient.prototype.send;
const records = new Map<string, Record<string, AttributeValue>>();
let unavailable = false;
const commands: (GetItemCommand | PutItemCommand | QueryCommand)[] = [];
const signal: IntakeSignal = { schema_version: 1, customer_id: "synthetic", provider: "api", connection_id: "api", source_id: "request", intent_key: "submit", intent_occurrence: "1", observed_at: "2026-09-10T10:00:00Z" };
const deadline = "2026-09-10T11:00:00Z";
before(() => {
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_INTAKE_ATTEMPTS_TABLE = "synthetic-intake";
  DynamoDBClient.prototype.send = (async (command: GetItemCommand | PutItemCommand | QueryCommand) => {
    commands.push(command);
    if (unavailable) throw new Error("Dynamo unavailable");
    if (command instanceof QueryCommand) {
      assert.equal(command.input.KeyConditionExpression, "customer_id = :customer");
      assert.equal(command.input.ConsistentRead, true);
      const customer = command.input.ExpressionAttributeValues![":customer"]!.S;
      const after = command.input.ExclusiveStartKey?.attempt_id?.S;
      const all = [...records.values()].filter((item) => item.customer_id?.S === customer && (!after || item.attempt_id!.S! > after))
        .sort((left, right) => left.attempt_id!.S!.localeCompare(right.attempt_id!.S!));
      const items = all.slice(0, command.input.Limit);
      return { Items: items, LastEvaluatedKey: all.length > items.length ? { customer_id: items.at(-1)!.customer_id, attempt_id: items.at(-1)!.attempt_id } : undefined };
    }
    const item = command instanceof PutItemCommand ? command.input.Item! : command.input.Key!;
    const key = JSON.stringify([item.customer_id, item.attempt_id]);
    const previous = records.get(key);
    if (command instanceof GetItemCommand) { assert.equal(command.input.ConsistentRead, true); return { Item: previous }; }
    assert.equal(command.input.TableName, "synthetic-intake");
    const create = command.input.ConditionExpression?.includes("attribute_not_exists");
    if (create ? previous : previous?.revision?.N !== command.input.ExpressionAttributeValues?.[":expected"]?.N) {
      throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
    }
    records.set(key, structuredClone(item));
    return {};
  }) as typeof DynamoDBClient.prototype.send;
});
beforeEach(() => { records.clear(); commands.length = 0; unavailable = false; });
test("Dynamo enumeration paginates by tenant without skipping requests or scanning", async () => {
  unavailable = false;
  const { reserveIntakeAttempt, listIntakeAttemptsPage } = await import("../src/store.js");
  for (const source_id of ["request-2", "request-3", "request-4"]) await reserveIntakeAttempt({ ...signal, source_id }, deadline);
  await reserveIntakeAttempt({ ...signal, customer_id: "another-tenant" }, deadline);
  const first = await listIntakeAttemptsPage(signal.customer_id, 2);
  assert.equal(first.attempts.length, 2);
  assert.ok(first.next_cursor);
  const second = await listIntakeAttemptsPage(signal.customer_id, 2, first.next_cursor!);
  assert.equal(second.attempts.length, 1);
  assert.equal(second.next_cursor, null);
  assert.equal(new Set([...first.attempts, ...second.attempts].map((entry) => entry.attempt_id)).size, 3);
  await assert.rejects(listIntakeAttemptsPage("another-tenant", 2, first.next_cursor!));
});
after(() => { DynamoDBClient.prototype.send = originalSend; });
test("durable reservation, replay, tenant isolation, concurrent CAS and unavailable storage", async () => {
  const { reserveIntakeAttempt, getIntakeAttempt, transitionIntakeAttempt } = await import("../src/store.js");
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveIntakeAttempt(signal, deadline)));
  assert.equal(results.filter((result) => result.created).length, 1);
  const id = results[0]!.attempt.attempt_id;
  assert.equal(await getIntakeAttempt("other", id), null);
  const e = { event_id: "prepare", expected_revision: 0, occurred_at: signal.observed_at, state: "preparing" as const, reason: null, next_action_at: deadline };
  const transitions = await Promise.allSettled([transitionIntakeAttempt(signal.customer_id, id, e), transitionIntakeAttempt(signal.customer_id, id, { ...e, event_id: "other-worker" })]);
  assert.equal(transitions.filter((entry) => entry.status === "fulfilled").length, 1);
  const stored = (await getIntakeAttempt(signal.customer_id, id))!;
  assert.equal(stored.revision, 1);
  assert.deepEqual(await transitionIntakeAttempt(signal.customer_id, id, stored.last_event!), stored);
  const replay = await reserveIntakeAttempt({ ...signal, observed_at: deadline }, "2026-09-10T12:00:00Z");
  assert.equal(replay.attempt.created_at, signal.observed_at);
  assert.equal(replay.attempt.next_action_at, deadline);
  unavailable = true;
  await assert.rejects(reserveIntakeAttempt(signal, deadline), /Dynamo unavailable/);
  assert.ok(commands.every((command) => command instanceof GetItemCommand || command instanceof PutItemCommand));
});

test("corrupt persisted data cannot silently disappear from the Exceptions page", async () => {
  const { reserveIntakeAttempt, listIntakeAttemptsPage, getIntakeAttempt } = await import("../src/store.js");
  const reserved = await reserveIntakeAttempt(signal, deadline);
  const key = [...records.keys()][0]!;
  const item = records.get(key)!;
  records.set(key, { ...item, data: { S: JSON.stringify({ ...reserved.attempt, revision: -1 }) } });
  await assert.rejects(listIntakeAttemptsPage(signal.customer_id), /Invalid persisted/);
  await assert.rejects(getIntakeAttempt(signal.customer_id, reserved.attempt.attempt_id), /Invalid persisted/);
  records.set(key, { ...item, data: { S: "null" } });
  await assert.rejects(listIntakeAttemptsPage(signal.customer_id), /Invalid persisted/);
});
