import type { CanonicalOrder, Contact, ShippingAddress, ValidationMessage } from "@pathfinder/canonical";

export interface LiftTargetConfig {
  destination_adapter: "lift-standard-graphics";
  active_environment: "QA1" | "PROD";
  environments: {
    QA1: { endpoint_url: string };
    PROD: { endpoint_url: string };
  };
  headers: {
    "Content-Type": "application/json";
    Company: string;
    Ext_ID: {
      strategy: "field";
      field: "order.ext_id";
      body_field: "order.ext_id";
      must_match_body: true;
      default_source_field: "canonical.order.external_order_id";
      fallback_fields: string[];
    };
  };
  credentials: {
    User: string;
    Password: string;
  };
}

export interface LiftOrderPayload {
  customer: {
    lift_customer_id?: string;
    customer_name: string;
    crm_id?: string | null;
  };
  contacts?: Contact[];
  source: {
    platform: "Pathfinder";
    pathfinder_customer_id: string;
    source_system: string;
    source_customer: string;
    source_record_id: string;
    source_record_url?: string | null;
    source_template?: string | null;
    submitted_at: string;
    pathfinder_job_id: string;
    pathfinder_canonical_order_id: string;
  };
  order: {
    ext_id: string;
    po_number?: string | null;
    contract_number?: string | null;
    order_title?: string | null;
    order_note?: string | null;
    requested_ship_date?: string | null;
    due_date?: string | null;
    order_attachment?: string | null;
    shipping?: ShippingAddress | null;
  };
  lines: Array<{
    line_number: number;
    unit_number: string;
    customer_sku?: string | null;
    description?: string | null;
    product_id?: string | null;
    product_name?: string | null;
    quantity: number;
    artwork?: {
      file_name?: string | null;
      file_url?: string | null;
      checksum?: string | null;
    };
    dimensions: {
      final_height: number;
      final_width: number;
      live_height?: number | null;
      live_width?: number | null;
      bleed?: number | null;
    };
    production?: Record<string, string | number | boolean | null>;
    line_note?: string | null;
  }>;
}

export type ValueNormalizationMatchMode = "exact" | "case_insensitive" | "contains" | "regex";
export type ValueNormalizationFallbackBehavior = "pass_through" | "block_submit" | "use_default";

export interface ValueNormalizationRule {
  value_rule_id: string;
  canonical_field: string;
  output_field: string;
  match_mode: ValueNormalizationMatchMode;
  input_value: string;
  normalized_value: string;
  fallback_behavior: ValueNormalizationFallbackBehavior;
  default_value?: string | null;
  status: "Active" | "Draft" | "Inactive";
  notes?: string | null;
}

export interface ValueNormalizationResult {
  rule_id?: string | null;
  field: string;
  original_value: string;
  normalized_value: string;
  status: "Normalized" | "Pass Through" | "Defaulted" | "Blocked";
  message: string;
}

export interface LiftSubmitRequest {
  endpoint_url: string;
  headers: {
    "Content-Type": "application/json";
    Ext_ID: string;
    User: string;
    Password: string;
    Company: string;
  };
  body: LiftOrderPayload;
}

export type LiftSubmitTransportMode = "dry_run" | "live";

export interface LiftSubmitTransportResult {
  status: "not_sent" | "accepted" | "rejected" | "error";
  http_status?: number | null;
  lift_order_id?: string | null;
  message: string;
  raw_body?: unknown;
  error_translation?: LiftSubmitErrorTranslation | null;
  received_at: string;
}

export type LiftSubmitErrorCategory =
  | "auth"
  | "company"
  | "duplicate_ext_id"
  | "customer"
  | "unit_number"
  | "payload"
  | "endpoint"
  | "timeout"
  | "unknown";

export interface LiftSubmitErrorTranslation {
  category: LiftSubmitErrorCategory;
  operator_message: string;
  suggested_action: string;
  retryable: boolean;
  source_message: string;
}

