import { createHash } from "node:crypto";

const safeText = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

const normalizedText = (value: unknown) => safeText(value).replace(/\s+/g, " ").toUpperCase();

// AS360Orders renders a product's dimensions as a trailing name suffix even
// though the create-order payload and reconciliation contract carry width and
// height as separate fields. Compare the stable product name here and continue
// to compare both dimensions independently below.
const normalizedProductName = (value: unknown) =>
  normalizedText(value).replace(/-\s*\d+(?:\.\d+)?\s*[X×]\s*\d+(?:\.\d+)?$/, "").trim();

const normalizedNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Number(parsed.toFixed(6))) : "";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (safeText(value)) return value;
  }
  return null;
}

function providerRows(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  return record && Array.isArray(record.rowset) ? record.rowset : [];
}

export interface ScheduledUncertainReconciliationJob {
  job_id: string;
  customer_id: string;
  submit_customer_id: string;
  import_method_id: string;
  target_order_number?: string | null;
  updated_at: string;
  scheduled_wrike_intake?: {
    source: "scheduled_polling";
    task_id?: string | null;
    import_method_id: string;
  } | null;
  source_evidence?: {
    provider?: string | null;
    task_id?: string | null;
  } | null;
  lift_payload: {
    order: Record<string, unknown> & {
      ext_id: string;
      po_number?: string | null;
      contract_number?: string | null;
      order_title?: string | null;
    };
    lines: Array<{
      line_number: number;
      unit_number: string;
      product_id?: string | null;
      product_name?: string | null;
      quantity: number;
      dimensions: { final_height: number; final_width: number };
    }>;
  };
}

export interface ScheduledUncertainReconciliationAttempt {
  attempt_id: string;
  idempotency_key: string;
  job_id: string;
  customer_id: string;
  state: string;
  transport_mode?: string | null;
  external_submit_enabled: boolean;
  ext_id: string;
  company_id: string;
  request_fingerprint?: string | null;
  response: { lift_order_id?: string | null };
}

export class ScheduledUncertainReconciliationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScheduledUncertainReconciliationError";
    this.code = code;
  }
}

export function selectScheduledUncertainAttempt(args: {
  job: ScheduledUncertainReconciliationJob;
  attempts: ScheduledUncertainReconciliationAttempt[];
  expected_attempt_id?: string | null;
}) {
  const taskId = args.job.source_evidence?.task_id?.trim() ?? "";
  const marker = args.job.scheduled_wrike_intake;
  if (
    args.job.target_order_number?.trim() ||
    args.job.source_evidence?.provider !== "wrike" ||
    !taskId ||
    marker?.source !== "scheduled_polling" ||
    marker.task_id?.trim() !== taskId ||
    marker.import_method_id !== args.job.import_method_id
  ) {
    throw new ScheduledUncertainReconciliationError(
      "scheduled_boundary_mismatch",
      "This job is not an unassociated scheduled Wrike intake candidate."
    );
  }
  const transportAttempts = args.attempts.filter(
    (attempt) => !["Blocked", "Gate Locked"].includes(attempt.state)
  );
  if (transportAttempts.length !== 1) {
    throw new ScheduledUncertainReconciliationError(
      "attempt_ambiguous",
      "The scheduled job does not have exactly one transport attempt to reconcile."
    );
  }
  const attempt = transportAttempts[0]!;
  if (
    attempt.state !== "Submission Uncertain" ||
    attempt.job_id !== args.job.job_id ||
    attempt.customer_id !== args.job.customer_id ||
    attempt.transport_mode !== "live" ||
    !attempt.external_submit_enabled ||
    attempt.response.lift_order_id?.trim() ||
    normalizedText(attempt.ext_id) !== normalizedText(args.job.lift_payload.order.ext_id)
  ) {
    throw new ScheduledUncertainReconciliationError(
      "attempt_boundary_mismatch",
      "The exact scheduled submit attempt is not eligible for uncertain-response reconciliation."
    );
  }
  if (args.expected_attempt_id && attempt.attempt_id !== args.expected_attempt_id) {
    throw new ScheduledUncertainReconciliationError(
      "attempt_changed",
      "The uncertain submit attempt changed after verification."
    );
  }
  return attempt;
}

