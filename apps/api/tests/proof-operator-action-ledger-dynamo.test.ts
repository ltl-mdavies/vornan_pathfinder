import assert from "node:assert/strict";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import type {
  ProofOperatorActionRecord
} from "../src/proof/operator-action-store.ts";

type DynamoCommand = GetItemCommand | TransactWriteItemsCommand;
const commands: DynamoCommand[] = [];
let storedCore: Record<string, AttributeValue> | undefined;
let storedAudit: Record<string, AttributeValue> | undefined;
const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: DynamoCommand): Promise<unknown>;
};
const originalSend = clientPrototype.send;
let reserve: typeof import("../src/proof/operator-action-store.ts")["reserveProofOperatorAction"];
let transition: typeof import("../src/proof/operator-action-store.ts")["transitionProofOperatorAction"];
let getRecord: typeof import("../src/proof/operator-action-store.ts")["getProofOperatorActionRecord"];

const record: ProofOperatorActionRecord = {
  idempotency_key: "operator-action-dynamo-0001",
  canonical_body_hash: "a".repeat(64),
  request_body_sha256: "b".repeat(64),
  action: "APPROVE",
  order_number: "A0226753",
  task_id: "ptask_dynamo_001",
  order_line_id: "line-dynamo-001",
  attachment_id: "proofing-dynamo-0001",
  expected_task_version: 7,
  expected_version_id: "pversion-dynamo-001",
  feedback_fingerprint: "feedback-dynamo-001",
  target_id: "lift-standard-graphics",
  environment_id: "env-lift-prod",
  note_sha256: null,
  revision_asset_id: null,
  revision_publication_id: null,
  revision_id: null,
  revision_source_object_version_sha256: null,
  revision_outbound_object_version_sha256: null,
  revision_asset_sha256: null,
  revision_outbound_sha256: null,
  revision_delivery_url_sha256: null,
  revision_lift_not_before_epoch: null,
  revision_retention_anchor_at: null,
  revision_retention_days: null,
  revision_cleanup_eligible_at_epoch: null,
  prepared_audit_event_id: `paudit_operator-${"c".repeat(64)}`,
  outcome: "prepared",
  record_version: 1,
  created_at: "2026-07-27T12:00:00.000Z",
  updated_at: "2026-07-27T12:00:00.000Z",
  expires_at_epoch:
    Math.floor(Date.parse("2026-07-27T12:00:00.000Z") / 1_000) +
    30 * 24 * 60 * 60,
  attempt_id: null,
  response_classification: null
};

function audit(
  action: ProofAuditEvent["action"],
  eventId: string,
  decisionOutcome: ProofOperatorActionRecord["outcome"] = "prepared"
): ProofAuditEvent {
  return {
    event_id: eventId,
    occurred_at: record.created_at,
    action,
    outcome: "succeeded",
    order_number: record.order_number,
    task_id: record.task_id,
    order_line_id: record.order_line_id,
    attachment_id: record.attachment_id,
    grant_id: null,
    participant_id: null,
    actor_type: "operator",
    actor_id: "operator_synthetic",
    correlation_id: "correlation-synthetic",
    metadata: {
      source: "operator",
      operator_action_kind: record.action,
      decision_outcome: decisionOutcome
    }
  };
}

before(async () => {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_PROOF_CORE_TABLE = "Pathfinder-ProofCore-operator-contract";
  process.env.PATHFINDER_PROOF_AUDIT_TABLE = "Pathfinder-ProofAudit-operator-contract";
  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      return {
        Item:
          command.input.TableName === "Pathfinder-ProofAudit-operator-contract"
            ? storedAudit
            : storedCore
      };
    }
    const items = command.input.TransactItems ?? [];
    assert.equal(items.length, 2);
    storedCore = items[0]?.Put?.Item;
    storedAudit = items[1]?.Put?.Item;
    return {};
  };
  const module = await import("../src/proof/operator-action-store.ts");
  reserve = module.reserveProofOperatorAction;
  transition = module.transitionProofOperatorAction;
  getRecord = module.getProofOperatorActionRecord;
});

beforeEach(() => {
  commands.length = 0;
  storedCore = undefined;
  storedAudit = undefined;
});

after(() => {
  clientPrototype.send = originalSend;
});

test("atomically reserves the sanitized operator intent and retained audit in the two existing tables", async () => {
  const preparedAudit = audit("proof.operator_action_prepared", record.prepared_audit_event_id);
  const result = await reserve(record, preparedAudit);
  assert.equal(result.status, "new");
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "TransactWriteItemsCommand"
  ]);
  const transaction = (commands[0] as TransactWriteItemsCommand).input;
  assert.equal(transaction.TransactItems?.length, 2);
  const core = transaction.TransactItems?.[0]?.Put;
  const auditPut = transaction.TransactItems?.[1]?.Put;
  assert.equal(core?.TableName, "Pathfinder-ProofCore-operator-contract");
  assert.equal(core?.Item?.pk?.S, "ORDER#A0226753");
  assert.equal(core?.Item?.sk?.S, "OPERATOR_ACTION#operator-action-dynamo-0001");
  assert.equal(core?.ConditionExpression, "attribute_not_exists(pk) AND attribute_not_exists(sk)");
  assert.equal(core?.Item?.ttl_epoch?.N, String(record.expires_at_epoch));
  assert.equal(auditPut?.TableName, "Pathfinder-ProofAudit-operator-contract");
  assert.equal("ttl_epoch" in (auditPut?.Item ?? {}), false);
  const serialized = JSON.stringify({ core: storedCore, audit: storedAudit });
  for (const forbidden of ["Bearer ", "client_secret", "https://", "\"note\""]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("conditionally persists submission_uncertain before transport and keeps the fixed TTL", async () => {
  await reserve(
    record,
    audit("proof.operator_action_prepared", record.prepared_audit_event_id)
  );
  commands.length = 0;
  const next: ProofOperatorActionRecord = {
    ...record,
    outcome: "submission_uncertain",
    record_version: 2,
    updated_at: "2026-07-27T12:01:00.000Z",
    attempt_id: `paction_${"d".repeat(64)}`
  };
  await transition(
    record,
    next,
    audit(
      "proof.operator_action_submission_started",
      `paudit_operator-${"e".repeat(64)}`,
      "submission_uncertain"
    )
  );

  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "GetItemCommand",
    "TransactWriteItemsCommand"
  ]);
  const transaction = (commands[2] as TransactWriteItemsCommand).input;
  const core = transaction.TransactItems?.[0]?.Put;
  assert.match(core?.ConditionExpression ?? "", /canonical_body_hash = :hash/);
  assert.match(core?.ConditionExpression ?? "", /outcome = :outcome/);
  assert.match(core?.ConditionExpression ?? "", /record_version = :version/);
  assert.equal(core?.ExpressionAttributeValues?.[":outcome"]?.S, "prepared");
  assert.equal(core?.ExpressionAttributeValues?.[":version"]?.N, "1");
  assert.equal(core?.Item?.ttl_epoch?.N, String(record.expires_at_epoch));
  assert.equal(transaction.TransactItems?.[1]?.Put?.TableName, "Pathfinder-ProofAudit-operator-contract");
});

test("fails closed when a durable core record has no paired prepared audit", async () => {
  await reserve(
    record,
    audit("proof.operator_action_prepared", record.prepared_audit_event_id)
  );
  storedAudit = undefined;
  await assert.rejects(
    () => getRecord(record.order_number, record.idempotency_key),
    /prepared audit is invalid/
  );
});
