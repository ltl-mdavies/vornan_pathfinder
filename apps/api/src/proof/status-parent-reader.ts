import { DynamoDBClient, GetItemCommand, type GetItemCommandOutput } from "@aws-sdk/client-dynamodb";
import type { OrderStatusTokenRecord } from "../store.js";
import { resolveWorkspaceTables } from "../workspace-table-namespace.js";

type ParentState = { parent: OrderStatusTokenRecord | null; visibility: string | undefined };
type Send = (command: GetItemCommand) => Promise<GetItemCommandOutput>;
const client = new DynamoDBClient({});
const tableName = (value: string | undefined) => value && /^[A-Za-z0-9_.-]{3,255}$/.test(value) ? value : null;

/** Isolated Proof needs only two current records, never the general Pathfinder store. */
export async function readDynamoStatusParent(tokenHash: string, customerId: string,
  env: NodeJS.ProcessEnv = process.env, send: Send = command => client.send(command)): Promise<ParentState> {
  const denied: ParentState = { parent: null, visibility: undefined };
  // The main API already owns these tables; isolated Proof gets explicit read-only bindings.
  let workspaceTable = env.PATHFINDER_PROOF_CUSTOMER_WORKSPACES_TABLE;
  if (!workspaceTable && env.PATHFINDER_STORAGE_DRIVER === "dynamodb") {
    try { workspaceTable = resolveWorkspaceTables(env, ["workspaces"]).workspaces; } catch { return denied; }
  }
  const tokens = tableName(env.PATHFINDER_PROOF_STATUS_PARENT_TOKENS_TABLE
    ?? (env.PATHFINDER_STORAGE_DRIVER === "dynamodb" ? env.PATHFINDER_ORDER_STATUS_TOKENS_TABLE : undefined));
  const workspaces = tableName(workspaceTable);
  if (customerId !== "1249" || !/^[a-f0-9]{64}$/.test(tokenHash) || !tokens || !workspaces) return denied;
  try {
    const [tokenResult, workspaceResult] = await Promise.all([
      send(new GetItemCommand({ TableName: tokens, Key: { token_hash: { S: tokenHash } }, ConsistentRead: true,
        ProjectionExpression: "token_hash, #data", ExpressionAttributeNames: { "#data": "data" } })),
      send(new GetItemCommand({ TableName: workspaces, Key: { customer_id: { S: customerId } }, ConsistentRead: true,
        ProjectionExpression: "customer_id, #data", ExpressionAttributeNames: { "#data": "data" } }))
    ]);
    if (tokenResult.Item?.token_hash?.S !== tokenHash || workspaceResult.Item?.customer_id?.S !== customerId) return denied;
    const parent = JSON.parse(tokenResult.Item?.data?.S ?? "null") as OrderStatusTokenRecord | null;
    const workspace = JSON.parse(workspaceResult.Item?.data?.S ?? "null");
    if (!parent || parent.token_hash !== tokenHash || workspace?.customer?.lift_customer_id !== customerId) return denied;
    return { parent, visibility: typeof workspace?.status_access_policy?.proof_visibility === "string"
      ? workspace.status_access_policy.proof_visibility : undefined };
  } catch {
    // Missing configuration, denied reads, corrupt records and outages never grant access.
    return denied;
  }
}

export async function readStatusParent(tokenHash: string, customerId: string): Promise<ParentState> {
  if (process.env.PATHFINDER_PROOF_STORAGE_DRIVER === "dynamodb"
    || (process.env.PATHFINDER_RUNTIME === "lambda" && process.env.PATHFINDER_PROOF_STORAGE_DRIVER !== "local")) {
    return readDynamoStatusParent(tokenHash, customerId);
  }
  // Explicit local fixtures only; missing Lambda configuration never falls back to files.
  const { getOrderStatusToken, getWorkspace } = await import("../store.js");
  const [parent, workspace] = await Promise.all([getOrderStatusToken(tokenHash), getWorkspace(customerId)]);
  return { parent, visibility: workspace?.status_access_policy.proof_visibility };
}