export const defaultLiftTargetConfig: LiftTargetConfig = {
  destination_adapter: "lift-standard-graphics",
  active_environment: "QA1",
  environments: {
    PROD: {
      endpoint_url: "http://prod-lifterp/lifterp/ords/lifterp/lift/erp/api/create_order"
    },
    QA1: {
      endpoint_url: "http://devcompute/lifterp-qa1/lifterp/liftqa1/erp/api/create_orde"
    }
  },
  headers: {
    "Content-Type": "application/json",
    Company: "91",
    Ext_ID: {
      strategy: "field",
      field: "order.ext_id",
      body_field: "order.ext_id",
      must_match_body: true,
      default_source_field: "canonical.order.external_order_id",
      fallback_fields: ["canonical.order.contract_number", "canonical.order.po_number"]
    }
  },
  credentials: {
    User: "LIFT_IMPORT_USERNAME_TBD",
    Password: "SECRET_REFERENCE_ONLY"
  }
};

function resolveExtId(order: CanonicalOrder): string {
  return (
    order.order.external_order_id ||
    order.order.contract_number ||
    order.order.po_number ||
    order.source.source_record_id
  );
}

export function generateLiftPayload(
  canonicalOrder: CanonicalOrder,
  ids: { jobId: string; canonicalOrderId: string } = {
    jobId: "job_preview",
    canonicalOrderId: "co_preview"
  }
): LiftOrderPayload {
  const extId = resolveExtId(canonicalOrder);

  return {
    customer: {
      lift_customer_id: canonicalOrder.customer.destination_customer_id,
      customer_name: canonicalOrder.customer.customer_name,
      crm_id: canonicalOrder.customer.crm_id ?? null
    },
    contacts: canonicalOrder.contacts ?? [],
    source: {
      platform: "Pathfinder",
      pathfinder_customer_id: canonicalOrder.customer.customer_id,
      source_system: canonicalOrder.source.source_system,
      source_customer: canonicalOrder.source.source_customer,
      source_record_id: canonicalOrder.source.source_record_id,
      source_record_url: canonicalOrder.source.source_record_url ?? null,
      source_template: canonicalOrder.source.source_template ?? null,
      submitted_at: canonicalOrder.source.submitted_at,
      pathfinder_job_id: ids.jobId,
      pathfinder_canonical_order_id: ids.canonicalOrderId
    },
    order: {
      ext_id: extId,
      po_number: canonicalOrder.order.po_number ?? null,
      contract_number: canonicalOrder.order.contract_number ?? null,
      order_title: canonicalOrder.order.order_title ?? null,
      order_note: canonicalOrder.order.order_note ?? null,
      requested_ship_date: canonicalOrder.order.ship_date ?? null,
      due_date: canonicalOrder.order.due_date ?? null,
      order_attachment: canonicalOrder.order.order_attachment ?? null,
      shipping: canonicalOrder.order.shipping ?? null
    },
    lines: canonicalOrder.lines.map((line) => ({
      line_number: line.line_number,
      unit_number: line.unit_number,
      customer_sku: line.customer_sku ?? null,
      description: line.description ?? null,
      product_id: line.product_id ?? null,
      product_name: line.product_name ?? line.description ?? null,
      quantity: line.quantity,
      artwork: line.artwork,
      dimensions: {
        final_height: line.dimensions.final_height,
        final_width: line.dimensions.final_width,
        live_height: line.dimensions.live_height ?? null,
        live_width: line.dimensions.live_width ?? null,
        bleed: line.dimensions.bleed ?? null
      },
      production: line.production,
      line_note: line.line_note ?? null
    }))
  };
}

function getPayloadValue(payload: LiftOrderPayload, field: string): unknown {
  return field.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, payload);
}

function setPayloadValue(payload: LiftOrderPayload, field: string, value: unknown) {
  const segments = field.split(".");
  const finalSegment = segments.pop();
  if (!finalSegment) {
    return;
  }

  const parent = segments.reduce<Record<string, unknown>>((current, segment) => {
    if (!current[segment] || typeof current[segment] !== "object") {
      current[segment] = {};
    }
    return current[segment] as Record<string, unknown>;
  }, payload as unknown as Record<string, unknown>);

  parent[finalSegment] = value;
}