function expectedLineIdentity(job: ScheduledUncertainReconciliationJob) {
  return [...job.lift_payload.lines]
    .sort((left, right) => left.line_number - right.line_number)
    .map((line) => ({
      line_number: normalizedNumber(line.line_number),
      quantity: normalizedNumber(line.quantity),
      product_name: normalizedProductName(line.product_name),
      final_height: normalizedNumber(line.dimensions.final_height),
      final_width: normalizedNumber(line.dimensions.final_width)
    }));
}

function providerLineIdentity(header: Record<string, unknown>) {
  const lines = Array.isArray(header.LINES) ? header.LINES : [];
  return lines.flatMap((value, index) => {
    const line = asRecord(value);
    if (!line) return [];
    return [{
      line_number: normalizedNumber(firstValue(line, ["LINE_NUMBER"]) ?? index + 1),
      quantity: normalizedNumber(firstValue(line, ["QUANTITY", "QTY"])),
      product_name: normalizedProductName(firstValue(line, ["PRODUCT_NAME", "PRODUCT"])),
      final_height: normalizedNumber(firstValue(line, ["PRINT_H_IN", "FINAL_HEIGHT", "HEIGHT"])),
      final_width: normalizedNumber(firstValue(line, ["PRINT_W_IN", "FINAL_WIDTH", "WIDTH"]))
    }];
  }).sort((left, right) => Number(left.line_number) - Number(right.line_number));
}

function canonicalLineFingerprint(lines: ReturnType<typeof expectedLineIdentity>) {
  return createHash("sha256").update(JSON.stringify(lines)).digest("hex");
}

export interface ScheduledUncertainProviderVerification {
  order_number: string;
  external_order_id: string;
  company_id: string;
  customer_id: string;
  customer_name: string | null;
  order_title: string;
  po_number: string;
  contract_number: string;
  order_type: string;
  created_by: string;
  order_status: string | null;
  line_count: number;
  line_fingerprint: string;
  submit_attempt_id: string;
  request_fingerprint: string | null;
  fetched_at: string;
}

