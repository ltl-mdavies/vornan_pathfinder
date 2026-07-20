import type { ProofActivity, ProofOrder, ProofParticipant, ProofVersion } from "./types";

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

export async function acknowledgeFeedback(taskId: string) {
  return api<{ feedback: { required: true; acknowledged: true; acknowledged_at: string } }>(
    `/api/public/proof/tasks/${encodeURIComponent(taskId)}/feedback-acknowledgements`,
    { method: "POST" },
    true
  );
}

export async function endSession() {
  await api<null>("/api/public/proof/sessions/current", { method: "DELETE" }, true);
}
