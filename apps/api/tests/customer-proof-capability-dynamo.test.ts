import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";

type DynamoCommand = GetItemCommand | PutItemCommand;
const commands: DynamoCommand[] = [];
let failConditionalWrite = false;
const customer = {
  lift_customer_id: "284619",
  customer_name: "Empirical - Momentara",
  customer_number: "0000000960",
  customer_status: "Active",
  contacts: []
};
const initialPolicyUpdatedAt = "2026-08-13T16:00:00.000Z";
let storedItem: Record<string, AttributeValue> = {
  customer_id: { S: customer.lift_customer_id },
  data: {
    S: JSON.stringify({
      customer,
      source_connections: [],
      templates: [],
      catalog_presets: [],
      product_mapping_replacement_checkpoint: null,
      product_mapping_replacement_history: [],
      product_mapping_active_versions: {},
      status_access_policy: {
        mode: "Invite only",
        allow_public_status_links: false,
        proof_visibility: "off",
        approved_email_domains: [],
        updated_at: initialPolicyUpdatedAt
      },
      proof_capability_policy: {
        access_mode: "view_only",
        review_experience: "simple",
        customer_identity: {
          proof_customer_id: "1249",
          verified_order_number: "A0226753",
          verified_at: "2026-08-13T15:59:00.000Z",
          verified_by: "operator-qa"
        },
        order_overrides: [],
        updated_at: initialPolicyUpdatedAt,
        updated_by: "system-default"
      },
      proof_capability_audit: [],
      primary_target_id: "lift-production",
      primary_output_route_id: "route-lift-production",
      updated_at: initialPolicyUpdatedAt
    })
  },
  updated_at: { S: initialPolicyUpdatedAt }
};
const initialStoredItem = structuredClone(storedItem);

const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: DynamoCommand): Promise<unknown>;
};
const originalSend = clientPrototype.send;
let updateCustomerProofCapabilityPolicy:
  typeof import("../src/store.ts")["updateCustomerProofCapabilityPolicy"];
let upsertCustomerProofOrderOverride:
  typeof import("../src/store.ts")["upsertCustomerProofOrderOverride"];
let removeCustomerProofOrderOverride:
  typeof import("../src/store.ts")["removeCustomerProofOrderOverride"];
let verifyCustomerProofCustomerIdentity:
  typeof import("../src/store.ts")["verifyCustomerProofCustomerIdentity"];
let CustomerProofCapabilityConflictError:
  typeof import("../src/store.ts")["CustomerProofCapabilityConflictError"];
let CustomerProofCapabilityPersistenceError:
  typeof import("../src/store.ts")["CustomerProofCapabilityPersistenceError"];

before(async () => {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  for (const name of [
    "CUSTOMERS",
    "CUSTOMER_WORKSPACES",
    "TARGETS",
    "IMPORT_METHODS",
    "OUTPUT_ROUTES",
    "PRODUCT_MAPPINGS",
    "JOBS",
    "ORDER_IDS",
    "SUBMIT_ATTEMPTS",
    "LIFT_PRODUCT_CACHE",
    "ORDER_STATUS_TOKENS",
    "ORDER_STATUS_SNAPSHOTS",
    "CANONICAL_REGISTRY"
  ]) {
    process.env[`PATHFINDER_${name}_TABLE`] = `Pathfinder-${name}-contract`;
  }
  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) return { Item: structuredClone(storedItem) };
    if (failConditionalWrite) {
      const error = new Error("concurrent customer Proof settings write");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    storedItem = structuredClone(command.input.Item!);
    return {};
  };
  ({
    updateCustomerProofCapabilityPolicy,
    upsertCustomerProofOrderOverride,
    removeCustomerProofOrderOverride,
    verifyCustomerProofCustomerIdentity,
    CustomerProofCapabilityPersistenceError,
    CustomerProofCapabilityConflictError
  } = await import("../src/store.ts"));
});

beforeEach(() => {
  commands.length = 0;
  failConditionalWrite = false;
  storedItem = structuredClone(initialStoredItem);
});

after(() => {
  clientPrototype.send = originalSend;
});

function storedWorkspace() {
  return JSON.parse(storedItem.data!.S!) as Record<string, unknown>;
}

function withoutProofPolicyFields(workspace: Record<string, unknown>) {
  const copy = structuredClone(workspace);
  delete copy.proof_capability_policy;
  delete copy.proof_capability_audit;
  delete copy.updated_at;
  return copy;
}

function assertOnlySelectedWorkspaceCommands() {
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "PutItemCommand"
  ]);
  for (const command of commands) {
    assert.equal(command.input.TableName, "Pathfinder-CUSTOMER_WORKSPACES-contract");
  }
}

test("writes only the selected customer workspace with an exact conditional version and preserves non-Proof fields", async () => {
  const before = storedWorkspace();
  const updated = await updateCustomerProofCapabilityPolicy(
    customer,
    { access_mode: "review", review_experience: "advanced" },
    "operator-qa",
    initialPolicyUpdatedAt
  );

  assertOnlySelectedWorkspaceCommands();
  const put = (commands[1] as PutItemCommand).input;
  assert.equal(put.TableName, "Pathfinder-CUSTOMER_WORKSPACES-contract");
  assert.equal(put.ConditionExpression, "#stored_data = :expected_data");
  assert.equal(put.ExpressionAttributeNames?.["#stored_data"], "data");
  assert.equal(put.Item?.customer_id?.S, customer.lift_customer_id);
  assert.equal(updated.proof_capability_policy.access_mode, "review");
  assert.equal(updated.proof_capability_policy.review_experience, "advanced");
  assert.equal(updated.proof_capability_audit.length, 1);
  assert.deepEqual(withoutProofPolicyFields(storedWorkspace()), withoutProofPolicyFields(before));
});

