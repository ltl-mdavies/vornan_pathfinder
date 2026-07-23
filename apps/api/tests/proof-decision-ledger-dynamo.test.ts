import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";
import type {
  ProofAuditEvent,
  ProofDecisionCanonicalIntent,
  ProofDecisionIntegrityContract
} from "@pathfinder/proof-domain";

type DynamoCommand = GetItemCommand | PutItemCommand | TransactWriteItemsCommand;

let storedCoreItem: Record<string, AttributeValue> | undefined;
let storedAuditItem: Record<string, AttributeValue> | undefined;
let transactionMode: "normal" | "cancel" | "commit_then_cancel" = "normal";
let failNextPut = false;
const commands: DynamoCommand[] = [];
const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: DynamoCommand): Promise<unknown>;
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

function decisionContract(key = "approval-dynamo-ledger-01"): ProofDecisionIntegrityContract {
  return {
    idempotency_key: key,
    canonical_body_hash: createHash("sha256").update(JSON.stringify(intent)).digest("hex"),
    intent,
    outcome: "prepared"
  };
}

const auditContext = {
  actor_id: "psession_dynamo_ledger",
  order_line_id: "9301338"
};

function transactionCanceled(message: string) {
  const error = new Error(message);
  error.name = "TransactionCanceledException";
  return error;
}

function applyTransaction(command: TransactWriteItemsCommand) {
  const items = command.input.TransactItems ?? [];
  assert.equal(items.length, 2);
  const core = items[0]?.Put?.Item;
  const audit = items[1]?.Put?.Item;
  assert.ok(core);
  assert.ok(audit);
  if (storedCoreItem || storedAuditItem) {
    throw transactionCanceled("conditional transaction race");
  }
  if (transactionMode !== "cancel") {
    storedCoreItem = core;
    storedAuditItem = audit;
  }
  if (transactionMode !== "normal") {
    throw transactionCanceled("transaction result was ambiguous");
  }
}

before(async () => {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_PROOF_CORE_TABLE = "Pathfinder-ProofCore-contract";
  process.env.PATHFINDER_PROOF_AUDIT_TABLE = "Pathfinder-ProofAudit-contract";
  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      return {
        Item: command.input.TableName === "Pathfinder-ProofAudit-contract"
          ? storedAuditItem
          : storedCoreItem
      };
    }
    if (command instanceof TransactWriteItemsCommand) {
      applyTransaction(command);
      return {};
    }
    if (failNextPut) {
      failNextPut = false;
      const error = new Error("conditional race");
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    storedCoreItem = command.input.Item;
    return {};
  };
  const module = await import("../src/proof/decision-ledger.ts");
  ledger = module.createProofDecisionLedger();
  ProofDecisionLedgerError = module.ProofDecisionLedgerError;
});

beforeEach(() => {
  storedCoreItem = undefined;
  storedAuditItem = undefined;
  transactionMode = "normal";
  failNextPut = false;
  commands.length = 0;
});

after(() => {
  clientPrototype.send = originalSend;
});

test("atomically writes the exact conditional ProofCore and retained ProofAudit transaction", async () => {
  const prepared = decisionContract();
  const reservedAt = new Date("2026-07-23T18:00:00.000Z");
  const reservation = await ledger.reserve(prepared, auditContext, reservedAt);
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;

  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "TransactWriteItemsCommand"
  ]);
  assert.equal((commands[0] as GetItemCommand).input.ConsistentRead, true);
  const transaction = (commands[1] as TransactWriteItemsCommand).input;
  assert.match(transaction.ClientRequestToken ?? "", /^pdec-[a-f0-9]{31}$/);
  assert.equal(transaction.ClientRequestToken?.includes(prepared.idempotency_key), false);
  assert.equal(transaction.TransactItems?.length, 2);
  const corePut = transaction.TransactItems?.[0]?.Put;
  const auditPut = transaction.TransactItems?.[1]?.Put;
  assert.equal(corePut?.TableName, "Pathfinder-ProofCore-contract");
  assert.equal(corePut?.Item?.pk?.S, "ORDER#A0221132");
  assert.equal(corePut?.Item?.sk?.S, "IDEMPOTENCY#approval-dynamo-ledger-01");
  assert.equal(corePut?.ConditionExpression, "attribute_not_exists(pk) AND attribute_not_exists(sk)");
  assert.equal(corePut?.Item?.canonical_body_hash?.S, prepared.canonical_body_hash);
  assert.equal(corePut?.Item?.record_version?.N, "1");
  assert.equal(corePut?.Item?.outcome?.S, "prepared");
  assert.equal(corePut?.Item?.ttl_epoch?.N, String(reservation.record.expires_at_epoch));

  assert.equal(auditPut?.TableName, "Pathfinder-ProofAudit-contract");
  assert.equal(auditPut?.Item?.pk?.S, "ORDER#A0221132");
  assert.equal(
    auditPut?.Item?.sk?.S,
    `${reservation.record.created_at}#${reservation.record.prepared_audit_event_id}`
  );
  assert.equal(auditPut?.ConditionExpression, "attribute_not_exists(pk) AND attribute_not_exists(sk)");
  assert.equal("ttl_epoch" in (auditPut?.Item ?? {}), false);
  const audit = JSON.parse(auditPut?.Item?.data?.S ?? "{}") as ProofAuditEvent;
  assert.equal(audit.event_id, reservation.record.prepared_audit_event_id);
  assert.equal(audit.action, "proof.decision_prepared");
  assert.match(audit.correlation_id, /^pcorrelation_decision_[a-f0-9]{64}$/);
  const serializedAudit = JSON.stringify(audit).toLowerCase();
  for (const forbidden of [
    prepared.idempotency_key,
    prepared.canonical_body_hash,
    "session_hash",
    "token_hash",
    "\"email\"",
    "\"note\"",
    "signed_url",
    "\"jwt\"",
    "credential",
    "creative"
  ]) {
    assert.equal(serializedAudit.includes(forbidden), false, `audit persisted ${forbidden}`);
  }

  commands.length = 0;
  const replay = await ledger.reserve(prepared, auditContext, new Date("2026-07-23T18:00:30.000Z"));
  assert.equal(replay.status, "replay");
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "GetItemCommand"
  ]);
  assert.equal((commands[0] as GetItemCommand).input.ConsistentRead, true);
  assert.equal((commands[1] as GetItemCommand).input.ConsistentRead, true);
});

