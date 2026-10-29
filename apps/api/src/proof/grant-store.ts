import { PutItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { ProofAccessGrant, ProofAuditEvent } from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { getProofDynamoClient, mutateLocalProofStore, requiredProofCoreTable, requiredProofAuditTable, proofDataItem, proofStringAttribute, grantIndexes, auditEventItem } from "./store.js";

/** Compare the entire authority snapshot so stale writes cannot undo revocation. */
export async function replaceProofGrant(previous: ProofAccessGrant, next: ProofAccessGrant, audit?: ProofAuditEvent) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") throw new Error("Proof storage is disabled.");
  if (config.storage_driver === "dynamodb") {
    try {
      const put = {
        TableName: requiredProofCoreTable(),
        Item: proofDataItem(`ORDER#${next.order_number}`, `GRANT#${next.grant_id}`, next, grantIndexes(next)),
        ConditionExpression: "#data = :expected",
        ExpressionAttributeNames: { "#data": "data" },
        ExpressionAttributeValues: { ":expected": proofStringAttribute(JSON.stringify(previous)) }
      };
      if (audit) {
        await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
          { Put: put }, { Put: { TableName: requiredProofAuditTable(), Item: auditEventItem(audit), ConditionExpression: "attribute_not_exists(pk)" } }
        ] }));
      } else await getProofDynamoClient().send(new PutItemCommand(put));
      return true;
    } catch (error) {
      if (error instanceof Error && ["ConditionalCheckFailedException", "TransactionCanceledException"].includes(error.name)) return false;
      throw error;
    }
  }
  return mutateLocalProofStore((store) => {
    if (JSON.stringify(store.grants[previous.grant_id]) !== JSON.stringify(previous)) return false;
    store.grants[next.grant_id] = next;
    if (audit) store.audit_events[audit.event_id] = audit;
    return true;
  });
}

/** Serialize creation with parent changes and reserve the idempotent child atomically. */
export async function createDelegatedProofGrant(parent: ProofAccessGrant, child: ProofAccessGrant, audit: ProofAuditEvent) {
  const next = { ...parent, share_created_count: (parent.share_created_count ?? 0) + 1, share_last_created_at: child.created_at };
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") throw new Error("Proof storage is disabled.");
  if (config.storage_driver === "dynamodb") {
    try {
      await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
        { Put: {
          TableName: requiredProofCoreTable(),
          Item: proofDataItem(`ORDER#${parent.order_number}`, `GRANT#${parent.grant_id}`, next, grantIndexes(next)),
          ConditionExpression: "#data = :expected", ExpressionAttributeNames: { "#data": "data" },
          ExpressionAttributeValues: { ":expected": proofStringAttribute(JSON.stringify(parent)) }
        } },
        { Put: {
          TableName: requiredProofCoreTable(),
          Item: proofDataItem(`ORDER#${child.order_number}`, `GRANT#${child.grant_id}`, child, grantIndexes(child)),
          ConditionExpression: "attribute_not_exists(pk)"
        } },
        { Put: { TableName: requiredProofAuditTable(), Item: auditEventItem(audit), ConditionExpression: "attribute_not_exists(pk)" } }
      ] }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "TransactionCanceledException") return false;
      throw error;
    }
  }
  return mutateLocalProofStore((store) => {
    if (JSON.stringify(store.grants[parent.grant_id]) !== JSON.stringify(parent) || store.grants[child.grant_id]) return false;
    store.grants[parent.grant_id] = next;
    store.grants[child.grant_id] = child;
    store.audit_events[audit.event_id] = audit;
    return true;
  });
}
