import { pathfinderFetch } from "./api-client";
import type { OperationsJob, OperationsProofLine, OperationsProofPage } from "./operations-model";
import { proofLineHasState } from "./operations-model";

// Dashboard attention is actionable work, not a second version of the wider Jobs queue.
export function dashboardAttention(jobs: OperationsJob[]) {
  const priority: Record<string, number> = { "Submit Failed": 0, Failed: 0, "Needs Mapping": 1, Retry: 2 };
  return jobs.filter(job => !job.archived && !job.liftOrder && Object.prototype.hasOwnProperty.call(priority, job.processing))
    .sort((a, b) => priority[a.processing] - priority[b.processing] ||
      (Date.parse(a.activityAt) || 0) - (Date.parse(b.activityAt) || 0) || a.id.localeCompare(b.id));
}

export function dashboardIssue(job: OperationsJob) {
  if (job.processing === "Needs Mapping") return "Product mapping needed";
  if (job.processing === "Submit Failed") return "Lift submission needs review";
  if (job.processing === "Retry") return "Retry needs review";
  return "Job processing needs review";
}

export function dashboardRecent(jobs: OperationsJob[]) {
  return jobs.filter(job => !job.archived).sort((a, b) =>
    (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) ||
    (Date.parse(b.activityAt) || 0) - (Date.parse(a.activityAt) || 0) || a.id.localeCompare(b.id)).slice(0, 5);
}

export interface DashboardProofOrder {
  key: string; order: string; customerId: string; customer: string;
  pending: number; since: string | null; lastSynced: string; stale: boolean;
}
export function dashboardProofOrders(lines: OperationsProofLine[], now = Date.now()): DashboardProofOrder[] {
  const groups = new Map<string, DashboardProofOrder>();
  for (const row of new Map(lines.map(line => [line.id, line])).values()) {
    if (!proofLineHasState(row, "pending")) continue;
    const key = `${row.customerId}:${row.orderNumber}`;
    const age = now - Date.parse(row.lastSynced);
    const stale = row.stale || !Number.isFinite(age) || age > 15 * 60_000;
    const since = row.since && Number.isFinite(Date.parse(row.since)) ? row.since : null;
    const previous = groups.get(key);
    if (!previous) groups.set(key, { key, order: row.orderNumber, customerId: row.customerId, customer: row.customer,
      pending: 1, since, lastSynced: row.lastSynced, stale });
    else {
      previous.pending++;
      previous.stale ||= stale;
      if (since && (!previous.since || Date.parse(since) < Date.parse(previous.since))) previous.since = since;
      if (Date.parse(row.lastSynced) < Date.parse(previous.lastSynced)) previous.lastSynced = row.lastSynced;
    }
  }
  return [...groups.values()].sort((a, b) => (Date.parse(a.since ?? "") || Infinity) - (Date.parse(b.since ?? "") || Infinity) || a.key.localeCompare(b.key));
}

/** One bounded authenticated cache read. Never initiates Lift sync or creates Proof access. */
export async function readDashboardProof(apiBaseUrl: string, signal: AbortSignal): Promise<OperationsProofPage> {
  const response = await pathfinderFetch(`${apiBaseUrl}/api/operations/proof-queue`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404 ? "Proof preview is not enabled on this API." : "Proof preview could not be refreshed.");
  const page = await response.json() as OperationsProofPage;
  if (!Array.isArray(page.lines) || page.coverage !== "cached_orders_only" || !Number.isFinite(Date.parse(page.checked_at))) {
    throw new Error("Proof preview returned incomplete data.");
  }
  return page;
}
