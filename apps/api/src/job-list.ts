import type { ProcessingJobPreview } from "./store.js";

export interface JobListItem {
  job_id: string;
  pathfinder_order_id: string;
  customer_id: string;
  customer_name: string;
  import_method_name: string;
  output_route_name: string;
  state: ProcessingJobPreview["state"];
  source_file_name: string;
  target_order_number: string | null;
  target_order_status: ProcessingJobPreview["target_order_status"];
  target_order_status_checked_at: string | null;
  target_order_created_at: string | null;
  target_order_created_precision: ProcessingJobPreview["target_order_created_precision"];
  target_order_created_source: ProcessingJobPreview["target_order_created_source"];
  last_activity_at: string | null;
  order_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  ext_id: string;
  contract_number: string | null;
  campaign_name: string | null;
  order_title: string | null;
  line_count: number;
  public_intake: ProcessingJobPreview["public_intake"];
  source_order_summary: {
    source_order_key: string;
    related_record_count: number;
  } | null;
}

export interface JobListPageMetadata {
  returned_count: number;
  total_count: number;
  next_cursor: string | null;
}

export interface JobListPage {
  items: JobListItem[];
  page: JobListPageMetadata;
}

export function toJobListItem(job: ProcessingJobPreview): JobListItem {
  return {
    job_id: job.job_id,
    pathfinder_order_id: job.pathfinder_order_id,
    customer_id: job.customer_id,
    customer_name: job.customer_name,
    import_method_name: job.import_method_name,
    output_route_name: job.output_route_name,
    state: job.state,
    source_file_name: job.source_file_name,
    target_order_number: job.target_order_number ?? null,
    target_order_status: job.target_order_status ?? null,
    target_order_status_checked_at: job.target_order_status_checked_at ?? null,
    target_order_created_at: job.target_order_created_at ?? null,
    target_order_created_precision: job.target_order_created_precision ?? null,
    target_order_created_source: job.target_order_created_source ?? null,
    last_activity_at: job.last_activity_at ?? null,
    order_confirmed_at: job.order_confirmed_at ?? null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    archived_at: job.archived_at ?? null,
    ext_id: job.lift_payload.order.ext_id,
    contract_number: job.canonical_order.order.contract_number?.trim() || null,
    campaign_name:
      job.source_evidence?.campaign_name?.trim() ||
      job.lift_payload.order.order_title?.trim() ||
      job.source_file_name ||
      null,
    order_title: job.lift_payload.order.order_title?.trim() || null,
    line_count: job.lift_payload.lines.length,
    public_intake: job.public_intake ?? null,
    source_order_summary: job.source_order_summary
      ? {
          source_order_key: job.source_order_summary.source_order_key,
          related_record_count: job.source_order_summary.related_record_count
        }
      : null
  };
}

export function buildJobListPage(jobs: ProcessingJobPreview[]): JobListPage {
  const items = jobs.map(toJobListItem);
  return {
    items,
    page: {
      returned_count: items.length,
      total_count: jobs.length,
      // The response contract is cursor-ready. The first repair deliberately
      // keeps the current all-jobs behavior because compact records are small;
      // a bounded cursor can be introduced without changing the item shape.
      next_cursor: null
    }
  };
}

export function compactWorkspaceJobs<
  T extends { jobs: ProcessingJobPreview[]; submit_attempts?: unknown[] }
>(workspace: T) {
  const jobList = buildJobListPage(workspace.jobs);
  return {
    ...workspace,
    jobs: jobList.items,
    // The workspace shell only uses the newest attempt for its existing
    // "last submission" summary. Complete attempt history remains on the
    // exact job-detail endpoint.
    submit_attempts: workspace.submit_attempts?.slice(0, 1) ?? [],
    jobs_page: jobList.page
  };
}
