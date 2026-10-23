export interface OperationsJob {
  id: string;
  label: string;
  customerId: string;
  customer: string;
  sourceOrder: string;
  intake: string;
  liftOrder: string | null;
  processing: string;
  production: string;
  createdAt: string;
  confirmedAt: string | null;
  activityAt: string;
  archived: boolean;
}

export type JobFilters = { search: string; customer: string; intake: string; days: string; attention: boolean; archived: string };
export const defaultOperationsFilters: JobFilters = { search: "", customer: "", intake: "", days: "", attention: false, archived: "active" };
export const needsOperationsAttention = (job: OperationsJob) => !job.liftOrder && ["Submitted", "Needs Mapping", "Submit Failed", "Failed", "Retry"].includes(job.processing);

export function filterOperationsJobs(jobs: OperationsJob[], filters: JobFilters, now = Date.now()) {
  const query = filters.search.trim().toLocaleLowerCase();
  return jobs.filter(job =>
    (filters.archived === "all" || job.archived === (filters.archived === "archived")) &&
    (!filters.customer || job.customerId === filters.customer) &&
    (!filters.intake || job.intake === filters.intake) &&
    (!filters.attention || needsOperationsAttention(job)) &&
    (!filters.days || Date.parse(job.createdAt) >= now - Number(filters.days) * 86_400_000) &&
    (!query || [job.id, job.label, job.customer, job.sourceOrder, job.liftOrder].join(" ").toLocaleLowerCase().includes(query))
  ).sort((a, b) => (Date.parse(b.activityAt) || 0) - (Date.parse(a.activityAt) || 0) || a.id.localeCompare(b.id));
}

export function operationsMetrics(jobs: OperationsJob[], now = new Date()) {
  const day = (value: string | null) => value && Number.isFinite(Date.parse(value)) && new Date(value).toDateString() === now.toDateString();
  const active = jobs.filter(job => !job.archived);
  return {
    receivedToday: jobs.filter(job => day(job.createdAt)).length,
    confirmedToday: jobs.filter(job => job.liftOrder && day(job.confirmedAt)).length,
    confirming: active.filter(job => !job.liftOrder && job.processing === "Submitted").length,
    mapping: active.filter(job => !job.liftOrder && job.processing === "Needs Mapping").length,
    blocked: active.filter(job => !job.liftOrder && ["Failed", "Submit Failed"].includes(job.processing)).length,
    ready: active.filter(job => !job.liftOrder && job.processing === "Ready").length
  };
}

export function operationsDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export type QueueState = "pending" | "waiting" | "changes" | "approved" | "reference" | "cancel_requested" | "revision_pending" | "reviewed" | "unavailable";
export interface OperationsProofLine {
  id: string; orderNumber: string; orderTitle: string | null; customerId: string; customer: string;
  lineNumber: string | null; product: string; state: QueueState; creativeCount: number;
  since: string | null; lastSynced: string; stale: boolean;
  stateCounts?: Partial<Record<QueueState, number>>;
}
export function proofLineHasState(row: OperationsProofLine, state: QueueState) {
  return row.stateCounts ? (row.stateCounts[state] ?? 0) > 0 : row.state === state;
}
export type ProofGrouping = "order" | "customer";
export function sortProofLines(rows: OperationsProofLine[], grouping: ProofGrouping) {
  return [...rows].sort((a, b) =>
    (grouping === "customer" ? a.customer.localeCompare(b.customer) || a.customerId.localeCompare(b.customerId) : 0) ||
    a.orderNumber.localeCompare(b.orderNumber) || a.customerId.localeCompare(b.customerId) ||
    (a.lineNumber ?? "").localeCompare(b.lineNumber ?? "", undefined, { numeric: true }) || a.id.localeCompare(b.id));
}
export const proofOrderGroupKey = (row: OperationsProofLine) => JSON.stringify([row.customerId, row.orderNumber]);
export interface OperationsProofPage {
  lines: OperationsProofLine[]; next_cursor: string | null; checked_at: string;
  coverage: "cached_orders_only";
}
