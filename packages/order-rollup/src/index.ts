export type LiftStatusColor = "blue" | "red" | "green" | "yellow" | "grey" | null;

export interface LiftStepDefinition {
  step_id: string;
  step_number: string;
  job_flow_id: string;
  step_name: string;
  step_code: string;
  order_status: string;
  order_status_code: string;
  order_status_color: LiftStatusColor;
  active: boolean;
}

type LiftStepTuple = readonly [
  stepId: string,
  stepNumber: string,
  stepName: string,
  stepCode: string,
  orderStatus: string,
  orderStatusCode: string,
  orderStatusColor: LiftStatusColor,
  active?: boolean
];

// Lift Standard Graphics flow (JOB_FLOW_ID 1006), transcribed from the
// operator-supplied Order Status table dated 2026-01-26.
const standardGraphicsStepTuples: LiftStepTuple[] = [
  ["1002", "0", "Add Art", "ADD_ART", "Pending Art", "PENDING_ART", "blue", false],
  ["1057", "1", "Waiting For Info", "WAITING_FOR_INFO", "Waiting For Info", "WAITING_FOR_INFO", "yellow"],
  ["1038", "2", "Site Survey", "SITE_SURVEY", "Site Survey", "SITE_SURVEY", "blue"],
  ["1061", "3", "Production Approval", "PRODUCTION_APPROVAL", "Production Approval", "PRODUCTION_APPROVAL", "yellow"],
  ["1092", "4", "Schedule", "SCHEDULE", "In Scheduling", "IN_SCHEDULING", "blue"],
  ["1039", "5", "Design Required", "DESIGN_REQUIRED", "Design", "DESIGN", "blue"],
  ["1040", "6", "Obtain Art", "OBTAIN_ART", "Pending Art", "PENDING_ART", "blue"],
  ["1042", "7.01", "PDF Proof", "PDF_PROOF", "To Be Proofed", "TO_BE_PROOFED", "blue"],
  ["1037", "7.02", "Approve Art", "APPROVE_ART", "Pending Art Approval", "PENDING_ART_APPROVAL", "blue"],
  ["1031", "7.03", "OPP Epson", "OPP_EPSON", "On Press Proof", "ON_PRESS_PROOF", "red"],
  ["1041", "7.04", "Printed Proof", "PRINTED_PROOF", "On Press Proof", "ON_PRESS_PROOF", "red"],
  ["1056", "7.05", "Approved", "APPROVED", "Approved", "APPROVED", "blue"],
  ["1094", "7.06", "Design", "DESIGN", "Design", "DESIGN", "blue"],
  ["1003", "7", "Approve Art", "APPROVE_ART", "Pending Art Approval", "PENDING_ART_APPROVAL", "blue"],
  ["1062", "8", "Color Test", "COLOR_TEST", "In Scheduling", "IN_SCHEDULING", "blue"],
  ["1063", "9", "Test Print", "TEST_PRINT", "In Scheduling", "IN_SCHEDULING", "blue"],
  ["1004", "10", "Rip Art", "RIP_ART", "To Be Ripped", "TO_BE_RIPPED", "blue"],
  ["1106", "11", "Create Screen", "CREATE_SCREEN", "Create Screen", "CREATE_SCREEN", "blue"],
  ["1100", "12", "Pre-Print Mount", "PRE-PRINT_MOUNT", "In Production", "IN_PRODUCTION", "red"],
  ["1101", "13", "Pre-Print Cut", "PRE-PRINT_CUT", "In Production", "IN_PRODUCTION", "red"],
  ["1005", "14", "Print", "PRINT", "Ready to Print", "READY_TO_PRINT", "blue"],
  ["1006", "15", "In Production", "IN_PRODUCTION", "In Production", "IN_PRODUCTION", "red"],
  ["1143", "15.01", "Pre-Production QC", "PREPRODUCTION_QC", "In Production", "IN_PRODUCTION", "red"],
  ["1065", "15.02", "Sublimation", "SUBLIMATION", "In Production", "IN_PRODUCTION", "red"],
  ["1009", "15.03", "Laminate", "LAMINATE", "In Production", "IN_PRODUCTION", "red"],
  ["1008", "15.04", "Measure", "MEASURE", "In Production", "IN_PRODUCTION", "red"],
  ["1010", "15.05", "Pre-Mask A", "PRE-MASK_A", "In Production", "IN_PRODUCTION", "red"],
  ["1102", "15.06", "Pre-Cut Mount", "PRE-CUT_MOUNT", "In Production", "IN_PRODUCTION", "red"],
  ["1043", "15.07", "Cut", "CUT", "In Production", "IN_PRODUCTION", "red"],
  ["1007", "15.08", "Clear Coat", "CLEAR_COAT", "In Production", "IN_PRODUCTION", "red"],
  ["1095", "15.09", "Folding", "FOLDING", "In Bindery", "IN_BINDERY", null],
  ["1096", "15.11", "Bindery Stitching", "BINDERY_STITCHING", "In Bindery", "IN_BINDERY", null],
  ["1051", "15.12", "Sewing", "SEWING", "In Production", "IN_PRODUCTION", "red"],
  ["1052", "15.13", "Welding", "WELDING", "In Production", "IN_PRODUCTION", "red"],
  ["1066", "15.14", "Weeding", "WEEDING", "In Production", "IN_PRODUCTION", "red"],
  ["1044", "15.15", "Pre-Mask", "PRE-MASK", "In Production", "IN_PRODUCTION", "red"],
  ["1045", "15.16", "Grommet", "GROMMET", "In Production", "IN_PRODUCTION", "red"],
  ["1046", "15.17", "Webbing", "WEBBING", "In Production", "IN_PRODUCTION", "red"],
  ["1047", "15.18", "Keder", "KEDER", "In Production", "IN_PRODUCTION", "red"],
  ["1059", "15.19", "Mounting", "MOUNTING", "In Production", "IN_PRODUCTION", "red"],
  ["1064", "15.1", "Bindery", "BINDERY", "In Bindery", "IN_BINDERY", null],
  ["1060", "15.2", "Building", "BUILDING", "In Production", "IN_PRODUCTION", "red"],
  ["1048", "15.21", "Special Finishing", "SPECIAL_FINISHING", "In Production", "IN_PRODUCTION", "red"],
  ["1098", "15.22", "Hand Assembly", "HAND_ASSEMBLY", "In Production", "IN_PRODUCTION", "red"],
  ["1103", "15.24", "Dyesub Finishing", "DYESUB_FINISHING", "In Production", "IN_PRODUCTION", "red"],
  ["1067", "15.25", "Q.C.", "Q.C.", "In Q.C.", "IN_Q.C.", "red"],
  ["1049", "15.26", "Roll on Core", "ROLL_ON_CORE", "In Production", "IN_PRODUCTION", "red"],
  ["1097", "15.27", "Mailing", "MAILING", "To Be Mailed", "TO_BE_MAILED", "blue"],
  ["1012", "15.28", "Pack", "PACK", "In Packing", "IN_PACKING", "red"],
  ["1013", "15.29", "Ship", "SHIP", "Ready to Ship", "READY_TO_SHIP", "red"],
  ["1058", "15.3", "Email Digital", "EMAIL_DIGITAL", "Email Digital", "EMAIL_DIGITAL", "green"],
  ["1142", "15.31", "Ready for Pickup", "READY_FOR_PICKUP", "Ready for Pickup", "READY_FOR_PICKUP", "green"],
  ["1018", "16", "Install", "INSTALL", "To Be Installed", "TO_BE_INSTALLED", "green"],
  ["1019", "17", "Invoice", "INVOICE", "Shipped", "SHIPPED", "green"],
  ["1020", "18", "Completed", "COMPLETED", "Invoiced", "INVOICED", "green"],
  ["1055", "19", "Canceled", "CANCELED", "Canceled", "CANCELED", "grey", false],
  ["1011", "0", "Weigh", "WEIGH", "In Packing", "IN_PACKING", "red", false],
  ["1014", "0", "Schedule", "SCHEDULE", "In Production", "IN_PRODUCTION", "red", false],
  ["1015", "0", "OPP Epson", "OPP_EPSON", "In Production", "IN_PRODUCTION", "red", false],
  ["1016", "0", "Printed Proof", "PRINTED_PROOF", "In Production", "IN_PRODUCTION", "red", false],
  ["1017", "0", "Production Approval", "PRODUCTION_APPROVAL", "In Production", "IN_PRODUCTION", "red", false],
  ["1050", "0", "Labeling", "LABELING", "In Production", "IN_PRODUCTION", "red", false]
];

