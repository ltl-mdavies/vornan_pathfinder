export interface WrikeManualIntakeEvidenceRecord {
  evidence_id: string;
  file_name: string;
  extension: string;
  storage_status: "Stored" | "Replayed";
}

export interface WrikeManualIntakePreview {
  preview_status: "Created" | "Replayed";
  job_id: string;
  job_state: string;
}

export type WrikeManualIntakeFailureStage =
  | "source_evidence"
  | "document_publication"
  | "preview_creation"
  | "unknown";

export type WrikeManualIntakeFailureCode =
  | "invalid_evidence"
  | "evidence_identity_conflict"
  | "evidence_not_found"
  | "evidence_storage_failed"
  | "publication_disabled"
  | "publication_configuration_invalid"
  | "manifest_read_failed"
  | "object_write_failed"
  | "object_head_failed"
  | "publication_identity_conflict"
  | "delivery_preflight_failed"
  | "manifest_write_failed"
  | "preview_failed"
  | "unknown";

export interface WrikeManualIntakeFailure {
  failure_stage: WrikeManualIntakeFailureStage;
  failure_code: WrikeManualIntakeFailureCode;
}

export interface WrikeManualIntakeWorkbookResult {
  evidence_id: string;
  file_name: string;
  extension: string;
  evidence_status: "Stored" | "Replayed";
  preview_status: "Created" | "Replayed" | "Blocked";
  job_id?: string;
  job_state?: string;
  message?: string;
  failure_stage?: WrikeManualIntakeFailureStage;
  failure_code?: WrikeManualIntakeFailureCode;
}

export interface WrikeManualIntakeResult {
  status: "Prepared" | "Partially Prepared";
  task_id: string;
  prepared_at: string;
  summary: {
    workbook_count: number;
    created_count: number;
    replayed_count: number;
    blocked_count: number;
  };
  workbooks: WrikeManualIntakeWorkbookResult[];
  capabilities: {
    operator_controlled: true;
    source_evidence_persistence: true;
    preview_job_creation: true;
    polling: false;
    webhook: false;
    wrike_writes: false;
    lift_actions: false;
  };
}

const blockedPreviewMessage =
  "Pathfinder could not prepare this workbook. Review its source evidence and saved Import Method before trying again.";

export async function prepareWrikeManualIntake<TRecord extends WrikeManualIntakeEvidenceRecord>(args: {
  captureEvidence: () => Promise<{ task_id: string; evidence: TRecord[] }>;
  createPreview: (record: TRecord) => Promise<WrikeManualIntakePreview>;
  classifyPreviewError?: (error: unknown) => WrikeManualIntakeFailure;
  now?: () => Date;
}): Promise<WrikeManualIntakeResult> {
  const captured = await args.captureEvidence();
  const workbooks: WrikeManualIntakeWorkbookResult[] = [];

  for (const record of captured.evidence) {
    try {
      const preview = await args.createPreview(record);
      workbooks.push({
        evidence_id: record.evidence_id,
        file_name: record.file_name,
        extension: record.extension,
        evidence_status: record.storage_status,
        preview_status: preview.preview_status,
        job_id: preview.job_id,
        job_state: preview.job_state
      });
    } catch (error) {
      const failure = args.classifyPreviewError?.(error) ?? {
        failure_stage: "unknown" as const,
        failure_code: "unknown" as const
      };
      workbooks.push({
        evidence_id: record.evidence_id,
        file_name: record.file_name,
        extension: record.extension,
        evidence_status: record.storage_status,
        preview_status: "Blocked",
        message: blockedPreviewMessage,
        failure_stage: failure.failure_stage,
        failure_code: failure.failure_code
      });
    }
  }

  const createdCount = workbooks.filter((record) => record.preview_status === "Created").length;
  const replayedCount = workbooks.filter((record) => record.preview_status === "Replayed").length;
  const blockedCount = workbooks.filter((record) => record.preview_status === "Blocked").length;

  return {
    status: blockedCount ? "Partially Prepared" : "Prepared",
    task_id: captured.task_id,
    prepared_at: (args.now?.() ?? new Date()).toISOString(),
    summary: {
      workbook_count: workbooks.length,
      created_count: createdCount,
      replayed_count: replayedCount,
      blocked_count: blockedCount
    },
    workbooks,
    capabilities: {
      operator_controlled: true,
      source_evidence_persistence: true,
      preview_job_creation: true,
      polling: false,
      webhook: false,
      wrike_writes: false,
      lift_actions: false
    }
  };
}
