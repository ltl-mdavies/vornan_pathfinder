import type { ProofActivity, ProofDetailedReport, ProofOrder, ProofParticipant, ProofSharedLink, ProofVersion } from "./types";

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
  constructor(message: string, readonly status: number) {
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
    throw new ProofApiError(body?.error ?? "Proof access is unavailable.", response.status);
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

export async function loadSharedLinks() {
  return api<{ shares: ProofSharedLink[] }>("/api/public/proof/shares");
}

export async function createSharedLink(input: {
  scope: "view" | "review";
  expires_in_hours: 24 | 72 | 168 | 336;
  description?: string;
}) {
  return api<{ share: ProofSharedLink; access_url: string }>("/api/public/proof/shares", {
    method: "POST",
    body: JSON.stringify(input)
  }, true);
}

export async function revokeSharedLink(grantId: string) {
  return api<{ share: ProofSharedLink }>(`/api/public/proof/shares/${encodeURIComponent(grantId)}`, {
    method: "DELETE"
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
