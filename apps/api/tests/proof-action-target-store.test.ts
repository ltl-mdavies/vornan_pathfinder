import assert from "node:assert/strict";
import test from "node:test";
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { readProofActionTargetConfig } from "../src/proof/action-target-store.ts";

test("reads only the exact active-target record with a consistent GetItem", async () => {
  let observed: GetItemCommand | null = null;
  const target = {
    target_id: "lift-standard-graphics",
    adapter: "lift-standard-graphics",
    environments: [{
      environment_id: "env-lift-prod",
      role: "PROD",
      status: "Active",
      endpoint_url: "https://ltlco.lifterp.com/ords/api/create_order"
    }]
  };
  const result = await readProofActionTargetConfig("lift-standard-graphics", {
    tableName: "Pathfinder-Targets-prod",
    client: {
      async send(command) {
        observed = command;
        return { Item: { target_id: { S: target.target_id }, data: { S: JSON.stringify(target) } } };
      }
    }
  });
  assert.deepEqual(result, target);
  assert.ok(observed instanceof GetItemCommand);
  assert.deepEqual(observed.input, {
    TableName: "Pathfinder-Targets-prod",
    Key: { target_id: { S: "lift-standard-graphics" } },
    ConsistentRead: true
  });
});

test("rejects malformed IDs and does not accept a mismatched stored target", async () => {
  let calls = 0;
  const client = {
    async send() {
      calls += 1;
      return {
        Item: {
          data: {
            S: JSON.stringify({
              target_id: "different-target",
              adapter: "lift-standard-graphics",
              environments: []
            })
          }
        }
      };
    }
  };
  await assert.rejects(
    () => readProofActionTargetConfig("bad target", { tableName: "Pathfinder-Targets-prod", client }),
    /target ID is invalid/
  );
  assert.equal(calls, 0);
  assert.equal(
    await readProofActionTargetConfig("lift-standard-graphics", {
      tableName: "Pathfinder-Targets-prod",
      client
    }),
    null
  );
});
