export interface WrikeScheduledIntakeConfig {
  enabled: boolean;
  lift_submit_enabled: boolean;
  status_writeback_enabled: boolean;
  customer_id: string;
  import_method_id: string;
  max_candidates: number;
}

export function isWrikeScheduledIntakeEvent(event: unknown) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  const record = event as Record<string, unknown>;
  const detail = record.detail as Record<string, unknown> | undefined;
  return (
    record.source === "pathfinder.wrike" &&
    record["detail-type"] === "Wrike Scheduled Intake" &&
    typeof detail === "object" &&
    detail !== null &&
    !Array.isArray(detail) &&
    (detail.prepare_only === true ||
      detail.automation === "discover_prepare_submit_writeback")
  );
}

export interface WrikeScheduledOrderCandidate {
  task_id: string;
  contract_number: string;
  trigger_status_id: string;
}

export interface WrikeSourceTaskJob {
  customer_id: string;
  job_id: string;
  import_method_id?: string | null;
  source_evidence?: {
    provider?: string | null;
    task_id?: string | null;
  } | null;
}

export function findWrikeSourceTaskSiblingJobs<T extends WrikeSourceTaskJob>(args: {
  current: T;
  jobs: T[];
}): T[] {
  const taskId = args.current.source_evidence?.task_id?.trim() ?? "";
  if (args.current.source_evidence?.provider !== "wrike" || !taskId) return [];
  return args.jobs.filter(
    (candidate) =>
      candidate.job_id !== args.current.job_id &&
      candidate.customer_id === args.current.customer_id &&
      candidate.import_method_id === args.current.import_method_id &&
      candidate.source_evidence?.provider === "wrike" &&
      candidate.source_evidence.task_id?.trim() === taskId
  );
}

export interface WrikeScheduledCompletedTaskJob extends WrikeSourceTaskJob {
  target_order_number?: string | null;
  scheduled_wrike_intake?: {
    source?: string | null;
    task_id?: string | null;
    import_method_id?: string | null;
  } | null;
}

/**
 * Do not spend the bounded scheduled-intake budget on a source task that has
 * already reached a durable Lift order.  The task may remain in Wrike at its
 * ready status, but it must never be prepared or submitted again by the
 * scheduler.  Unresolved source tasks deliberately remain eligible.
 */
export function filterPreviouslyConfirmedWrikeScheduledCandidates<
  T extends WrikeScheduledOrderCandidate,
  J extends WrikeScheduledCompletedTaskJob
>(args: {
  candidates: T[];
  jobs: J[];
  customer_id: string;
  import_method_id: string;
}): T[] {
  const confirmedTaskIds = new Set(
    args.jobs
      .filter((job) => {
        const marker = job.scheduled_wrike_intake;
        const taskId = job.source_evidence?.task_id?.trim() ?? "";
        return (
          job.customer_id === args.customer_id &&
          job.import_method_id === args.import_method_id &&
          job.source_evidence?.provider === "wrike" &&
          marker?.source === "scheduled_polling" &&
          marker.import_method_id === args.import_method_id &&
          marker.task_id?.trim() === taskId &&
          Boolean(job.target_order_number?.trim())
        );
      })
      .map((job) => job.scheduled_wrike_intake?.task_id?.trim() ?? "")
      .filter(Boolean)
  );
  return args.candidates.filter((candidate) => !confirmedTaskIds.has(candidate.task_id));
}

export interface WrikeMappingReevaluationJob extends WrikeSourceTaskJob {
  state?: string | null;
  target_order_number?: string | null;
}

export interface WrikeMappingReevaluationAttempt {
  state: string;
}