export function verifyScheduledUncertainProviderOrder(args: {
  job: ScheduledUncertainReconciliationJob;
  attempt: ScheduledUncertainReconciliationAttempt;
  order_number: string;
  provider_payload: unknown;
  provider_company_id: string;
  expected_order_type: string;
  fetched_at: string;
}): ScheduledUncertainProviderVerification {
  const requestedOrder = normalizedText(args.order_number);
  const matchingRows = providerRows(args.provider_payload)
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .filter((row) => normalizedText(firstValue(row, ["ORDER_NUMBER"])) === requestedOrder);
  if (matchingRows.length !== 1) {
    throw new ScheduledUncertainReconciliationError(
      matchingRows.length ? "provider_order_ambiguous" : "provider_order_missing",
      "Lift did not return exactly one matching order for this reconciliation."
    );
  }
  const header = matchingRows[0]!;
  const expectedLines = expectedLineIdentity(args.job);
  const actualLines = providerLineIdentity(header);
  const expectedFingerprint = canonicalLineFingerprint(expectedLines);
  const actualFingerprint = canonicalLineFingerprint(actualLines);
  const expectedOrderTitle = normalizedText(args.job.lift_payload.order.order_title);
  const expectedPo = normalizedText(args.job.lift_payload.order.po_number);
  const expectedContract = normalizedText(args.job.lift_payload.order.contract_number);
  const expectedOrderType = normalizedText(args.expected_order_type);
  const actualOrderTitle = normalizedText(firstValue(header, ["ORDER_TITLE"]));
  const actualExternalId = normalizedText(firstValue(header, ["EXT_ID", "EXTERNAL_ORDER_ID", "ORDER_EXT_ID"]));
  const actualCompanyId = normalizedText(firstValue(header, ["COMPANY_ID", "COMPANY"])) || normalizedText(args.provider_company_id);
  const actualPo = normalizedText(firstValue(header, ["PO_NUMBER", "PO_NO"]));
  const actualContract = normalizedText(firstValue(header, ["CONTRACT_NUMBER", "CONTRACT_NO"]));
  const checks: Array<[boolean, string, string]> = [
    [!actualExternalId || actualExternalId === normalizedText(args.attempt.ext_id), "external_id_mismatch", "Lift Ext_ID does not match the uncertain submit attempt."],
    [actualCompanyId === normalizedText(args.attempt.company_id), "company_mismatch", "Lift company does not match the uncertain submit attempt."],
    [normalizedText(firstValue(header, ["CUSTOMER_ID"])) === normalizedText(args.job.submit_customer_id), "customer_mismatch", "Lift customer does not match the scheduled submit customer."],
    [
      Boolean(actualOrderTitle) &&
        (actualOrderTitle === expectedOrderTitle || actualOrderTitle === expectedContract),
      "order_title_mismatch",
      "Lift order title does not match the prepared order identity."
    ],
    [actualPo === expectedPo, "po_mismatch", "Lift PO does not match the prepared order."],
    [
      actualContract ? actualContract === expectedContract : actualPo === expectedContract && expectedPo === expectedContract,
      "contract_mismatch",
      "Lift contract does not match the prepared order."
    ],
    [normalizedText(firstValue(header, ["CREATED_BY"])) === "PATHFINDER", "creator_mismatch", "Lift does not identify Pathfinder as the order creator."],
    [Boolean(expectedOrderType) && normalizedText(firstValue(header, ["ORDER_TYPE_NAME", "ORDER_TYPE"])) === expectedOrderType, "order_type_mismatch", "Lift order type does not match the prepared order."],
    [expectedLines.length > 0 && actualLines.length === expectedLines.length && actualFingerprint === expectedFingerprint, "line_identity_mismatch", "Lift line identities do not match the prepared order."]
  ];
  const failed = checks.find(([passed]) => !passed);
  if (failed) {
    throw new ScheduledUncertainReconciliationError(failed[1], failed[2]);
  }
  return {
    order_number: requestedOrder,
    // AS360Orders currently omits Ext_ID. The exact uncertain attempt remains
    // the authoritative Ext_ID binding when every provider-visible identity
    // above matches; a provider-supplied Ext_ID still must match exactly.
    external_order_id: actualExternalId || normalizedText(args.attempt.ext_id),
    company_id: actualCompanyId,
    customer_id: normalizedText(firstValue(header, ["CUSTOMER_ID"])),
    customer_name: safeText(firstValue(header, ["CUSTOMER_NAME"])) || null,
    order_title: safeText(firstValue(header, ["ORDER_TITLE"])),
    po_number: safeText(firstValue(header, ["PO_NUMBER", "PO_NO"])),
    contract_number:
      safeText(firstValue(header, ["CONTRACT_NUMBER", "CONTRACT_NO"])) ||
      safeText(firstValue(header, ["PO_NUMBER", "PO_NO"])),
    order_type: safeText(firstValue(header, ["ORDER_TYPE_NAME", "ORDER_TYPE"])),
    created_by: safeText(firstValue(header, ["CREATED_BY"])),
    order_status: safeText(firstValue(header, ["ORDER_STATUS"])) || null,
    line_count: actualLines.length,
    line_fingerprint: actualFingerprint,
    submit_attempt_id: args.attempt.attempt_id,
    request_fingerprint: args.attempt.request_fingerprint?.trim() || null,
    fetched_at: args.fetched_at
  };
}
