export interface WrikeScheduledIntakeConfig {
  enabled: boolean;
  lift_submit_enabled: boolean;
  status_writeback_enabled: boolean;
  customer_id: string;
  import_method_id: string;
  max_candidates: number;
}

export interface WrikeScheduledOrderCandidate {
  task_id: string;
  contract_number: string;
  trigger_status_id: string;
}

export interface WrikeScheduledPreparedOrder {
  task_id: string;
  status: "Created" | "Replayed";
  job_ids: string[];
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
  const name = error instanceof Error ? error.name : "unknown";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "unknown";
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
        failure_category: null
      });
    } catch (error) {
      results.push({
        task_id: candidate.task_id,
        contract_number: candidate.contract_number,
        outcome: "failed",
        job_count: 0,
        job_ids: [],
        failure_category: failureCategory(error)
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