function matchesNormalizationRule(value: string, rule: ValueNormalizationRule) {
  const inputs = rule.input_value
    .split(",")
    .map((input) => input.trim())
    .filter(Boolean);
  if (!inputs.length) {
    return false;
  }

  return inputs.some((input) => {
    if (rule.match_mode === "case_insensitive") {
      return value.trim().toLowerCase() === input.toLowerCase();
    }
    if (rule.match_mode === "contains") {
      return value.toLowerCase().includes(input.toLowerCase());
    }
    if (rule.match_mode === "regex") {
      try {
        return new RegExp(input, "i").test(value);
      } catch {
        return false;
      }
    }
    return value.trim() === input;
  });
}

export function applyValueNormalizationToLiftPayload(
  payload: LiftOrderPayload,
  rules: ValueNormalizationRule[] = []
): { payload: LiftOrderPayload; results: ValueNormalizationResult[]; validation: ValidationMessage[] } {
  const nextPayload = JSON.parse(JSON.stringify(payload)) as LiftOrderPayload;
  const activeRules = rules.filter((rule) => rule.status === "Active" && rule.output_field.trim());
  const fields = [...new Set(activeRules.map((rule) => rule.output_field))];
  const results: ValueNormalizationResult[] = [];
  const validation: ValidationMessage[] = [];

  for (const field of fields) {
    const fieldRules = activeRules.filter((rule) => rule.output_field === field);
    const rawValue = getPayloadValue(nextPayload, field);

    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") {
      continue;
    }

    const originalValue = String(rawValue);
    const matchedRule = fieldRules.find((rule) => matchesNormalizationRule(originalValue, rule));

    if (matchedRule) {
      setPayloadValue(nextPayload, field, matchedRule.normalized_value);
      results.push({
        rule_id: matchedRule.value_rule_id,
        field,
        original_value: originalValue,
        normalized_value: matchedRule.normalized_value,
        status: "Normalized",
        message: `${field} normalized from "${originalValue}" to "${matchedRule.normalized_value}".`
      });
      continue;
    }

    const fallbackRule = fieldRules.find((rule) => rule.fallback_behavior === "block_submit") ?? fieldRules[0];
    if (fallbackRule?.fallback_behavior === "use_default" && fallbackRule.default_value) {
      setPayloadValue(nextPayload, field, fallbackRule.default_value);
      results.push({
        rule_id: fallbackRule.value_rule_id,
        field,
        original_value: originalValue,
        normalized_value: fallbackRule.default_value,
        status: "Defaulted",
        message: `${field} defaulted to "${fallbackRule.default_value}".`
      });
      continue;
    }

    if (fallbackRule?.fallback_behavior === "block_submit") {
      results.push({
        rule_id: null,
        field,
        original_value: originalValue,
        normalized_value: originalValue,
        status: "Blocked",
        message: `${field} value "${originalValue}" does not match an approved output value.`
      });
      validation.push({
        severity: "FAIL",
        code: "LIFT-VALUE-NORMALIZATION",
        object: "lift.payload",
        field,
        message: `${field} value "${originalValue}" is not approved for this output route.`,
        suggested_action: "Add a value normalization rule or update the source mapping before submitting."
      });
      continue;
    }

    results.push({
      rule_id: null,
      field,
      original_value: originalValue,
      normalized_value: originalValue,
      status: "Pass Through",
      message: `${field} passed through without normalization.`
    });
  }

  return { payload: nextPayload, results, validation };
}

export function validateLiftPayload(payload: LiftOrderPayload): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  if (!payload.order.ext_id?.trim()) {
    messages.push({
      severity: "FAIL",
      code: "LIFT-EXT-ID",
      object: "lift.order",
      field: "order.ext_id",
      message: "Lift payload order.ext_id is required.",
      suggested_action: "Map or derive ext_id from the canonical external order ID, contract number, or PO number."
    });
  }

  if (!payload.lines.length) {
    messages.push({
      severity: "FAIL",
      code: "LIFT-LINES",
      object: "lift.lines",
      field: "lines",
      message: "Lift payload requires at least one line.",
      suggested_action: "Import line rows before generating the payload."
    });
  }

  payload.lines.forEach((line, index) => {
    if (!line.unit_number.trim()) {
      messages.push({
        severity: "FAIL",
        code: "LIFT-UNIT",
        object: "lift.line",
        field: `lines[${index}].unit_number`,
        message: "Lift line unit_number is required.",
        suggested_action: "Resolve product mapping before generating the Lift payload."
      });
    }
  });

  return messages.length
    ? messages
    : [
        {
          severity: "PASS",
          code: "LIFT-OK",
          object: "lift.payload",
          field: "*",
          message: "Lift payload passes preview validation."
        }
      ];
}

