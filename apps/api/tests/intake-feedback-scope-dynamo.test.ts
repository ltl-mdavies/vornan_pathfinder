import assert from "node:assert/strict";
import test from "node:test";
import { DynamoDBClient, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createIntakeAttempt } from "../src/intake-assurance.js";
import { prepareIntakeDelivery } from "../src/intake-delivery.js";
test("feedback scope uses only exact consistent reads and receipt listing queries the reserved tenant partition", async () => {
  const original = DynamoDBClient.prototype.send;
  Object.assign(process.env, { PATHFINDER_STORAGE_DRIVER: "dynamodb", PATHFINDER_CUSTOMER_WORKSPACES_TABLE: "synthetic-workspaces", PATHFINDER_IMPORT_METHODS_TABLE: "synthetic-methods", PATHFINDER_INTAKE_ATTEMPTS_TABLE: "synthetic-intakes" });
  let wrongTenant = false; let gets = 0; let queries = 0;
  const scope = { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" };
  const attempt = createIntakeAttempt({ schema_version: 1, ...scope, source_id: "task", intent_key: "order", intent_occurrence: "initial", observed_at: "2026-09-10T10:00:00Z" }, "2026-09-10T11:00:00Z");
  const receipt = prepareIntakeDelivery(null, attempt, "internal_notification", "2026-09-10T12:00:00Z")!;
  DynamoDBClient.prototype.send = (async (command: GetItemCommand | QueryCommand) => {
    assert.equal(command.input.ConsistentRead, true);
    if (command instanceof GetItemCommand) {
      gets++; assert.equal(command.input.Key!.customer_id!.S, "synthetic");
      const data = command.input.TableName === "synthetic-workspaces" ? { customer: { lift_customer_id: "synthetic" }, source_connections: [{ connection_id: "connection", provider: "wrike", status: "Active" }] } :
        { customer_id: wrongTenant ? "other" : "synthetic", import_method_id: "method" };
      if (command.input.TableName === "synthetic-methods") assert.equal(command.input.Key!.import_method_id!.S, "method");
      return { Item: { data: { S: JSON.stringify(data) } } };
    }
    assert.ok(command instanceof QueryCommand); queries++;
    assert.equal(command.input.ExpressionAttributeValues![":customer"]!.S, "intake-delivery#synthetic");
    assert.equal(command.input.Limit, 1);
    return { Items: [{ data: { S: JSON.stringify(receipt) } }], LastEvaluatedKey: { customer_id: { S: "intake-delivery#synthetic" }, attempt_id: { S: receipt.receipt_id } } };
  }) as typeof original;
  try {
    const { readWrikeIntakeFeedbackScope, listIntakeDeliveriesPage } = await import("../src/store.js");
    assert.equal((await readWrikeIntakeFeedbackScope(scope)).connection.connection_id, "connection");
    assert.equal(gets, 2);
    wrongTenant = true; await assert.rejects(readWrikeIntakeFeedbackScope(scope), /tenant/);
    const page = await listIntakeDeliveriesPage("synthetic", 1);
    assert.equal(page.receipts[0]!.receipt_id, receipt.receipt_id); assert.ok(page.next_cursor); assert.equal(queries, 1);
  } finally { DynamoDBClient.prototype.send = original; }
});
