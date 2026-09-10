import assert from "node:assert/strict";
import test from "node:test";
import { DynamoDBClient, GetItemCommand, PutItemCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
test("Dynamo delivery claim atomically checks intake and receipt revisions; lost acknowledgement stays uncertain", async () => {
  const original = DynamoDBClient.prototype.send;
  Object.assign(process.env, { PATHFINDER_STORAGE_DRIVER: "dynamodb", PATHFINDER_INTAKE_ATTEMPTS_TABLE: "synthetic-intake" });
  type Item = Record<string, AttributeValue>;
  const records = new Map<string, Item>();
  const key = (item: Item) => JSON.stringify([item.customer_id, item.attempt_id]);
  let failAck = false; let transactions = 0;
  DynamoDBClient.prototype.send = (async (command: GetItemCommand | PutItemCommand | TransactWriteItemsCommand) => {
    if (command instanceof GetItemCommand) return { Item: records.get(key(command.input.Key!)) };
    if (command instanceof TransactWriteItemsCommand) {
      transactions++;
      const check = command.input.TransactItems![0]!.ConditionCheck!;
      const put = command.input.TransactItems![1]!.Put!;
      assert.equal(check.Key!.customer_id!.S, "synthetic");
      assert.equal(put.Item!.customer_id!.S, "intake-delivery#synthetic");
      const previous = records.get(key(put.Item!));
      if (records.get(key(check.Key!))?.revision?.N !== check.ExpressionAttributeValues![":intake"]!.N ||
        (put.ExpressionAttributeValues ? previous?.revision?.N !== put.ExpressionAttributeValues[":expected"]!.N : !!previous)) throw Object.assign(new Error("rejected"), { name: "TransactionCanceledException" });
      records.set(key(put.Item!), structuredClone(put.Item!)); return {};
    }
    const put = command.input;
    if (failAck) throw new Error("storage unavailable");
    const previous = records.get(key(put.Item!));
    if (put.ExpressionAttributeValues && previous?.revision?.N !== put.ExpressionAttributeValues[":expected"]!.N) throw Object.assign(new Error("rejected"), { name: "ConditionalCheckFailedException" });
    records.set(key(put.Item!), structuredClone(put.Item!)); return {};
  }) as typeof original;
  try {
    const store = await import("../src/store.js");
    const time = "2026-09-10T10:00:00Z";
    const { attempt: initial } = await store.reserveIntakeAttempt({ schema_version: 1, customer_id: "synthetic", provider: "wrike", connection_id: "connection", source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: time }, "2026-09-10T11:00:00Z");
    const attempt = await store.transitionIntakeAttempt("synthetic", initial.attempt_id, { event_id: "failure", expected_revision: initial.revision, occurred_at: time, state: "internal_action_required", reason: "pathfinder_failure", next_action_at: initial.next_action_at });
    const ledger = store.intakeDeliveryLedger;
    const receipt = (await ledger.prepare(attempt, "internal_notification", time))!;
    const claims = await Promise.allSettled([ledger.claim(receipt, attempt, time), ledger.claim(receipt, attempt, time)]);
    assert.equal(claims.filter(row => row.status === "fulfilled").length, 1);
    const uncertain = (await ledger.get("synthetic", attempt.attempt_id, "internal_notification"))!;
    failAck = true;
    await assert.rejects(ledger.acknowledge(uncertain, "ses-id", time), /unavailable/);
    assert.equal((await ledger.get("synthetic", attempt.attempt_id, "internal_notification"))!.state, "uncertain");
    failAck = false;
    const feedbackAttempt = await store.transitionIntakeAttempt("synthetic", attempt.attempt_id, { event_id: "changed", expected_revision: attempt.revision, occurred_at: time, state: "internal_action_required", reason: "lift_failure", next_action_at: attempt.next_action_at });
    assert.equal((await ledger.prepare(feedbackAttempt, "internal_notification", time))!.state, "uncertain");
    assert.ok(transactions >= 3);
  } finally { DynamoDBClient.prototype.send = original; }
});
