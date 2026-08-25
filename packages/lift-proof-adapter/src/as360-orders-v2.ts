import { normalizeLiftOrderNumber } from "@pathfinder/proof-domain";

export const AS360_ORDERS_V2 = "as360_orders_v2" as const;
export const AS360_ORDER_HISTORY_DAY_OPTIONS = [1, 7, 30, 90, 180, 360] as const;
export type As360OrderHistoryDays = (typeof AS360_ORDER_HISTORY_DAY_OPTIONS)[number];

export interface CustomerOrderLineSummary {
  line_number: string;
  source_line_id: string;
  quantity: number | null;
  product_name: string | null;
  unit_number: string | null;
  material: string | null;
  line_step_id: string | null;
  line_step_number: number | null;
  print_height_inches: number | null;
  print_width_inches: number | null;
}

export interface CustomerOrderSummary {
  source: typeof AS360_ORDERS_V2;
  source_order_reference: string;
  order_number: string;
  customer_id: string;
  customer_name: string | null;
  order_title: string | null;
  po_number: string | null;
  creation_date: string;
  created_by: string | null;
  order_type_name: string | null;
  order_status: string | null;
  order_step_id: string | null;
  header_step_number: number | null;
  line_count: number;
  proof_availability: "not_checked";
  lines: CustomerOrderLineSummary[];
}

export interface As360OrdersV2Result {
  adapter_version: typeof AS360_ORDERS_V2;
  customer_id: string;
  query: {
    order_number: string | null;
    days_back: As360OrderHistoryDays | null;
  };
  total_count: number;
  returned_count: number;
  truncated: boolean;
  orders: CustomerOrderSummary[];
}

export type As360OrdersFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export class As360OrdersV2Error extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "provider_error"
      | "invalid_response"
      | "customer_boundary_mismatch",
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "As360OrdersV2Error";
  }
}

function exactCustomerId(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,20}$/.test(normalized)) {
    throw new As360OrdersV2Error("invalid_request", "A verified numeric Lift customer ID is required.");
  }
  return normalized;
}

function exactDaysBack(value: number | null | undefined) {
  if (value == null) return null;
  if (!AS360_ORDER_HISTORY_DAY_OPTIONS.includes(value as As360OrderHistoryDays)) {
    throw new As360OrdersV2Error(
      "invalid_request",
      "Order history days must be one of 1, 7, 30, 90, 180, or 360."
    );
  }
  return value as As360OrderHistoryDays;
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredDate(value: unknown) {
  const normalized = optionalString(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !Number.isFinite(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new As360OrdersV2Error("invalid_response", "Lift returned an invalid order creation date.");
  }
  return normalized;
}

function sourceId(value: unknown, label: string) {
  const normalized = optionalString(value);
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new As360OrdersV2Error("invalid_response", `Lift returned an invalid ${label}.`);
  }
  return normalized;
}

function orderRows(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("rowset" in payload)) {
    throw new As360OrdersV2Error("invalid_response", "Lift returned an invalid AS360Orders response.");
  }
  const rowset = (payload as { rowset?: unknown }).rowset;
  if (rowset === null) return [];
  if (!Array.isArray(rowset)) {
    throw new As360OrdersV2Error("invalid_response", "Lift returned an invalid AS360Orders rowset.");
  }
  return rowset;
}

function normalizeLine(value: unknown): CustomerOrderLineSummary {
  if (!value || typeof value !== "object") {
    throw new As360OrdersV2Error("invalid_response", "Lift returned an invalid order line.");
  }
  const line = value as Record<string, unknown>;
  return {
    line_number: sourceId(line.LINE_NUMBER, "line number"),
    source_line_id: sourceId(line.ORDER_LINE_ID, "order line ID"),
    quantity: optionalNumber(line.QUANTITY),
    product_name: optionalString(line.PRODUCT_NAME),
    unit_number: optionalString(line.UNIT_NUMBER),
    material: optionalString(line.MATERIAL),
    line_step_id: optionalString(line.LINE_STEP_ID),
    line_step_number: optionalNumber(line.LINE_STEP_NUMBER),
    print_height_inches: optionalNumber(line.PRINT_H_IN),
    print_width_inches: optionalNumber(line.PRINT_W_IN)
  };
}

