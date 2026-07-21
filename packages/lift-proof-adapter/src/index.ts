import { liftOrderLines, liftRows, normalizeLiftOrderNumber } from "@pathfinder/proof-domain";

export const DEFAULT_LIFT_PROOF_ORDER_READ_URL =
  "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360Orders/N?offset=0";
export const DEFAULT_LIFT_PROOF_REPORT_READ_URL =
  "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0";

export const LIFT_PROOF_WRITE_CAPABILITY = "not_implemented" as const;

export interface LiftProofReadConfig {
  order_read_url: string;
  proof_report_read_url: string;
  timeout_ms: number;
  concurrency: number;
  proof_readable_min_step: number | null;
}

export interface LiftProofReadDiagnostics {
  order_url: string;
  line_reads: Array<{
    order_line_id: string;
    url: string;
    ok: boolean;
    row_count: number;
    error: string | null;
  }>;
  fallback_read: {
    attempted: boolean;
    url: string | null;
    ok: boolean | null;
    row_count: number;
    error: string | null;
  };
}

export interface LiftProofReadSnapshot {
  order_number: string;
  order_payload: unknown;
  proof_payloads: unknown[];
  fetched_at: string;
  diagnostics: LiftProofReadDiagnostics;
}

export type LiftProofFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class LiftProofReadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string
  ) {
    super(message);
    this.name = "LiftProofReadError";
  }
}

export function getDefaultLiftProofReadConfig(): LiftProofReadConfig {
  return {
    order_read_url: DEFAULT_LIFT_PROOF_ORDER_READ_URL,
    proof_report_read_url: DEFAULT_LIFT_PROOF_REPORT_READ_URL,
    timeout_ms: 15_000,
    concurrency: 5,
    proof_readable_min_step: null
  };
}

function configuredBaseUrl(value: string, label: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL.`);
  }
}

export function buildLiftProofOrderReadUrl(baseUrl: string, orderNumber: string) {
  const url = configuredBaseUrl(baseUrl, "Lift proof order read URL");
  url.searchParams.set("p0", normalizeLiftOrderNumber(orderNumber));
  return url.toString();
}

export function buildLiftProofReportReadUrl(baseUrl: string, orderNumber: string, orderLineId?: string | null) {
  const url = configuredBaseUrl(baseUrl, "Lift proof report read URL");
  url.searchParams.set("p1", normalizeLiftOrderNumber(orderNumber));
  if (orderLineId?.trim()) {
    url.searchParams.set("p2", orderLineId.trim());
  } else {
    url.searchParams.delete("p2");
  }
  return url.toString();
}

async function readJson(fetcher: LiftProofFetch, url: string, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new LiftProofReadError(
      error instanceof Error ? error.message : "Lift proof read failed.",
      null,
      url
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");
  if (!response.ok) {
    throw new LiftProofReadError(`Lift proof read failed with HTTP ${response.status}.`, response.status, url);
  }
  return payload;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index] as T);
      }
    })
  );
  return results;
}

function orderRowIsCancelled(row: Record<string, unknown>) {
  const cancelled = row.CANCELLED ?? row.CANCELED ?? row.IS_CANCELLED ?? row.cancelled ?? row.canceled;
  const status = String(row.LINE_STATUS ?? row.ORDER_LINE_STATUS ?? row.STATUS ?? row.line_status ?? row.status ?? "");
  return /^(Y|YES|TRUE|1)$/i.test(String(cancelled ?? "")) || /CANCEL/i.test(status);
}

function orderLineIds(orderPayload: unknown, isProofReadableOrderRow?: (row: Record<string, unknown>) => boolean) {
  return Array.from(
    new Set(
      liftOrderLines(orderPayload)
        .filter((row) => !orderRowIsCancelled(row))
        .filter((row) => (isProofReadableOrderRow ? isProofReadableOrderRow(row) : true))
        .map((row) => row.ORDER_LINE_ID ?? row.order_line_id)
        .filter((value) => value !== null && value !== undefined && String(value).trim())
        .map((value) => String(value).trim())
    )
  );
}

export async function readLiftProofOrder(
  orderNumber: string,
  options: {
    config?: Partial<LiftProofReadConfig>;
    fetcher?: LiftProofFetch;
    fetched_at?: string;
    isProofReadableOrderRow?: (row: Record<string, unknown>) => boolean;
    validateOrderPayload?: (payload: unknown) => void;
  } = {}
): Promise<LiftProofReadSnapshot> {
  const normalizedOrderNumber = normalizeLiftOrderNumber(orderNumber);
  const config = { ...getDefaultLiftProofReadConfig(), ...(options.config ?? {}) };
  const fetcher = options.fetcher ?? fetch;
  const orderUrl = buildLiftProofOrderReadUrl(config.order_read_url, normalizedOrderNumber);
  const orderPayload = await readJson(fetcher, orderUrl, config.timeout_ms);
  options.validateOrderPayload?.(orderPayload);
  const configuredEligibility =
    options.isProofReadableOrderRow ??
    (config.proof_readable_min_step == null
      ? undefined
      : (row: Record<string, unknown>) =>
          Number(row.LINE_STEP_NUMBER ?? row.STEP_NUMBER ?? row.line_step_number ?? row.step_number) >=
          (config.proof_readable_min_step as number));
  const lineIds = orderLineIds(orderPayload, configuredEligibility);

  const lineResults = await mapWithConcurrency(lineIds, config.concurrency, async (orderLineId) => {
    const url = buildLiftProofReportReadUrl(config.proof_report_read_url, normalizedOrderNumber, orderLineId);
    try {
      const payload = await readJson(fetcher, url, config.timeout_ms);
      return {
        orderLineId,
        url,
        payload,
        ok: true as const,
        error: null
      };
    } catch (error) {
      return {
        orderLineId,
        url,
        payload: null,
        ok: false as const,
        error: error instanceof Error ? error.message : "Lift proof report line read failed."
      };
    }
  });

  const usableLinePayloads = lineResults.filter((result) => result.ok && liftRows(result.payload).length > 0);
  const failedLineReads = lineResults.filter((result) => !result.ok);
  let fallbackPayload: unknown = null;
  let fallbackUrl: string | null = null;
  let fallbackOk: boolean | null = null;
  let fallbackError: string | null = null;

  if (failedLineReads.length > 0 && usableLinePayloads.length === 0) {
    fallbackUrl = buildLiftProofReportReadUrl(config.proof_report_read_url, normalizedOrderNumber, null);
    try {
      fallbackPayload = await readJson(fetcher, fallbackUrl, config.timeout_ms);
      fallbackOk = true;
    } catch (error) {
      fallbackOk = false;
      fallbackError = error instanceof Error ? error.message : "Lift proof report fallback read failed.";
    }
  }

  const proofPayloads = fallbackOk
    ? [fallbackPayload]
    : lineResults.filter((result) => result.ok).map((result) => result.payload);

  return {
    order_number: normalizedOrderNumber,
    order_payload: orderPayload,
    proof_payloads: proofPayloads,
    fetched_at: options.fetched_at ?? new Date().toISOString(),
    diagnostics: {
      order_url: orderUrl,
      line_reads: lineResults.map((result) => ({
        order_line_id: result.orderLineId,
        url: result.url,
        ok: result.ok,
        row_count: liftRows(result.payload).length,
        error: result.error
      })),
      fallback_read: {
        attempted: fallbackUrl !== null,
        url: fallbackUrl,
        ok: fallbackOk,
        row_count: liftRows(fallbackPayload).length,
        error: fallbackError
      }
    }
  };
}
