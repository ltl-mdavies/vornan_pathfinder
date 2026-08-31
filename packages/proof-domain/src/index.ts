import {
  matchLiftLineRecord,
  type LiftLineIdentity,
  type OrderRollupProof,
  type OrderRollupProofSummary
} from "@pathfinder/order-rollup";


export type ProofTaskState =
  | "waiting"
  | "pending"
  | "revised"
  | "approved"
  | "reference"
  | "cancelled"
  | "missing"
  | "error";

export type ProofTaskDecisionState =
  | "approval_pending"
  | "rejected_pending_action"
  | "sent_back_to_artist"
  | "revised_art_pending"
  | "cancel_requested";

export interface ProofTaskDecisionContext {
  state: ProofTaskDecisionState;
  action:
    | "APPROVE"
    | "REJECT"
    | "SEND_BACK_TO_ARTIST"
    | "REVISED_ART_WILL_BE_SENT"
    | "CANCEL_LINE";
  attachment_id: string;
  recorded_at: string;
  source: "pathfinder_operator_action" | "pathfinder_customer_decision";
}

export type ProofOrderHealth = "active" | "complete" | "missing" | "stale" | "error";

export interface ProofNormalizationWarning {
  code:
    | "line_number_fallback"
    | "proof_without_line"
    | "proof_without_attachment"
    | "proof_without_url"
    | "duplicate_attachment_line_mismatch";
  message: string;
  order_line_id?: string | null;
  line_number?: string | null;
  attachment_id?: string | null;
}

export interface ProofComment {
  text: string | null;
  created_at: string | null;
  attachment: unknown;
}

export interface ProofLine {
  order_line_id: string;
  line_number: string | null;
  step_number: number | null;
  product_name: string | null;
  quantity: number | null;
  status: string | null;
  cancelled: boolean;
}

export interface ProofVersion {
  version_id: string;
  attachment_id: string | null;
  created_at: string | null;
  filename: string | null;
  content_type?: string | null;
  preview_url: string | null;
  download_url: string | null;
  approval_status: string | null;
  approved_by: string | null;
  approved_at: string | null;
  comments: ProofComment[];
  detailed_report: unknown;
  feedback_fingerprint: string;
  current: boolean;
  archived_at: string | null;
}

