import type { ProcessingJobPreview } from "./store.js";
export interface CurrentWrikeWorkbook { attachment_id: string; version_id: string; updated_at: string }
/** Fail closed for legacy or multi-workbook identity; this is not a backfill writer. */
export function assessWrikeFeedbackFreshness(job: ProcessingJobPreview, workbooks: CurrentWrikeWorkbook[], taskUpdatedAt: string | null) {
  const evidence = job.source_evidence;
  if (!evidence?.attachment_id || !evidence.version_id || !evidence.evidence_id || !/^[a-f0-9]{64}$/.test(evidence.evidence_sha256) ||
    !evidence.import_method_fingerprint || !Number.isFinite(Date.parse(evidence.captured_at))) return "legacy_backfill_required" as const;
  if (workbooks.length !== 1) return "workbook_identity_review" as const;
  if (!taskUpdatedAt || !Number.isFinite(Date.parse(taskUpdatedAt))) return "task_freshness_unknown" as const;
  const workbook = workbooks[0]!;
  if (workbook.attachment_id !== evidence.attachment_id || workbook.version_id !== evidence.version_id) return "source_version_changed" as const;
  if (!Number.isFinite(Date.parse(workbook.updated_at)) || Date.parse(workbook.updated_at) > Date.parse(evidence.captured_at) || Date.parse(taskUpdatedAt) > Date.parse(evidence.captured_at)) return "source_newer_than_job" as const;
  return "current" as const;
}
