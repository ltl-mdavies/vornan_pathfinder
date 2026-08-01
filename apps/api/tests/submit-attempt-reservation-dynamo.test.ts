import assert from "node:assert/strict";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";
import type { SubmitAttempt } from "../src/store.js";

type DynamoCommand = GetItemCommand | PutItemCommand;
const commands: DynamoCommand[] = [];
let storedItem: Record<string, AttributeValue> | undefined;
const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: DynamoCommand): Promise<unknown>;
};
const originalSend = clientPrototype.send;
let reserveSubmitAttempt: typeof import("../src/store.ts")["reserveSubmitAttempt"];
let finalizeReservedSubmitAttempt: typeof import("../src/store.ts")["finalizeReservedSubmitAttempt"];

const customer = {
  lift_customer_id: "submit-reservation-dynamo-customer",
  customer_name: "Submit Reservation Dynamo Customer",
  customer_number: null,
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

function attempt(): SubmitAttempt {
  return {
    attempt_id: `submit_${"a".repeat(64)}`,
    idempotency_key: `job-dynamo:route:profile:${"b".repeat(64)}`,
    customer_id: customer.lift_customer_id,
    customer_name: customer.customer_name,
    job_id: "job-dynamo",
    output_route_id: "route-dynamo",
    output_route_name: "Dynamo Route",
    submit_profile_id: "profile-dynamo",
    submit_profile_name: "Dynamo Profile",
    submit_mode: "sandbox_customer",
    sandbox: true,
    state: "Submission Uncertain",
    transport_mode: "live",
    external_submit_enabled: true,
    request_fingerprint: "b".repeat(64),
    endpoint_url: "https://lift.invalid/create_order",
    ext_id: "PF-DYNAMO",
    company_id: "91",
    submit_request_masked: {} as SubmitAttempt["submit_request_masked"],
    certification: {
      can_submit: true,
      external_submit_enabled: true,
      summary: "Synthetic reservation",
      items: []
    },
    blocking_items: [],
    response: {
      status: "not_sent",
      http_status: null,
      lift_order_id: null,
      message: "Reserved before transport",
      raw_body: null,
      received_at: "2026-08-01T12:00:00.000Z"
    },
    created_at: "2026-08-01T12:00:00.000Z",
    updated_at: "2026-08-01T12:00:00.000Z"
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
    process.env[`PATHFINDER_${name}_TABLE`] = `Pathfinder-${name}-contract`;
  }
  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      return command.input.TableName === "Pathfinder-SUBMIT_ATTEMPTS-contract"
        ? { Item: storedItem }
        : {};
    }
    const isFinalization = command.input.ConditionExpression?.includes("transport_completed = :false");
    if (isFinalization && storedItem?.transport_completed?.BOOL === false) {
      storedItem = command.input.Item;
      return {};
    }
    if (storedItem) {
      const error = new Error("conditional reservation race");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    storedItem = command.input.Item;
    return {};
  };
  ({ reserveSubmitAttempt, finalizeReservedSubmitAttempt } = await import("../src/store.ts"));
});

beforeEach(() => {
  commands.length = 0;
  storedItem = undefined;
});

after(() => {
  clientPrototype.send = originalSend;
});

test("uses one conditional durable reservation and strongly reconciles a race", async () => {
  const value = attempt();
  const first = await reserveSubmitAttempt(customer, value);
  assert.equal(first.created, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0] instanceof PutItemCommand, true);
  const put = (commands[0] as PutItemCommand).input;
  assert.equal(put.TableName, "Pathfinder-SUBMIT_ATTEMPTS-contract");
  assert.equal(put.Item?.customer_id?.S, customer.lift_customer_id);
  assert.equal(put.Item?.attempt_id?.S, value.attempt_id);
  assert.equal(put.ConditionExpression, "attribute_not_exists(customer_id) AND attribute_not_exists(attempt_id)");

  const replay = await reserveSubmitAttempt(customer, structuredClone(value));
  assert.equal(replay.created, false);
  assert.equal(replay.attempt.idempotency_key, value.idempotency_key);
  assert.deepEqual(commands.slice(1).map((command) => command.constructor.name), [
    "PutItemCommand",
    "GetItemCommand"
  ]);
  assert.equal((commands[2] as GetItemCommand).input.ConsistentRead, true);
});

test("conditionally finalizes only the reserved transport boundary", async () => {
  const reserved = attempt();
  await reserveSubmitAttempt(customer, reserved);
  const completed: SubmitAttempt = {
    ...reserved,
    state: "Submitted",
    response: {
      ...reserved.response,
      status: "accepted",
      http_status: 200,
      lift_order_id: "A0000001",
      message: "Accepted"
    },
    updated_at: "2026-08-01T12:00:10.000Z"
  };
  const finalized = await finalizeReservedSubmitAttempt(customer, completed);
  assert.equal(finalized.state, "Submitted");
  assert.equal(storedItem?.transport_completed?.BOOL, true);
  const finalPut = commands.find(
    (command) => command instanceof PutItemCommand && command.input.ConditionExpression?.includes("transport_completed")
  ) as PutItemCommand;
  assert.equal(
    finalPut.input.ConditionExpression,
    "idempotency_key = :idempotency_key AND #state = :submission_uncertain AND transport_completed = :false"
  );

  const replay = await finalizeReservedSubmitAttempt(customer, completed);
  assert.equal(replay.state, "Submitted");
  assert.equal(replay.response.lift_order_id, "A0000001");
});
