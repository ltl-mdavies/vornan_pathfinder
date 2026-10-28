import { GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import { actionClaimKey, REOPENED } from "./customer-allocation-store.js";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { auditEventItem, getProofDynamoClient, mutateLocalProofStore, parseProofData, proofDataItem, proofStringAttribute, readLocalProofStore, requiredProofAuditTable, requiredProofCoreTable } from "./store.js";

export type RevisionSubmission = {
  submission_id: string; request_hash: string; order_number: string; customer_id: string;
  grant_id: string; participant_id: string; task_id: string; attachment_id: string; version_id: string;
  asset_id: string; filename: string; source_sha256: string; outbound_sha256: string;
  delivery_url_sha256: string; source_version_hash: string; outbound_version_hash: string;
  state: "submitted" | "checking" | "accepted";
  record_version: number; created_at: string; updated_at: string;
};
const sk = (id: string) => `REVISION_SUBMISSION#${id}`;
const localKey = (order: string, id: string) => `${order}:${id}`;
const key = (order: string, id: string) => ({ pk: proofStringAttribute(`ORDER#${order}`), sk: proofStringAttribute(sk(id)) });
const item = (record: RevisionSubmission) => proofDataItem(`ORDER#${record.order_number}`, sk(record.submission_id), record, { record_version: { N: String(record.record_version) } });
function driver() {
  const value = getProofRuntimeConfig().storage_driver;
  if (value === "disabled") throw new Error("Proof storage is unavailable.");
  return value;
}
const conflict = (error: unknown) => error instanceof Error && ["TransactionCanceledException", "TransactionInProgressException"].includes(error.name);
export async function readRevisionSubmission(order: string, id: string): Promise<RevisionSubmission | null> {
  if (driver() === "local") return (await readLocalProofStore()).revision_submissions[localKey(order, id)] as RevisionSubmission ?? null;
  return parseProofData<RevisionSubmission>((await getProofDynamoClient().send(new GetItemCommand({ TableName: requiredProofCoreTable(), ConsistentRead: true, Key: key(order, id) }))).Item);
}
/** Receipt + exclusion + audit are durable before the one allowed Lift attempt. */
export async function reserveRevisionSubmission(record: RevisionSubmission, audit: ProofAuditEvent): Promise<boolean> {
  const claim = actionClaimKey(record.attachment_id, record.version_id);
  if (driver() === "local") return mutateLocalProofStore(store => {
    const id = localKey(record.order_number, record.submission_id), claimId = localKey(record.order_number, claim);
    const owner = store.action_claims[claimId];
    if (store.revision_submissions[id] || (owner && owner !== "released-unsent" && owner !== REOPENED)) return false;
    store.revision_submissions[id] = record; store.action_claims[claimId] = record.submission_id; store.audit_events[audit.event_id] = audit; return true;
  });
  try {
    await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: requiredProofCoreTable(), Item: item(record), ConditionExpression: "attribute_not_exists(pk)" } },
      { Put: { TableName: requiredProofCoreTable(), Item: { pk: proofStringAttribute(`ORDER#${record.order_number}`), sk: proofStringAttribute(claim), owner: proofStringAttribute(record.submission_id) }, ConditionExpression: "attribute_not_exists(pk) OR #owner = :released OR #owner = :reopened", ExpressionAttributeNames: { "#owner": "owner" }, ExpressionAttributeValues: { ":released": proofStringAttribute("released-unsent"), ":reopened": proofStringAttribute(REOPENED) } } },
      { Put: { TableName: requiredProofAuditTable(), Item: auditEventItem(audit), ConditionExpression: "attribute_not_exists(pk)" } }
    ] })); return true;
  } catch (error) { if (conflict(error)) return false; throw error; }
}
export async function replaceRevisionSubmission(current: RevisionSubmission, next: RevisionSubmission, audit: ProofAuditEvent): Promise<boolean> {
  if (driver() === "local") return mutateLocalProofStore(store => {
    const id = localKey(current.order_number, current.submission_id), saved = store.revision_submissions[id] as RevisionSubmission | undefined;
    if (!saved || saved.record_version !== current.record_version) return false;
    store.revision_submissions[id] = next; store.audit_events[audit.event_id] = audit; return true;
  });
  try {
    await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: requiredProofCoreTable(), Item: item(next), ConditionExpression: "record_version = :version", ExpressionAttributeValues: { ":version": { N: String(current.record_version) } } } },
      { Put: { TableName: requiredProofAuditTable(), Item: auditEventItem(audit), ConditionExpression: "attribute_not_exists(pk)" } }
    ] })); return true;
  } catch (error) { if (conflict(error)) return false; throw error; }
}
