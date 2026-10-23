import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { createOperationsRouter } from "../src/operations/router.js";
import { listWorkspaceCustomerIds, listOperationsCustomers } from "../src/store.js";

test("workspace membership is read-only, minimal, and independent of Lift status", async () => {
  const app = express().use(createOperationsRouter({ enabled: true, workspaceIds: async () => ["inactive-in-lift", "284619", "284619"] }));
  const response = await request(app).get("/customer-workspaces");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.workspace_customer_ids, ["284619", "inactive-in-lift"]);
  assert.deepEqual(Object.keys(response.body).sort(), ["checked_at", "workspace_customer_ids"]);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((await request(app).post("/customer-workspaces")).status, 404);
});

test("workspace membership is default dark and fails unavailable instead of returning an empty directory", async () => {
  let reads = 0;
  const workspaceIds = async () => { reads++; throw new Error("private storage details"); };
  assert.equal((await request(express().use(createOperationsRouter({ enabled: false, workspaceIds }))).get("/customer-workspaces")).status, 404);
  assert.equal(reads, 0);
  const response = await request(express().use(createOperationsRouter({ enabled: true, workspaceIds }))).get("/customer-workspaces");
  assert.equal(response.status, 503);
  assert.equal(response.body.workspace_customer_ids, undefined);
  assert.ok(!JSON.stringify(response.body).includes("private storage details"));
});

test("membership reader follows every page of the workspace table without reading jobs, secrets or writing", async () => {
  const previous = { ...process.env };
  const original = DynamoDBClient.prototype.send;
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_CUSTOMER_WORKSPACES_TABLE = "test-customer-workspaces";
  let reads = 0;
  DynamoDBClient.prototype.send = (async (command: ScanCommand) => {
    assert.ok(command instanceof ScanCommand);
    assert.equal(command.input.TableName, "test-customer-workspaces");
    assert.equal(command.input.ProjectionExpression, "customer_id");
    assert.equal(command.input.ConsistentRead, true);
    reads++;
    if (reads === 1) return { Items: [{ customer_id: { S: "1" } }], LastEvaluatedKey: { customer_id: { S: "1" } } };
    assert.deepEqual(command.input.ExclusiveStartKey, { customer_id: { S: "1" } });
    return { Items: [{ customer_id: { S: "2" } }] };
  }) as typeof DynamoDBClient.prototype.send;
  try { assert.deepEqual(await listWorkspaceCustomerIds(), ["1", "2"]); assert.equal(reads, 2); }
  finally {
    DynamoDBClient.prototype.send = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("Proof eligibility reads only saved membership and customer records, never the whole store", async () => {
  const previous = { ...process.env };
  const original = DynamoDBClient.prototype.send;
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_CUSTOMER_WORKSPACES_TABLE = "test-workspaces";
  process.env.PATHFINDER_CUSTOMERS_TABLE = "test-customers";
  const seen: string[] = [];
  DynamoDBClient.prototype.send = (async (command: ScanCommand) => {
    assert.ok(command instanceof ScanCommand);
    seen.push(command.input.TableName!);
    if (command.input.TableName === "test-workspaces") return { Items: [{ customer_id: { S: "1" } }] };
    assert.equal(command.input.TableName, "test-customers");
    return { Items: ["1", "2"].map(id => ({ data: { S: JSON.stringify({ lift_customer_id: id, customer_status: "Active", private_field: "not projected" }) } })) };
  }) as typeof DynamoDBClient.prototype.send;
  try {
    assert.deepEqual(await listOperationsCustomers(), [{ lift_customer_id: "1", customer_status: "Active" }]);
    assert.deepEqual(seen, ["test-workspaces", "test-customers"]);
  } finally {
    DynamoDBClient.prototype.send = original;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