export function wrikeMappingReevaluationBlockReason(args: {
  current: WrikeMappingReevaluationJob;
  siblings: WrikeMappingReevaluationJob[];
  attemptsByJobId: ReadonlyMap<string, WrikeMappingReevaluationAttempt[]>;
}): string | null {
  if (!args.current.source_evidence?.task_id?.trim()) {
    return "This job no longer has a complete Wrike source identity. Review the original intake before continuing.";
  }
  if (!new Set(["Needs Mapping", "Failed"]).has(args.current.state ?? "")) {
    return "Only a blocked or Needs Mapping job can be checked against current product mappings.";
  }
  for (const job of [args.current, ...args.siblings]) {
    if (job.target_order_number?.trim()) {
      return "A Lift order is already associated with this Wrike task. Reconcile that order instead of creating or rebuilding another one.";
    }
    const attempts = args.attemptsByJobId.get(job.job_id) ?? [];
    if (attempts.some((attempt) => !["Blocked", "Gate Locked"].includes(attempt.state))) {
      return "A Lift submission may already have reached the external service. Reconcile that attempt before taking another action; Pathfinder will not retry it automatically.";
    }
  }
  if (args.siblings.length > 0) {
    return "Another Pathfinder job already represents this Wrike task. Open that job and reconcile the two previews before changing either one.";
  }
  return null;
}

export interface WrikeScheduledPreparedOrder {
  task_id: string;
  status: "Created" | "Replayed";
  job_ids: string[];
}

export interface WrikeScheduledCandidateFailureDetail {
  failure_stage: string;
  reason_code: string;
  evidence_ids: string[];
  job_ids: string[];
}

export class WrikeScheduledCandidatePreparationError extends Error {
  readonly failure_details: WrikeScheduledCandidateFailureDetail[];

  constructor(failureDetails: WrikeScheduledCandidateFailureDetail[]) {
    super("Scheduled Wrike candidate preparation failed.");
    this.name = "WrikeScheduledCandidatePreparationError";
    this.failure_details = failureDetails;
  }
}

export function buildWrikeScheduledCandidatePreparationError(workbooks: Array<{
  evidence_id: string;
  preview_status: string;
  failure_stage?: string;
  failure_code?: string;
  reason_code?: string;
  job_id?: string;
}>) {
  const existingJobIds = workbooks
    .map((workbook) => workbook.job_id)
    .filter((jobId): jobId is string => Boolean(jobId));
  return new WrikeScheduledCandidatePreparationError(
    workbooks
      .filter((workbook) => workbook.preview_status === "Blocked")
      .map((workbook) => ({
        failure_stage: workbook.failure_stage ?? "prepare",
        reason_code: workbook.reason_code ?? workbook.failure_code ?? "unknown",
        evidence_ids: [workbook.evidence_id],
        job_ids: existingJobIds
      }))
  );
}

export interface WrikeScheduledIntakeRunResult {
  status: "disabled" | "completed";
  checked_at: string;
  customer_id: string | null;
  import_method_id: string | null;
  discovered_count: number;
  prepared_count: number;
  replayed_count: number;
  failed_count: number;
  results: Array<{
    task_id: string;
    contract_number: string;
    outcome: "created" | "replayed" | "failed";
    job_count: number;
    job_ids: string[];
    failure_category: string | null;
    failure_details: WrikeScheduledCandidateFailureDetail[];
  }>;
  capabilities: {
    wrike_reads: boolean;
    evidence_persistence: boolean;
    document_publication: boolean;
    preview_job_creation: boolean;
    wrike_writes: false;
    lift_actions: boolean;
  };
}

function cleanIdentifier(value: string | undefined) {
  const candidate = value?.trim() ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(candidate) ? candidate : "";
}