export const standardGraphicsSteps: LiftStepDefinition[] = standardGraphicsStepTuples.map((step) => ({
  step_id: step[0],
  step_number: step[1],
  job_flow_id: "1006",
  step_name: step[2],
  step_code: step[3],
  order_status: step[4],
  order_status_code: step[5],
  order_status_color: step[6],
  active: step[7] ?? true
}));

const standardGraphicsStepsById = new Map(standardGraphicsSteps.map((step) => [step.step_id, step]));

export const standardGraphicsRailStepIds = [
  "1040",
  "1042",
  "1037",
  "1056",
  "1004",
  "1005",
  "1043",
  "1048",
  "1012",
  "1013",
  "1019",
  "1020"
] as const;

export const standardGraphicsRail = standardGraphicsRailStepIds
  .map((stepId) => standardGraphicsStepsById.get(stepId))
  .filter((step): step is LiftStepDefinition => Boolean(step));

export function resolveLiftStep(stepId?: string | number | null, stepNumber?: string | number | null) {
  const normalizedStepId = stepId == null ? "" : String(stepId).trim();
  const definition = standardGraphicsStepsById.get(normalizedStepId);
  if (definition) {
    return definition;
  }
  const normalizedStepNumber = stepNumber == null ? "" : String(stepNumber).replace(/[AI]$/i, "").trim();
  return normalizedStepNumber
    ? {
        step_id: normalizedStepId || `step-${normalizedStepNumber}`,
        step_number: normalizedStepNumber,
        job_flow_id: "unknown",
        step_name: `Step ${normalizedStepNumber}`,
        step_code: "UNKNOWN",
        order_status: "Status pending",
        order_status_code: "UNKNOWN",
        order_status_color: null,
        active: true
      } satisfies LiftStepDefinition
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function value(record: Record<string, unknown>, key: string): string | number | null {
  const candidate = record[key];
  return typeof candidate === "string" || typeof candidate === "number" ? candidate : null;
}

function numericValue(record: Record<string, unknown>, key: string): number | null {
  const candidate = value(record, key);
  if (candidate == null || candidate === "") {
    return null;
  }
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface NormalizedLiftOrderLine {
  line_number: number;
  order_line_id: string | number | null;
  quantity: number | null;
  product_name: string | null;
  unit_number: string | null;
  material: string | null;
  final_height: number | null;
  final_width: number | null;
  step: LiftStepDefinition | null;
}

export interface OrderRollupDestination {
  company?: string | null;
  attention_to?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export type OrderRollupHeaderFieldSource = "lift" | "submitted";

export interface LiftLineIdentity {
  order_line_id?: string | number | null;
  line_number?: string | number | null;
}

export interface LiftLineMatch<T extends LiftLineIdentity> {
  line: T;
  matched_by: "order_line_id" | "line_number";
}

function normalizedIdentity(valueToNormalize: string | number | null | undefined) {
  if (valueToNormalize == null) {
    return null;
  }
  const normalized = String(valueToNormalize).trim();
  return normalized || null;
}

function normalizedLineNumber(valueToNormalize: string | number | null | undefined) {
  const normalized = normalizedIdentity(valueToNormalize);
  if (normalized == null) {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? String(numeric) : normalized;
}

/**
 * Joins a Lift proof/package record to exactly one normalized order line.
 * ORDER_LINE_ID is authoritative; LINE_NUMBER is compatibility-only fallback.
 */
export function matchLiftLineRecord<T extends LiftLineIdentity>(
  lines: readonly T[],
  record: LiftLineIdentity
): LiftLineMatch<T> | null {
  const orderLineId = normalizedIdentity(record.order_line_id);
  if (orderLineId) {
    const line = lines.find((candidate) => normalizedIdentity(candidate.order_line_id) === orderLineId);
    if (line) {
      return { line, matched_by: "order_line_id" };
    }
  }

  const lineNumber = normalizedLineNumber(record.line_number);
  if (lineNumber) {
    const line = lines.find((candidate) => normalizedLineNumber(candidate.line_number) === lineNumber);
    if (line) {
      return { line, matched_by: "line_number" };
    }
  }

  return null;
}

export interface NormalizedLiftOrder {
  order_number: string | null;
  customer_id: string | number | null;
  customer_name: string | null;
  order_title: string | null;
  po_number: string | null;
  contract_number: string | null;
  order_type: string | null;
  created_by: string | null;
  creation_date: string | null;
  requested_ship_date: string | null;
  due_date: string | null;
  actual_ship_date: string | null;
  shipping: OrderRollupDestination | null;
  status: {
    label: string;
    code: string | null;
    color: LiftStatusColor;
    step: LiftStepDefinition | null;
  } | null;
  lines: NormalizedLiftOrderLine[];
}

function firstText(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const candidate = value(record, key);
    if (candidate != null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return null;
}

/**
 * Keeps only destination context that is appropriate for a customer-facing
 * order view. Contact channels, account numbers, rates, and instructions are
 * intentionally excluded.
 */
export function toCustomerSafeOrderRollupDestination(shipping: unknown): OrderRollupDestination | null {
  const record = asRecord(shipping);
  if (!record) {
    return null;
  }
  const destination: OrderRollupDestination = {
    company: firstText(record, "company", "COMPANY", "ship_to_company", "SHIP_TO_COMPANY"),
    attention_to: firstText(record, "attention_to", "ATTENTION_TO", "ship_to_attention", "SHIP_TO_ATTENTION"),
    address_1: firstText(record, "address_1", "ADDRESS_1", "ship_to_address_1", "SHIP_TO_ADDRESS_1"),
    address_2: firstText(record, "address_2", "ADDRESS_2", "ship_to_address_2", "SHIP_TO_ADDRESS_2"),
    city: firstText(record, "city", "CITY", "ship_to_city", "SHIP_TO_CITY"),
    state: firstText(record, "state", "STATE", "ship_to_state", "SHIP_TO_STATE"),
    postal_code: firstText(record, "postal_code", "POSTAL_CODE", "zip", "ZIP", "ship_to_postal_code", "SHIP_TO_POSTAL_CODE"),
    country: firstText(record, "country", "COUNTRY", "ship_to_country", "SHIP_TO_COUNTRY")
  };
  return Object.values(destination).some(Boolean) ? destination : null;
}

function liftDestination(header: Record<string, unknown>) {
  const nested = header.SHIPPING ?? header.SHIP_TO ?? header.DELIVERY_ADDRESS ?? header.shipping;
  const nestedDestination = toCustomerSafeOrderRollupDestination(nested);
  const flatDestination = toCustomerSafeOrderRollupDestination({
    company: firstText(header, "SHIP_TO_COMPANY", "SHIPPING_COMPANY", "DESTINATION_COMPANY"),
    attention_to: firstText(header, "SHIP_TO_ATTENTION", "SHIPPING_ATTENTION", "ATTENTION_TO"),
    address_1: firstText(header, "SHIP_TO_ADDRESS_1", "SHIPPING_ADDRESS_1", "DELIVERY_ADDRESS_1"),
    address_2: firstText(header, "SHIP_TO_ADDRESS_2", "SHIPPING_ADDRESS_2", "DELIVERY_ADDRESS_2"),
    city: firstText(header, "SHIP_TO_CITY", "SHIPPING_CITY", "DELIVERY_CITY"),
    state: firstText(header, "SHIP_TO_STATE", "SHIPPING_STATE", "DELIVERY_STATE"),
    postal_code: firstText(header, "SHIP_TO_POSTAL_CODE", "SHIP_TO_ZIP", "SHIPPING_POSTAL_CODE", "DELIVERY_POSTAL_CODE"),
    country: firstText(header, "SHIP_TO_COUNTRY", "SHIPPING_COUNTRY", "DELIVERY_COUNTRY")
  });
  return nestedDestination ?? flatDestination;
}

export function normalizeLiftOrderLookupPayload(payload: unknown): NormalizedLiftOrder | null {
  const payloadRecord = asRecord(payload);
  const rows = Array.isArray(payload)
    ? payload
    : payloadRecord && Array.isArray(payloadRecord.rowset)
      ? payloadRecord.rowset
      : [];
  const header = asRecord(rows[0]);
  if (!header) {
    return null;
  }

  const headerStep = resolveLiftStep(value(header, "ORDER_STEP_ID"), value(header, "HEADER_STEP_NUMBER"));
  const statusLabel = value(header, "ORDER_STATUS");
  const lines = Array.isArray(header.LINES) ? header.LINES : [];

  return {
    order_number: value(header, "ORDER_NUMBER") == null ? null : String(value(header, "ORDER_NUMBER")),
    customer_id: value(header, "CUSTOMER_ID"),
    customer_name: value(header, "CUSTOMER_NAME") == null ? null : String(value(header, "CUSTOMER_NAME")),
    order_title: value(header, "ORDER_TITLE") == null ? null : String(value(header, "ORDER_TITLE")),
    po_number: firstText(header, "PO_NUMBER", "PO_NO"),
    contract_number: firstText(header, "CONTRACT_NUMBER", "CONTRACT_NO"),
    order_type: value(header, "ORDER_TYPE_NAME") == null ? null : String(value(header, "ORDER_TYPE_NAME")),
    created_by: value(header, "CREATED_BY") == null ? null : String(value(header, "CREATED_BY")),
    creation_date: value(header, "CREATION_DATE") == null ? null : String(value(header, "CREATION_DATE")),
    requested_ship_date: firstText(header, "SHIP_DATE", "REQUESTED_SHIP_DATE"),
    due_date: firstText(header, "DUE_DATE", "DELIVERY_DATE"),
    actual_ship_date: firstText(header, "ACTUAL_SHIP_DATE"),
    shipping: liftDestination(header),
    status: statusLabel || headerStep
      ? {
          label: statusLabel == null ? headerStep?.order_status ?? "Status pending" : String(statusLabel),
          code: headerStep?.order_status_code ?? null,
          color: headerStep?.order_status_color ?? null,
          step: headerStep
        }
      : null,
    lines: lines.flatMap((lineValue, index) => {
      const line = asRecord(lineValue);
      if (!line) {
        return [];
      }
      return [{
        line_number: numericValue(line, "LINE_NUMBER") ?? index + 1,
        order_line_id: value(line, "ORDER_LINE_ID"),
        quantity: numericValue(line, "QUANTITY"),
        product_name: value(line, "PRODUCT_NAME") == null ? null : String(value(line, "PRODUCT_NAME")),
        unit_number: value(line, "UNIT_NUMBER") == null ? null : String(value(line, "UNIT_NUMBER")),
        material: value(line, "MATERIAL") == null ? null : String(value(line, "MATERIAL")),
        final_height: numericValue(line, "PRINT_H_IN"),
        final_width: numericValue(line, "PRINT_W_IN"),
        step: resolveLiftStep(value(line, "LINE_STEP_ID"), value(line, "LINE_STEP_NUMBER"))
      }];
    })
  };
}

export function stepProgressIndex(step: LiftStepDefinition | null) {
  if (!step) {
    return -1;
  }
  const exactIndex = standardGraphicsRail.findIndex((candidate) => candidate.step_id === step.step_id);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const currentNumber = Number(step.step_number);
  if (!Number.isFinite(currentNumber)) {
    return -1;
  }
  let completedIndex = -1;
  standardGraphicsRail.forEach((candidate, index) => {
    const candidateNumber = Number(candidate.step_number);
    if (Number.isFinite(candidateNumber) && candidateNumber <= currentNumber) {
      completedIndex = index;
    }
  });
  return completedIndex;
}

export interface OrderRollupProof {
  proof_filename?: string | null;
  proof_approval_status?: string | null;
  proof_link_low?: string | null;
  proof_link_high?: string | null;
  creation_date?: string | null;
  preview_kind?: "image" | "pdf" | "download" | "unavailable";
  proof_state?: "waiting" | "pending" | "revised" | "approved" | "reference" | "cancelled" | "missing" | "error";
}

export interface OrderRollupProofSummary {
  source: "proof_cache";
  health: "active" | "complete" | "missing" | "stale" | "error";
  pending: number;
  regenerating: number;
  waiting: number;
  reviewed: number;
  total: number;
  review_required: boolean;
  last_synced_at: string;
  decisions_enabled: false;
}

export interface OrderRollupPackage {
  tracking_number?: string | null;
  ship_method?: string | null;
  tracker_message?: string | null;
  box_number?: string | number | null;
  package_type?: string | null;
  location_name?: string | null;
}

export interface OrderRollupShipmentSummary {
  source: "package_details";
  state: "pending" | "activity_recorded" | "tracking_available";
  package_count: number;
  tracking_count: number;
  methods: string[];
  locations: string[];
  status_messages: string[];
}

function boundedPackageText(valueToNormalize: unknown, maximumLength: number) {
  if (typeof valueToNormalize !== "string" && typeof valueToNormalize !== "number") {
    return null;
  }
  const normalized = String(valueToNormalize).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

/** Customer-facing package allowlist. Internal shipment IDs, rates, dimensions,
 * weights, account data, and unknown fields never cross this projection. */
export function toCustomerSafeOrderRollupPackage(pkg: unknown): OrderRollupPackage {
  const record = asRecord(pkg) ?? {};
  return {
    tracking_number: boundedPackageText(record.tracking_number, 100),
    ship_method: boundedPackageText(record.ship_method, 100),
    tracker_message: boundedPackageText(record.tracker_message, 240),
    box_number: boundedPackageText(record.box_number, 40),
    package_type: boundedPackageText(record.package_type, 100),
    location_name: boundedPackageText(record.location_name, 160)
  };
}

function uniquePackageValues(values: Array<string | null | undefined>, maximumItems: number) {
  return [...new Set(values.filter((candidate): candidate is string => Boolean(candidate)))].slice(0, maximumItems);
}

export function buildOrderRollupShipmentSummary(lines: readonly OrderRollupLine[]): OrderRollupShipmentSummary {
  const packages = lines.flatMap((line) => line.packages.map(toCustomerSafeOrderRollupPackage));
  const trackingNumbers = uniquePackageValues(packages.map((pkg) => pkg.tracking_number), Number.MAX_SAFE_INTEGER);
  return {
    source: "package_details",
    state: packages.length === 0 ? "pending" : trackingNumbers.length > 0 ? "tracking_available" : "activity_recorded",
    package_count: packages.length,
    tracking_count: trackingNumbers.length,
    methods: uniquePackageValues(packages.map((pkg) => pkg.ship_method), 4),
    locations: uniquePackageValues(packages.map((pkg) => pkg.location_name), 3),
    status_messages: uniquePackageValues(packages.map((pkg) => pkg.tracker_message), 3)
  };
}

export interface OrderRollupLine {
  line_number: number;
  order_line_id?: string | number | null;
  product_name?: string | null;
  description?: string | null;
  quantity: number | null;
  unit_number?: string | null;
  product_id?: string | number | null;
  material?: string | null;
  final_height?: number | null;
  final_width?: number | null;
  step?: LiftStepDefinition | null;
  proof_count: number;
  package_count: number;
  latest_proof_status: string | null;
  latest_tracking_message: string | null;
  proofs: OrderRollupProof[];
  packages: OrderRollupPackage[];
}

export interface OrderRollupSnapshot {
  order_number: string;
  source_order_id: string;
  customer: {
    source_customer_name: string;
    submit_customer_name: string;
  };
  header: {
    ext_id: string;
    po_number?: string | null;
    order_title?: string | null;
    contract_number?: string | null;
    requested_ship_date?: string | null;
    due_date?: string | null;
    actual_ship_date?: string | null;
    shipping?: OrderRollupDestination | null;
    field_sources?: {
      po_number?: OrderRollupHeaderFieldSource;
      contract_number?: OrderRollupHeaderFieldSource;
      order_title?: OrderRollupHeaderFieldSource;
      requested_ship_date?: OrderRollupHeaderFieldSource;
      due_date?: OrderRollupHeaderFieldSource;
      actual_ship_date?: OrderRollupHeaderFieldSource;
      shipping?: OrderRollupHeaderFieldSource;
    };
  };
  live_order?: NormalizedLiftOrder | null;
  order_status?: NormalizedLiftOrder["status"];
  proof_summary?: OrderRollupProofSummary | null;
  shipment_summary?: OrderRollupShipmentSummary | null;
  lines: OrderRollupLine[];
  issues: Array<{ source: string; severity: "warning" | "error"; message: string }>;
  refreshed_at: string;
}
