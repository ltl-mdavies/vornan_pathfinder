import { createHash } from "node:crypto";
import { WrikeConnectionError, type WrikeAttachmentFailure } from "@pathfinder/wrike-adapter";

export interface IntakeDiagnostic {
  customer_id: string; diagnostic_id: string; import_method_id: string; task_id: string;
  contract_number: string | null; provider: "wrike"; stage: "preparation" | "document_publication" | "source_evidence" | "preview_creation";
  task_url: string | null;
  state: "open" | "resolved"; reason_code: string; message: string;
  attachment: WrikeAttachmentFailure | null;
  first_seen_at: string; last_seen_at: string; observed_at: string; resolved_at: string | null;
  occurrences: number; job_ids: string[];
}
export interface IntakeObservation {
  customer_id: string; import_method_id: string; task_id: string; contract_number?: string;
  task_url?: string | null;
  observed_at: string; error?: unknown; job_ids?: string[];
}
export function diagnosticKey(input: Pick<IntakeObservation, "customer_id" | "import_method_id" | "task_id">) {
  for (const value of [input.customer_id, input.import_method_id, input.task_id]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(value)) throw new Error("Invalid diagnostic identity");
  }
  return createHash("sha256").update(`${input.import_method_id}\0${input.task_id}`).digest("hex");
}
const reasons: Record<string, string> = {
  attachment_validation_failed: "An order attachment did not pass validation. Review the order grid and reference PDF files.",
  attachment_download_failed: "An approved attachment could not be downloaded. Check its availability in Wrike.",
  attachment_metadata_failed: "Wrike attachment details could not be read. Check the task attachments.",
  trigger_status_mismatch: "The Wrike task no longer matches the configured intake status.",
  task_discovery_failed: "The Wrike task could not be qualified. Check its contract, folder, and required fields.",
  oauth_refresh_failed: "The Wrike connection needs internal support review.",
  invalid_configuration: "The intake configuration needs internal support review.",
  invalid_evidence: "The saved attachment did not pass identity and content validation. Internal support must review it.",
  evidence_identity_conflict: "The attachment identity conflicts with previously saved evidence. Internal support must review it; do not resubmit.",
  evidence_not_found: "Saved source evidence is unavailable. Internal support must review its storage.",
  evidence_storage_failed: "Source attachments could not be saved. Internal support must check evidence storage.",
  publication_disabled: "Document delivery is unavailable in this environment. Internal support must review the configuration.",
  publication_configuration_invalid: "Document delivery configuration is invalid. Internal support must review it.",
  manifest_read_failed: "The document delivery record could not be read. Internal support must check delivery storage.",
  object_write_failed: "The order document could not be published for Lift. Internal support must check delivery storage.",
  object_head_failed: "The published order document could not be verified. Internal support must check delivery storage.",
  publication_identity_conflict: "The published document conflicts with saved evidence. Internal support must review it; do not resubmit.",
  delivery_preflight_failed: "The published order document was not reachable for delivery to Lift. Internal support must check document delivery.",
  manifest_write_failed: "The document delivery record could not be saved. Internal support must check delivery storage.",
  preview_failed: "The order grid could not be converted into a job. Check the grid format and required fields with internal support."
};
export class IntakePreparationFailure extends Error {
  constructor(public readonly code: string, public readonly stage: IntakeDiagnostic["stage"]) { super("Preparation failed"); }
}
export function safePreparationFailure(error: unknown): Pick<IntakeDiagnostic, "reason_code" | "message" | "attachment" | "stage"> {
  // Never serialize provider messages, arbitrary error properties, URLs or credentials.
  const code = (error instanceof WrikeConnectionError || error instanceof IntakePreparationFailure) && Object.hasOwn(reasons, error.code) ? error.code : "preparation_failed";
  const detail = error instanceof WrikeConnectionError ? error.attachment_failure : undefined;
  let attachment: WrikeAttachmentFailure | null = null;
  if (detail && ["workbook", "reference_pdf"].includes(detail.kind) &&
      ["file_too_large", "total_budget_exceeded", "invalid_pdf"].includes(detail.reason) &&
      ["content_length", "stream_lower_bound", "complete"].includes(detail.size_source) &&
      Number.isSafeInteger(detail.observed_bytes) && detail.observed_bytes >= 0 &&
      Number.isSafeInteger(detail.limit_bytes) && detail.limit_bytes >= 0) {
    const name = detail.file_name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256);
    attachment = { kind: detail.kind, reason: detail.reason, observed_bytes: detail.observed_bytes,
      limit_bytes: detail.limit_bytes, size_source: detail.size_source,
      file_name: /https?:|[\\/]|(?:token|signature|secret)=/i.test(name) ? "Attachment" : name || "Attachment" };
  }
  const type = attachment?.kind === "reference_pdf" ? "Reference PDF" : "Workbook";
  const message = attachment?.reason === "invalid_pdf" ? "Reference PDF does not have a valid PDF signature. Replace it with a valid production reference file."
    : attachment ? `${type} exceeds ${attachment.reason === "total_budget_exceeded" ? "the remaining total attachment budget" : "the file-size limit"}. Reduce the file size or contact support.`
    : reasons[code] ?? "Order preparation failed before completion. Internal support must review the source order; do not resubmit an uncertain Lift order.";
  return { reason_code: attachment?.reason ?? code, message, attachment,
    stage: error instanceof IntakePreparationFailure ? error.stage : error instanceof WrikeConnectionError && error.code.startsWith("attachment_") ? "source_evidence" : "preparation" };
}
export function applyIntakeObservation(previous: IntakeDiagnostic | null, input: IntakeObservation): IntakeDiagnostic | null {
  const id = diagnosticKey(input);
  if (!Number.isFinite(Date.parse(input.observed_at))) throw new Error("Invalid observation time");
  if (previous && (previous.diagnostic_id !== id || previous.customer_id !== input.customer_id)) throw new Error("Diagnostic identity mismatch");
  // An older in-flight preparation must not reopen a later successful observation.
  if (previous && Date.parse(input.observed_at) <= Date.parse(previous.observed_at)) return previous;
  const jobs = (input.job_ids ?? []).filter(id => /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(id)).slice(0, 25);
  if (input.error === undefined) {
    if (!previous || !jobs.length) return previous;
    return { ...previous, state: "resolved", observed_at: input.observed_at, resolved_at: input.observed_at, job_ids: jobs };
  }
  return {
    customer_id: input.customer_id, diagnostic_id: id, import_method_id: input.import_method_id,
    task_id: input.task_id, provider: "wrike", state: "open",
    task_url: input.task_url && /^https:\/\/www\.wrike\.com\/open\.htm\?id=\d+$/.test(input.task_url) ? input.task_url : previous?.task_url ?? null,
    contract_number: input.contract_number && /^C\d{1,20}$/i.test(input.contract_number) ? input.contract_number.toUpperCase() : previous?.contract_number ?? null,
    ...safePreparationFailure(input.error), first_seen_at: previous?.first_seen_at ?? input.observed_at,
    last_seen_at: input.observed_at, observed_at: input.observed_at, resolved_at: null,
    occurrences: (previous?.occurrences ?? 0) + 1, job_ids: jobs
  };
}
