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
}

interface ScheduledWritebackSummary {
  eligible_count: number;
  posted_count: number;
  replayed_count: number;
  failed_count: number;
}

export interface WrikeScheduledIntakeCompletionResult {
  status: string;
  checked_at: string;
  discovered_count: number;
  prepared_count: number;
  replayed_count: number;
  failed_count: number;
  discovery_summary: ScheduledDiscoverySummary;
  scheduled_submit: ScheduledSubmitSummary;
  status_writeback: ScheduledWritebackSummary;
}

export function buildWrikeScheduledIntakeCompletionLog(
  result: WrikeScheduledIntakeCompletionResult,
  timestamp = Date.now()
) {
  const candidateFailures =
    result.failed_count +
    result.scheduled_submit.failed_count +
    result.status_writeback.failed_count;

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
            { Name: "candidate_failures", Unit: "Count" }
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
    candidate_failures: candidateFailures
  };
}