test("writes an exact order override without touching another customer or a non-workspace table", async () => {
  const updated = await upsertCustomerProofOrderOverride(
    customer,
    "A0228753",
    { access_mode: "review", review_experience: "simple" },
    "operator-qa",
    initialPolicyUpdatedAt
  );

  assertOnlySelectedWorkspaceCommands();
  assert.deepEqual(updated.proof_capability_policy.order_overrides, [{
    order_number: "A0228753",
    access_mode: "review",
    review_experience: "simple",
    updated_at: updated.proof_capability_policy.order_overrides[0]?.updated_at,
    updated_by: "operator-qa"
  }]);
  assert.equal(updated.proof_capability_audit[0]?.scope, "order");
  assert.equal(updated.proof_capability_audit[0]?.order_number, "A0228753");
});

test("treats identical default and override requests as idempotent no-ops", async () => {
  const unchanged = await updateCustomerProofCapabilityPolicy(
    customer,
    { access_mode: "view_only", review_experience: "simple" },
    "operator-qa",
    initialPolicyUpdatedAt
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), ["GetItemCommand"]);
  assert.equal(unchanged.proof_capability_policy.updated_at, initialPolicyUpdatedAt);
  assert.equal(unchanged.proof_capability_audit.length, 0);

  commands.length = 0;
  const unchangedOverride = await upsertCustomerProofOrderOverride(
    customer,
    "A0228753",
    { access_mode: "view_only", review_experience: "simple" },
    "operator-qa",
    initialPolicyUpdatedAt
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), ["GetItemCommand"]);
  assert.equal(unchangedOverride.proof_capability_policy.order_overrides.length, 0);

  commands.length = 0;
  const unchangedRemoval = await removeCustomerProofOrderOverride(
    customer,
    "A0228753",
    "operator-qa",
    initialPolicyUpdatedAt
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), ["GetItemCommand"]);
  assert.equal(unchangedRemoval.proof_capability_audit.length, 0);

  commands.length = 0;
  const unchangedIdentity = await verifyCustomerProofCustomerIdentity(
    customer,
    "1249",
    "A0226753",
    "operator-qa",
    initialPolicyUpdatedAt
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), ["GetItemCommand"]);
  assert.equal(unchangedIdentity.proof_capability_audit.length, 0);
});

test("surfaces a conflict instead of overwriting a concurrent customer workspace change", async () => {
  const current = JSON.parse(storedItem.data!.S!) as {
    proof_capability_policy: { updated_at: string };
  };
  failConditionalWrite = true;
  await assert.rejects(
    updateCustomerProofCapabilityPolicy(
      customer,
      { access_mode: "disabled", review_experience: "simple" },
      "operator-qa",
      current.proof_capability_policy.updated_at
    ),
    (error) => error instanceof CustomerProofCapabilityConflictError
  );
});

test("sanitizes an unavailable exact workspace persistence failure", async () => {
  failConditionalWrite = false;
  const unavailableSend = clientPrototype.send;
  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) return { Item: structuredClone(storedItem) };
    throw new Error("raw Dynamo failure should not leave the store boundary");
  };
  try {
    await assert.rejects(
      updateCustomerProofCapabilityPolicy(
        customer,
        { access_mode: "disabled", review_experience: "simple" },
        "operator-qa",
        initialPolicyUpdatedAt
      ),
      (error) => error instanceof CustomerProofCapabilityPersistenceError
    );
    assertOnlySelectedWorkspaceCommands();
  } finally {
    clientPrototype.send = unavailableSend;
  }
});

test("policy and override endpoints do not orchestrate sync, grants, or other customer persistence", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const defaultStart = source.indexOf('app.put("/api/customers/:liftCustomerId/proof-capability-policy",');
  const overrideStart = source.indexOf(
    'app.put("/api/customers/:liftCustomerId/proof-capability-policy/orders/:orderNumber",'
  );
  const removeStart = source.indexOf(
    'app.delete("/api/customers/:liftCustomerId/proof-capability-policy/orders/:orderNumber",'
  );
  const nextRoute = source.indexOf('app.get("/api/customers/:liftCustomerId/product-mappings"', removeStart);
  assert.ok(defaultStart > 0 && overrideStart > defaultStart && removeStart > overrideStart && nextRoute > removeStart);

  const routes = [
    source.slice(defaultStart, overrideStart),
    source.slice(overrideStart, removeStart),
    source.slice(removeStart, nextRoute)
  ];
  assert.match(routes[0]!, /updateCustomerProofCapabilityPolicy/);
  assert.match(routes[1]!, /upsertCustomerProofOrderOverride/);
  assert.match(routes[2]!, /removeCustomerProofOrderOverride/);
  for (const route of routes) {
    assert.match(route, /emitProofCapabilityPolicyPersistenceTelemetry/);
    assert.doesNotMatch(route, /getOrCreateWorkspace/);
    assert.doesNotMatch(route, /syncProofOrder/);
    assert.doesNotMatch(route, /revokeProofGrantForCapabilityChange/);
    assert.doesNotMatch(route, /listCustomerCapabilityProofGrants/);
    assert.doesNotMatch(route, /listOrderProofGrants/);
  }

  const identityStart = source.indexOf('app.post("/api/customers/:liftCustomerId/proof-capability-policy/identity",');
  assert.ok(identityStart > 0 && identityStart < defaultStart);
  assert.match(source.slice(identityStart, defaultStart), /syncProofOrder/);
});
