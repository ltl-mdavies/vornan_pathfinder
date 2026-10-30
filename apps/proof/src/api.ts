import type { ProofActivity, ProofDetailedReport, ProofOrder, ProofParticipant, ProofVersion } from "./types";

export type ProofRevisionAssetState =
  | "initialized"
  | "uploading"
  | "uploaded"
  | "verifying"
  | "scan_pending"
  | "ready_for_lift";

export interface ProofRevisionAsset {
  asset_id: string;
  revision_id: string;
  order_number: string;
  task_id: string;
  attachment_id: string;
  original_filename: string;
  content_type: string;
  content_length: number;
  sha256: string;
  state: ProofRevisionAssetState;
  record_version: number;
  initialized_at: string;
  upload_completed_at: string | null;
  verification_status: "pending" | "quarantined" | "cleared";
  publication_status: "not_started" | "published" | "delivery_verified";
}

export interface ProofRevisionUploadTicket {
  method: "POST";
  url: string;
  fields: Record<string, string>;
  expires_at: string;
}

export class ProofApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ProofApiError";
  }
}

function cookieValue(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function api<T>(path: string, init?: RequestInit, csrf = false) {
  const csrfToken = csrf ? cookieValue("vornan_proof_csrf") : null;
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-Vornan-Proof-Csrf": decodeURIComponent(csrfToken) } : {}),
      ...init?.headers
    }
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ProofApiError(body?.error ?? "Proof access is unavailable.", response.status, body?.code);
  }
  return body as T;
}

export async function exchangeToken(token: string) {
  return api<{ authenticated: true; expires_at: string }>("/api/public/proof/sessions", {
    method: "POST",
    body: JSON.stringify({ token })
  });
}

export async function loadProofOrder() {
  return api<{
    order: ProofOrder;
    participant: ProofParticipant | null;
    activity: ProofActivity;
    refresh_queued: boolean;
    session_expires_at: string;
  }>("/api/public/proof/order");
}

export interface SharedProofLink {
  id: string; scope: "view" | "review"; description: string | null;
  created_at: string; expires_at: string; status: "active" | "expired" | "revoked";
}
export interface ShareAuthority { expected_order_number: string; expected_share_context: string }
export interface ShareLinkRequest extends ShareAuthority { idempotency_key: string; scope: "view" | "review"; days: number; description: string }
const shareQuery = (authority: ShareAuthority) => new URLSearchParams({ order: authority.expected_order_number, context: authority.expected_share_context }).toString();
export const loadSharedProofLinks = (authority: ShareAuthority) => boundedRevisionRequest((signal) => api<{ links: SharedProofLink[] }>(`/api/public/proof/shares?${shareQuery(authority)}`, { signal }));
export const createSharedProofLink = (input: ShareLinkRequest) => boundedRevisionRequest((signal) => api<{ link: SharedProofLink; access_url: string }>(
  "/api/public/proof/shares", { method: "POST", body: JSON.stringify(input), signal }, true
));
export const revokeSharedProofLink = (id: string, authority: ShareAuthority) => boundedRevisionRequest((signal) => api<{ link: SharedProofLink }>(
  `/api/public/proof/shares/${encodeURIComponent(id)}?${shareQuery(authority)}`, { method: "DELETE", signal }, true
));

/** Persist only the request, never a link or secret. A different session cannot replay it. */
export async function shareRecoveryStorageKey(orderNumber: string) {
  const csrf = cookieValue("vornan_proof_csrf");
  if (!csrf) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csrf));
  const marker = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `proof-share-request:${orderNumber}:${marker}`;
}

export async function loadProofHistory(taskId: string) {
  return api<{ task_id: string; versions: ProofVersion[] }>(
    `/api/public/proof/tasks/${encodeURIComponent(taskId)}/history`
  );
}

export async function requestProofRefresh() {
  return api<{ refresh_queued: true }>("/api/public/proof/order/refresh", { method: "POST" }, true);
}

export async function identifyParticipant(displayName: string, email: string) {
  return api<{ participant: ProofParticipant }>("/api/public/proof/participants", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName, email })
  }, true);
}

export async function acknowledgeFeedback(taskId: string) {
  return api<{ feedback: { required: true; acknowledged: true; acknowledged_at: string } }>(
    `/api/public/proof/tasks/${encodeURIComponent(taskId)}/feedback-acknowledgements`,
    { method: "POST" },
    true
  );
}

export async function approveProof(input: {
  task_id: string;
  attachment_id: string;
  expected_task_version: number;
  expected_version_id: string;
  idempotency_key: string;
  note: string | null;
}) {
  return api<{
    decision: {
      status: "new" | "replay";
      outcome: "submission_uncertain" | "reconciling" | "confirmed" | "failed";
      automatic_retry: false;
      authoritative_refresh_completed: boolean;
    };
  }>(`/api/public/proof/tasks/${encodeURIComponent(input.task_id)}/decisions/approve`, {
    method: "POST",
    body: JSON.stringify({
      attachment_id: input.attachment_id,
      expected_task_version: input.expected_task_version,
      expected_version_id: input.expected_version_id,
      idempotency_key: input.idempotency_key,
      note: input.note
    })
  }, true);
}