test("validates the paired audit before a conditional transition and preserves fixed TTL", async () => {
  const prepared = decisionContract("approval-dynamo-transition");
  const reservation = await ledger.reserve(prepared, auditContext, new Date("2026-07-23T18:10:00.000Z"));
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;
  commands.length = 0;

  const transitioned = await ledger.transition({
    order_number: intent.order_number,
    idempotency_key: prepared.idempotency_key,
    canonical_body_hash: prepared.canonical_body_hash,
    expected_record_version: 1,
    next_outcome: "submission_uncertain"
  }, new Date("2026-07-23T18:11:00.000Z"));
  assert.equal(transitioned.record_version, 2);
  assert.equal(transitioned.expires_at_epoch, reservation.record.expires_at_epoch);

  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "GetItemCommand",
    "PutItemCommand"
  ]);
  const transitionInput = (commands[2] as PutItemCommand).input;
  assert.equal(
    transitionInput.ConditionExpression,
    "canonical_body_hash = :canonical_body_hash AND record_version = :record_version " +
      "AND #outcome = :outcome AND ttl_epoch = :ttl_epoch"
  );
  assert.deepEqual(transitionInput.ExpressionAttributeNames, { "#outcome": "outcome" });
  assert.equal(transitionInput.ExpressionAttributeValues?.[":canonical_body_hash"]?.S, prepared.canonical_body_hash);
  assert.equal(transitionInput.ExpressionAttributeValues?.[":record_version"]?.N, "1");
  assert.equal(transitionInput.ExpressionAttributeValues?.[":outcome"]?.S, "prepared");
  assert.equal(
    transitionInput.ExpressionAttributeValues?.[":ttl_epoch"]?.N,
    String(reservation.record.expires_at_epoch)
  );
  assert.equal(transitionInput.Item?.ttl_epoch?.N, String(reservation.record.expires_at_epoch));
});

test("reclassifies a committed ambiguous transaction but fails closed when no valid pair exists", async () => {
  const committed = decisionContract("approval-dynamo-ambiguous");
  transactionMode = "commit_then_cancel";
  const replay = await ledger.reserve(committed, auditContext, new Date("2026-07-23T18:20:00.000Z"));
  assert.equal(replay.status, "replay");
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "TransactWriteItemsCommand",
    "GetItemCommand",
    "GetItemCommand"
  ]);

  storedCoreItem = undefined;
  storedAuditItem = undefined;
  commands.length = 0;
  transactionMode = "cancel";
  await assert.rejects(
    () => ledger.reserve(
      decisionContract("approval-dynamo-canceled"),
      auditContext,
      new Date("2026-07-23T18:21:00.000Z")
    ),
    (error) => error instanceof ProofDecisionLedgerError && error.code === "concurrent_update"
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "TransactWriteItemsCommand",
    "GetItemCommand"
  ]);
  assert.equal(storedCoreItem, undefined);
  assert.equal(storedAuditItem, undefined);
});

test("fails closed on an orphaned or mismatched Dynamo audit record", async () => {
  const prepared = decisionContract("approval-dynamo-mismatch");
  const reservation = await ledger.reserve(prepared, auditContext, new Date("2026-07-23T18:30:00.000Z"));
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;

  storedAuditItem = undefined;
  await assert.rejects(
    () => ledger.read(intent.order_number, prepared.idempotency_key),
    (error) => error instanceof ProofDecisionLedgerError && error.code === "prepared_audit_missing"
  );

  const audit = JSON.parse(
    (commands.find((command) => command instanceof TransactWriteItemsCommand) as TransactWriteItemsCommand)
      .input.TransactItems?.[1]?.Put?.Item?.data?.S ?? "{}"
  ) as ProofAuditEvent;
  storedAuditItem = {
    pk: { S: `ORDER#${intent.order_number}` },
    sk: { S: `${audit.occurred_at}#${audit.event_id}` },
    data: { S: JSON.stringify({ ...audit, actor_id: "unsafe@example.invalid" }) }
  };
  await assert.rejects(
    () => ledger.read(intent.order_number, prepared.idempotency_key),
    (error) => error instanceof ProofDecisionLedgerError && error.code === "prepared_audit_mismatch"
  );
});

test("maps a Dynamo conditional transition race to one fail-closed ledger error", async () => {
  const prepared = decisionContract("approval-dynamo-transition-race");
  const reservation = await ledger.reserve(prepared, auditContext, new Date("2026-07-23T18:40:00.000Z"));
  assert.equal(reservation.status, "new");
  if (reservation.status !== "new") return;
  commands.length = 0;
  failNextPut = true;
  await assert.rejects(
    () => ledger.transition({
      order_number: intent.order_number,
      idempotency_key: prepared.idempotency_key,
      canonical_body_hash: prepared.canonical_body_hash,
      expected_record_version: 1,
      next_outcome: "submission_uncertain"
    }, new Date("2026-07-23T18:41:00.000Z")),
    (error) => error instanceof ProofDecisionLedgerError && error.code === "concurrent_update"
  );
  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "GetItemCommand",
    "GetItemCommand",
    "PutItemCommand"
  ]);
});
