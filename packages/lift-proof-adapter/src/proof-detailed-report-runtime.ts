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

function detailedReportOrderId(orderNumber: string) {
  const normalized = requiredIdentifier(orderNumber, "Lift order number");
  const match = /^A(\d{7,8})$/i.exec(normalized);
  if (!match) {
    throw new LiftProofDetailedReportRuntimeError("Lift detailed-report order number must be an A-number.");
  }
  return match[1]!;
}

function reportPath(input: { order_number: string; order_line_id: string; attachment_id: string; report_id?: string }) {
  const orderId = detailedReportOrderId(input.order_number);
  const orderLineId = requiredIdentifier(input.order_line_id, "Lift order line ID");
  const attachmentId = requiredIdentifier(input.attachment_id, "Lift proof attachment ID");
  const root = `/orders/${encodeURIComponent(orderId)}/lines/${encodeURIComponent(orderLineId)}/proofs/${encodeURIComponent(attachmentId)}/reports`;
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

export function buildLiftDetailedReportBasicHeaders(input: {
  username: string;
  password: string;
}) {
  const username = requiredIdentifier(input.username, "Lift detailed-report user");
  if (typeof input.password !== "string" || !input.password || input.password.length > 4_096 || /[\u0000-\u001f\u007f]/.test(input.password)) {
    throw new LiftProofDetailedReportRuntimeError("Lift detailed-report password is invalid.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${username}:${input.password}`).toString("base64")}`
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
  headers: ReturnType<typeof buildLiftDetailedReportBasicHeaders>;
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
  credentials: { username: string; password: string };
  order_number: string;
  order_line_id: string;
  attachment_id: string;
  definition_id: string;
  timeout_ms: number;
  fetcher?: typeof fetch;
}) {
  const headers = buildLiftDetailedReportBasicHeaders(input.credentials);
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
  credentials: { username: string; password: string };
  order_number: string;
  order_line_id: string;
  attachment_id: string;
  report_id: string;
  timeout_ms: number;
  fetcher?: typeof fetch;
}) {
  const headers = buildLiftDetailedReportBasicHeaders(input.credentials);
  return call({
    base_url: input.base_url,
    method: "GET",
    path: reportPath(input),
    headers,
    timeout_ms: input.timeout_ms,
    fetcher: input.fetcher
  });
}
