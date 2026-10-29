import type { AllocationStatus } from "./api";

/** A stale order projection cannot unlock artwork already sent in a durable batch. */
export function protectedAllocationAttachments(batch: AllocationStatus, orderRefreshed: boolean): string[] {
  if (batch.state === "completed" && orderRefreshed) return [];
  return batch.entries
    .filter((entry) => batch.state !== "paused" || entry.state !== "pending")
    .map((entry) => entry.attachment_id);
}
