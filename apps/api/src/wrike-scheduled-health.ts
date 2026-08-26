export interface ScheduledSubmissionHealthInput {
  enabled: boolean;
  lift_submit_enabled: boolean;
  customer_id: string;
  import_method_id: string;
}

export interface ScheduledSubmissionHealthJob {
  customer_id: string;
  import_method_id: string;
  state: string;
  target_order_number?: string | null;
  created_at: string;
  source_evidence?: {
    provider?: string | null;
    task_id?: string | null;
  } | null;
  scheduled_wrike_intake?: {
    source: "scheduled_polling";
    task_id?: string | null;
    import_method_id: string;
    discovered_at: string;
  } | null;
}

export interface ScheduledSubmissionHealth {
  configured: boolean;
  submission_enabled: boolean;
  state: "healthy" | "submission_inhibited" | "unhealthy" | "inactive";
  ready_count: number;
  oldest_ready_at: string | null;
  last_cycle_at: string | null;
  last_cycle_prepared_count: number | null;
  last_cycle_submitted_count: number | null;
  cycle_overdue: boolean;
}

export interface ScheduledSubmissionCycleSummary {
  checked_at: string;
  prepared_count: number;
  submitted_count: number;
  candidate_failure_count: number;
  failed_count: number;
  scheduled_submit_failed_count: number;
}

/** Sanitized aggregate-only scheduler health. It never exposes task, job, or provider identities. */
export function buildScheduledSubmissionHealth(
  config: ScheduledSubmissionHealthInput,
  jobs: ScheduledSubmissionHealthJob[],
  latestCycle: ScheduledSubmissionCycleSummary | null = null,
  observedAt = new Date().toISOString()
): ScheduledSubmissionHealth {
  if (!config.enabled) {
    return {
      configured: false,
      submission_enabled: false,
      state: "inactive",
      ready_count: 0,
      oldest_ready_at: null,
      last_cycle_at: null,
      last_cycle_prepared_count: null,
      last_cycle_submitted_count: null,
      cycle_overdue: false
    };
  }
  const ready = jobs.filter((job) =>
    job.customer_id === config.customer_id &&
    job.import_method_id === config.import_method_id &&
    job.state === "Ready" &&
    !job.target_order_number?.trim() &&
    job.source_evidence?.provider === "wrike" &&
    Boolean(job.source_evidence.task_id?.trim()) &&
    job.scheduled_wrike_intake?.source === "scheduled_polling" &&
    job.scheduled_wrike_intake.import_method_id === config.import_method_id &&
    job.scheduled_wrike_intake.task_id?.trim() === job.source_evidence.task_id?.trim()
  );
  const oldestReadyAt = ready
    .map((job) => job.scheduled_wrike_intake?.discovered_at ?? job.created_at)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()[0] ?? null;
  const inhibited = !config.lift_submit_enabled && ready.length > 0;
  const cycleFailed = latestCycle
    ? latestCycle.candidate_failure_count > 0 ||
      latestCycle.failed_count > 0 ||
      latestCycle.scheduled_submit_failed_count > 0
    : false;
  const cycleOverdue = latestCycle
    ? Date.parse(latestCycle.checked_at) < Date.parse(observedAt) - 30 * 60 * 1000
    : false;
  return {
    configured: true,
    submission_enabled: config.lift_submit_enabled,
    state: cycleFailed || cycleOverdue ? "unhealthy" : inhibited ? "submission_inhibited" : "healthy",
    ready_count: ready.length,
    oldest_ready_at: oldestReadyAt,
    last_cycle_at: latestCycle?.checked_at ?? null,
    last_cycle_prepared_count: latestCycle?.prepared_count ?? null,
    last_cycle_submitted_count: latestCycle?.submitted_count ?? null,
    cycle_overdue: cycleOverdue
  };
}
