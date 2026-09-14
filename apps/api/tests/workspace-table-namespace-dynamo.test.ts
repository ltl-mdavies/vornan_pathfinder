import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { DynamoDBClient, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { workspaceTableBindings } from "../src/workspace-table-namespace.js";

test("compact namespace targets exact tables for recovery and feedback, and rejects conflicts before I/O", async () => {
  const original = DynamoDBClient.prototype.send; const old = { ...process.env }; const calls: string[] = [];
  for (const [key] of Object.values(workspaceTableBindings)) delete process.env[key];
  Object.assign(process.env, { PATHFINDER_STORAGE_DRIVER: "dynamodb", PATHFINDER_TABLE_NAMESPACE: "1|Fixture|prod" });
  DynamoDBClient.prototype.send = (async (command: GetItemCommand | QueryCommand) => {
    calls.push(command.input.TableName!); assert.equal(command.input.ConsistentRead,true);
    if (command instanceof QueryCommand) return { Items: [] };
    assert.ok(command instanceof GetItemCommand);
    const data = command.input.TableName === "Fixture-CustomerWorkspaces-prod" ? { customer: { lift_customer_id: "synthetic" }, source_connections: [{ connection_id: "connection", provider: "wrike", status: "Active" }] } : { customer_id: "synthetic", import_method_id: "method" };
    return { Item: { data: { S: JSON.stringify(data) } } };
  }) as typeof original;
  try {
    const { readIntakeRecoverySnapshot, readWrikeIntakeFeedbackScope } = await import("../src/store.js");
    const scope = { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" };
    await readIntakeRecoverySnapshot("synthetic", 5); await readWrikeIntakeFeedbackScope(scope);
    assert.deepEqual(calls, ["Fixture-Jobs-prod", "Fixture-SubmitAttempts-prod", "Fixture-CustomerWorkspaces-prod", "Fixture-ImportMethods-prod"]);
    calls.length=0;process.env.PATHFINDER_CUSTOMERS_TABLE="wrong-table";
    await assert.rejects(readIntakeRecoverySnapshot("synthetic",5), /conflicting/);
    await assert.rejects(readWrikeIntakeFeedbackScope(scope), /conflicting/);
    assert.deepEqual(calls, []);
  } finally { DynamoDBClient.prototype.send=original; for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});
test("ordinary workspace persistence fixtures run against compact-only physical table names", () => {
  const childEnv = { ...process.env, PATHFINDER_TEST_COMPACT_TABLES: "true" };
  delete (childEnv as NodeJS.ProcessEnv).NODE_TEST_CONTEXT;
  const result=spawnSync(process.execPath,["--import","tsx/esm","--test",new URL("./workspace-focused-persistence-dynamo.test.ts",import.meta.url).pathname],{env:childEnv,encoding:"utf8",timeout:120000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/# fail 0/);
});