export function getWrikeScheduledIntakeConfig(
  environment: NodeJS.ProcessEnv = process.env
): WrikeScheduledIntakeConfig {
  const [
    packedEnabled,
    packedCustomerId,
    packedImportMethodId,
    packedMaxCandidates,
    packedStatusWriteback,
    packedLiftSubmit
  ] =
    (environment.PATHFINDER_WRIKE_SCHEDULED_INTAKE ?? "").split("|");
  const configuredMax = Number(
    packedMaxCandidates || environment.PATHFINDER_WRIKE_SCHEDULED_MAX_CANDIDATES || 25
  );
  return {
    enabled:
      packedEnabled === "true" ||
      (!packedEnabled && environment.PATHFINDER_ENABLE_WRIKE_SCHEDULED_INTAKE === "true"),
    status_writeback_enabled:
      packedStatusWriteback === "true" ||
      (!packedStatusWriteback &&
        environment.PATHFINDER_ENABLE_WRIKE_SCHEDULED_STATUS_WRITEBACK === "true"),
    lift_submit_enabled:
      packedLiftSubmit === "true" ||
      (!packedLiftSubmit &&
        environment.PATHFINDER_ENABLE_WRIKE_SCHEDULED_LIFT_SUBMIT === "true"),
    customer_id: cleanIdentifier(
      packedCustomerId || environment.PATHFINDER_WRIKE_SCHEDULED_CUSTOMER_ID
    ),
    import_method_id: cleanIdentifier(
      packedImportMethodId || environment.PATHFINDER_WRIKE_SCHEDULED_IMPORT_METHOD_ID
    ),
    max_candidates: Number.isInteger(configuredMax)
      ? Math.max(1, Math.min(configuredMax, 25))
      : 25
  };
}

export interface WrikeScheduledSubmitResult {
  eligible_count: number;
  submitted_count: number;
  replayed_count: number;
  failed_count: number;
  outcomes: Array<{
    job_id: string;
    outcome: "submitted" | "replayed" | "failed";
    failure_category: string | null;
  }>;
}

export async function runWrikeScheduledSubmits(args: {
  candidates: Array<{ job_id: string }>;
  submit: (candidate: { job_id: string }) => Promise<{ reused: boolean }>;
}): Promise<WrikeScheduledSubmitResult> {
  const candidates = [...args.candidates].sort((left, right) =>
    left.job_id.localeCompare(right.job_id)
  );
  const outcomes: WrikeScheduledSubmitResult["outcomes"] = [];
  for (const candidate of candidates) {
    try {
      const result = await args.submit(candidate);
      outcomes.push({
        job_id: candidate.job_id,
        outcome: result.reused ? "replayed" : "submitted",
        failure_category: null
      });
    } catch (error) {
      outcomes.push({
        job_id: candidate.job_id,
        outcome: "failed",
        failure_category: failureCategory(error)
      });
    }
  }
  return {
    eligible_count: candidates.length,
    submitted_count: outcomes.filter((entry) => entry.outcome === "submitted").length,
    replayed_count: outcomes.filter((entry) => entry.outcome === "replayed").length,
    failed_count: outcomes.filter((entry) => entry.outcome === "failed").length,
    outcomes
  };
}

export interface WrikeScheduledStatusWritebackCandidate {
  job_id: string;
}

export interface WrikeScheduledStatusWritebackResult {
  eligible_count: number;
  posted_count: number;
  replayed_count: number;
  failed_count: number;
  outcomes: Array<{
    job_id: string;
    outcome: "posted" | "replayed" | "failed";
    failure_category: string | null;
  }>;
}

export async function runWrikeScheduledStatusWritebacks(args: {
  candidates: WrikeScheduledStatusWritebackCandidate[];
  writeBack: (
    candidate: WrikeScheduledStatusWritebackCandidate
  ) => Promise<{ reused: boolean }>;
}): Promise<WrikeScheduledStatusWritebackResult> {
  const candidates = [...args.candidates].sort((left, right) =>
    left.job_id.localeCompare(right.job_id)
  );
  const outcomes: WrikeScheduledStatusWritebackResult["outcomes"] = [];
  for (const candidate of candidates) {
    try {
      const result = await args.writeBack(candidate);
      outcomes.push({
        job_id: candidate.job_id,
        outcome: result.reused ? "replayed" : "posted",
        failure_category: null
      });
    } catch (error) {
      outcomes.push({
        job_id: candidate.job_id,
        outcome: "failed",
        failure_category: failureCategory(error)
      });
    }
  }
  return {
    eligible_count: candidates.length,
    posted_count: outcomes.filter((entry) => entry.outcome === "posted").length,
    replayed_count: outcomes.filter((entry) => entry.outcome === "replayed").length,
    failed_count: outcomes.filter((entry) => entry.outcome === "failed").length,
    outcomes
  };
}

