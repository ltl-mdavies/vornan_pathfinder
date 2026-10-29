import { GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { ProofOrder, ProofTask } from "@pathfinder/proof-domain";
import { actionClaimKey, allocationHash, REOPENED } from "./customer-allocation-store.js";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { auditEventItem, getProofDynamoClient, mutateLocalProofStore, parseProofData, proofDataItem, proofStringAttribute, readLocalProofStore, requiredProofAuditTable, requiredProofCoreTable } from "./store.js";

type ApprovalObservation = {
  owner: string; attachment_id: string; version_id: string; task_version: number;
  order_version: number; observed_at: string;
};
const localKey = (order: string, claim: string) => `${order}:${claim}`;
const key = (order: string, sk: string) => ({ pk: proofStringAttribute(`ORDER#${order}`), sk: proofStringAttribute(sk) });
const marker = (claim: string) => claim.replace("ACTION_CLAIM#", "ACTION_APPROVAL#");
function driver() {
  const value = getProofRuntimeConfig().storage_driver;
  if (value === "disabled") throw new Error("Proof storage is unavailable.");
  return value;
}
const collision = (error: unknown) => error instanceof Error && ["TransactionCanceledException", "TransactionInProgressException", "ConditionalCheckFailedException"].includes(error.name);
const sameSnapshot = (a: ProofOrder | undefined, b: ProofOrder) => JSON.stringify(a) === JSON.stringify(b);
const currentMember = (order: ProofOrder, task: ProofTask) => order.tasks.some(candidate => candidate.task_id === task.task_id && JSON.stringify(candidate) === JSON.stringify(task));
const snapshotCheck = (order: ProofOrder) => ({ ConditionCheck: {
  TableName: requiredProofCoreTable(), Key: key(order.order_number, "PROFILE"),
  ConditionExpression: "#data = :snapshot", ExpressionAttributeNames: { "#data": "data" },
  ExpressionAttributeValues: { ":snapshot": proofStringAttribute(JSON.stringify(order)) }
} });

/** Record positive Lift evidence, never a successful transport response. Legacy
 * claims without evidence stay locked. This does not release the claim. */
export async function recordActionApproval(order: ProofOrder, task: ProofTask, owner: string): Promise<boolean> {
  if (!currentMember(order, task)) return false;
  if (!task.attachment_id || !task.current_version?.current || task.archived_at || task.state !== "approved" || task.current_version.approval_status?.toUpperCase() !== "APPROVED" || !Number.isFinite(Date.parse(order.last_synced_at))) return false;
  const claim = actionClaimKey(task.attachment_id, task.current_version.version_id);
  const record: ApprovalObservation = { owner, attachment_id: task.attachment_id, version_id: task.current_version.version_id, task_version: task.version, order_version: order.version, observed_at: order.last_synced_at };
  if (driver() === "local") return mutateLocalProofStore(store => {
    const k = localKey(order.order_number, claim);
    if (store.action_claims[k] !== owner || !sameSnapshot(store.orders[order.order_number], order)) return false;
    store.action_approvals[k] = record; return true;
  });
  try {
    await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
      snapshotCheck(order),
      { ConditionCheck: { TableName: requiredProofCoreTable(), Key: key(order.order_number, claim), ConditionExpression: "#owner = :owner", ExpressionAttributeNames: { "#owner": "owner" }, ExpressionAttributeValues: { ":owner": proofStringAttribute(owner) } } },
      { Put: { TableName: requiredProofCoreTable(), Item: proofDataItem(`ORDER#${order.order_number}`, marker(claim), record) } }
    ] })); return true;
  } catch (error) { if (collision(error)) return false; throw error; }
}

/** A new user decision may follow a later authoritative reopening. The old
 * receipt remains immutable/no-retry; this is not a retry of its request. */
export async function reopenConfirmedAction(order: ProofOrder, task: ProofTask): Promise<boolean> {
  if (!currentMember(order, task)) return false;
  if (order.health !== "active" || task.state !== "pending" || !task.actionable || task.archived_at || task.decision_context || !task.attachment_id || !task.current_version?.current || order.lines.some(line => line.order_line_id === task.order_line_id && line.cancelled)) return false;
  const claim = actionClaimKey(task.attachment_id, task.current_version.version_id);
  const k = localKey(order.order_number, claim);
  const mode = driver();
  const record = mode === "local" ? (await readLocalProofStore()).action_approvals[k] as ApprovalObservation | undefined
    : parseProofData<ApprovalObservation>((await getProofDynamoClient().send(new GetItemCommand({ TableName: requiredProofCoreTable(), ConsistentRead: true, Key: key(order.order_number, marker(claim)) }))).Item);
  if (!record || record.attachment_id !== task.attachment_id || record.version_id !== task.current_version.version_id || !(task.version > record.task_version) || !(order.version > record.order_version) || !(Date.parse(order.last_synced_at) > Date.parse(record.observed_at))) return false;
  const event = {
    event_id: `paudit_reopened-${allocationHash([order.order_number, claim, record.owner, order.version])}`, occurred_at: order.last_synced_at,
    action: "proof.decision_observed" as const, outcome: "succeeded" as const, order_number: order.order_number,
    order_line_id: task.order_line_id, task_id: task.task_id, attachment_id: task.attachment_id,
    grant_id: null, participant_id: null, actor_type: "system" as const, actor_id: "authoritative-reopening", correlation_id: `reopening-${order.version}`,
    metadata: { source: "system" as const }
  };
  if (mode === "local") return mutateLocalProofStore(store => {
    if (store.action_claims[k] !== record.owner || JSON.stringify(store.action_approvals[k]) !== JSON.stringify(record) || !sameSnapshot(store.orders[order.order_number], order)) return false;
    store.action_claims[k] = REOPENED; store.audit_events[event.event_id] = event; return true;
  });
  try {
    await getProofDynamoClient().send(new TransactWriteItemsCommand({ TransactItems: [
      snapshotCheck(order),
      { ConditionCheck: { TableName: requiredProofCoreTable(), Key: key(order.order_number, marker(claim)), ConditionExpression: "#data = :record", ExpressionAttributeNames: { "#data": "data" }, ExpressionAttributeValues: { ":record": proofStringAttribute(JSON.stringify(record)) } } },
      { Put: { TableName: requiredProofCoreTable(), Item: { ...key(order.order_number, claim), owner: proofStringAttribute(REOPENED) }, ConditionExpression: "#owner = :owner", ExpressionAttributeNames: { "#owner": "owner" }, ExpressionAttributeValues: { ":owner": proofStringAttribute(record.owner) } } },
      { Put: { TableName: requiredProofAuditTable(), Item: auditEventItem(event), ConditionExpression: "attribute_not_exists(pk)" } }
    ] })); return true;
  } catch (error) { if (collision(error)) return false; throw error; }
}
