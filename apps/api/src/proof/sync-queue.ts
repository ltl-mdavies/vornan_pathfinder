import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { normalizeLiftOrderNumber } from "@pathfinder/proof-domain";
import type { ProofOrder } from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "./runtime-config.js";

let sqsClient: SQSClient | null = null;

export async function queueProofSync(orderNumber: string, reason: "stale_public_read" | "public_refresh") {
  const queueUrl = getProofRuntimeConfig().sync.queue_url;
  if (!queueUrl) return { queued: false as const, reason: "queue_not_configured" as const };
  sqsClient ??= new SQSClient({});
  const normalized = normalizeLiftOrderNumber(orderNumber);
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ order_number: normalized, reason, requested_at: new Date().toISOString() }),
    MessageGroupId: queueUrl.endsWith(".fifo") ? `proof-${normalized}` : undefined,
    MessageDeduplicationId: queueUrl.endsWith(".fifo") ? `${normalized}-${Math.floor(Date.now() / 60_000)}` : undefined
  }));
  return { queued: true as const };
}

export function proofOrderIsStale(lastSyncedAt: string, now = new Date()) {
  const syncedAt = Date.parse(lastSyncedAt);
  const staleAfterMs = getProofRuntimeConfig().sync.stale_after_minutes * 60 * 1000;
  return !Number.isFinite(syncedAt) || now.getTime() - syncedAt >= staleAfterMs;
}

export type ProofAutomaticRefreshState = {
  stale: boolean;
  eligible: boolean;
  reason: "fresh" | "active_recent" | "non_interactive" | "inactive";
};

export function proofAutomaticRefreshState(
  order: Pick<ProofOrder, "health" | "updated_at" | "last_synced_at">,
  now = new Date()
): ProofAutomaticRefreshState {
  if (!proofOrderIsStale(order.last_synced_at, now)) {
    return { stale: false, eligible: false, reason: "fresh" };
  }
  if (order.health !== "active") {
    return { stale: true, eligible: false, reason: "non_interactive" };
  }
  const updatedAt = Date.parse(order.updated_at);
  const maximumInactiveMs = getProofRuntimeConfig().sync.automatic_refresh_max_inactive_days * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(updatedAt) || now.getTime() - updatedAt >= maximumInactiveMs) {
    return { stale: true, eligible: false, reason: "inactive" };
  }
  return { stale: true, eligible: true, reason: "active_recent" };
}
