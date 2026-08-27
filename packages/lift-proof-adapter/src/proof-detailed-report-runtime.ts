import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export class LiftProofDetailedReportRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiftProofDetailedReportRuntimeError";
  }
}

function requiredIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!identifier.test(normalized)) throw new LiftProofDetailedReportRuntimeError(`${label} is invalid.`);
  return normalized;
}

function reportPath(input: { order_number: string; order_line_id: string; attachment_id: string; report_id?: string }) {
  const orderNumber = requiredIdentifier(input.order_number, "Lift order number");
  const orderLineId = requiredIdentifier(input.order_line_id, "Lift order line ID");
  const attachmentId = requiredIdentifier(input.attachment_id, "Lift proof attachment ID");
  const root = `/orders/${encodeURIComponent(orderNumber)}/lines/${encodeURIComponent(orderLineId)}/proofs/${encodeURIComponent(attachmentId)}/reports`;
  return input.report_id ? `${root}/${encodeURIComponent(requiredIdentifier(input.report_id, "Lift report ID"))}` : root;
}

function requestUrl(baseUrl: string, path: string) {
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw new LiftProofDetailedReportRuntimeError("Lift Proofing API base URL is invalid."); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new LiftProofDetailedReportRuntimeError("Lift Proofing API base URL is invalid.");
  }
  const url = new URL(`${base.toString().replace(/\/+$/, "")}${path}`);
  if (url.origin !== base.origin) throw new LiftProofDetailedReportRuntimeError("Lift report request URL escaped its configured origin.");
  return url.toString();
}

export function buildLiftProofingBearerHeaders(input: {
  client_id: string;
  client_secret: string;
  issued_at_epoch: number;
  expires_at_epoch: number;
}) {
  const clientId = requiredIdentifier(input.client_id, "Lift Proofing API client ID");
  if (typeof input.client_secret !== "string" || input.client_secret.length < 32 || input.client_secret.length > 4_096) {
    throw new LiftProofDetailedReportRuntimeError("Lift Proofing API signing secret is invalid.");
  }
  if (!Number.isSafeInteger(input.issued_at_epoch) || !Number.isSafeInteger(input.expires_at_epoch) || input.expires_at_epoch <= input.issued_at_epoch) {
    throw new LiftProofDetailedReportRuntimeError("Lift Proofing JWT timestamps are invalid.");
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: clientId,
    aud: "https://www.lifterp.com",
    iat: input.issued_at_epoch,
    exp: input.expires_at_epoch
  })).toString("base64url");
  const signingInput = `${header}.${claims}`;
  const key = Buffer.from(input.client_secret, "utf8");
  let signature: string;
  try { signature = createHmac("sha256", key).update(signingInput).digest("base64url"); } finally { key.fill(0); }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${signingInput}.${signature}`,
    "Lift-ERP-Client-Id": clientId
  } as const;
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function scalar(value: unknown, maximum = 512) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

function nestedRecord(value: unknown) {
  const root = jsonObject(value);
  return root && jsonObject(root.report) ? { ...root, ...jsonObject(root.report) } : root;
}

function safeHttpsUrl(value: unknown) {
  const candidate = scalar(value, 8_192);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || isIP(url.hostname) !== 0) return null;
    return url.toString();
  } catch { return null; }
}

function reportObservation(payload: unknown) {
  const row = nestedRecord(payload);
  if (!row) return { report_id: null, status: null, report_url: null };
  return {
    report_id: scalar(row.reportId ?? row.REPORT_ID ?? row.id ?? row.ID),
    status: scalar(row.status ?? row.STATUS ?? row.reportStatus ?? row.REPORT_STATUS, 80),
    report_url: safeHttpsUrl(row.reportUrl ?? row.REPORT_URL ?? row.url ?? row.URL)
  };
}

async function call(input: {
  base_url: string;
  method: "POST" | "GET";
  path: string;
  headers: ReturnType<typeof buildLiftProofingBearerHeaders>;
  body?: string;
  timeout_ms: number;
  fetcher?: typeof fetch;
}) {
  const response = await (input.fetcher ?? fetch)(requestUrl(input.base_url, input.path), {
    method: input.method,
    headers: input.headers,
    ...(input.body ? { body: input.body } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(input.timeout_ms)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new LiftProofDetailedReportRuntimeError("Lift detailed report request was not accepted.");
  return reportObservation(payload);
}

export async function startLiftProofDetailedReport(input: {
  base_url: string;
  credentials: { client_id: string; client_secret: string };
  order_number: string;
  order_line_id: string;
  attachment_id: string;
  definition_id: string;
  timeout_ms: number;
  now?: Date;
  fetcher?: typeof fetch;
}) {
  const now = input.now ?? new Date();
  const headers = buildLiftProofingBearerHeaders({
    client_id: input.credentials.client_id,
    client_secret: input.credentials.client_secret,
    issued_at_epoch: Math.floor(now.getTime() / 1_000),
    expires_at_epoch: Math.floor(now.getTime() / 1_000) + 60
  });
  const definitionId = requiredIdentifier(input.definition_id, "Lift report definition ID");
  return call({
    base_url: input.base_url,
    method: "POST",
    path: reportPath(input),
    headers,
    body: JSON.stringify({ reportDefinitionId: definitionId }),
    timeout_ms: input.timeout_ms,
    fetcher: input.fetcher
  });
}

export async function readLiftProofDetailedReportStatus(input: {
  base_url: string;
  credentials: { client_id: string; client_secret: string };
  order_number: string;
  order_line_id: string;
  attachment_id: string;
  report_id: string;
  timeout_ms: number;
  now?: Date;
  fetcher?: typeof fetch;
}) {
  const now = input.now ?? new Date();
  const headers = buildLiftProofingBearerHeaders({
    client_id: input.credentials.client_id,
    client_secret: input.credentials.client_secret,
    issued_at_epoch: Math.floor(now.getTime() / 1_000),
    expires_at_epoch: Math.floor(now.getTime() / 1_000) + 60
  });
  return call({
    base_url: input.base_url,
    method: "GET",
    path: reportPath(input),
    headers,
    timeout_ms: input.timeout_ms,
    fetcher: input.fetcher
  });
}