export function buildLiftSubmitRequest(
  payload: LiftOrderPayload,
  config: LiftTargetConfig = defaultLiftTargetConfig
): LiftSubmitRequest {
  const extIdHeader = payload.order.ext_id;
  if (extIdHeader !== payload.order.ext_id) {
    throw new Error("Lift Ext_ID header must match payload order.ext_id.");
  }

  return {
    endpoint_url: config.environments[config.active_environment].endpoint_url,
    headers: {
      "Content-Type": "application/json",
      Ext_ID: extIdHeader,
      User: config.credentials.User,
      Password: config.credentials.Password,
      Company: config.headers.Company
    },
    body: payload
  };
}

export function maskLiftSubmitRequest(request: LiftSubmitRequest) {
  return {
    ...request,
    headers: {
      ...request.headers,
      Password: "********"
    }
  };
}

function valueFromRecord(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }

  return null;
}

function valueFromBody(body: unknown, keys: string[], depth = 0): string | null {
  if (!body || typeof body !== "object" || depth > 3) {
    return null;
  }

  if (Array.isArray(body)) {
    for (const item of body) {
      const nestedValue = valueFromBody(item, keys, depth + 1);
      if (nestedValue) {
        return nestedValue;
      }
    }
    return null;
  }

  const record = body as Record<string, unknown>;
  const directValue = valueFromRecord(record, keys);
  if (directValue) {
    return directValue;
  }

  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    const matchingKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === lowerKey);
    if (matchingKey) {
      const value = record[matchingKey];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (typeof value === "number") {
        return String(value);
      }
    }
  }

  for (const nested of Object.values(record)) {
    const nestedValue = valueFromBody(nested, keys, depth + 1);
    if (nestedValue) {
      return nestedValue;
    }
  }

  return null;
}

function messageFromBody(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) {
    return body.trim().slice(0, 500);
  }

  return valueFromBody(body, ["message", "status", "error", "error_message", "detail"]);
}

function rawTextFromBody(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }

  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function bodyHasFailureSignal(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const joinedValues = Object.values(body as Record<string, unknown>)
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /\b(error|failed|failure|rejected|invalid)\b/.test(joinedValues);
}