function failureCategory(error: unknown) {
  const code = error && typeof error === "object"
    ? safeFailureToken((error as { code?: unknown }).code, "")
    : "";
  if (code) return code;
  const name = error instanceof Error ? error.name : "unknown";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "unknown";
}

function safeFailureToken(value: unknown, fallback: string) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
    ? value
    : fallback;
}

function safeFailureIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(value)
    ? value
    : null;
}

function candidateFailureDetails(error: unknown): WrikeScheduledCandidateFailureDetail[] {
  if (error instanceof WrikeScheduledCandidatePreparationError) {
    const details = error.failure_details.slice(0, 25).map((detail) => ({
      failure_stage: safeFailureToken(detail.failure_stage, "prepare"),
      reason_code: safeFailureToken(detail.reason_code, "unknown"),
      evidence_ids: detail.evidence_ids
        .map(safeFailureIdentifier)
        .filter((value): value is string => Boolean(value))
        .slice(0, 25),
      job_ids: detail.job_ids
        .map(safeFailureIdentifier)
        .filter((value): value is string => Boolean(value))
        .slice(0, 25)
    }));
    if (details.length > 0) return details;
  }
  return [{
    failure_stage: "prepare",
    reason_code: failureCategory(error),
    evidence_ids: [],
    job_ids: []
  }];
}

export async function runWrikeScheduledIntake(args: {
  config: WrikeScheduledIntakeConfig;
  discover: () => Promise<WrikeScheduledOrderCandidate[]>;
  prepare: (candidate: WrikeScheduledOrderCandidate) => Promise<WrikeScheduledPreparedOrder>;
  now?: () => Date;
}): Promise<WrikeScheduledIntakeRunResult> {
  const checkedAt = (args.now ?? (() => new Date()))().toISOString();
  const base = {
    checked_at: checkedAt,
    customer_id: args.config.customer_id || null,
    import_method_id: args.config.import_method_id || null,
    capabilities: {
      wrike_reads: false,
      evidence_persistence: false,
      document_publication: false,
      preview_job_creation: false,
      wrike_writes: false as const,
      lift_actions: false
    }
  };
  if (!args.config.enabled) {
    return {
      ...base,
      status: "disabled",
      discovered_count: 0,
      prepared_count: 0,
      replayed_count: 0,
      failed_count: 0,
      results: []
    };
  }
  if (!args.config.customer_id || !args.config.import_method_id) {
    throw new Error("Scheduled Wrike intake requires one exact customer and Import Method.");
  }

  const discovered = await args.discover();
  if (discovered.length > args.config.max_candidates) {
    throw new Error("Scheduled Wrike intake exceeded its bounded candidate limit.");
  }
  const candidates = [...discovered].sort(
    (left, right) =>
      left.task_id.localeCompare(right.task_id) ||
      left.contract_number.localeCompare(right.contract_number)
  );
  const results: WrikeScheduledIntakeRunResult["results"] = [];
  for (const candidate of candidates) {
    try {
      const prepared = await args.prepare(candidate);
      results.push({
        task_id: candidate.task_id,
        contract_number: candidate.contract_number,
        outcome: prepared.status === "Replayed" ? "replayed" : "created",
        job_count: prepared.job_ids.length,
        job_ids: prepared.job_ids,
        failure_category: null,
        failure_details: []
      });
    } catch (error) {
      const failureDetails = candidateFailureDetails(error);
      results.push({
        task_id: candidate.task_id,
        contract_number: candidate.contract_number,
        outcome: "failed",
        job_count: 0,
        job_ids: [],
        failure_category: failureDetails[0]?.reason_code ?? "unknown",
        failure_details: failureDetails
      });
    }
  }
  return {
    ...base,
    status: "completed",
    discovered_count: candidates.length,
    prepared_count: results.filter((result) => result.outcome === "created").length,
    replayed_count: results.filter((result) => result.outcome === "replayed").length,
    failed_count: results.filter((result) => result.outcome === "failed").length,
    results,
    capabilities: {
      wrike_reads: true,
      evidence_persistence: true,
      document_publication: true,
      preview_job_creation: true,
      wrike_writes: false,
      lift_actions: args.config.lift_submit_enabled
    }
  };
}
