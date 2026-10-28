import { createHash } from "node:crypto";
import { GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { auditEventItem, getProofDynamoClient, mutateLocalProofStore, parseProofData, proofDataItem, proofStringAttribute, readLocalProofStore, requiredProofAuditTable, requiredProofCoreTable } from "./store.js";

export type AllocationEntry = {
  task_id: string; attachment_id: string; expected_task_version: number; expected_version_id: string;
  feedback_fingerprint: string; filename: string | null; quantity: number;
  state: "pending" | "submitted" | "confirmed";
  resulting_line_number: string | null;
};
export type CustomerAllocation = {
  batch_id: string; request_hash: string; order_number: string; customer_id: string;
  grant_id: string; participant_id: string; source_order_line_id: string; source_line_number: string | null;
  line_quantity: number; note: string | null; entries: AllocationEntry[];
  state: "ready" | "checking" | "completed" | "paused";
  record_version: number; created_at: string; updated_at: string;
};
export function allocationHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
// Claims have no TTL: an uncertain external write must never become replayable
// merely because a receipt expired. A new artwork version has a new identity.
export function actionClaimKey(attachmentId: string, versionId: string) {
  return `ACTION_CLAIM#${allocationHash([attachmentId, versionId])}`;
}
const key = (order: string, sk: string) => ({ pk: proofStringAttribute(`ORDER#${order}`), sk: proofStringAttribute(sk) });
const localKey = (order: string, sk: string) => `${order}:${sk}`;
const batchKey = (id: string) => `ALLOCATION#${id}`;
const RELEASED = "released-unsent";
export const REOPENED = "released-after-confirmed-reopening";
const available = (owner: string | undefined) => !owner || owner === RELEASED || owner === REOPENED;
function driver() {
  const value = getProofRuntimeConfig().storage_driver;
  if (value === "disabled") throw new Error("Proof storage is unavailable.");
  return value;
}
function conflict(error: unknown) {
  return error instanceof Error && ["ConditionalCheckFailedException", "TransactionCanceledException", "TransactionInProgressException"].includes(error.name);
}
function item(record: CustomerAllocation) {
  return proofDataItem(`ORDER#${record.order_number}`, batchKey(record.batch_id), record, { record_version: { N: String(record.record_version) } });
}
export async function claimProofAction(order: string, attachment: string, version: string, owner: string) {
  const sk = actionClaimKey(attachment, version);
  if (driver() === "local") return mutateLocalProofStore((store) => {
    const k = localKey(order, sk);
    if (!available(store.action_claims[k]) && store.action_claims[k] !== owner) return false;
    store.action_claims[k] = owner;
    return true;
  });
  try {
    await getProofDynamoClient().send(new PutItemCommand({
      TableName: requiredProofCoreTable(), Item: { ...key(order, sk), owner: proofStringAttribute(owner) },
      ConditionExpression: "attribute_not_exists(pk) OR #owner = :owner OR #owner = :released OR #owner = :reopened",
      ExpressionAttributeNames: { "#owner": "owner" }, ExpressionAttributeValues: { ":owner": proofStringAttribute(owner), ":released": proofStringAttribute(RELEASED), ":reopened": proofStringAttribute(REOPENED) }
    }));
    return true;
  } catch (error) { if (conflict(error)) return false; throw error; }
}
export async function readCustomerAllocation(order: string, id: string): Promise<CustomerAllocation | null> {
  if (driver() === "local") return (await readLocalProofStore()).allocation_records[localKey(order, batchKey(id))] as CustomerAllocation ?? null;
  const response = await getProofDynamoClient().send(new GetItemCommand({ TableName: requiredProofCoreTable(), ConsistentRead: true, Key: key(order, batchKey(id)) }));
  return parseProofData<CustomerAllocation>(response.Item);
}
export async function listCustomerAllocations(order: string): Promise<CustomerAllocation[]> {
  if (driver() === "local") return Object.values((await readLocalProofStore()).allocation_records).map((r) => r as CustomerAllocation).filter((r) => r.order_number === order);
  const records: CustomerAllocation[] = [];
  let cursor: Record<string, AttributeValue> | undefined;
  do {
    const response = await getProofDynamoClient().send(new QueryCommand({
      TableName: requiredProofCoreTable(), ConsistentRead: true,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": proofStringAttribute(`ORDER#${order}`), ":prefix": proofStringAttribute("ALLOCATION#") },
      ExclusiveStartKey: cursor
    }));
    for (const entry of response.Items ?? []) { const record = parseProofData<CustomerAllocation>(entry); if (record) records.push(record); }
    cursor = response.LastEvaluatedKey;
  } while (cursor);
  return records;
}
export async function reserveCustomerAllocation(record: CustomerAllocation, audit: ProofAuditEvent) {
  const claims = record.entries.map((e) => actionClaimKey(e.attachment_id, e.expected_version_id));
  if (driver() === "local") return mutateLocalProofStore((store) => {
    const k = localKey(record.order_number, batchKey(record.batch_id));
    if (store.allocation_records[k] || claims.some((sk) => !available(store.action_claims[localKey(record.order_number, sk)]))) return false;
    store.allocation_records[k] = record;
    claims.forEach((sk) => { store.action_claims[localKey(record.order_number, sk)] = record.batch_id; });
    store.audit_events[audit.event_id] = audit;
    return true;
  });
  try {
    await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: requiredProofCoreTable(), Item: item(record), ConditionExpression: "attribute_not_exists(pk)" } },
      ...claims.map((sk) => ({ Put: { TableName: requiredProofCoreTable(), Item: { ...key(record.order_number, sk), owner: proofStringAttribute(record.batch_id) }, ConditionExpression: "attribute_not_exists(pk) OR #owner = :released OR #owner = :reopened", ExpressionAttributeNames: { "#owner": "owner" }, ExpressionAttributeValues: { ":released": proofStringAttribute(RELEASED), ":reopened": proofStringAttribute(REOPENED) } } })),
      { Put: { TableName: requiredProofAuditTable(), Item: auditEventItem(audit), ConditionExpression: "attribute_not_exists(pk)" } }
    ] }));
    return true;
  } catch (error) { if (conflict(error)) return false; throw error; }
}
export async function replaceCustomerAllocation(current: CustomerAllocation, next: CustomerAllocation, audit: ProofAuditEvent) {
  // A stopped batch may release only work that never crossed the send boundary.
  // Submitted/confirmed claims remain durable, even if the artwork later changes.
  const released = next.state === "paused" ? next.entries.filter((entry) => entry.state === "pending").map((entry) => actionClaimKey(entry.attachment_id, entry.expected_version_id)) : [];
  if (driver() === "local") return mutateLocalProofStore((store) => {
    const k = localKey(current.order_number, batchKey(current.batch_id));
    const saved = store.allocation_records[k] as CustomerAllocation | undefined;
    if (!saved || saved.record_version !== current.record_version) return false;
    if (released.some((sk) => store.action_claims[localKey(current.order_number, sk)] !== current.batch_id)) return false;
    store.allocation_records[k] = next;
    released.forEach((sk) => { store.action_claims[localKey(current.order_number, sk)] = RELEASED; });
    store.audit_events[audit.event_id] = audit;
    return true;
  });
  try {
    await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: requiredProofCoreTable(), Item: item(next), ConditionExpression: "record_version = :version", ExpressionAttributeValues: { ":version": { N: String(current.record_version) } } } },
      ...released.map((sk) => ({ Put: { TableName: requiredProofCoreTable(), Item: { ...key(current.order_number, sk), owner: proofStringAttribute(RELEASED) }, ConditionExpression: "#owner = :owner", ExpressionAttributeNames: { "#owner": "owner" }, ExpressionAttributeValues: { ":owner": proofStringAttribute(current.batch_id) } } })),
      { Put: { TableName: requiredProofAuditTable(), Item: auditEventItem(audit), ConditionExpression: "attribute_not_exists(pk)" } }
    ] }));
    return true;
  } catch (error) { if (conflict(error)) return false; throw error; }
}