export interface ProofTask {
  task_id: string;
  order_line_id: string | null;
  line_number: string | null;
  attachment_id: string | null;
  product_name: string | null;
  quantity: number | null;
  state: ProofTaskState;
  actionable: boolean;
  decision_context?: ProofTaskDecisionContext | null;
  sibling_index: number;
  sibling_count: number;
  version: number;
  current_version: ProofVersion | null;
  versions: ProofVersion[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ProofOrder {
  order_number: string;
  order_title: string | null;
  /** Internal Lift cohort boundary. Never include this field in the public Proof DTO. */
  customer_id?: string | null;
  customer_name: string | null;
  order_status: string | null;
  health: ProofOrderHealth;
  version: number;
  lines: ProofLine[];
  tasks: ProofTask[];
  archived_tasks: ProofTask[];
  warnings: ProofNormalizationWarning[];
  last_sync_diagnostics?: ProofSyncDiagnosticsSummary | null;
  created_at: string;
  updated_at: string;
  last_synced_at: string;
}

export interface ProofSyncDiagnosticsSummary {
  source: "lift_read";
  completed_at: string;
  line_reads: {
    attempted: number;
    succeeded: number;
    failed: number;
    proof_rows: number;
  };
  fallback_read: {
    attempted: boolean;
    ok: boolean | null;
    proof_rows: number;
  };
  normalization_warning_count: number;
}

export type ProofGrantScope = "view" | "review";
export type ProofGrantStatus = "active" | "revoked";
export type ProofReviewExperience = "simple" | "advanced";
export type ProofGrantKind = "owner" | "shared";

export interface ProofGrantCapabilityBinding {
  pathfinder_customer_id: string;
  proof_customer_id: string;
  identity_verified_at: string;
  access_mode: "view_only" | "review";
  review_experience: ProofReviewExperience;
  source: "customer_default" | "order_override" | "ltl_demo_qa";
  policy_updated_at: string;
}

export interface ProofAccessGrant {
  grant_id: string;
  order_number: string;
  scope: ProofGrantScope;
  /**
   * Owner grants are the original customer access links and remain single-use.
   * Shared grants are explicitly delegated, reusable bearer links.
   */
  kind?: ProofGrantKind;
  parent_grant_id?: string | null;
  created_by_participant_id?: string | null;
  label: string | null;
  /** Optional owner-only note describing the purpose of a delegated link. */
  description?: string | null;
  status: ProofGrantStatus;
  token_hash: string;
  created_at: string;
  expires_at: string;
  expires_at_epoch: number;
  exchanged_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  capability?: ProofGrantCapabilityBinding | null;
}

export interface ProofAccessSession {
  session_id: string;
  session_hash: string;
  grant_id: string;
  order_number: string;
  scope: ProofGrantScope;
  csrf_hash: string;
  participant_id: string | null;
  created_at: string;
  expires_at: string;
  expires_at_epoch: number;
  last_seen_at: string;
  ended_at: string | null;
  capability?: ProofGrantCapabilityBinding | null;
}

export interface ProofParticipant {
  participant_id: string;
  grant_id: string;
  order_number: string;
  display_name: string;
  email: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface PublicProofParticipant {
  participant_id: string;
  display_name: string;
  email: string;
}

export interface PublicProofActivity {
  identified_reviewers: number;
  last_activity_at: string | null;
  reviewer_names_visible: false;
}

export type ProofReviewLifecycleState = "waiting" | "review_ready" | "all_reviewed" | "degraded";
export type ProofReviewLifecycleAction = "proof.review_ready" | "proof.all_reviewed" | "proof.review_reopened";

export interface ProofFeedbackAcknowledgement {
  acknowledgement_id: string;
  grant_id: string;
  participant_id: string;
  order_number: string;
  task_id: string;
  feedback_fingerprint: string;
  acknowledged_at: string;
}

export type ProofDecisionKind = "approve" | "send_back_to_artist";

export interface ProofDecisionCanonicalIntent {
  decision: ProofDecisionKind;
  order_number: string;
  task_id: string;
  attachment_id: string;
  participant_id: string;
  grant_id: string;
  expected_task_version: number;
  expected_version_id: string;
  feedback_fingerprint: string;
  note: string | null;
}

export type ProofDecisionOutcomeState =
  | "prepared"
  | "submission_uncertain"
  | "reconciling"
  | "confirmed"
  | "failed";

export type ProofDecisionOutcomeClass = "pending" | "reconciling" | "terminal";

export interface ProofDecisionIntegrityContract {
  idempotency_key: string;
  canonical_body_hash: string;
  intent: ProofDecisionCanonicalIntent;
  outcome: "prepared";
}

export interface ProofDecisionIdempotencyRecord {
  idempotency_key: string;
  canonical_body_hash: string;
  outcome: ProofDecisionOutcomeState;
}

export interface ProofDecisionLedgerRecord extends ProofDecisionIdempotencyRecord {
  intent: ProofDecisionCanonicalIntent;
  prepared_audit_event_id: string;
  record_version: number;
  created_at: string;
  updated_at: string;
  expires_at_epoch: number;
}

export type ProofDecisionIdempotencyDisposition =
  | { status: "new" }
  | { status: "replay"; outcome: ProofDecisionOutcomeState }
  | { status: "conflict" };

export class InvalidProofDecisionOutcomeTransitionError extends Error {
  constructor(current: ProofDecisionOutcomeState, next: ProofDecisionOutcomeState) {
    super(`Proof decision outcome cannot transition from ${current} to ${next}.`);
    this.name = "InvalidProofDecisionOutcomeTransitionError";
  }
}

const proofDecisionOutcomeTransitions: Record<ProofDecisionOutcomeState, readonly ProofDecisionOutcomeState[]> = {
  prepared: ["submission_uncertain", "confirmed", "failed"],
  submission_uncertain: ["reconciling", "confirmed", "failed"],
  reconciling: ["confirmed", "failed"],
  confirmed: [],
  failed: []
};

export function proofDecisionOutcomeClass(state: ProofDecisionOutcomeState): ProofDecisionOutcomeClass {
  if (state === "confirmed" || state === "failed") return "terminal";
  if (state === "submission_uncertain" || state === "reconciling") return "reconciling";
  return "pending";
}

export function transitionProofDecisionOutcome(
  current: ProofDecisionOutcomeState,
  next: ProofDecisionOutcomeState
) {
  if (!proofDecisionOutcomeTransitions[current].includes(next)) {
    throw new InvalidProofDecisionOutcomeTransitionError(current, next);
  }
  return next;
}

export function classifyProofDecisionIdempotency(
  existing: ProofDecisionIdempotencyRecord | null,
  candidate: Pick<ProofDecisionIntegrityContract, "idempotency_key" | "canonical_body_hash">
): ProofDecisionIdempotencyDisposition {
  if (!existing || existing.idempotency_key !== candidate.idempotency_key) {
    return { status: "new" };
  }
  if (existing.canonical_body_hash !== candidate.canonical_body_hash) {
    return { status: "conflict" };
  }
  return { status: "replay", outcome: existing.outcome };
}

export type ProofAuditAction =
  | "proof.sync_completed"
  | "proof.sync_failed"
  | ProofReviewLifecycleAction
  | "proof.grant_created"
  | "proof.grant_updated"
  | "proof.grant_revoked"
  | "proof.grant_regenerated"
  | "proof.share_created"
  | "proof.share_revoked"
  | "proof.link_email_sent"
  | "proof.link_email_failed"
  | "proof.participant_identified"
  | "proof.participant_updated"
  | "proof.feedback_acknowledged"
  | "proof.session_exchanged"
  | "proof.session_extended"
  | "proof.session_ended"
  | "proof.decision_prepared"
  | "proof.decision_submission_started"
  | "proof.decision_observed"
  | "proof.operator_action_prepared"
  | "proof.operator_action_submission_started"
  | "proof.operator_action_observed"
  | "proof.asset_upload_initialized"
  | "proof.asset_upload_started"
  | "proof.asset_upload_completed"
  | "proof.asset_verification_started"
  | "proof.asset_scan_started"
  | "proof.asset_scan_completed"
  | "proof.asset_published"
  | "proof.asset_delivery_verified"
  | "proof.detailed_report_generation_started"
  | "proof.detailed_report_status_observed"
  | "proof.detailed_report_ready"
  | "proof.detailed_report_timed_out"
  | "proof.detailed_report_view_redirected";

export type ProofAuditActorType = "operator" | "customer_session" | "system";
export type ProofAuditOutcome = "succeeded" | "failed";

export interface ProofAuditMetadata {
  source: "operator" | "public_api" | "sync_worker" | "system";
  order_health?: ProofOrderHealth;
  order_version?: number;
  active_task_count?: number;
  archived_task_count?: number;
  review_state?: ProofReviewLifecycleState;
  pending_task_count?: number;
  regenerating_task_count?: number;
  waiting_task_count?: number;
  reviewed_task_count?: number;
  total_task_count?: number;
  grant_scope?: ProofGrantScope;
  grant_status?: ProofGrantStatus;
  customer_proof_access_mode?: "view_only" | "review";
  customer_proof_review_experience?: ProofReviewExperience;
  customer_proof_policy_source?: "customer_default" | "order_override" | "ltl_demo_qa";
  customer_proof_policy_updated_at?: string;
  delivery_mode?: "log" | "ses";
  delivery_status?: "logged" | "sent" | "failed";
  decision_kind?: ProofDecisionKind;
  decision_outcome?: "prepared" | "submission_uncertain" | "reconciling" | "confirmed" | "failed";
  operator_action_kind?:
    | "APPROVE"
    | "REJECT"
    | "SEND_BACK_TO_ARTIST"
    | "CANCEL_LINE"
    | "REVISED_ART_WILL_BE_SENT";
  response_classification?: string;
  proof_asset_id?: string;
  proof_asset_state?:
    | "initialized"
    | "uploading"
    | "uploaded"
    | "verifying"
    | "scan_pending"
    | "ready_for_lift";
  detailed_report_state?:
    | "unavailable"
    | "ready"
    | "generation_started"
    | "running"
    | "failed"
    | "timed_out";
  failure_class?: string;
}

export interface ProofAuditEvent {
  event_id: string;
  occurred_at: string;
  action: ProofAuditAction;
  outcome: ProofAuditOutcome;
  order_number: string;
  task_id: string | null;
  order_line_id: string | null;
  attachment_id: string | null;
  grant_id: string | null;
  participant_id: string | null;
  actor_type: ProofAuditActorType;
  actor_id: string;
  correlation_id: string;
  metadata: ProofAuditMetadata;
}

export interface ProofAuditPage {
  events: ProofAuditEvent[];
  next_cursor: string | null;
}

export interface PublicProofComment {
  text: string | null;
  created_at: string | null;
  attachments: PublicProofCommentAttachment[];
}

export interface PublicProofCommentAttachment {
  filename: string;
  url: string | null;
  content_type: string | null;
}

export interface PublicProofTechnicalCheck {
  name: string;
  status: string | null;
}

/** Customer-safe report availability. Provider links and response bodies remain private. */
export interface PublicProofDetailedReportDefinition {
  definition_id: string;
  label: string | null;
  ready: boolean;
}

export interface PublicProofVersion {
  version_id: string;
  created_at: string | null;
  filename: string | null;
  content_type: string | null;
  preview_kind: "image" | "pdf" | "download" | "unavailable";
  preview_url: string | null;
  download_url: string | null;
  approval_status: string | null;
  approved_at: string | null;
  comments: PublicProofComment[];
  technical_checks: PublicProofTechnicalCheck[];
  report_definitions?: PublicProofDetailedReportDefinition[];
  current: boolean;
}

export interface PublicProofTask {
  task_id: string;
  attachment_id?: string | null;
  version?: number;
  line_number: string | null;
  shared_line_numbers: string[];
  product_name: string | null;
  quantity: number | null;
  state: ProofTaskState;
  decision_state: ProofTaskDecisionState | null;
  action_reconciliation_pending: boolean;
  sibling_index: number;
  sibling_count: number;
  feedback_required: boolean;
  feedback_acknowledged: boolean;
  current_version: PublicProofVersion | null;
  versions: PublicProofVersion[];
}

export interface PublicProofTaskHistory {
  task_id: string;
  versions: PublicProofVersion[];
}

export interface PublicProofCounts {
  pending: number;
  regenerating: number;
  waiting: number;
  reviewed: number;
  total: number;
}

export interface PublicProofOrder {
  order_number: string;
  order_title: string | null;
  order_status: string | null;
  health: ProofOrderHealth;
  tasks: PublicProofTask[];
  counts: PublicProofCounts;
  last_synced_at: string;
  access: {
    scope: ProofGrantScope;
    decisions_enabled: boolean;
    share_access_enabled: boolean;
    review_experience: ProofReviewExperience;
  };
}

export interface OrderRollupProofRecord extends OrderRollupProof, LiftLineIdentity {}

export interface ProofOrderRollupProjection {
  summary: OrderRollupProofSummary;
  proofs: OrderRollupProofRecord[];
}

export interface ProofNormalizationPolicy {
  isProofReadableLine?: (line: ProofLine) => boolean;
  isReferenceLine?: (line: ProofLine) => boolean;
  reference_min_step?: number | null;
}

export interface NormalizeProofOrderInput {
  order_number: string;
  order_payload: unknown;
  proof_payloads: unknown[];
  previous?: ProofOrder | null;
  synced_at?: string;
  policy?: ProofNormalizationPolicy;
}

export class InvalidLiftOrderNumberError extends Error {
  constructor(value: string) {
    super(`Lift order number must match A followed by 7 or 8 digits; received ${value || "an empty value"}.`);
    this.name = "InvalidLiftOrderNumberError";
  }
}

export class LiftOrderNotFoundError extends Error {
  constructor(orderNumber: string) {
    super(`Lift order ${orderNumber} was not found.`);
    this.name = "LiftOrderNotFoundError";
  }
}

export function normalizeLiftOrderNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^A\d{7,8}$/.test(normalized)) {
    throw new InvalidLiftOrderNumberError(normalized);
  }
  return normalized;
}

export function liftRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["rowset", "items", "rows", "data"]) {
      if (Array.isArray(record[key])) {
        return (record[key] as unknown[]).filter(
          (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object"
        );
      }
    }
  }
  return [];
}

