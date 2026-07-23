import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before } from "node:test";
import type {
  ProofDecisionCanonicalIntent,
  ProofDecisionIntegrityContract
} from "@pathfinder/proof-domain";

let storedItem: Record<string, AttributeValue> | undefined;
let failNextPut = false;
const commands: Array<GetItemCommand | PutItemCommand> = [];
const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: GetItemCommand | PutItemCommand): Promise<unknown>;
};
const originalSend = clientPrototype.send;
let ledger: ReturnType<typeof import("../src/proof/decision-ledger.ts")["createProofDecisionLedger"]>;
let ProofDecisionLedgerError: typeof import("../src/proof/decision-ledger.ts")["ProofDecisionLedgerError"];

const intent: ProofDecisionCanonicalIntent = {
  decision: "approve",
  order_number: "A0221132",
  task_id: "ptask_dynamo_ledger",
  attachment_id: "25435041",
  participant_id: "pparticipant_dynamo_ledger",
  grant_id: "pgrant_dynamo_ledger",
  expected_task_version: 9,
  expected_version_id: "pversion_dynamo_ledger_v1",
  feedback_fingerprint: "feedback-dynamo-ledger-v1",
  note: null
};

const contract: ProofDecisionIntegrityContract = {
  idempotency_key: "approval-dynamo-ledger-01",
  canonical_body_hash: createHash("sha256").update(JSON.stringify(intent)).digest("hex"),
  intent,
  outcome: "prepared"
};

before(async () => {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_PROOF_CORE_TABLE = "Pathfinder-ProofCore-contract";
  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      return { Item: storedItem };
    }
    if (failNextPut) {
      failNextPut = false;
      const error = new Error("conditional race");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    storedItem = command.input.Item;
    return {};
  };
  const module = await import("../src/proof/decision-ledger.ts");
  ledger = module.createProofDecisionLedger();
  ProofDecisionLedgerError = module.ProofDecisionLedgerError;
});

after(() => {
  clientPrototype.send = originalSend;
});

test("uses only conditional GetItem and PutItem contracts on the existing ProofCore key and TTL model", async () => {
  const reservedAt = new Date("2026-07-23T18:00:00.000Z");
  const reservation = await ledger.reserve(contract, reservedAt);
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;

  assert.equal(commands.length, 2);
  assert.ok(commands[0] instanceof GetItemCommand);
  assert.ok(commands[1] instanceof PutItemCommand);
  const createInput = (commands[1] as PutItemCommand).input;
  assert.equal(createInput.TableName, "Pathfinder-ProofCore-contract");
  assert.equal(createInput.Item?.pk?.S, "ORDER#A0221132");
  assert.equal(createInput.Item?.sk?.S, "IDEMPOTENCY#approval-dynamo-ledger-01");
  assert.equal(createInput.ConditionExpression, "attribute_not_exists(pk) AND attribute_not_exists(sk)");
  assert.equal(createInput.Item?.canonical_body_hash?.S, contract.canonical_body_hash);
  assert.equal(createInput.Item?.record_version?.N, "1");
  assert.equal(createInput.Item?.outcome?.S, "prepared");
  assert.equal(createInput.Item?.ttl_epoch?.N, String(reservation.record.expires_at_epoch));

  commands.length = 0;
  const transitioned = await ledger.transition({
    order_number: intent.order_number,
    idempotency_key: contract.idempotency_key,
    canonical_body_hash: contract.canonical_body_hash,
    expected_record_version: 1,
    next_outcome: "submission_uncertain"
  }, new Date("2026-07-23T18:01:00.000Z"));
  assert.equal(transitioned.record_version, 2);
  assert.equal(transitioned.expires_at_epoch, reservation.record.expires_at_epoch);

  assert.equal(commands.length, 2);
  assert.ok(commands[0] instanceof GetItemCommand);
  assert.ok(commands[1] instanceof PutItemCommand);
  const transitionInput = (commands[1] as PutItemCommand).input;
  assert.equal(
    transitionInput.ConditionExpression,
    "canonical_body_hash = :canonical_body_hash AND record_version = :record_version " +
      "AND #outcome = :outcome AND ttl_epoch = :ttl_epoch"
  );
  assert.deepEqual(transitionInput.ExpressionAttributeNames, { "#outcome": "outcome" });
  assert.equal(transitionInput.ExpressionAttributeValues?.[":canonical_body_hash"]?.S, contract.canonical_body_hash);
  assert.equal(transitionInput.ExpressionAttributeValues?.[":record_version"]?.N, "1");
  assert.equal(transitionInput.ExpressionAttributeValues?.[":outcome"]?.S, "prepared");
  assert.equal(
    transitionInput.ExpressionAttributeValues?.[":ttl_epoch"]?.N,
    String(reservation.record.expires_at_epoch)
  );
  assert.equal(transitionInput.Item?.ttl_epoch?.N, String(reservation.record.expires_at_epoch));
});

test("maps a Dynamo conditional transition race to one fail-closed ledger error", async () => {
  commands.length = 0;
  failNextPut = true;
  await assert.rejects(
    () => ledger.transition({
      order_number: intent.order_number,
      idempotency_key: contract.idempotency_key,
      canonical_body_hash: contract.canonical_body_hash,
      expected_record_version: 2,
      next_outcome: "reconciling"
    }, new Date("2026-07-23T18:02:00.000Z")),
    (error) => error instanceof ProofDecisionLedgerError && error.code === "concurrent_update"
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), ["GetItemCommand", "PutItemCommand"]);
});
