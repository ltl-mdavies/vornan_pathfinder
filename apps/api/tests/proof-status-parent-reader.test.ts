import assert from "node:assert/strict";
import test from "node:test";
import type { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { readDynamoStatusParent, readStatusParent } from "../src/proof/status-parent-reader.ts";

const hash = "a".repeat(64);
const env = { PATHFINDER_PROOF_STATUS_PARENT_TOKENS_TABLE: "test-tokens", PATHFINDER_PROOF_CUSTOMER_WORKSPACES_TABLE: "test-workspaces" };
const parent = { token_hash: hash, status: "Active" };
const workspace = { customer: { lift_customer_id: "1249" }, status_access_policy: { proof_visibility: "review_link" } };
const denied = { parent: null, visibility: undefined };
function fixture(tokenData = JSON.stringify(parent), workspaceData = JSON.stringify(workspace)) {
  const calls: GetItemCommand[] = [];
  return { calls, send: async (command: GetItemCommand) => {
    calls.push(command);
    return { $metadata: {}, Item: { ...command.input.Key, data: { S: command.input.TableName === env.PATHFINDER_PROOF_STATUS_PARENT_TOKENS_TABLE ? tokenData : workspaceData } } };
  } };
}
test("isolated parent lookup uses only two strongly consistent exact-key reads", async () => {
  const f = fixture();
  assert.deepEqual(await readDynamoStatusParent(hash, "1249", env, f.send), { parent, visibility: "review_link" });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(c => c.input.Key), [{ token_hash: { S: hash } }, { customer_id: { S: "1249" } }]);
  for (const call of f.calls) { assert.equal(call.constructor.name, "GetItemCommand"); assert.equal(call.input.ConsistentRead, true); }
});
test("foreign customer, malformed hash and missing configuration never issue a read", async () => {
  const f = fixture();
  assert.deepEqual(await readDynamoStatusParent(hash, "175332", env, f.send), denied);
  assert.deepEqual(await readDynamoStatusParent("private-token", "1249", env, f.send), denied);
  assert.deepEqual(await readDynamoStatusParent(hash, "1249", {}, f.send), denied);
  assert.deepEqual(await readDynamoStatusParent(hash, "1249", { ...env, PATHFINDER_PROOF_CUSTOMER_WORKSPACES_TABLE: "*" }, f.send), denied);
  assert.equal(f.calls.length, 0);
});
test("main API reuses only its existing token binding and workspace namespace", async () => {
  const calls: GetItemCommand[] = [];
  const result = await readDynamoStatusParent(hash, "1249", {
    PATHFINDER_STORAGE_DRIVER: "dynamodb", PATHFINDER_TABLE_NAMESPACE: "1|Pathfinder|prod",
    PATHFINDER_ORDER_STATUS_TOKENS_TABLE: "test-tokens"
  }, async command => {
    calls.push(command);
    return { $metadata: {}, Item: { ...command.input.Key, data: { S: JSON.stringify(command.input.Key?.token_hash ? parent : workspace) } } };
  });
  assert.equal(result.visibility, "review_link");
  assert.deepEqual(calls.map(c => c.input.TableName), ["test-tokens", "Pathfinder-CustomerWorkspaces-prod"]);
  assert.deepEqual(await readDynamoStatusParent(hash, "1249", { PATHFINDER_STORAGE_DRIVER: "dynamodb" }, fixture().send), denied);
});
test("missing, corrupt, mismatched and unavailable records fail closed", async () => {
  for (const [token, record] of [["null", JSON.stringify(workspace)], ["{", JSON.stringify(workspace)],
    [JSON.stringify({ ...parent, token_hash: "b".repeat(64) }), JSON.stringify(workspace)],
    [JSON.stringify(parent), "null"], [JSON.stringify(parent), "{"],
    [JSON.stringify(parent), JSON.stringify({ ...workspace, customer: { lift_customer_id: "175332" } })]]) {
    assert.deepEqual(await readDynamoStatusParent(hash, "1249", env, fixture(token, record).send), denied);
  }
  assert.deepEqual(await readDynamoStatusParent(hash, "1249", env, async () => ({ $metadata: {} })), denied);
  assert.deepEqual(await readDynamoStatusParent(hash, "1249", env, async () => { throw new Error("denied"); }), denied);
});
test("Lambda does not fall back to the general file store when parent bindings are missing", async () => {
  const original = process.env.PATHFINDER_RUNTIME;
  process.env.PATHFINDER_RUNTIME = "lambda";
  try { assert.deepEqual(await readStatusParent(hash, "1249"), denied); }
  finally { if (original === undefined) delete process.env.PATHFINDER_RUNTIME; else process.env.PATHFINDER_RUNTIME = original; }
});