export function liftOrderLines(payload: unknown) {
  return liftRows(payload).flatMap((row) => {
    const nestedLines = row.LINES ?? row.lines;
    if (Array.isArray(nestedLines)) {
      return nestedLines.filter(
        (line): line is Record<string, unknown> => Boolean(line) && typeof line === "object"
      );
    }
    return row.ORDER_LINE_ID !== undefined || row.order_line_id !== undefined ? [row] : [];
  });
}

export function liftOrderCustomerId(payload: unknown) {
  const header = liftRows(payload)[0];
  const candidate = header?.CUSTOMER_ID ?? header?.customer_id;
  return candidate === undefined || candidate === null ? null : String(candidate).trim() || null;
}

function value(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return null;
}

function text(record: Record<string, unknown>, ...keys: string[]) {
  const candidate = value(record, ...keys);
  return candidate == null ? null : String(candidate).trim() || null;
}

function number(record: Record<string, unknown>, ...keys: string[]) {
  const candidate = value(record, ...keys);
  if (candidate == null) {
    return null;
  }
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function truthy(record: Record<string, unknown>, ...keys: string[]) {
  const candidate = text(record, ...keys)?.toUpperCase();
  return candidate === "Y" || candidate === "YES" || candidate === "TRUE" || candidate === "1";
}

function stableHash(valueToHash: string) {
  let hash = 2166136261;
  for (let index = 0; index < valueToHash.length; index += 1) {
    hash ^= valueToHash.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function stableTaskId(orderNumber: string, identity: string) {
  return `ptask_${stableHash(`${orderNumber}|${identity}`)}`;
}

function stableVersionId(valueToHash: unknown) {
  return `pversion_${stableHash(JSON.stringify(valueToHash))}`;
}

function proofFileIdentity(version: Pick<ProofVersion, "attachment_id" | "version_id">) {
  // Lift assigns a new attachment ID whenever a new proof file is created.
  // Everything else on a proof row can legitimately change while the file remains the same.
  return version.attachment_id ? `attachment:${version.attachment_id}` : `version:${version.version_id}`;
}

function dedupeProofVersions(versions: ProofVersion[]) {
  const seen = new Set<string>();
  return versions.filter((version) => {
    const identity = proofFileIdentity(version);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function fingerprint(valueToHash: unknown) {
  return stableHash(JSON.stringify(valueToHash));
}

function isCancelled(record: Record<string, unknown>) {
  const status = text(record, "LINE_STATUS", "ORDER_LINE_STATUS", "STATUS", "line_status", "status")?.toUpperCase() ?? "";
  return truthy(record, "CANCELLED", "CANCELED", "IS_CANCELLED", "cancelled", "canceled") || /CANCEL/.test(status);
}

function lineFromRow(row: Record<string, unknown>, fallbackIndex: number): ProofLine {
  const lineNumber = text(row, "LINE_NUMBER", "line_number");
  return {
    order_line_id: text(row, "ORDER_LINE_ID", "order_line_id") ?? `unidentified-line-${lineNumber ?? fallbackIndex + 1}`,
    line_number: lineNumber,
    step_number: number(row, "LINE_STEP_NUMBER", "STEP_NUMBER", "line_step_number", "step_number"),
    product_name: text(row, "PRODUCT_NAME", "PRODUCT", "DESCRIPTION", "product_name", "description"),
    quantity: number(row, "QUANTITY", "ORDER_QUANTITY", "quantity"),
    status: text(row, "LINE_STATUS", "ORDER_LINE_STATUS", "STATUS", "line_status", "status"),
    cancelled: isCancelled(row)
  };
}

function defaultIsReferenceLine(line: ProofLine, referenceMinStep: number | null | undefined) {
  return (
    /PRODUCTION|PRODUCED|COMPLETE|COMPLETED|SHIPPED|CLOSED|INVOICED/i.test(line.status ?? "") ||
    (referenceMinStep != null && line.step_number != null && line.step_number >= referenceMinStep)
  );
}

function commentFromRow(row: Record<string, unknown>): ProofComment | null {
  const comment: ProofComment = {
    text: text(row, "PROOF_COMMENT", "COMMENT", "proof_comment", "comment"),
    created_at: text(row, "COMMENT_TS", "COMMENT_DATE", "comment_ts", "comment_date"),
    attachment: value(row, "COMMENT_ATTACHMENT", "comment_attachment")
  };
  return comment.text || comment.created_at || comment.attachment ? comment : null;
}

function feedbackAttachmentIdentity(attachment: unknown) {
  return publicCommentAttachments(attachment)
    .map((item) => {
      let path: string | null = null;
      if (item.url) {
        try {
          path = new URL(item.url).pathname || null;
        } catch {
          path = null;
        }
      }
      return { filename: item.filename, content_type: item.content_type, path };
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function comparableFeedbackComment(comment: ProofComment) {
  return {
    text: comment.text,
    created_at: comment.created_at,
    attachments: feedbackAttachmentIdentity(comment.attachment)
  };
}

function compareFeedbackComments(left: ProofComment, right: ProofComment) {
  const leftTime = left.created_at ? Date.parse(left.created_at) : Number.NaN;
  const rightTime = right.created_at ? Date.parse(right.created_at) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) return Number.isFinite(leftTime) ? -1 : 1;
  return fingerprint(comparableFeedbackComment(left)).localeCompare(fingerprint(comparableFeedbackComment(right)));
}

function canonicalFeedbackComments(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows
    .map(commentFromRow)
    .filter((comment): comment is ProofComment => Boolean(comment))
    .filter((comment) => {
      const key = fingerprint(comparableFeedbackComment(comment));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareFeedbackComments);
}

function proofVersionFromRows(rows: Record<string, unknown>[]): ProofVersion {
  const row = rows[0] ?? {};
  const attachmentId = text(row, "ATTACHMENT_ID", "attachment_id");
  const createdAt = text(row, "CREATION_DATE", "CREATED_AT", "creation_date", "created_at");
  const filename = text(row, "PROOF_FILENAME", "FILENAME", "proof_filename", "filename");
  const contentType = text(
    row,
    "PROOF_CONTENT_TYPE",
    "PROOF_MIME_TYPE",
    "CONTENT_TYPE",
    "MIME_TYPE",
    "proof_content_type",
    "proof_mime_type",
    "content_type",
    "mime_type"
  );
  const comments = canonicalFeedbackComments(rows);
  const previewUrl = text(row, "PROOF_LINK_LOW", "PROOF_URL_LOW", "proof_link_low", "proof_url_low");
  const downloadUrl =
    text(row, "PROOF_LINK_HIGH", "PROOF_URL_HIGH", "proof_link_high", "proof_url_high") ?? previewUrl;
  const approvalStatus = text(row, "PROOF_APPROVAL_STATUS", "APPROVAL_STATUS", "proof_approval_status", "approval_status");
  const approvedBy = text(row, "PROOF_APPROVED_BY", "APPROVED_BY", "proof_approved_by", "approved_by");
  const approvedAt = text(row, "PROOF_APPROVED_DATE", "APPROVED_DATE", "proof_approved_date", "approved_date");
  const detailedReport = value(row, "DETAILED_REPORT", "detailed_report");
  return {
    // Attachment ID is Lift's durable file identity. Do not create a new
    // customer-visible version for a refreshed URL, comment, approval, or report.
    version_id: stableVersionId(attachmentId ? { attachmentId } : {
      createdAt,
      filename,
      contentType,
      previewUrl,
      downloadUrl
    }),
    attachment_id: attachmentId,
    created_at: createdAt,
    filename,
    content_type: contentType,
    preview_url: previewUrl ?? downloadUrl,
    download_url: downloadUrl,
    approval_status: approvalStatus,
    approved_by: approvedBy,
    approved_at: approvedAt,
    comments,
    detailed_report: detailedReport,
    feedback_fingerprint: fingerprint(comments.map(comparableFeedbackComment)),
    current: true,
    archived_at: null
  };
}

function taskState(line: ProofLine | null, version: ProofVersion | null, policy: ProofNormalizationPolicy) {
  if (line?.cancelled) {
    return "cancelled" as const;
  }
  // Lift's proof status is authoritative whenever it is present. A line can have
  // reached a production step while its proof record still carries the customer
  // approval outcome that the Proof experience must display.
  if (version) {
    if (/APPROV/i.test(version.approval_status ?? "")) {
      return "approved" as const;
    }
    if (/REVIS|REJECT|REGENERAT|CHANGE.*REQUEST/i.test(version.approval_status ?? "")) {
      return "revised" as const;
    }
    if ((version.approval_status ?? "").trim()) {
      if (!version.preview_url && !version.download_url) {
        return "error" as const;
      }
      return "pending" as const;
    }
  }
  if (
    line &&
    (policy.isReferenceLine
      ? policy.isReferenceLine(line)
      : defaultIsReferenceLine(line, policy.reference_min_step ?? 10))
  ) {
    return "reference" as const;
  }
  if (!version) {
    return "waiting" as const;
  }
  if (!version.preview_url && !version.download_url) {
    return "error" as const;
  }
  return "pending" as const;
}

function actionableState(state: ProofTaskState) {
  return state === "pending";
}

function stableProofAssetIdentity(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return value.replace(/[?#].*$/, "");
  }
}

function comparableProofVersion(version: ProofVersion | null) {
  if (!version) return null;
  const { version_id: _versionId, current: _current, archived_at: _archivedAt, ...content } = version;
  return {
    ...content,
    preview_url: stableProofAssetIdentity(version.preview_url),
    download_url: stableProofAssetIdentity(version.download_url)
  };
}

function comparableProofVersionWithoutFeedback(version: ProofVersion | null) {
  const comparable = comparableProofVersion(version);
  if (!comparable) return null;
  const { comments: _comments, feedback_fingerprint: _feedbackFingerprint, ...content } = comparable;
  return content;
}

function isSameProofVersionApartFromFeedback(left: ProofVersion | null, right: ProofVersion | null) {
  return Boolean(left && right) && fingerprint(comparableProofVersionWithoutFeedback(left)) === fingerprint(comparableProofVersionWithoutFeedback(right));
}

function taskContentFingerprint(task: ProofTask) {
  return fingerprint({
    order_line_id: task.order_line_id,
    line_number: task.line_number,
    attachment_id: task.attachment_id,
    product_name: task.product_name,
    quantity: task.quantity,
    state: task.state,
    actionable: task.actionable,
    sibling_index: task.sibling_index,
    sibling_count: task.sibling_count,
    current_version: comparableProofVersion(task.current_version)
  });
}

function comparableStoredTask(task: ProofTask) {
  return {
    ...task,
    current_version: comparableProofVersion(task.current_version),
    versions: task.versions.map((version) => comparableProofVersion(version))
  };
}

const proofDecisionReconciliationWindowMs = 15 * 60 * 1000;

function retainedDecisionContext(previous: ProofTask, incoming: ProofTask, syncedAt: string) {
  const context = previous.decision_context ?? null;
  if (
    !context ||
    incoming.state !== "pending" ||
    previous.attachment_id !== incoming.attachment_id
  ) {
    return null;
  }
  const recordedAt = Date.parse(context.recorded_at);
  const observedAt = Date.parse(syncedAt);
  if (!Number.isFinite(recordedAt) || !Number.isFinite(observedAt) || observedAt < recordedAt) {
    return context;
  }
  return observedAt - recordedAt < proofDecisionReconciliationWindowMs ? context : null;
}

function mergeTask(previous: ProofTask | undefined, incoming: ProofTask, syncedAt: string) {
  if (!previous) {
    return incoming;
  }
  if (taskContentFingerprint(previous) === taskContentFingerprint(incoming)) {
    const refreshedCurrentVersion = incoming.current_version && previous.current_version
      ? {
          ...incoming.current_version,
          version_id: previous.current_version.version_id,
          current: true,
          archived_at: null
        }
      : incoming.current_version;
    const refreshedVersions = refreshedCurrentVersion
      ? dedupeProofVersions([
          refreshedCurrentVersion,
          ...previous.versions.filter((version) => version.version_id !== previous.current_version?.version_id)
        ])
      : previous.versions;
    return {
      ...incoming,
      decision_context: retainedDecisionContext(previous, incoming, syncedAt),
      task_id: previous.task_id,
      version: previous.version,
      current_version: refreshedCurrentVersion,
      versions: refreshedVersions,
      created_at: previous.created_at,
      updated_at: previous.updated_at
    };
  }

  if (isSameProofVersionApartFromFeedback(previous.current_version, incoming.current_version)) {
    const refreshedCurrentVersion = {
      ...incoming.current_version!,
      version_id: previous.current_version!.version_id,
      current: true,
      archived_at: null
    };
    return {
      ...incoming,
      decision_context: retainedDecisionContext(previous, incoming, syncedAt),
      task_id: previous.task_id,
      version: previous.version + 1,
      current_version: refreshedCurrentVersion,
      versions: dedupeProofVersions([
        refreshedCurrentVersion,
        ...previous.versions.filter((version) => !isSameProofVersionApartFromFeedback(version, refreshedCurrentVersion))
      ]),
      created_at: previous.created_at,
      updated_at: syncedAt
    };
  }

  const priorVersions = previous.versions.map((version) =>
    version.current
      ? { ...version, current: false, archived_at: version.archived_at ?? syncedAt }
      : version
  );
  const currentVersion = incoming.current_version;
  const versions = currentVersion
    ? dedupeProofVersions([currentVersion, ...priorVersions.filter((version) => version.version_id !== currentVersion.version_id)])
    : priorVersions;
  return {
    ...incoming,
    decision_context: retainedDecisionContext(previous, incoming, syncedAt),
    task_id: previous.task_id,
    version: previous.version + 1,
    versions,
    created_at: previous.created_at,
    updated_at: syncedAt
  };
}

export function normalizeProofOrder(input: NormalizeProofOrderInput): ProofOrder {
  const orderNumber = normalizeLiftOrderNumber(input.order_number);
  const orderHeaders = liftRows(input.order_payload);
  const orderRows = liftOrderLines(input.order_payload);
  const syncedAt = input.synced_at ?? new Date().toISOString();
  const previous = input.previous ?? null;

  if (!orderHeaders.length) {
    if (!previous) {
      throw new LiftOrderNotFoundError(orderNumber);
    }
    return {
      ...previous,
      health: "missing",
      version: previous.version + (previous.health === "missing" ? 0 : 1),
      updated_at: previous.health === "missing" ? previous.updated_at : syncedAt,
      last_synced_at: syncedAt
    };
  }

  const header = orderHeaders[0] ?? {};
  const lineMap = new Map<string, ProofLine>();
  orderRows.forEach((row, index) => {
    const line = lineFromRow(row, index);
    const existing = lineMap.get(line.order_line_id);
    if (!existing || (!existing.product_name && line.product_name)) {
      lineMap.set(line.order_line_id, line);
    }
  });
  const lines = Array.from(lineMap.values()).sort(
    (left, right) => Number(left.line_number ?? Number.MAX_SAFE_INTEGER) - Number(right.line_number ?? Number.MAX_SAFE_INTEGER)
  );
  const proofRows = input.proof_payloads.flatMap(liftRows);
  const warnings: ProofNormalizationWarning[] = [];
  const rowsByAttachmentAndLine = new Map<string, Map<string, Record<string, unknown>[]>>();

  proofRows.forEach((row) => {
    const attachmentId = text(row, "ATTACHMENT_ID", "attachment_id");
    if (!attachmentId) {
      warnings.push({
        code: "proof_without_attachment",
        message: "A Lift proof-report row was ignored because it had no ATTACHMENT_ID.",
        order_line_id: text(row, "ORDER_LINE_ID", "order_line_id"),
        line_number: text(row, "LINE_NUMBER", "line_number")
      });
      return;
    }
    const explicitLineId = text(row, "ORDER_LINE_ID", "order_line_id");
    const proofLineNumber = text(row, "LINE_NUMBER", "line_number");
    const lineIdentity = explicitLineId
      ? `order-line:${explicitLineId}`
      : proofLineNumber
        ? `line-number:${proofLineNumber}`
        : "unmatched";
    const rowsByLine = rowsByAttachmentAndLine.get(attachmentId) ?? new Map<string, Record<string, unknown>[]>();
    rowsByLine.set(lineIdentity, [...(rowsByLine.get(lineIdentity) ?? []), row]);
    rowsByAttachmentAndLine.set(attachmentId, rowsByLine);
  });

  const draftTasks: ProofTask[] = [];
  const linesWithProof = new Set<string>();

  rowsByAttachmentAndLine.forEach((rowsByLine, attachmentId) => {
    const lineGroups = Array.from(rowsByLine.entries())
      .map(([lineIdentity, rows]) => {
        const first = rows[0] ?? {};
        const explicitLineId = text(first, "ORDER_LINE_ID", "order_line_id");
        const proofLineNumber = text(first, "LINE_NUMBER", "line_number");
        const lineMatch = matchLiftLineRecord(lines, {
          order_line_id: explicitLineId,
          line_number: proofLineNumber
        });
        return {
          lineIdentity,
          rows,
          first,
          explicitLineId,
          proofLineNumber,
          lineMatch,
          line: lineMatch?.line ?? null
        };
      })
      .sort((left, right) => {
        const leftLineNumber = Number(left.line?.line_number ?? left.proofLineNumber ?? Number.MAX_SAFE_INTEGER);
        const rightLineNumber = Number(right.line?.line_number ?? right.proofLineNumber ?? Number.MAX_SAFE_INTEGER);
        return leftLineNumber - rightLineNumber || left.lineIdentity.localeCompare(right.lineIdentity);
      });

    lineGroups.forEach((group, groupIndex) => {
      const { rows, first, explicitLineId, proofLineNumber, lineMatch, line, lineIdentity } = group;
      if (lineMatch?.matched_by === "line_number") {
        warnings.push({
          code: "line_number_fallback",
          message: `Attachment ${attachmentId} used LINE_NUMBER compatibility fallback because ORDER_LINE_ID did not match.`,
          order_line_id: explicitLineId,
          line_number: proofLineNumber,
          attachment_id: attachmentId
        });
      }
      if (!line) {
        warnings.push({
          code: "proof_without_line",
          message: `Attachment ${attachmentId} could not be joined to an AS360Orders line.`,
          order_line_id: explicitLineId,
          line_number: proofLineNumber,
          attachment_id: attachmentId
        });
      } else {
        linesWithProof.add(line.order_line_id);
      }

      const version = proofVersionFromRows(rows);
      const state = taskState(line, version, input.policy ?? {});
      if (!version.preview_url && !version.download_url) {
        warnings.push({
          code: "proof_without_url",
          message: `Attachment ${attachmentId} has no usable proof URL.`,
          order_line_id: line?.order_line_id ?? explicitLineId,
          line_number: line?.line_number ?? proofLineNumber,
          attachment_id: attachmentId
        });
      }
      const taskIdentity = groupIndex === 0
        ? `attachment:${attachmentId}`
        : `attachment:${attachmentId}:line:${line?.order_line_id ?? explicitLineId ?? proofLineNumber ?? lineIdentity}`;
      draftTasks.push({
        task_id: stableTaskId(orderNumber, taskIdentity),
        order_line_id: line?.order_line_id ?? explicitLineId,
        line_number: line?.line_number ?? proofLineNumber,
        attachment_id: attachmentId,
        product_name: line?.product_name ?? text(first, "PRODUCT_NAME", "PRODUCT", "product_name"),
        quantity: line?.quantity ?? null,
        state,
        actionable: actionableState(state) && lineGroups.length === 1,
        decision_context: null,
        sibling_index: 1,
        sibling_count: 1,
        version: 1,
        current_version: version,
        versions: [version],
        created_at: syncedAt,
        updated_at: syncedAt,
        archived_at: null
      });
    });
  });

  lines.forEach((line) => {
    const readable = (input.policy?.isProofReadableLine ?? (() => true))(line);
    if (!line.cancelled && readable && !linesWithProof.has(line.order_line_id)) {
      const state = taskState(line, null, input.policy ?? {});
      draftTasks.push({
        task_id: stableTaskId(orderNumber, `waiting-line:${line.order_line_id}`),
        order_line_id: line.order_line_id,
        line_number: line.line_number,
        attachment_id: null,
        product_name: line.product_name,
        quantity: line.quantity,
        state,
        actionable: false,
        decision_context: null,
        sibling_index: 1,
        sibling_count: 1,
        version: 1,
        current_version: null,
        versions: [],
        created_at: syncedAt,
        updated_at: syncedAt,
        archived_at: null
      });
    }
  });

  const siblingGroups = new Map<string, ProofTask[]>();
  draftTasks.forEach((task) => {
    const key = task.order_line_id ?? `unmatched:${task.attachment_id ?? task.task_id}`;
    siblingGroups.set(key, [...(siblingGroups.get(key) ?? []), task]);
  });
  siblingGroups.forEach((siblings) => {
    siblings
      .sort((left, right) => (left.attachment_id ?? "").localeCompare(right.attachment_id ?? ""))
      .forEach((task, index) => {
        task.sibling_index = index + 1;
        task.sibling_count = siblings.length;
      });
  });

  const previousByTaskId = new Map((previous?.tasks ?? []).map((task) => [task.task_id, task]));
  const tasks = draftTasks
    .map((task) => mergeTask(previousByTaskId.get(task.task_id), task, syncedAt))
    .sort((left, right) => {
      const lineDifference = Number(left.line_number ?? Number.MAX_SAFE_INTEGER) - Number(right.line_number ?? Number.MAX_SAFE_INTEGER);
      return lineDifference || left.sibling_index - right.sibling_index;
    });
  const currentTaskIds = new Set(tasks.map((task) => task.task_id));
  const newlyArchived = (previous?.tasks ?? [])
    .filter((task) => !currentTaskIds.has(task.task_id))
    .map((task) => ({
      ...task,
      actionable: false,
      archived_at: task.archived_at ?? syncedAt,
      current_version: task.current_version ? { ...task.current_version, current: false, archived_at: syncedAt } : null,
      versions: task.versions.map((version) => ({ ...version, current: false, archived_at: version.archived_at ?? syncedAt }))
    }));
  const archivedTasks = [...newlyArchived, ...(previous?.archived_tasks ?? [])].filter(
    (task, index, all) => all.findIndex((candidate) => candidate.task_id === task.task_id) === index
  );
  const activeContent = fingerprint({
    lines,
    tasks: tasks.map(comparableStoredTask),
    archivedTasks: archivedTasks.map(comparableStoredTask),
    warnings
  });
  const previousContent = previous
    ? fingerprint({
        lines: previous.lines,
        tasks: previous.tasks.map(comparableStoredTask),
        archivedTasks: previous.archived_tasks.map(comparableStoredTask),
        warnings: previous.warnings
      })
    : null;
  const changed = !previous || activeContent !== previousContent;
  const health: ProofOrderHealth =
    tasks.some((task) => task.state === "error")
      ? "error"
      : tasks.length > 0 && tasks.every((task) => task.state === "approved" || task.state === "reference")
        ? "complete"
        : "active";

  return {
    order_number: orderNumber,
    order_title: text(header, "ORDER_TITLE", "ORDER_NAME", "order_title", "order_name"),
    customer_id: text(header, "CUSTOMER_ID", "customer_id"),
    customer_name: text(header, "CUSTOMER_NAME", "customer_name"),
    order_status: text(header, "ORDER_STATUS", "STATUS", "order_status", "status"),
    health,
    version: changed ? (previous?.version ?? 0) + 1 : previous?.version ?? 1,
    lines,
    tasks,
    archived_tasks: archivedTasks,
    warnings,
    created_at: previous?.created_at ?? syncedAt,
    updated_at: changed ? syncedAt : previous?.updated_at ?? syncedAt,
    last_synced_at: syncedAt
  };
}

function publicTechnicalCheckText(value: unknown, maxLength: number) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength || /^[a-z][a-z\d+.-]*:\/\//i.test(normalized)) return null;
  if (/(?:[?&](?:x-amz-|signature|token|key)=)|(?:bearer\s+)/i.test(normalized)) return null;
  return normalized;
}

function publicProofDisplayText(value: unknown, maxLength: number) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function publicProofTimestamp(value: unknown) {
  const candidate = publicProofDisplayText(value, 64);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function publicProofComments(comments: ProofComment[], includeAssetUrls: boolean): PublicProofComment[] {
  return comments
    .map(({ text, created_at, attachment }, index) => {
      const createdAt = publicProofTimestamp(created_at);
      return {
        comment: {
          text: publicProofDisplayText(text, 8_000),
          created_at: createdAt,
          attachments: publicCommentAttachments(attachment).map((item) => ({
            ...item,
            url: includeAssetUrls ? item.url : null
          }))
        },
        index,
        timestamp: createdAt ? Date.parse(createdAt) : null
      };
    })
    .sort((left, right) => {
      if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp;
      }
      if (left.timestamp !== null && right.timestamp === null) return -1;
      if (left.timestamp === null && right.timestamp !== null) return 1;
      return left.index - right.index;
    })
    .map(({ comment }) => comment);
}

function publicTechnicalChecks(report: unknown): PublicProofTechnicalCheck[] {
  let parsed = report;
  if (typeof report === "string") {
    try {
      parsed = JSON.parse(report);
    } catch {
      return [];
    }
  }
  const container = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container?.checks)
      ? container.checks
      : Array.isArray(container?.results)
        ? container.results
        : Array.isArray(container?.rowset)
          ? container.rowset
          : [];
  const checks = rows.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const name = publicTechnicalCheckText(
      row.name ?? row.NAME ?? row.check ?? row.CHECK ?? row.label ?? row.LABEL ?? row.rule ?? row.RULE,
      120
    );
    if (!name) return [];
    const status = publicTechnicalCheckText(
      row.status ?? row.STATUS ?? row.result ?? row.RESULT ?? row.outcome ?? row.OUTCOME,
      40
    );
    return [{ name, status }];
  });
  return checks.filter((check, index, all) =>
    all.findIndex((candidate) => candidate.name === check.name && candidate.status === check.status) === index
  ).slice(0, 50);
}

function publicAttachmentText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function publicAttachmentUrl(value: unknown) {
  const candidate = publicAttachmentText(value, 2_048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function publicProofAssetUrl(value: unknown) {
  const candidate = publicAttachmentText(value, 8_192);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function filenameFromAttachment(value: unknown) {
  const candidate = publicAttachmentText(value, 180);
  if (!candidate || /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) return null;
  const filename = candidate.replace(/\\/g, "/").split("/").at(-1)?.trim() ?? "";
  return filename && filename.length <= 180 ? filename : null;
}

function filenameFromUrl(url: string | null) {
  if (!url) return null;
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
    return filenameFromAttachment(filename);
  } catch {
    return null;
  }
}

function publicAttachmentContentType(value: unknown) {
  const candidate = publicAttachmentText(value, 100)?.toLowerCase() ?? null;
  return candidate && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(candidate) ? candidate : null;
}

function assetExtension(value: string | null) {
  if (!value) return null;
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {
    // A bounded filename is also a valid extension source.
  }
  const match = pathname.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match?.[1] ?? null;
}

function publicProofPreviewKind(input: {
  filename: string | null;
  content_type: string | null;
  preview_url: string | null;
  download_url: string | null;
}): PublicProofVersion["preview_kind"] {
  if (!input.preview_url && !input.download_url) return "unavailable";
  const previewExtension = assetExtension(input.preview_url);
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(previewExtension ?? "")) return "image";
  if (previewExtension === "pdf") return "pdf";
  if (input.content_type) {
    if (input.content_type === "application/pdf") return "pdf";
    if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(input.content_type)) return "image";
    return "download";
  }
  const fileExtension = assetExtension(input.filename) ?? assetExtension(input.download_url);
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(fileExtension ?? "")) return "image";
  if (fileExtension === "pdf") return "pdf";
  return "download";
}

function publicCommentAttachments(attachment: unknown): PublicProofCommentAttachment[] {
  let parsed = attachment;
  if (typeof attachment === "string" && /^[\[{]/.test(attachment.trim())) {
    try {
      parsed = JSON.parse(attachment);
    } catch {
      return [];
    }
  }
  const container = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const candidates = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container?.attachments)
      ? container.attachments
      : parsed == null
        ? []
        : [parsed];
  const projected = candidates.flatMap((candidate) => {
    if (typeof candidate === "string") {
      const url = publicAttachmentUrl(candidate);
      const filename = filenameFromUrl(url) ?? (/^[^/\\]+\.[a-z0-9]{1,10}$/i.test(candidate.trim()) ? filenameFromAttachment(candidate) : null);
      return filename ? [{ filename, url, content_type: null }] : [];
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const rawUrl = row.url ?? row.URL ?? row.href ?? row.HREF ?? row.link ?? row.LINK
      ?? row.link_to_attachment ?? row.LINK_TO_ATTACHMENT
      ?? row.download_url ?? row.DOWNLOAD_URL ?? row.attachment_url ?? row.ATTACHMENT_URL;
    const url = publicAttachmentUrl(rawUrl);
    if (rawUrl != null && !url) return [];
    const filename = filenameFromAttachment(
      row.filename ?? row.FILENAME ?? row.file_name ?? row.FILE_NAME ?? row.name ?? row.NAME
    ) ?? filenameFromUrl(url);
    if (!filename) return [];
    const contentType = publicAttachmentContentType(
      row.content_type ?? row.CONTENT_TYPE ?? row.mime_type ?? row.MIME_TYPE ?? row.mime ?? row.MIME
    );
    return [{ filename, url, content_type: contentType }];
  });
  return projected.filter((item, index, all) => all.findIndex((candidate) =>
    candidate.filename === item.filename && candidate.url === item.url && candidate.content_type === item.content_type
  ) === index).slice(0, 20);
}

function publicDetailedReportDefinitions(report: unknown): PublicProofDetailedReportDefinition[] {
  let parsed = report;
  if (typeof report === "string") {
    try {
      parsed = JSON.parse(report);
    } catch {
      return [];
    }
  }
  const container = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(container?.DETAILED_REPORT)
      ? container.DETAILED_REPORT
      : Array.isArray(container?.detailed_report)
        ? container.detailed_report
        : [];
  return rows.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const definitionId = publicProofDisplayText(row.DEFINITION_ID ?? row.definition_id, 120);
    if (!definitionId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(definitionId)) return [];
    const label = publicProofDisplayText(row.DEFINITION_LABEL ?? row.definition_label, 160);
    const reportId = publicProofDisplayText(row.REPORT_ID ?? row.report_id, 160);
    const reportUrl = publicAttachmentUrl(row.REPORT_URL ?? row.report_url);
    return [{ definition_id: definitionId, label, ready: Boolean(reportId && reportUrl) }];
  }).filter((definition, index, all) =>
    all.findIndex((candidate) => candidate.definition_id === definition.definition_id) === index
  ).slice(0, 10);
}

export function toPublicProofVersion(
  version: ProofVersion,
  options: { include_asset_urls?: boolean } = {}
): PublicProofVersion {
  const includeAssetUrls = options.include_asset_urls !== false;
  const filename = filenameFromAttachment(version.filename)
    ?? filenameFromUrl(publicProofAssetUrl(version.download_url))
    ?? filenameFromUrl(publicProofAssetUrl(version.preview_url));
  const contentType = publicAttachmentContentType(version.content_type);
  const candidatePreviewUrl = publicProofAssetUrl(version.preview_url);
  const downloadUrl = publicProofAssetUrl(version.download_url) ?? candidatePreviewUrl;
  const previewKind = publicProofPreviewKind({
    filename,
    content_type: contentType,
    preview_url: candidatePreviewUrl,
    download_url: downloadUrl
  });
  return {
    version_id: version.version_id,
    created_at: publicProofTimestamp(version.created_at),
    filename,
    content_type: contentType,
    preview_kind: previewKind,
    preview_url:
      includeAssetUrls && (previewKind === "image" || previewKind === "pdf")
        ? candidatePreviewUrl ?? downloadUrl
        : null,
    download_url: includeAssetUrls ? downloadUrl : null,
    approval_status: publicProofDisplayText(version.approval_status, 40),
    approved_at: publicProofTimestamp(version.approved_at),
    comments: publicProofComments(version.comments.slice(0, 100), includeAssetUrls),
    technical_checks: publicTechnicalChecks(version.detailed_report),
    ...(publicDetailedReportDefinitions(version.detailed_report).length
      ? { report_definitions: publicDetailedReportDefinitions(version.detailed_report) }
      : {}),
    current: version.current
  };
}

export function toPublicProofTaskHistory(
  task: ProofTask,
  options: { include_asset_urls?: boolean; prior_tasks?: ProofTask[] } = {}
): PublicProofTaskHistory {
  const selectedVersionId = task.current_version?.version_id ?? null;
  const priorTasks = (options.prior_tasks ?? [])
    .filter((candidate) => candidate.task_id !== task.task_id)
    .sort((left, right) => (right.archived_at ?? right.updated_at).localeCompare(left.archived_at ?? left.updated_at));
  const versions = dedupeProofVersions([
    ...(task.versions.length ? task.versions : task.current_version ? [task.current_version] : []),
    ...priorTasks.flatMap((priorTask) => priorTask.versions.length
      ? priorTask.versions
      : priorTask.current_version
        ? [priorTask.current_version]
        : [])
  ]).map((version) => ({
    ...version,
    // The selected file is the only current entry in this file's lineage.
    current: version.version_id === selectedVersionId
  }));
  return {
    task_id: task.task_id,
    versions: versions.map((version) => toPublicProofVersion(version, options))
  };
}

function publicProofQuantity(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : null;
}

export function publicProofCounts(tasks: ProofTask[]): PublicProofCounts {
  return {
    pending: tasks.filter((task) => task.state === "pending").length,
    regenerating: tasks.filter((task) => task.state === "revised").length,
    waiting: tasks.filter((task) => task.state === "waiting").length,
    reviewed: tasks.filter((task) => task.state === "approved" || task.state === "reference").length,
    total: tasks.length
  };
}

export function proofReviewLifecycleState(order: Pick<ProofOrder, "health" | "tasks">): ProofReviewLifecycleState {
  if (order.health === "missing" || order.health === "error" || order.health === "stale") {
    return "degraded";
  }
  const counts = publicProofCounts(order.tasks);
  if (counts.total > 0 && counts.reviewed === counts.total) {
    return "all_reviewed";
  }
  if (counts.pending > 0) {
    return "review_ready";
  }
  return "waiting";
}

export function proofReviewLifecycleTransitions(
  previous: Pick<ProofOrder, "health" | "tasks"> | null,
  current: Pick<ProofOrder, "health" | "tasks">
): ProofReviewLifecycleAction[] {
  const previousState = previous ? proofReviewLifecycleState(previous) : null;
  const currentState = proofReviewLifecycleState(current);
  if (currentState === previousState) {
    return [];
  }
  if (currentState === "all_reviewed") {
    return ["proof.all_reviewed"];
  }
  if (previousState === "all_reviewed" && currentState === "review_ready") {
    return ["proof.review_reopened"];
  }
  if (currentState === "review_ready") {
    return ["proof.review_ready"];
  }
  return [];
}

export function toPublicProofOrder(
  order: ProofOrder,
  scope: ProofGrantScope = "view",
  options: {
    include_asset_urls?: boolean;
    decisions_enabled?: boolean;
    revision_action_enabled?: boolean;
    share_access_enabled?: boolean;
    review_experience?: ProofReviewExperience;
  } = {}
): PublicProofOrder {
  const decisionsEnabled = scope === "review" && options.decisions_enabled === true;
  const revisionActionEnabled = scope === "review" && options.revision_action_enabled === true;
  const actionBindingEnabled = decisionsEnabled || revisionActionEnabled;
  const sharedLinesByAttachment = new Map<string, string[]>();
  for (const task of order.tasks) {
    const attachmentId = task.attachment_id;
    const lineNumber = publicProofDisplayText(task.line_number, 32);
    if (!attachmentId || !lineNumber) continue;
    const lineNumbers = sharedLinesByAttachment.get(attachmentId) ?? [];
    if (!lineNumbers.includes(lineNumber)) lineNumbers.push(lineNumber);
    sharedLinesByAttachment.set(attachmentId, lineNumbers);
  }
  for (const [attachmentId, lineNumbers] of sharedLinesByAttachment) {
    sharedLinesByAttachment.set(attachmentId, lineNumbers.sort((left, right) => left.localeCompare(right, undefined, { numeric: true })));
  }
  return {
    order_number: order.order_number,
    order_title: publicProofDisplayText(order.order_title, 160),
    order_status: publicProofDisplayText(order.order_status, 80),
    health: order.health,
    tasks: order.tasks.map((task) => ({
      task_id: task.task_id,
      ...(actionBindingEnabled
        ? { attachment_id: task.attachment_id, version: task.version }
        : {}),
      line_number: publicProofDisplayText(task.line_number, 32),
      shared_line_numbers: task.attachment_id && (sharedLinesByAttachment.get(task.attachment_id)?.length ?? 0) > 1
        ? sharedLinesByAttachment.get(task.attachment_id) ?? []
        : [],
      product_name: publicProofDisplayText(task.product_name, 160),
      quantity: publicProofQuantity(task.quantity),
      state: task.state,
      // Lift's Proof Report is authoritative for the customer-visible proof
      // state. A local, unconfirmed write may prevent a duplicate action, but
      // must never relabel a pending Lift proof as rejected, revised, or sent.
      decision_state: null,
      action_reconciliation_pending: task.state === "pending" && Boolean(task.decision_context),
      sibling_index: task.sibling_index,
      sibling_count: task.sibling_count,
      feedback_required: Boolean(task.current_version?.comments.length),
      feedback_acknowledged: false,
      current_version: task.current_version ? toPublicProofVersion(task.current_version, options) : null,
      versions: task.versions.map((version) => toPublicProofVersion(version, options))
    })),
    counts: publicProofCounts(order.tasks),
    last_synced_at: order.last_synced_at,
    access: {
      scope,
      decisions_enabled: decisionsEnabled,
      share_access_enabled: options.share_access_enabled === true,
      review_experience: decisionsEnabled && options.review_experience === "advanced"
        ? "advanced"
        : "simple"
    }
  };
}

export function recordProofTaskDecisionContext(
  order: ProofOrder,
  input: {
    task_id: string;
    attachment_id: string;
    action: ProofTaskDecisionContext["action"];
    recorded_at: string;
    source?: ProofTaskDecisionContext["source"];
  }
) {
  const recordedAtEpoch = Date.parse(input.recorded_at);
  if (
    !Number.isFinite(recordedAtEpoch) ||
    new Date(recordedAtEpoch).toISOString() !== input.recorded_at
  ) {
    throw new Error("The Proof decision context timestamp must be an exact UTC ISO instant.");
  }
  const stateByAction: Record<ProofTaskDecisionContext["action"], ProofTaskDecisionState> = {
    APPROVE: "approval_pending",
    REJECT: "rejected_pending_action",
    SEND_BACK_TO_ARTIST: "sent_back_to_artist",
    REVISED_ART_WILL_BE_SENT: "revised_art_pending",
    CANCEL_LINE: "cancel_requested"
  };
  let matched = false;
  const tasks = order.tasks.map((task) => {
    if (task.task_id !== input.task_id) return task;
    if (
      task.attachment_id !== input.attachment_id ||
      task.current_version?.attachment_id !== input.attachment_id ||
      task.state !== "pending"
    ) {
      throw new Error("The Proof decision context no longer matches the current pending attachment.");
    }
    matched = true;
    return {
      ...task,
      decision_context: {
        state: stateByAction[input.action],
        action: input.action,
        attachment_id: input.attachment_id,
        recorded_at: input.recorded_at,
        source: input.source ?? "pathfinder_operator_action"
      },
      version: task.version + 1,
      updated_at: input.recorded_at
    };
  });
  if (!matched) {
    throw new Error("The current Proof task was not found for the decision context.");
  }
  return {
    ...order,
    tasks,
    version: order.version + 1,
    updated_at: input.recorded_at
  };
}

function rollupProofStateLabel(state: ProofTaskState) {
  switch (state) {
    case "approved": return "Reviewed";
    case "reference": return "Reference proof";
    case "revised": return "Regenerating";
    case "cancelled": return "Cancelled";
    case "missing": return "Unavailable";
    case "error": return "File unavailable";
    case "waiting": return "Waiting for proof";
    default: return "Pending review";
  }
}

export function toCustomerSafeOrderRollupProof(proof: OrderRollupProof): OrderRollupProof {
  const allowedStates = new Set<NonNullable<OrderRollupProof["proof_state"]>>([
    "waiting", "pending", "revised", "approved", "reference", "cancelled", "missing", "error"
  ]);
  const previewKind = ["image", "pdf", "download", "unavailable"].includes(proof.preview_kind ?? "")
    ? proof.preview_kind
    : undefined;
  const proofState = proof.proof_state && allowedStates.has(proof.proof_state) ? proof.proof_state : undefined;
  return {
    proof_filename: publicProofDisplayText(proof.proof_filename, 180),
    proof_approval_status: publicProofDisplayText(proof.proof_approval_status, 80),
    proof_link_low: publicProofAssetUrl(proof.proof_link_low),
    proof_link_high: publicProofAssetUrl(proof.proof_link_high),
    creation_date: publicProofTimestamp(proof.creation_date),
    ...(previewKind ? { preview_kind: previewKind } : {}),
    ...(proofState ? { proof_state: proofState } : {})
  };
}

export function toOrderRollupProofProjection(order: ProofOrder): ProofOrderRollupProjection {
  const counts = publicProofCounts(order.tasks);
  return {
    summary: {
      source: "proof_cache",
      health: order.health,
      ...counts,
      review_required: counts.pending > 0,
      last_synced_at: order.last_synced_at,
      decisions_enabled: false
    },
    proofs: order.tasks.flatMap((task) => {
      if (!task.current_version) {
        return [];
      }
      const version = toPublicProofVersion(task.current_version);
      return [{
        order_line_id: task.order_line_id,
        line_number: task.line_number,
        proof_filename: version.filename,
        proof_approval_status: version.approval_status ?? rollupProofStateLabel(task.state),
        proof_link_low: version.preview_url,
        proof_link_high: version.download_url,
        creation_date: version.created_at,
        preview_kind: version.preview_kind,
        proof_state: task.state
      }];
    })
  };
}
