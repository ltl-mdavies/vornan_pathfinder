import {
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import type {
  ProofAuditEvent,
  ProofDecisionLedgerRecord,
  ProofDecisionOutcomeState
} from "@pathfinder/proof-domain";
import {
  auditEventItem,
  getProofDynamoClient,
  parseProofData,
  proofDataItem,
  proofStringAttribute,
  readLocalProofStore,
  requiredProofAuditTable,
  requiredProofCoreTable,
  mutateLocalProofStore
} from "./store.js";
import { getProofRuntimeConfig } from "./runtime-config.js";

function decisionRecordKey(orderNumber: string, idempotencyKey: string) {
  return `${orderNumber}:${idempotencyKey}`;
}

function decisionRecordItem(record: ProofDecisionLedgerRecord) {
  return proofDataItem(
    `ORDER#${record.intent.order_number}`,
    `IDEMPOTENCY#${record.idempotency_key}`,
    record,
    {
      canonical_body_hash: proofStringAttribute(record.canonical_body_hash),
      record_version: { N: String(record.record_version) },
      outcome: proofStringAttribute(record.outcome),
      ttl_epoch: { N: String(record.expires_at_epoch) }
    }
  );
}

function conditionalCheckFailed(error: unknown) {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function transactionCanceled(error: unknown) {
  return error instanceof Error &&
    (error.name === "TransactionCanceledException" || error.name === "TransactionInProgressException");
}

export async function getProofDecisionRecord(orderNumber: string, idempotencyKey: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await getProofDynamoClient().send(new GetItemCommand({
      TableName: requiredProofCoreTable(),
      ConsistentRead: true,
      Key: {
        pk: proofStringAttribute(`ORDER#${orderNumber}`),
        sk: proofStringAttribute(`IDEMPOTENCY#${idempotencyKey}`)
      }
    }));
    return parseProofData<ProofDecisionLedgerRecord>(
      response.Item as Record<string, AttributeValue> | undefined
    );
  }
  const store = await readLocalProofStore();
  return store.decision_records[decisionRecordKey(orderNumber, idempotencyKey)] ?? null;
}

export async function getProofAuditEventByIdentity(
  orderNumber: string,
  occurredAt: string,
  eventId: string
) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof audit table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await getProofDynamoClient().send(new GetItemCommand({
      TableName: requiredProofAuditTable(),
      ConsistentRead: true,
      Key: {
        pk: proofStringAttribute(`ORDER#${orderNumber}`),
        sk: proofStringAttribute(`${occurredAt}#${eventId}`)
      }
    }));
    return parseProofData<ProofAuditEvent>(
      response.Item as Record<string, AttributeValue> | undefined
    );
  }
  const store = await readLocalProofStore();
  const event = store.audit_events[eventId] ?? null;
  return event?.order_number === orderNumber && event.occurred_at === occurredAt ? event : null;
}

export async function reserveProofDecisionRecordWithAudit(
  record: ProofDecisionLedgerRecord,
  auditEvent: ProofAuditEvent,
  clientRequestToken: string
) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof tables are configured.");
  }
  if (config.storage_driver === "dynamodb") {
    try {
      await getProofDynamoClient().send(new TransactWriteItemsCommand({
        ClientRequestToken: clientRequestToken,
        TransactItems: [
          {
            Put: {
              TableName: requiredProofCoreTable(),
              Item: decisionRecordItem(record),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          },
          {
            Put: {
              TableName: requiredProofAuditTable(),
              Item: auditEventItem(auditEvent),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          }
        ]
      }));
      return true;
    } catch (error) {
      if (transactionCanceled(error)) return false;
      throw error;
    }
  }
  return mutateLocalProofStore((store) => {
    const key = decisionRecordKey(record.intent.order_number, record.idempotency_key);
    if (store.decision_records[key] || store.audit_events[auditEvent.event_id]) return false;
    store.decision_records[key] = record;
    store.audit_events[auditEvent.event_id] = auditEvent;
    return true;
  });
}

export async function replaceProofDecisionRecord(
  record: ProofDecisionLedgerRecord,
  expected: {
    canonical_body_hash: string;
    record_version: number;
    outcome: ProofDecisionOutcomeState;
    expires_at_epoch: number;
  }
) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    try {
      await getProofDynamoClient().send(new PutItemCommand({
        TableName: requiredProofCoreTable(),
        Item: decisionRecordItem(record),
        ConditionExpression:
          "canonical_body_hash = :canonical_body_hash AND record_version = :record_version " +
          "AND #outcome = :outcome AND ttl_epoch = :ttl_epoch",
        ExpressionAttributeNames: { "#outcome": "outcome" },
        ExpressionAttributeValues: {
          ":canonical_body_hash": proofStringAttribute(expected.canonical_body_hash),
          ":record_version": { N: String(expected.record_version) },
          ":outcome": proofStringAttribute(expected.outcome),
          ":ttl_epoch": { N: String(expected.expires_at_epoch) }
        }
      }));
      return true;
    } catch (error) {
      if (conditionalCheckFailed(error)) return false;
      throw error;
    }
  }
  return mutateLocalProofStore((store) => {
    const key = decisionRecordKey(record.intent.order_number, record.idempotency_key);
    const current = store.decision_records[key];
    if (!current ||
        current.canonical_body_hash !== expected.canonical_body_hash ||
        current.record_version !== expected.record_version ||
        current.outcome !== expected.outcome ||
        current.expires_at_epoch !== expected.expires_at_epoch) {
      return false;
    }
    store.decision_records[key] = record;
    return true;
  });
}
