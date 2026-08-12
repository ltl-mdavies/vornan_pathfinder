export interface WrikeSourceOrderJob {
  customer_id: string;
  job_id: string;
  import_method_id?: string | null;
  state?: string | null;
  target_order_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  source_evidence?: {
    provider?: string | null;
    account_id?: string | null;
    task_id?: string | null;
  } | null;
}

function cleanIdentityPart(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function wrikeSourceOrderKey(job: WrikeSourceOrderJob) {
  const accountId = cleanIdentityPart(job.source_evidence?.account_id);
  const taskId = cleanIdentityPart(job.source_evidence?.task_id);
  const methodId = cleanIdentityPart(job.import_method_id);
  if (
    job.source_evidence?.provider !== "wrike" ||
    !job.customer_id.trim() ||
    !methodId ||
    !accountId ||
    !taskId
  ) {
    return null;
  }
  return ["wrike", job.customer_id.trim(), methodId, accountId, taskId].join(":");
}

function stateAuthority(state: string | null | undefined) {
  switch (state) {
    case "Order Confirmed":
    case "Completed":
      return 5;
    case "Submitted":
      return 4;
    case "Ready":
      return 3;
    case "Needs Mapping":
    case "Failed":
    case "Submit Failed":
      return 2;
    default:
      return 1;
  }
}

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareWrikeSourceOrderAuthority<T extends WrikeSourceOrderJob>(left: T, right: T) {
  const targetComparison = Number(Boolean(right.target_order_number?.trim())) - Number(Boolean(left.target_order_number?.trim()));
  if (targetComparison !== 0) return targetComparison;
  const stateComparison = stateAuthority(right.state) - stateAuthority(left.state);
  if (stateComparison !== 0) return stateComparison;
  const updatedComparison = timestamp(right.updated_at) - timestamp(left.updated_at);
  if (updatedComparison !== 0) return updatedComparison;
  const createdComparison = timestamp(right.created_at) - timestamp(left.created_at);
  if (createdComparison !== 0) return createdComparison;
  return left.job_id.localeCompare(right.job_id);
}

export function selectWrikeSourceOrderAnchor<T extends WrikeSourceOrderJob>(jobs: T[]) {
  return [...jobs].sort(compareWrikeSourceOrderAuthority)[0] ?? null;
}

export function wrikeSourceOrderHasPossibleTransport(
  jobs: WrikeSourceOrderJob[],
  attemptsByJobId: ReadonlyMap<string, Array<{ state: string }>>
) {
  return jobs.some(
    (job) =>
      Boolean(job.target_order_number?.trim()) ||
      (attemptsByJobId.get(job.job_id) ?? []).some(
        (attempt) => !["Blocked", "Gate Locked"].includes(attempt.state)
      )
  );
}

export interface WrikeSourceOrderGroup<T extends WrikeSourceOrderJob> {
  source_order_key: string;
  anchor: T;
  related: T[];
}

export function groupWrikeSourceOrders<T extends WrikeSourceOrderJob>(jobs: T[]) {
  const wrikeGroups = new Map<string, T[]>();
  const groups: Array<WrikeSourceOrderGroup<T>> = [];
  for (const job of jobs) {
    const key = wrikeSourceOrderKey(job);
    if (!key) {
      groups.push({ source_order_key: `job:${job.customer_id}:${job.job_id}`, anchor: job, related: [] });
      continue;
    }
    const current = wrikeGroups.get(key) ?? [];
    current.push(job);
    wrikeGroups.set(key, current);
  }
  for (const [sourceOrderKey, sourceJobs] of wrikeGroups) {
    const anchor = selectWrikeSourceOrderAnchor(sourceJobs);
    if (!anchor) continue;
    groups.push({
      source_order_key: sourceOrderKey,
      anchor,
      related: sourceJobs
        .filter((job) => job.job_id !== anchor.job_id)
        .sort(compareWrikeSourceOrderAuthority)
    });
  }
  return groups.sort((left, right) => compareWrikeSourceOrderAuthority(left.anchor, right.anchor));
}