function normalizeOrder(value: unknown, verifiedCustomerId: string): CustomerOrderSummary {
  if (!value || typeof value !== "object") {
    throw new As360OrdersV2Error("invalid_response", "Lift returned an invalid order row.");
  }
  const row = value as Record<string, unknown>;
  const customerId = optionalString(row.CUSTOMER_ID);
  if (customerId !== verifiedCustomerId) {
    throw new As360OrdersV2Error(
      "customer_boundary_mismatch",
      "Lift returned an order outside the verified customer boundary."
    );
  }
  let orderNumber: string;
  try {
    orderNumber = normalizeLiftOrderNumber(String(row.ORDER_NUMBER ?? ""));
  } catch {
    throw new As360OrdersV2Error("invalid_response", "Lift returned an invalid order number.");
  }
  const lines = Array.isArray(row.LINES) ? row.LINES.map(normalizeLine) : [];
  return {
    source: AS360_ORDERS_V2,
    source_order_reference: orderNumber,
    order_number: orderNumber,
    customer_id: customerId,
    customer_name: optionalString(row.CUSTOMER_NAME),
    order_title: optionalString(row.ORDER_TITLE),
    po_number: optionalString(row.PO_NUMBER),
    creation_date: requiredDate(row.CREATION_DATE),
    created_by: optionalString(row.CREATED_BY),
    order_type_name: optionalString(row.ORDER_TYPE_NAME),
    order_status: optionalString(row.ORDER_STATUS),
    order_step_id: optionalString(row.ORDER_STEP_ID),
    header_step_number: optionalNumber(row.HEADER_STEP_NUMBER),
    line_count: lines.length,
    proof_availability: "not_checked",
    lines
  };
}

export function buildAs360OrdersV2Url(
  baseUrl: string,
  input: {
    verified_customer_id: string;
    order_number?: string | null;
    days_back?: number | null;
  }
) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new As360OrdersV2Error("invalid_request", "Lift AS360Orders URL must be absolute.");
  }
  const customerId = exactCustomerId(input.verified_customer_id);
  const orderNumber = input.order_number?.trim()
    ? normalizeLiftOrderNumber(input.order_number)
    : null;
  const daysBack = exactDaysBack(input.days_back);
  if (!orderNumber && daysBack === null) {
    throw new As360OrdersV2Error("invalid_request", "Order history days are required when no order number is supplied.");
  }
  url.searchParams.set("offset", "0");
  url.searchParams.set("p1", customerId);
  url.searchParams.delete("rows");
  if (orderNumber) {
    url.searchParams.set("p0", orderNumber);
    url.searchParams.delete("p2");
  } else {
    url.searchParams.delete("p0");
    url.searchParams.set("p2", String(daysBack));
  }
  return url.toString();
}

export async function readAs360OrdersV2(
  baseUrl: string,
  input: {
    verified_customer_id: string;
    order_number?: string | null;
    days_back?: number | null;
    result_limit?: number;
    timeout_ms?: number;
    fetcher?: As360OrdersFetch;
  }
): Promise<As360OrdersV2Result> {
  const customerId = exactCustomerId(input.verified_customer_id);
  const orderNumber = input.order_number?.trim()
    ? normalizeLiftOrderNumber(input.order_number)
    : null;
  const daysBack = orderNumber ? null : exactDaysBack(input.days_back);
  const url = buildAs360OrdersV2Url(baseUrl, {
    verified_customer_id: customerId,
    order_number: orderNumber,
    days_back: daysBack
  });
  const resultLimit = Math.max(1, Math.min(100, Math.floor(input.result_limit ?? 50)));
  const timeoutMs = Math.max(1_000, Math.min(30_000, Math.floor(input.timeout_ms ?? 15_000)));
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new As360OrdersV2Error(
      "provider_error",
      error instanceof Error ? error.message : "Lift AS360Orders read failed."
    );
  }
  if (!response.ok) {
    throw new As360OrdersV2Error(
      "provider_error",
      `Lift AS360Orders read failed with HTTP ${response.status}.`,
      response.status
    );
  }
  const payload = await response.json().catch(() => null);
  const orders = orderRows(payload)
    .map((row) => normalizeOrder(row, customerId))
    .sort((left, right) =>
      right.creation_date.localeCompare(left.creation_date) ||
      right.order_number.localeCompare(left.order_number)
    );
  if (orderNumber && orders.some((order) => order.order_number !== orderNumber)) {
    throw new As360OrdersV2Error("invalid_response", "Lift returned an unexpected order for the exact-order query.");
  }
  const limited = orders.slice(0, resultLimit);
  return {
    adapter_version: AS360_ORDERS_V2,
    customer_id: customerId,
    query: { order_number: orderNumber, days_back: daysBack },
    total_count: orders.length,
    returned_count: limited.length,
    truncated: limited.length < orders.length,
    orders: limited
  };
}
