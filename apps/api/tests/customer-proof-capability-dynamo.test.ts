import assert from "node:assert/strict";
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

const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: DynamoCommand): Promise<unknown>;
};
const originalSend = clientPrototype.send;
let updateCustomerProofCapabilityPolicy:
  typeof import("../src/store.ts")["updateCustomerProofCapabilityPolicy"];
let CustomerProofCapabilityConflictError:
  typeof import("../src/store.ts")["CustomerProofCapabilityConflictError"];

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
    CustomerProofCapabilityConflictError
  } = await import("../src/store.ts"));
});

beforeEach(() => {
  commands.length = 0;
  failConditionalWrite = false;
});

after(() => {
  clientPrototype.send = originalSend;
});

test("writes only the selected customer workspace with an exact conditional version", async () => {
  const updated = await updateCustomerProofCapabilityPolicy(
    customer,
    { access_mode: "review", review_experience: "advanced" },
    "operator-qa",
    initialPolicyUpdatedAt
  );

  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "PutItemCommand"
  ]);
  const put = (commands[1] as PutItemCommand).input;
  assert.equal(put.TableName, "Pathfinder-CUSTOMER_WORKSPACES-contract");
  assert.equal(put.ConditionExpression, "#stored_data = :expected_data");
  assert.equal(put.ExpressionAttributeNames?.["#stored_data"], "data");
  assert.equal(put.Item?.customer_id?.S, customer.lift_customer_id);
  assert.equal(updated.proof_capability_policy.access_mode, "review");
  assert.equal(updated.proof_capability_policy.review_experience, "advanced");
  assert.equal(updated.proof_capability_audit.length, 1);
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
