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
let rejectWrite = false;
const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: DynamoCommand): Promise<unknown>;
};
const originalSend = clientPrototype.send;
let associateJobWithLiftOrder: typeof import("../src/store.ts")["associateJobWithLiftOrder"];
let LiftOrderAssociationConflictError: typeof import("../src/store.ts")["LiftOrderAssociationConflictError"];

const customer = {
  lift_customer_id: "284619",
  customer_name: "Empirical - Momentara",
  customer_number: "0000000960",
  customer_type: null,
  customer_status: "Regular",
  sales_rep: null,
  default_invoice_email_address: null,
  created_date: null,
  crm_id: null,
  terms: null,
  terms_status: null,
  credit_limit: null,
  credit_hold: null,
  unpaid_total: null,
  available_credit: null
};

const job = {
  job_id: "job-dynamo-association",
  customer_id: customer.lift_customer_id,
  customer_name: customer.customer_name,
  output_route_id: "route-prod",
  state: "Submitted",
  created_at: "2026-08-03T18:00:00.000Z",
  updated_at: "2026-08-03T18:00:00.000Z"
};

const verification = {
  order_number: "A0227641",
  customer_id: "284619",
  customer_name: customer.customer_name,
  order_title: "C316870 - AZ Lottery",
  contract_number: "C316870",
  created_by: "PATHFINDER",
  order_status: "Pending Art Approval",
  line_count: 3,
  fetched_at: "2026-08-03T18:05:00.000Z"
};

function dataItem(value: unknown, updatedAt = "2026-08-03T18:00:00.000Z"): Record<string, AttributeValue> {
  return {
    data: { S: JSON.stringify(value) },
    updated_at: { S: updatedAt }
  };
}

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
    process.env[`PATHFINDER_${name}_TABLE`] = `Pathfinder-${name}-association-contract`;
  }
  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      if (command.input.TableName === "Pathfinder-JOBS-association-contract") {
        return { Item: dataItem(job) };
      }
      if (command.input.TableName === "Pathfinder-OUTPUT_ROUTES-association-contract") {
        return { Item: dataItem({ output_route_id: "route-prod", order_lookup_url: "https://lift.example/orders/{order_number}" }) };
      }
      return {};
    }
    if (rejectWrite) {
      const error = new Error("conditional conflict");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    return {};
  };
  ({ associateJobWithLiftOrder, LiftOrderAssociationConflictError } = await import("../src/store.ts"));
});

beforeEach(() => {
  commands.length = 0;
  rejectWrite = false;
});

after(() => {
  clientPrototype.send = originalSend;
});

test("conditionally replaces the exact current DynamoDB job version", async () => {
  const result = await associateJobWithLiftOrder(customer, {
    job_id: job.job_id,
    order_number: verification.order_number,
    expected_current_order_number: null,
    linked_by_email: "operator@vornan.co",
    reason: "Recover a verified order after a timeout.",
    verification
  });
  assert.equal(result?.job.target_order_number, "A0227641");
  assert.deepEqual(commands.map((command) => command.constructor.name), ["GetItemCommand", "GetItemCommand", "PutItemCommand"]);
  const write = commands[2] as PutItemCommand;
  assert.equal(write.input.TableName, "Pathfinder-JOBS-association-contract");
  assert.equal(write.input.ConditionExpression, "updated_at = :expected_updated_at");
  assert.equal(write.input.ExpressionAttributeValues?.[":expected_updated_at"]?.S, "2026-08-03T18:00:00.000Z");
  assert.equal(write.input.Item?.target_order_number?.S, "A0227641");
  assert.equal(write.input.Item?.data?.S?.includes("operator@vornan.co"), true);
});

test("fails closed when another operator changes the job before the conditional write", async () => {
  rejectWrite = true;
  await assert.rejects(
    associateJobWithLiftOrder(customer, {
      job_id: job.job_id,
      order_number: verification.order_number,
      expected_current_order_number: null,
      linked_by_email: "operator@vornan.co",
      reason: "Recover a verified order after a timeout.",
      verification
    }),
    (error) => error instanceof LiftOrderAssociationConflictError && /changed while/.test(error.message)
  );
});
