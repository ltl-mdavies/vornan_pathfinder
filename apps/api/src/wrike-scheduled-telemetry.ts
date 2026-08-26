interface ScheduledDiscoverySummary {
  task_count: number;
  scoped_task_count: number;
  order_identity_match_count: number;
  order_status_match_count: number;
  order_status_and_identity_match_count: number;
  order_vendor_match_count: number;
  order_contract_ready_count: number;
  order_status_id_count: number;
}

interface ScheduledSubmitSummary {
  eligible_count: number;
  submitted_count: number;
  replayed_count: number;
  failed_count: number;
  outcomes?: Array<{
    job_id: string;
    outcome: "submitted" | "replayed" | "failed";
    failure_category: string | null;
  }>;
}

interface ScheduledWritebackSummary {
  eligible_count: number;
  posted_count: number;
  replayed_count: number;
  failed_count: number;
  outcomes?: Array<{
    job_id: string;
    outcome: "posted" | "replayed" | "failed";
    failure_category: string | null;
  }>;
}

export interface WrikeScheduledIntakeCompletionResult {
  status: string;
  checked_at: string;
  discovered_count: number;
  prepared_count: number;
  replayed_count: number;
  failed_count: number;
  results?: Array<{
    task_id: string;
    outcome: "created" | "replayed" | "failed";
    failure_category: string | null;
    failure_details?: Array<{
      failure_stage: string;
      reason_code: string;
      evidence_ids: string[];
      job_ids: string[];
    }>;
  }>;
  discovery_summary: ScheduledDiscoverySummary;
  scheduled_submit: ScheduledSubmitSummary;
  status_writeback: ScheduledWritebackSummary;
  submission_inhibited_ready_count?: number;
}

function safeTelemetryToken(value: unknown, fallback: string) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)
    ? value
    : fallback;
}

function safeTelemetryIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(value)
    ? value
    : null;
}

function safeTelemetryIdentifiers(values: unknown) {
  return Array.isArray(values)
    ? values
      .map(safeTelemetryIdentifier)
      .filter((value): value is string => Boolean(value))
      .slice(0, 25)
    : [];
}

export function buildCandidateFailureDetails(result: WrikeScheduledIntakeCompletionResult) {
  const preparationFailures = (result.results ?? [])
    .filter((entry) => entry.outcome === "failed")
    .flatMap((entry) => {
      const details = entry.failure_details?.length
        ? entry.failure_details
        : [{
            failure_stage: "prepare",
            reason_code: entry.failure_category ?? "unknown",
            evidence_ids: [],
            job_ids: []
          }];
      return details.map((detail) => ({
        stage: safeTelemetryToken(detail.failure_stage, "prepare"),
        reason_code: safeTelemetryToken(detail.reason_code, "unknown"),
        task_id: safeTelemetryIdentifier(entry.task_id),
        evidence_ids: safeTelemetryIdentifiers(detail.evidence_ids),
        job_ids: safeTelemetryIdentifiers(detail.job_ids)
      }));
    });
  const submitFailures = (result.scheduled_submit.outcomes ?? [])
    .filter((entry) => entry.outcome === "failed")
    .map((entry) => ({
      stage: "submit",
      reason_code: safeTelemetryToken(entry.failure_category, "unknown"),
      task_id: null,
      evidence_ids: [],
      job_ids: safeTelemetryIdentifiers([entry.job_id])
    }));
  const writebackFailures = (result.status_writeback.outcomes ?? [])
    .filter((entry) => entry.outcome === "failed")
    .map((entry) => ({
      stage: "writeback",
      reason_code: safeTelemetryToken(entry.failure_category, "unknown"),
      task_id: null,
      evidence_ids: [],
      job_ids: safeTelemetryIdentifiers([entry.job_id])
    }));
  return [...preparationFailures, ...submitFailures, ...writebackFailures].slice(0, 75);
}

export function buildWrikeScheduledIntakeCompletionLog(
  result: WrikeScheduledIntakeCompletionResult,
  timestamp = Date.now()
) {
  const candidateFailures =
    result.failed_count +
    result.scheduled_submit.failed_count +
    result.status_writeback.failed_count;
  const candidateFailureDetails = buildCandidateFailureDetails(result);

  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: "Pathfinder/WrikeScheduledIntake",
          Dimensions: [[]],
          Metrics: [
            { Name: "discovered_count", Unit: "Count" },
            { Name: "prepared_count", Unit: "Count" },
            { Name: "scheduled_submits_submitted", Unit: "Count" },
            { Name: "status_comments_posted", Unit: "Count" },
            { Name: "candidate_failures", Unit: "Count" },
            { Name: "submission_inhibited_ready", Unit: "Count" }
          ]
        }
      ]
    },
    event: "wrike_scheduled_intake_completed",
    status: result.status,
    checked_at: result.checked_at,
    discovered_count: result.discovered_count,
    fetched_task_count: result.discovery_summary.task_count,
    scoped_task_count: result.discovery_summary.scoped_task_count,
    order_identity_match_count: result.discovery_summary.order_identity_match_count,
    order_status_match_count: result.discovery_summary.order_status_match_count,
    order_status_and_identity_match_count:
      result.discovery_summary.order_status_and_identity_match_count,
    order_vendor_match_count: result.discovery_summary.order_vendor_match_count,
    order_contract_ready_count: result.discovery_summary.order_contract_ready_count,
    matched_order_status_id_count: result.discovery_summary.order_status_id_count,
    prepared_count: result.prepared_count,
    replayed_count: result.replayed_count,
    failed_count: result.failed_count,
    scheduled_submits_eligible: result.scheduled_submit.eligible_count,
    scheduled_submits_submitted: result.scheduled_submit.submitted_count,
    scheduled_submits_replayed: result.scheduled_submit.replayed_count,
    scheduled_submits_failed: result.scheduled_submit.failed_count,
    status_comments_eligible: result.status_writeback.eligible_count,
    status_comments_posted: result.status_writeback.posted_count,
    status_comments_replayed: result.status_writeback.replayed_count,
    status_comments_failed: result.status_writeback.failed_count,
    candidate_failures: candidateFailures,
    submission_inhibited_ready: result.submission_inhibited_ready_count ?? 0,
    candidate_failure_detail_count: candidateFailureDetails.length,
    candidate_failure_details: candidateFailureDetails
  };
}