export type AllocationSubmission = {
  idempotency_key: string;
  entries: Array<{ task_id: string; attachment_id: string; expected_task_version: number; expected_version_id: string; quantity: number }>;
  note: string | null;
};
export type AllocationStatus = {
  batch_id: string; state: "ready" | "checking" | "completed" | "paused"; automatic_retry: false;
  source_line_number: string | null; line_quantity: number;
  entries: Array<{ task_id: string; attachment_id: string; filename: string | null; quantity: number; state: "pending" | "submitted" | "confirmed"; resulting_line_number: string | null }>;
};
export const prepareProofAllocation = (input: AllocationSubmission) => api<{ batch: AllocationStatus }>("/api/public/proof/approval-batches", { method: "POST", body: JSON.stringify(input) }, true);
export const advanceProofAllocation = (batchId: string) => api<{ batch: AllocationStatus }>(`/api/public/proof/approval-batches/${encodeURIComponent(batchId)}/advance`, { method: "POST" }, true);
export const loadProofAllocations = () => api<{ batches: AllocationStatus[] }>("/api/public/proof/approval-batches");

export async function requestProofChanges(input: {
  task_id: string;
  attachment_id: string;
  expected_task_version: number;
  expected_version_id: string;
  idempotency_key: string;
  note: string;
}) {
  return api<{
    decision: {
      status: "new" | "replay";
      outcome: "submission_uncertain" | "reconciling" | "confirmed" | "failed";
      automatic_retry: false;
      authoritative_refresh_completed: boolean;
    };
  }>(`/api/public/proof/tasks/${encodeURIComponent(input.task_id)}/decisions/request-changes`, {
    method: "POST",
    body: JSON.stringify({
      attachment_id: input.attachment_id,
      expected_task_version: input.expected_task_version,
      expected_version_id: input.expected_version_id,
      idempotency_key: input.idempotency_key,
      note: input.note
    })
  }, true);
}

export async function prepareRevisionUpload(input: {
  task_id: string;
  attachment_id: string;
  idempotency_key: string;
  original_filename: string;
  content_type: string;
  content_length: number;
  sha256: string;
}) {
  return api<{
    status: "new" | "replay";
    asset: ProofRevisionAsset;
    upload: ProofRevisionUploadTicket;
  }>(`/api/public/proof/tasks/${encodeURIComponent(input.task_id)}/revised-assets/uploads/prepare`, {
    method: "POST",
    body: JSON.stringify({
      attachment_id: input.attachment_id,
      idempotency_key: input.idempotency_key,
      original_filename: input.original_filename,
      content_type: input.content_type,
      content_length: input.content_length,
      sha256: input.sha256
    })
  }, true);
}

export async function uploadRevisionFile(ticket: ProofRevisionUploadTicket, file: File) {
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
  form.append("file", file, file.name);
  const response = await fetch(ticket.url, {
    method: ticket.method,
    body: form,
    credentials: "omit",
    redirect: "error"
  });
  if (!response.ok) {
    throw new ProofApiError("The revised artwork could not be stored. No production request was sent.", response.status);
  }
}

export async function finalizeRevisionUpload(assetId: string) {
  return api<{ status: "completed" | "replay"; asset: ProofRevisionAsset }>(
    "/api/public/proof/revised-assets/uploads/finalize",
    { method: "POST", body: JSON.stringify({ asset_id: assetId }) },
    true
  );
}

export async function loadRevisionUploadStatus(assetId: string) {
  return api<{ asset: ProofRevisionAsset }>(
    `/api/public/proof/revised-assets/uploads/${encodeURIComponent(assetId)}`
  );
}

export interface ProofRevisionSubmission {
  submission_id: string;
  task_id: string;
  attachment_id: string;
  version_id: string;
  asset_id: string;
  filename: string;
  line_number?: string | null;
  proof_filename?: string | null;
  state: "submitted" | "checking" | "accepted" | "not_sent";
  automatic_retry: false;
  lift_outcome_confirmed: false;
}

/** Recovery is read-only, including when the original proof task disappears. */
export const loadRevisionSubmissions = () => boundedRevisionRequest((signal) => api<{ submissions: ProofRevisionSubmission[] }>(
  "/api/public/proof/revised-art/submissions", { signal }
));

export const loadRevisionSubmission = (submissionId: string) => boundedRevisionRequest((signal) => api<{ submission: ProofRevisionSubmission }>(
  `/api/public/proof/revised-art/submissions/${encodeURIComponent(submissionId)}`, { signal }
));

/** Abort I/O and independently settle the UI even if a transport ignores abort. */
export async function boundedRevisionRequest<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => request(controller.signal)), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Artwork status could not be confirmed in time.")); }, timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Call only on an explicit user submission; status checks must never call this. */
export async function submitRevisionArtwork(input: {
  task_id: string;
  asset_id: string;
  attachment_id: string;
  expected_task_version: number;
  expected_version_id: string;
  idempotency_key: string;
  note?: string | null;
}) {
  const { task_id, ...body } = input;
  return boundedRevisionRequest((signal) => api<{ submission: ProofRevisionSubmission }>(
      `/api/public/proof/tasks/${encodeURIComponent(task_id)}/revised-art/submissions`,
      { method: "POST", body: JSON.stringify(body), signal },
      true
    ));
}

export async function startDetailedReport(taskId: string, definitionId: string) {
  return api<{ report: ProofDetailedReport }>(
    `/api/public/proof/tasks/${encodeURIComponent(taskId)}/detailed-reports/${encodeURIComponent(definitionId)}`,
    { method: "POST" },
    true
  );
}

export async function loadDetailedReport(taskId: string, definitionId: string) {
  return api<{ report: ProofDetailedReport }>(
    `/api/public/proof/tasks/${encodeURIComponent(taskId)}/detailed-reports/${encodeURIComponent(definitionId)}`
  );
}

export async function endSession() {
  await api<null>("/api/public/proof/sessions/current", { method: "DELETE" }, true);
}

export async function extendSession() {
  return api<{ extended: true; expires_at: string }>(
    "/api/public/proof/sessions/current/extend",
    { method: "POST" },
    true
  );
}
