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

export type ProofGrantScope = "view";
export type ProofGrantStatus = "active" | "revoked";

export interface ProofAccessGrant {
  grant_id: string;
  order_number: string;
  scope: ProofGrantScope;
  label: string | null;
  status: ProofGrantStatus;
  token_hash: string;
  created_at: string;
  expires_at: string;
  expires_at_epoch: number;
  exchanged_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
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

export type ProofAuditAction =
  | "proof.sync_completed"
  | "proof.sync_failed"
  | ProofReviewLifecycleAction
  | "proof.grant_created"
  | "proof.grant_updated"
  | "proof.grant_revoked"
  | "proof.grant_regenerated"
  | "proof.link_email_sent"
  | "proof.link_email_failed"
  | "proof.participant_identified"
  | "proof.participant_updated"
  | "proof.feedback_acknowledged"
  | "proof.session_exchanged"
  | "proof.session_ended";

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
  delivery_mode?: "log" | "ses";
  delivery_status?: "logged" | "sent" | "failed";
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
  current: boolean;
}

export interface PublicProofTask {
  task_id: string;
  line_number: string | null;
  product_name: string | null;
  quantity: number | null;
  state: ProofTaskState;
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
  access: { scope: ProofGrantScope; decisions_enabled: false };
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
  const comments = rows
    .map(commentFromRow)
    .filter((comment): comment is ProofComment => Boolean(comment))
    .filter((comment, index, all) => all.findIndex((candidate) => fingerprint(candidate) === fingerprint(comment)) === index);
  const previewUrl = text(row, "PROOF_LINK_LOW", "PROOF_URL_LOW", "proof_link_low", "proof_url_low");
  const downloadUrl =
    text(row, "PROOF_LINK_HIGH", "PROOF_URL_HIGH", "proof_link_high", "proof_url_high") ?? previewUrl;
  const approvalStatus = text(row, "PROOF_APPROVAL_STATUS", "APPROVAL_STATUS", "proof_approval_status", "approval_status");
  const approvedBy = text(row, "PROOF_APPROVED_BY", "APPROVED_BY", "proof_approved_by", "approved_by");
  const approvedAt = text(row, "PROOF_APPROVED_DATE", "APPROVED_DATE", "proof_approved_date", "approved_date");
  const detailedReport = value(row, "DETAILED_REPORT", "detailed_report");
  return {
    version_id: stableVersionId({
      attachmentId,
      createdAt,
      filename,
      contentType,
      previewUrl,
      downloadUrl,
      approvalStatus,
      approvedBy,
      approvedAt,
      comments,
      detailedReport
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
    feedback_fingerprint: fingerprint(comments),
    current: true,
    archived_at: null
  };
}

function taskState(line: ProofLine | null, version: ProofVersion | null, policy: ProofNormalizationPolicy) {
  if (line?.cancelled) {
    return "cancelled" as const;
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
  if (/APPROV/i.test(version.approval_status ?? "")) {
    return "approved" as const;
  }
  if (/REVIS|REJECT|REGENERAT|CHANGE.*REQUEST/i.test(version.approval_status ?? "")) {
    return "revised" as const;
  }
  if (!version.preview_url && !version.download_url) {
    return "error" as const;
  }
  return "pending" as const;
}

function actionableState(state: ProofTaskState) {
  return state === "pending";
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
    current_version: task.current_version
  });
}

function mergeTask(previous: ProofTask | undefined, incoming: ProofTask, syncedAt: string) {
  if (!previous) {
    return incoming;
  }
  if (taskContentFingerprint(previous) === taskContentFingerprint(incoming)) {
    return {
      ...incoming,
      task_id: previous.task_id,
      version: previous.version,
      versions: previous.versions,
      created_at: previous.created_at,
      updated_at: previous.updated_at
    };
  }

  const priorVersions = previous.versions.map((version) =>
    version.current
      ? { ...version, current: false, archived_at: version.archived_at ?? syncedAt }
      : version
  );
  const currentVersion = incoming.current_version;
  const versions = currentVersion
    ? [currentVersion, ...priorVersions.filter((version) => version.version_id !== currentVersion.version_id)]
    : priorVersions;
  return {
    ...incoming,
    task_id: previous.task_id,
    version: previous.version + 1,
    versions,
    created_at: previous.created_at,
    updated_at: syncedAt
  };
}

function proofIdentity(task: ProofTask) {
  return task.attachment_id ? `attachment:${task.attachment_id}` : `waiting-line:${task.order_line_id ?? task.line_number ?? task.task_id}`;
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
  const rowsByAttachment = new Map<string, Record<string, unknown>[]>();

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
    rowsByAttachment.set(attachmentId, [...(rowsByAttachment.get(attachmentId) ?? []), row]);
  });

  const draftTasks: ProofTask[] = [];
  const linesWithProof = new Set<string>();

  rowsByAttachment.forEach((rows, attachmentId) => {
    const first = rows[0] ?? {};
    const explicitLineId = text(first, "ORDER_LINE_ID", "order_line_id");
    const proofLineNumber = text(first, "LINE_NUMBER", "line_number");
    const lineMatch = matchLiftLineRecord(lines, {
      order_line_id: explicitLineId,
      line_number: proofLineNumber
    });
    const line = lineMatch?.line ?? null;
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
    draftTasks.push({
      task_id: stableTaskId(orderNumber, `attachment:${attachmentId}`),
      order_line_id: line?.order_line_id ?? explicitLineId,
      line_number: line?.line_number ?? proofLineNumber,
      attachment_id: attachmentId,
      product_name: line?.product_name ?? text(first, "PRODUCT_NAME", "PRODUCT", "product_name"),
      quantity: line?.quantity ?? null,
      state,
      actionable: actionableState(state),
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

  const previousByIdentity = new Map((previous?.tasks ?? []).map((task) => [proofIdentity(task), task]));
  const tasks = draftTasks
    .map((task) => mergeTask(previousByIdentity.get(proofIdentity(task)), task, syncedAt))
    .sort((left, right) => {
      const lineDifference = Number(left.line_number ?? Number.MAX_SAFE_INTEGER) - Number(right.line_number ?? Number.MAX_SAFE_INTEGER);
      return lineDifference || left.sibling_index - right.sibling_index;
    });
  const currentIdentities = new Set(tasks.map(proofIdentity));
  const newlyArchived = (previous?.tasks ?? [])
    .filter((task) => !currentIdentities.has(proofIdentity(task)))
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
  const activeContent = fingerprint({ lines, tasks, archivedTasks, warnings });
  const previousContent = previous
    ? fingerprint({ lines: previous.lines, tasks: previous.tasks, archivedTasks: previous.archived_tasks, warnings: previous.warnings })
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

export function toPublicProofVersion(version: ProofVersion): PublicProofVersion {
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
    preview_url: previewKind === "image" || previewKind === "pdf" ? candidatePreviewUrl ?? downloadUrl : null,
    download_url: downloadUrl,
    approval_status: publicProofDisplayText(version.approval_status, 40),
    approved_at: publicProofTimestamp(version.approved_at),
    comments: version.comments.slice(0, 100).map(({ text, created_at, attachment }) => ({
      text: publicProofDisplayText(text, 8_000),
      created_at: publicProofTimestamp(created_at),
      attachments: publicCommentAttachments(attachment)
    })),
    technical_checks: publicTechnicalChecks(version.detailed_report),
    current: version.current
  };
}

export function toPublicProofTaskHistory(task: ProofTask): PublicProofTaskHistory {
  return {
    task_id: task.task_id,
    versions: (task.versions.length ? task.versions : task.current_version ? [task.current_version] : []).map(toPublicProofVersion)
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

export function toPublicProofOrder(order: ProofOrder, scope: ProofGrantScope = "view"): PublicProofOrder {
  return {
    order_number: order.order_number,
    order_title: publicProofDisplayText(order.order_title, 160),
    order_status: publicProofDisplayText(order.order_status, 80),
    health: order.health,
    tasks: order.tasks.map((task) => ({
      task_id: task.task_id,
      line_number: publicProofDisplayText(task.line_number, 32),
      product_name: publicProofDisplayText(task.product_name, 160),
      quantity: publicProofQuantity(task.quantity),
      state: task.state,
      sibling_index: task.sibling_index,
      sibling_count: task.sibling_count,
      feedback_required: Boolean(task.current_version?.comments.length),
      feedback_acknowledged: false,
      current_version: task.current_version ? toPublicProofVersion(task.current_version) : null,
      versions: task.versions.map(toPublicProofVersion)
    })),
    counts: publicProofCounts(order.tasks),
    last_synced_at: order.last_synced_at,
    access: { scope, decisions_enabled: false }
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