export function translateLiftSubmitError(args: {
  httpStatus?: number | null;
  rawBody?: unknown;
  message?: string | null;
}): LiftSubmitErrorTranslation {
  const sourceMessage = (args.message || rawTextFromBody(args.rawBody) || "Unknown Lift submit failure").slice(0, 1000);
  const text = sourceMessage.toLowerCase();
  const httpStatus = args.httpStatus ?? null;

  if (httpStatus === 401 || httpStatus === 403 || /auth|unauthori[sz]ed|credential|password|user\b|forbidden/.test(text)) {
    return {
      category: "auth",
      operator_message: "Lift rejected the request because the import credentials were not accepted.",
      suggested_action: "Check the selected target environment's import user and password, then retry the submit.",
      retryable: false,
      source_message: sourceMessage
    };
  }

  if (/company|company_id|company id/.test(text)) {
    return {
      category: "company",
      operator_message: "Lift could not accept the request for the configured Company ID.",
      suggested_action: "Confirm the Output Route company ID and environment header settings match the destination Lift company.",
      retryable: false,
      source_message: sourceMessage
    };
  }

  if (
    /(duplicate|already exists|unique).*(ext[_ -]?id|external id|order)|(ext[_ -]?id|external id|order).*(duplicate|already exists|unique)/.test(
      text
    )
  ) {
    return {
      category: "duplicate_ext_id",
      operator_message: "Lift appears to have rejected the order as a duplicate external order.",
      suggested_action: "Confirm whether this Ext_ID was already submitted. If this is a retry, use the existing Lift order or choose a corrected Ext_ID strategy before resubmitting.",
      retryable: false,
      source_message: sourceMessage
    };
  }

  if (/customer|customerid|customer id/.test(text)) {
    return {
      category: "customer",
      operator_message: "Lift could not resolve the customer on the order.",
      suggested_action: "Check the selected submit profile and Lift customer ID. For sandbox tests, confirm LTL Demo / 1249 is selected when intended.",
      retryable: false,
      source_message: sourceMessage
    };
  }

  if (/unit[_ -]?number|unit number|product|item|sku|part/.test(text)) {
    return {
      category: "unit_number",
      operator_message: "Lift could not resolve one or more submitted product identifiers.",
      suggested_action: "Review the Output Product Map for this route and confirm each customer key maps to an approved Lift unit_number.",
      retryable: false,
      source_message: sourceMessage
    };
  }

  if (/missing|required|invalid|payload|json|parse|field|format/.test(text) || httpStatus === 400 || httpStatus === 422) {
    return {
      category: "payload",
      operator_message: "Lift rejected the order payload because required or formatted data was not accepted.",
      suggested_action: "Review the Canonical Order, Output Template mappings, and Lift payload preview for missing or malformed fields.",
      retryable: false,
      source_message: sourceMessage
    };
  }

  if (/timeout|timed out|abort/.test(text)) {
    return {
      category: "timeout",
      operator_message: "Pathfinder timed out while waiting for Lift to respond.",
      suggested_action: "Check Lift availability and retry after confirming the order was not created in Lift.",
      retryable: true,
      source_message: sourceMessage
    };
  }

  if (/fetch failed|econn|enotfound|network|unavailable|service unavailable|bad gateway|gateway/.test(text) || (httpStatus !== null && httpStatus >= 500)) {
    return {
      category: "endpoint",
      operator_message: "Pathfinder could not reach Lift or Lift returned a server-side error.",
      suggested_action: "Check the selected environment endpoint and Lift service health. Retry after confirming whether Lift created the order.",
      retryable: true,
      source_message: sourceMessage
    };
  }

  return {
    category: "unknown",
    operator_message: "Lift rejected the submit request, but Pathfinder does not yet recognize this error pattern.",
    suggested_action: "Review the raw Lift response with the Lift integration team, then add or refine an error translation rule.",
    retryable: false,
    source_message: sourceMessage
  };
}

export function normalizeLiftSubmitResponse(httpStatus: number, rawBody: unknown): LiftSubmitTransportResult {
  const acceptedHttpStatus = httpStatus >= 200 && httpStatus < 300;
  const failureSignal = bodyHasFailureSignal(rawBody);
  const liftOrderId = valueFromBody(rawBody, [
    "lift_order_id",
    "liftOrderId",
    "lift_order_number",
    "liftOrderNumber",
    "order_number",
    "orderNumber",
    "ORDER_NUMBER",
    "order_id",
    "orderId",
    "ORDER_ID",
    "id"
  ]);
  const bodyMessage = messageFromBody(rawBody);
  const status = acceptedHttpStatus && !failureSignal ? "accepted" : "rejected";

  return {
    status,
    http_status: httpStatus,
    lift_order_id: liftOrderId,
    message:
      bodyMessage ??
      (status === "accepted"
        ? "Lift accepted the order request."
        : `Lift rejected the order request with HTTP ${httpStatus}.`),
    raw_body: rawBody,
    error_translation:
      status === "accepted"
        ? null
        : translateLiftSubmitError({
            httpStatus,
            rawBody,
            message: bodyMessage
          }),
    received_at: new Date().toISOString()
  };
}

export async function submitLiftOrder(
  request: LiftSubmitRequest,
  options: { mode?: LiftSubmitTransportMode; timeoutMs?: number } = {}
): Promise<LiftSubmitTransportResult> {
  const mode = options.mode ?? "dry_run";
  if (mode !== "live") {
    return {
      status: "not_sent",
      http_status: null,
      lift_order_id: null,
      message: "Dry run: external Lift request not sent.",
      raw_body: null,
      error_translation: null,
      received_at: new Date().toISOString()
    };
  }

  try {
    const response = await fetch(request.endpoint_url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000)
    });
    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = contentType.includes("application/json") ? await response.json() : await response.text();

    return normalizeLiftSubmitResponse(response.status, rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lift submit transport failed.";
    return {
      status: "error",
      http_status: null,
      lift_order_id: null,
      message,
      raw_body: null,
      error_translation: translateLiftSubmitError({
        httpStatus: null,
        message
      }),
      received_at: new Date().toISOString()
    };
  }
}
