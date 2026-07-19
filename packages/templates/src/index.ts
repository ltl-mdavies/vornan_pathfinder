import {
  canonicalFieldPaths,
  type CanonicalFieldPath,
  type CanonicalOrder,
  type CanonicalOrderLine,
  type Contact,
  type ShippingAddress,
  type ValidationMessage
} from "@pathfinder/canonical";
import type * as XLSX from "xlsx";

export interface SourceGrid {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

export interface ParsedSourceRow {
  sheet_name: string;
  row_number: number;
  row_type: "order" | "reference";
  values: Record<string, string | number | boolean | null>;
}

export interface ParsedWorkbookSheet {
  sheet_name: string;
  columns: string[];
  order_row_count: number;
  reference_row_count: number;
  parsed_rows: ParsedSourceRow[];
  header_row?: number | null;
  header_row_count?: 1 | 2;
  ignored_header_rows?: number[];
}

export interface FieldMapping {
  sourceColumn: string;
  targetField: string;
  required?: boolean;
}

export interface InputTemplate {
  template_id: string;
  name: string;
  version: string;
  customer_id: string;
  status: "Draft" | "Published" | "Archived";
  mappings: FieldMapping[];
}

export const canonicalTargetFields = canonicalFieldPaths;

export type CanonicalTargetField = CanonicalFieldPath;

export const momentaraTemplateSeed: InputTemplate = {
  template_id: "template_momentara_xlsx_v1",
  name: "Momentara XLSX Upload",
  version: "1.0.0",
  customer_id: "customer_momentara",
  status: "Draft",
  mappings: [
    { sourceColumn: "Order Number", targetField: "order.external_order_id", required: true },
    { sourceColumn: "PO Number", targetField: "order.po_number" },
    { sourceColumn: "Contract Number", targetField: "order.contract_number" },
    { sourceColumn: "SKU", targetField: "lines[].customer_sku", required: true },
    { sourceColumn: "Quantity", targetField: "lines[].quantity", required: true }
  ]
};

export interface ParsedWorkbook extends SourceGrid {
  sheetName: string;
  sheetNames: string[];
  source_sheets: ParsedWorkbookSheet[];
  parsed_order_rows: ParsedSourceRow[];
  reference_rows: ParsedSourceRow[];
}

export interface WorkbookSheetHeaderOverride {
  headerRow: number | null;
  headerRowCount: 1 | 2;
}

export interface WorkbookParseOptions {
  preferredSheetName?: string;
  headerRow?: number | null;
  headerRowCount?: 1 | 2;
  quantityColumn?: string | null;
  ignoreRepeatedHeaders?: boolean;
  referenceRowsMode?: "rows_without_quantity" | "ignore";
  sheetHeaderOverrides?: Record<string, WorkbookSheetHeaderOverride>;
}

export interface CanonicalBuildOptions {
  customerId: string;
  customerName: string;
  customerCrmId?: string | null;
  destinationCustomerId?: string;
  sourceSystem: string;
  sourceCustomer: string;
  sourceTemplate?: string | null;
  targetSystem: string;
  submittedAt?: string;
}

export type OrderNameResolutionStrategy = "provided" | "composite" | "provided_then_composite";
export type OrderNameResolutionCase = "preserve" | "upper" | "lower";
export type OrderNameComponentFormat = "none" | "yyyyMMdd";

export interface OrderNameResolutionComponent {
  field: string;
  format: OrderNameComponentFormat;
  optional: boolean;
}

export interface OrderNameResolutionConfig {
  enabled: boolean;
  strategy: OrderNameResolutionStrategy;
  provided_field: string;
  components: OrderNameResolutionComponent[];
  prefix: string;
  suffix: string;
  separator: string;
  case: OrderNameResolutionCase;
  max_length: number | null;
  duplicate_behavior: "block";
}

export interface OrderNameResolutionResult {
  value: string | null;
  source: "provided" | "composite" | "missing";
  provided_value: string | null;
  component_values: Array<{
    field: string;
    value: string | null;
    optional: boolean;
  }>;
  missing_required_fields: string[];
  exceeds_max_length: boolean;
}

export function createDefaultOrderNameResolutionConfig(): OrderNameResolutionConfig {
  return {
    enabled: true,
    strategy: "provided_then_composite",
    provided_field: "order.order_title",
    components: [
      { field: "customer.destination_customer_id", format: "none", optional: false },
      { field: "order.external_order_id", format: "none", optional: false },
      { field: "order.ship_date", format: "yyyyMMdd", optional: true }
    ],
    prefix: "",
    suffix: "",
    separator: "-",
    case: "preserve",
    max_length: null,
    duplicate_behavior: "block"
  };
}

export function createLegacyOrderNameResolutionConfig(): OrderNameResolutionConfig {
  return {
    ...createDefaultOrderNameResolutionConfig(),
    enabled: false,
    strategy: "provided",
    components: []
  };
}

export function normalizeOrderNameResolutionConfig(
  config: Partial<OrderNameResolutionConfig> | null | undefined,
  fallback = createDefaultOrderNameResolutionConfig()
): OrderNameResolutionConfig {
  const source = config ?? {};
  const strategy =
    source.strategy === "provided" || source.strategy === "composite" || source.strategy === "provided_then_composite"
      ? source.strategy
      : fallback.strategy;
  const resolutionCase =
    source.case === "upper" || source.case === "lower" || source.case === "preserve"
      ? source.case
      : fallback.case;
  const maxLength =
    typeof source.max_length === "number" && Number.isFinite(source.max_length) && source.max_length > 0
      ? Math.min(512, Math.round(source.max_length))
      : source.max_length === null
        ? null
        : fallback.max_length;
  const rawComponents = Array.isArray(source.components) ? source.components : fallback.components;
  const components: OrderNameResolutionComponent[] = rawComponents
    .filter((component): component is OrderNameResolutionComponent => Boolean(component && typeof component.field === "string"))
    .map((component) => ({
      field: component.field.trim(),
      format: component.format === "yyyyMMdd" ? ("yyyyMMdd" as const) : ("none" as const),
      optional: Boolean(component.optional)
    }))
    .filter(
      (component, index, allComponents) =>
        component.field && allComponents.findIndex((candidate) => candidate.field === component.field) === index
    );

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    strategy,
    provided_field:
      typeof source.provided_field === "string" && source.provided_field.trim()
        ? source.provided_field.trim()
        : fallback.provided_field,
    components,
    prefix: typeof source.prefix === "string" ? source.prefix.trim() : fallback.prefix,
    suffix: typeof source.suffix === "string" ? source.suffix.trim() : fallback.suffix,
    separator: typeof source.separator === "string" ? source.separator.slice(0, 8) : fallback.separator,
    case: resolutionCase,
    max_length: maxLength,
    duplicate_behavior: "block"
  };
}

function nestedCanonicalValue(order: CanonicalOrder, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, order);
}

function formatOrderNameDate(value: string) {
  const directMatch = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (directMatch) {
    return `${directMatch[1]}${directMatch[2].padStart(2, "0")}${directMatch[3].padStart(2, "0")}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `${parsed.getUTCFullYear()}${String(parsed.getUTCMonth() + 1).padStart(2, "0")}${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function formatOrderNameComponent(value: unknown, format: OrderNameComponentFormat) {
  const normalized = valueAsString(value).replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return format === "yyyyMMdd" ? formatOrderNameDate(normalized) : normalized;
}

function applyOrderNameCase(value: string, resolutionCase: OrderNameResolutionCase) {
  if (resolutionCase === "upper") {
    return value.toUpperCase();
  }
  if (resolutionCase === "lower") {
    return value.toLowerCase();
  }
  return value;
}

export function resolveOrderName(
  order: CanonicalOrder,
  rawConfig: Partial<OrderNameResolutionConfig> | null | undefined
): OrderNameResolutionResult {
  const config = normalizeOrderNameResolutionConfig(rawConfig);
  const providedValue = formatOrderNameComponent(nestedCanonicalValue(order, config.provided_field), "none") || null;
  const componentValues = config.components.map((component) => ({
    field: component.field,
    value: formatOrderNameComponent(nestedCanonicalValue(order, component.field), component.format) || null,
    optional: component.optional
  }));
  if (!config.enabled) {
    return {
      value: providedValue,
      source: providedValue ? "provided" : "missing",
      provided_value: providedValue,
      component_values: componentValues,
      missing_required_fields: [],
      exceeds_max_length: false
    };
  }
  const missingRequiredFields = componentValues
    .filter((component) => !component.optional && !component.value)
    .map((component) => component.field);
  const useProvided = Boolean(providedValue) && config.strategy !== "composite";
  const useComposite = config.strategy === "composite" || (config.strategy === "provided_then_composite" && !providedValue);
  const baseParts = useProvided
    ? [providedValue as string]
    : useComposite && missingRequiredFields.length === 0
      ? componentValues.flatMap((component) => (component.value ? [component.value] : []))
      : [];
  const parts = [config.prefix, ...baseParts, config.suffix].filter(Boolean);
  const value = baseParts.length ? applyOrderNameCase(parts.join(config.separator), config.case) : null;

  return {
    value,
    source: useProvided ? "provided" : value ? "composite" : "missing",
    provided_value: providedValue,
    component_values: componentValues,
    missing_required_fields: useComposite ? missingRequiredFields : [],
    exceeds_max_length: Boolean(value && config.max_length && value.length > config.max_length)
  };
}

export function applyOrderNameResolution(
  order: CanonicalOrder,
  config: Partial<OrderNameResolutionConfig> | null | undefined
) {
  const result = resolveOrderName(order, config);
  const normalizedConfig = normalizeOrderNameResolutionConfig(config);
  return {
    canonical_order: {
      ...order,
      order: {
        ...order.order,
        order_title: normalizedConfig.enabled ? result.value : order.order.order_title ?? null
      }
    } satisfies CanonicalOrder,
    result
  };
}

export function validateOrderNameResolution(
  result: OrderNameResolutionResult,
  config: Partial<OrderNameResolutionConfig> | null | undefined
): ValidationMessage[] {
  const normalizedConfig = normalizeOrderNameResolutionConfig(config);
  if (!normalizedConfig.enabled) {
    return [];
  }
  if (!result.value) {
    const missingDetail = result.missing_required_fields.length
      ? ` Missing required composite fields: ${result.missing_required_fields.join(", ")}.`
      : "";
    return [
      {
        severity: "FAIL",
        code: "ORDER_NAME_MISSING",
        object: "Order",
        field: "order.order_title",
        message: `Order Name Resolution did not produce a value.${missingDetail}`,
        suggested_action: "Map a customer order title or complete the configured composite fields."
      }
    ];
  }

  if (result.exceeds_max_length) {
    return [
      {
        severity: "FAIL",
        code: "ORDER_NAME_TOO_LONG",
        object: "Order",
        field: "order.order_title",
        message: `Resolved order name is ${result.value.length} characters; this method allows ${normalizedConfig.max_length}.`,
        suggested_action: "Shorten the configured prefix, suffix, or composite components."
      }
    ];
  }

  return [
    {
      severity: "PASS",
      code: "ORDER_NAME_RESOLVED",
      object: "Order",
      field: "order.order_title",
      message: `Resolved from ${result.source === "provided" ? "the customer-provided title" : "the configured composite"}.`
    }
  ];
}

export function findDuplicateOrderNames(results: OrderNameResolutionResult[]) {
  const seen = new Map<string, number[]>();
  results.forEach((result, index) => {
    if (!result.value) {
      return;
    }
    const key = result.value.trim().toLocaleLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), index]);
  });
  return Array.from(seen.entries())
    .filter(([, indexes]) => indexes.length > 1)
    .map(([normalized_name, indexes]) => ({ normalized_name, indexes }));
}

const sourceColumnAliases: Record<string, CanonicalTargetField> = {
  "first name": "contacts[].first_name",
  firstname: "contacts[].first_name",
  "last name": "contacts[].last_name",
  lastname: "contacts[].last_name",
  title: "contacts[].title",
  "contact title": "contacts[].title",
  email: "contacts[].email",
  "email address": "contacts[].email",
  "mobile phone": "contacts[].mobile_phone",
  mobile: "contacts[].mobile_phone",
  "cell phone": "contacts[].mobile_phone",
  "office phone": "contacts[].office_phone",
  "work phone": "contacts[].office_phone",
  "home phone": "contacts[].home_phone",
  slack: "contacts[].slack",
  fax: "contacts[].fax",
  "crm id": "customer.crm_id",
  crmid: "customer.crm_id",
  "customer crm id": "customer.crm_id",
  "order number": "order.external_order_id",
  "order #": "order.external_order_id",
  "external order id": "order.external_order_id",
  "ext id": "order.external_order_id",
  "po number": "order.po_number",
  "po #": "order.po_number",
  "purchase order": "order.po_number",
  "contract number": "order.contract_number",
  "contract #": "order.contract_number",
  "order title": "order.order_title",
  campaign: "order.order_title",
  "due date": "order.due_date",
  due: "order.due_date",
  "order attachment": "order.order_attachment",
  attachment: "order.order_attachment",
  "source attachment": "order.order_attachment",
  "import file": "order.order_attachment",
  "ship date": "order.ship_date",
  "requested ship date": "order.ship_date",
  "ship method": "order.shipping.method",
  "shipping method": "order.shipping.method",
  "billing zip": "order.shipping.acct_billing_zip",
  "account billing zip": "order.shipping.acct_billing_zip",
  "acct billing zip": "order.shipping.acct_billing_zip",
  "billing country": "order.shipping.acct_billing_country",
  "account billing country": "order.shipping.acct_billing_country",
  "acct billing country": "order.shipping.acct_billing_country",
  attention: "order.shipping.attention_to",
  "attention to": "order.shipping.attention_to",
  "ship to company": "order.shipping.company",
  company: "order.shipping.company",
  "address 1": "order.shipping.address_1",
  address1: "order.shipping.address_1",
  "address 2": "order.shipping.address_2",
  address2: "order.shipping.address_2",
  city: "order.shipping.city",
  state: "order.shipping.state",
  zip: "order.shipping.postal_code",
  "postal code": "order.shipping.postal_code",
  country: "order.shipping.country",
  sku: "lines[].customer_sku",
  "customer sku": "lines[].customer_sku",
  "unit number": "lines[].unit_number",
  unit: "lines[].unit_number",
  description: "lines[].description",
  "product id": "lines[].product_id",
  productid: "lines[].product_id",
  "product name": "lines[].product_name",
  product: "lines[].product_name",
  quantity: "lines[].quantity",
  qty: "lines[].quantity",
  "print qty": "lines[].quantity",
  width: "lines[].dimensions.final_width",
  "final width": "lines[].dimensions.final_width",
  "final size width": "lines[].dimensions.final_width",
  height: "lines[].dimensions.final_height",
  "final height": "lines[].dimensions.final_height",
  length: "lines[].dimensions.final_height",
  "final length": "lines[].dimensions.final_height",
  "final size length": "lines[].dimensions.final_height",
  "live width": "lines[].dimensions.live_width",
  "live height": "lines[].dimensions.live_height",
  bleed: "lines[].dimensions.bleed",
  "art file": "lines[].artwork.file_name",
  "artwork file": "lines[].artwork.file_name",
  "art url": "lines[].artwork.file_url",
  "artwork url": "lines[].artwork.file_url",
  material: "lines[].production.material",
  stock: "lines[].production.material",
  print: "lines[].production.ink",
  laminate: "lines[].production.laminate",
  coating: "lines[].production.coating",
  premask: "lines[].production.premask",
  ink: "lines[].production.ink",
  finishing: "lines[].line_note",
  note: "lines[].line_note",
  notes: "lines[].line_note",
  "line note": "lines[].line_note"
};

export const sampleSourceGrid: SourceGrid = {
  columns: ["Order Number", "PO Number", "SKU", "Qty", "Product Name", "Width", "Height", "Ship Method"],
  rows: [
    {
      "Order Number": "AS360-30904511",
      "PO Number": "1122334455",
      SKU: "OOH-2SHEET-46X60",
      Qty: 1,
      "Product Name": "2 Sheet Poster",
      Width: 60.2,
      Height: 46.2,
      "Ship Method": "UPS Ground"
    },
    {
      "Order Number": "AS360-30904511",
      "PO Number": "1122334455",
      SKU: "OOH-BANNER-36X96",
      Qty: 2,
      "Product Name": "Vinyl Banner",
      Width: 96,
      Height: 36,
      "Ship Method": "UPS Ground"
    }
  ]
};

function normalizeColumnName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeAlias(value: string) {
  return normalizeColumnName(value).toLowerCase();
}

function deduplicateColumnNames(columns: string[]) {
  const seen = new Map<string, number>();
  return columns.map((column, index) => {
    const base = normalizeColumnName(column) || `Column ${index + 1}`;
    const key = base.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? base : `${base} ${count}`;
  });
}

function cellToPrimitive(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value);
}

function hasAnyValue(row: Record<string, string | number | boolean | null>) {
  return Object.values(row).some((value) => value !== null && String(value).trim() !== "");
}

const embeddedHeaderAliases = new Set(
  [
    "contract #",
    "description",
    "creative",
    "sign type",
    "formatting size",
    "final size width",
    "final size length",
    "stock",
    "print",
    "finishing",
    "print qty",
    "ship date",
    "delivery date",
    "media type",
    "campaign start date",
    "notes",
    "hardware",
    "ps sku",
    "item sku",
    "ps part number",
    "qty needed",
    "order information",
    "line items",
    "product information",
    "shipping information",
    "ship to",
    "bill to",
    "dimensions",
    "artwork",
    "production",
    "required",
    "optional"
  ].map(normalizeAlias)
);

const knownHeaderAliases = new Set([...Object.keys(sourceColumnAliases).map(normalizeAlias), ...embeddedHeaderAliases]);

function headerColumnsForRows(matrix: unknown[][], headerIndex: number, headerRowCount: 1 | 2) {
  const headerRows = matrix.slice(headerIndex, headerIndex + headerRowCount);
  const width = Math.max(0, ...headerRows.map((row) => row.length));

  if (headerRowCount === 1) {
    return deduplicateColumnNames(
      Array.from({ length: width }, (_, columnIndex) => {
        const value = cellToPrimitive(headerRows[0]?.[columnIndex]);
        return value === null ? `Column ${columnIndex + 1}` : valueAsString(value);
      })
    );
  }

  const topValues: Array<string | null> = [];
  let carriedTopValue: string | null = null;

  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    const value = cellToPrimitive(headerRows[0]?.[columnIndex]);
    if (value !== null) {
      carriedTopValue = valueAsString(value);
    }
    topValues.push(carriedTopValue);
  }

  const lowerValues = Array.from({ length: width }, (_, columnIndex) => {
    const value = cellToPrimitive(headerRows[1]?.[columnIndex]);
    return value === null ? null : valueAsString(value);
  });
  const lowerCounts = new Map<string, number>();
  lowerValues.forEach((value) => {
    const normalized = normalizeAlias(value ?? "");
    if (normalized) {
      lowerCounts.set(normalized, (lowerCounts.get(normalized) ?? 0) + 1);
    }
  });

  const columns = lowerValues.map((lowerValue, index) => {
    const topValue = topValues[index];
    const combined = topValue && lowerValue && normalizeAlias(topValue) !== normalizeAlias(lowerValue)
      ? `${topValue} ${lowerValue}`
      : lowerValue ?? topValue;
    const normalizedLower = normalizeAlias(lowerValue ?? "");
    const normalizedCombined = normalizeAlias(combined ?? "");

    if (lowerValue && knownHeaderAliases.has(normalizedLower) && lowerCounts.get(normalizedLower) === 1) {
      return lowerValue;
    }
    if (combined && knownHeaderAliases.has(normalizedCombined)) {
      return combined;
    }
    if (lowerValue && lowerCounts.get(normalizedLower) === 1) {
      return lowerValue;
    }
    return combined ?? `Column ${index + 1}`;
  });

  return deduplicateColumnNames(columns);
}

function headerCandidateScore(matrix: unknown[][], headerIndex: number, headerRowCount: 1 | 2) {
  const columns = headerColumnsForRows(matrix, headerIndex, headerRowCount);
  const namedColumns = columns.filter((column) => !/^Column \d+(?: \d+)?$/.test(column));
  if (namedColumns.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const recognizedColumns = namedColumns.filter((column) => knownHeaderAliases.has(normalizeAlias(column))).length;
  const headerCells = matrix
    .slice(headerIndex, headerIndex + headerRowCount)
    .flatMap((row) => row.map(cellToPrimitive))
    .filter((value) => value !== null);
  const textCells = headerCells.filter((value) => typeof value === "string").length;
  const numericCells = headerCells.filter((value) => typeof value === "number").length;
  const recognizedCells = headerCells.filter((value) => knownHeaderAliases.has(normalizeAlias(valueAsString(value)))).length;
  const dataLikeCells = headerCells.filter((value) => {
    const text = valueAsString(value);
    return /\d/.test(text) && !knownHeaderAliases.has(normalizeAlias(text));
  }).length;
  const nextPopulatedRow = matrix
    .slice(headerIndex + headerRowCount)
    .find((row) => row.some((cell) => cellToPrimitive(cell) !== null));
  const nextValueCount = nextPopulatedRow?.filter((cell) => cellToPrimitive(cell) !== null).length ?? 0;
  const compatibleDataBonus = nextValueCount > 0 && nextValueCount <= columns.length + 2 ? 3 : 0;
  const singleColumnPenalty = namedColumns.length === 1 ? 6 : 0;

  return (
    recognizedColumns * 10 +
    recognizedCells * 4 +
    namedColumns.length * 2 +
    textCells * 0.5 -
    numericCells * 2 +
    dataLikeCells * -2 +
    compatibleDataBonus -
    singleColumnPenalty -
    headerIndex * 0.05
  );
}

function detectHeaderIndex(matrix: unknown[][], headerRow: number | null | undefined, headerRowCount: 1 | 2) {
  if (
    typeof headerRow === "number" &&
    headerRow > 0 &&
    matrix[headerRow - 1]?.some((cell) => cellToPrimitive(cell) !== null)
  ) {
    return headerRow - 1;
  }

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const candidateCount = Math.min(matrix.length, 25);
  for (let index = 0; index < candidateCount; index += 1) {
    const score = headerCandidateScore(matrix, index, headerRowCount);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  return bestIndex;
}

function isLikelyRepeatedHeader(row: Record<string, string | number | boolean | null>) {
  let exactColumnMatches = 0;
  let headerLikeMatches = 0;
  let populatedValues = 0;
  Object.entries(row).forEach(([column, value]) => {
    const normalizedValue = normalizeAlias(valueAsString(value));
    if (!normalizedValue) {
      return;
    }
    populatedValues += 1;

    const normalizedColumn = normalizeAlias(column);
    if (normalizedValue === normalizedColumn) {
      exactColumnMatches += 1;
    }
    if (normalizedValue === normalizedColumn || embeddedHeaderAliases.has(normalizedValue)) {
      headerLikeMatches += 1;
    }
  });
  return exactColumnMatches >= 2 || headerLikeMatches >= 3 || (headerLikeMatches >= 2 && headerLikeMatches === populatedValues);
}

function isValidQuantity(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase().includes("qty")) {
      return false;
    }
    const parsed = Number.parseFloat(trimmed.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) && parsed > 0;
  }

  return false;
}

function findQuantityColumn(columns: string[]) {
  return (
    columns.find((column) => normalizeAlias(column) === "print qty") ??
    columns.find((column) => ["quantity", "qty"].includes(normalizeAlias(column))) ??
    null
  );
}

function parseWorksheetRows(
  xlsx: typeof XLSX,
  workbook: XLSX.WorkBook,
  sheetName: string,
  options: WorkbookParseOptions = {}
): {
  columns: string[];
  rows: ParsedSourceRow[];
  headerRow: number | null;
  headerRowCount: 1 | 2;
  ignoredHeaderRows: number[];
} {
  const worksheet = workbook.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false
  });
  if (matrix.length === 0) {
    return { columns: [], rows: [], headerRow: null, headerRowCount: options.headerRowCount ?? 1, ignoredHeaderRows: [] };
  }

  const headerRowCount = options.headerRowCount ?? 1;
  const headerIndex = detectHeaderIndex(matrix, options.headerRow, headerRowCount);
  const columns = headerColumnsForRows(matrix, headerIndex, headerRowCount);
  const quantityColumn =
    options.quantityColumn && columns.includes(options.quantityColumn)
      ? options.quantityColumn
      : findQuantityColumn(columns);
  const shouldIgnoreRepeatedHeaders = options.ignoreRepeatedHeaders ?? true;
  const referenceRowsMode = options.referenceRowsMode ?? "rows_without_quantity";
  const ignoredHeaderRows: number[] = [];

  const rows = matrix
    .slice(headerIndex + headerRowCount)
    .map((row, index) => {
      const values = columns.reduce<Record<string, string | number | boolean | null>>((record, column, columnIndex) => {
        record[column] = cellToPrimitive(row[columnIndex]);
        return record;
      }, {});
      const rowNumber = headerIndex + headerRowCount + index + 1;
      const hasQuantity = quantityColumn ? isValidQuantity(values[quantityColumn]) : false;

      return {
        sheet_name: sheetName,
        row_number: rowNumber,
        row_type: hasQuantity ? "order" : "reference",
        values
      } satisfies ParsedSourceRow;
    })
    .filter((row) => hasAnyValue(row.values))
    .filter((row) => {
      if (shouldIgnoreRepeatedHeaders && isLikelyRepeatedHeader(row.values)) {
        ignoredHeaderRows.push(row.row_number);
        return false;
      }
      return true;
    })
    .filter((row) => (referenceRowsMode === "ignore" ? row.row_type === "order" : true));

  return {
    columns,
    rows,
    headerRow: headerIndex + 1,
    headerRowCount,
    ignoredHeaderRows
  };
}

export async function parseWorkbookArrayBuffer(
  buffer: ArrayBuffer,
  preferredSheetNameOrOptions?: string | WorkbookParseOptions
): Promise<ParsedWorkbook> {
  const options =
    typeof preferredSheetNameOrOptions === "string"
      ? { preferredSheetName: preferredSheetNameOrOptions }
      : (preferredSheetNameOrOptions ?? {});
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(buffer, { type: "array", cellDates: true });
  const allSheetRows = workbook.SheetNames.map((candidateSheetName) => {
    const sheetOverride = options.sheetHeaderOverrides?.[candidateSheetName];
    const { columns, rows, headerRow, headerRowCount, ignoredHeaderRows } = parseWorksheetRows(
      xlsx,
      workbook,
      candidateSheetName,
      sheetOverride
        ? {
            ...options,
            headerRow: sheetOverride.headerRow,
            headerRowCount: sheetOverride.headerRowCount
          }
        : options
    );
    return {
      sheet_name: candidateSheetName,
      columns,
      order_row_count: rows.filter((row) => row.row_type === "order").length,
      reference_row_count: rows.filter((row) => row.row_type === "reference").length,
      parsed_rows: rows,
      header_row: headerRow,
      header_row_count: headerRowCount,
      ignored_header_rows: ignoredHeaderRows
    } satisfies ParsedWorkbookSheet;
  });
  const parsedOrderRows = allSheetRows.flatMap((sheet) => sheet.parsed_rows.filter((row) => row.row_type === "order"));
  const referenceRows = allSheetRows.flatMap((sheet) => sheet.parsed_rows.filter((row) => row.row_type === "reference"));
  const preferredSheetName = options.preferredSheetName;
  const preferredSheet = preferredSheetName && workbook.Sheets[preferredSheetName] ? preferredSheetName : null;
  const firstOrderSheet = allSheetRows.find((sheet) => sheet.order_row_count > 0)?.sheet_name ?? null;
  const sheetName = preferredSheet ?? firstOrderSheet ?? workbook.SheetNames[0];

  if (!sheetName) {
    return {
      sheetName: "Empty workbook",
      sheetNames: [],
      columns: [],
      rows: [],
      source_sheets: [],
      parsed_order_rows: [],
      reference_rows: []
    };
  }

  const selectedSheet = allSheetRows.find((sheet) => sheet.sheet_name === sheetName);
  const selectedRows = preferredSheet
    ? (selectedSheet?.parsed_rows ?? [])
    : parsedOrderRows.length
      ? parsedOrderRows
      : (selectedSheet?.parsed_rows ?? []);
  const columns = Array.from(
    new Set((preferredSheet ? selectedSheet?.columns : allSheetRows.flatMap((sheet) => sheet.columns)) ?? [])
  );
  const rows = selectedRows.map((row) => row.values);

  return {
    sheetName,
    sheetNames: workbook.SheetNames,
    columns,
    rows,
    source_sheets: allSheetRows,
    parsed_order_rows: parsedOrderRows,
    reference_rows: referenceRows
  };
}

export function buildDefaultMappings(columns: string[]): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  columns.forEach((sourceColumn) => {
    const targetField = sourceColumnAliases[normalizeAlias(sourceColumn)];
    if (targetField) {
      mappings.push({ sourceColumn, targetField, required: targetField.includes("external_order_id") });
    }
  });

  return mappings;
}

function getMappedValue(
  row: Record<string, string | number | boolean | null>,
  mappings: FieldMapping[],
  targetField: string
) {
  const mapping = mappings.find((candidate) => candidate.targetField === targetField);
  return mapping ? row[mapping.sourceColumn] : null;
}

function valueAsString(value: unknown, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized.length ? normalized : fallback;
}

function valueAsNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function firstMappedValue(
  rows: SourceGrid["rows"],
  mappings: FieldMapping[],
  targetField: string,
  fallback = ""
) {
  for (const row of rows) {
    const value = valueAsString(getMappedValue(row, mappings, targetField));
    if (value) {
      return value;
    }
  }

  return fallback;
}

const builtInCanonicalTargetFields = new Set<string>(canonicalTargetFields);

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split(".").filter(Boolean);
  let cursor: Record<string, unknown> = target;

  segments.forEach((segment, index) => {
    const isLast = index === segments.length - 1;
    if (isLast) {
      cursor[segment] = value;
      return;
    }

    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  });
}

function applySupplementalMapping(
  order: CanonicalOrder,
  row: Record<string, string | number | boolean | null>,
  rowIndex: number,
  mapping: FieldMapping
) {
  if (builtInCanonicalTargetFields.has(mapping.targetField)) {
    return;
  }

  const value = row[mapping.sourceColumn];
  if (value === null || value === undefined || value === "") {
    return;
  }

  if (mapping.targetField.startsWith("lines[].")) {
    const line = order.lines[rowIndex] as unknown as Record<string, unknown> | undefined;
    if (line) {
      setNestedValue(line, mapping.targetField.replace("lines[].", ""), value);
    }
    return;
  }

  if (mapping.targetField.startsWith("contacts[].")) {
    const contacts = (order.contacts ?? []) as Array<Record<string, unknown>>;
    if (!contacts[0]) {
      contacts[0] = {};
    }
    setNestedValue(contacts[0], mapping.targetField.replace("contacts[].", ""), value);
    order.contacts = contacts as CanonicalOrder["contacts"];
    return;
  }

  setNestedValue(order as unknown as Record<string, unknown>, mapping.targetField, value);
}

function buildShipping(rows: SourceGrid["rows"], mappings: FieldMapping[]): ShippingAddress | null {
  const shipping: ShippingAddress = {
    method: firstMappedValue(rows, mappings, "order.shipping.method", "") || null,
    account_number: firstMappedValue(rows, mappings, "order.shipping.account_number", "") || null,
    acct_billing_zip: firstMappedValue(rows, mappings, "order.shipping.acct_billing_zip", "") || null,
    acct_billing_country: firstMappedValue(rows, mappings, "order.shipping.acct_billing_country", "") || null,
    attention_to: firstMappedValue(rows, mappings, "order.shipping.attention_to", "") || null,
    company: firstMappedValue(rows, mappings, "order.shipping.company", "") || null,
    address_1: firstMappedValue(rows, mappings, "order.shipping.address_1", "") || null,
    address_2: firstMappedValue(rows, mappings, "order.shipping.address_2", "") || null,
    city: firstMappedValue(rows, mappings, "order.shipping.city", "") || null,
    state: firstMappedValue(rows, mappings, "order.shipping.state", "") || null,
    postal_code: firstMappedValue(rows, mappings, "order.shipping.postal_code", "") || null,
    country: firstMappedValue(rows, mappings, "order.shipping.country", "US") || null,
    phone: firstMappedValue(rows, mappings, "order.shipping.phone", "") || null,
    email: firstMappedValue(rows, mappings, "order.shipping.email", "") || null,
    instructions: firstMappedValue(rows, mappings, "order.shipping.instructions", "") || null
  };

  return Object.values(shipping).some(Boolean) ? shipping : null;
}

function buildContact(rows: SourceGrid["rows"], mappings: FieldMapping[]): Contact[] {
  const contact: Contact = {
    first_name: firstMappedValue(rows, mappings, "contacts[].first_name", "") || null,
    last_name: firstMappedValue(rows, mappings, "contacts[].last_name", "") || null,
    title: firstMappedValue(rows, mappings, "contacts[].title", "") || null,
    email: firstMappedValue(rows, mappings, "contacts[].email", "") || null,
    mobile_phone: firstMappedValue(rows, mappings, "contacts[].mobile_phone", "") || null,
    office_phone: firstMappedValue(rows, mappings, "contacts[].office_phone", "") || null,
    home_phone: firstMappedValue(rows, mappings, "contacts[].home_phone", "") || null,
    slack: firstMappedValue(rows, mappings, "contacts[].slack", "") || null,
    fax: firstMappedValue(rows, mappings, "contacts[].fax", "") || null
  };

  return Object.values(contact).some(Boolean) ? [contact] : [];
}

function buildLineShipping(row: Record<string, string | number | boolean | null>, mappings: FieldMapping[]): ShippingAddress | null {
  const shipping: ShippingAddress = {
    method: valueAsString(getMappedValue(row, mappings, "lines[].shipping.method")) || null,
    account_number: valueAsString(getMappedValue(row, mappings, "lines[].shipping.account_number")) || null,
    acct_billing_zip: valueAsString(getMappedValue(row, mappings, "lines[].shipping.acct_billing_zip")) || null,
    acct_billing_country: valueAsString(getMappedValue(row, mappings, "lines[].shipping.acct_billing_country")) || null,
    attention_to: valueAsString(getMappedValue(row, mappings, "lines[].shipping.attention_to")) || null,
    company: valueAsString(getMappedValue(row, mappings, "lines[].shipping.company")) || null,
    address_1: valueAsString(getMappedValue(row, mappings, "lines[].shipping.address_1")) || null,
    address_2: valueAsString(getMappedValue(row, mappings, "lines[].shipping.address_2")) || null,
    city: valueAsString(getMappedValue(row, mappings, "lines[].shipping.city")) || null,
    state: valueAsString(getMappedValue(row, mappings, "lines[].shipping.state")) || null,
    postal_code: valueAsString(getMappedValue(row, mappings, "lines[].shipping.postal_code")) || null,
    country: valueAsString(getMappedValue(row, mappings, "lines[].shipping.country")) || null,
    phone: valueAsString(getMappedValue(row, mappings, "lines[].shipping.phone")) || null,
    email: valueAsString(getMappedValue(row, mappings, "lines[].shipping.email")) || null,
    instructions: valueAsString(getMappedValue(row, mappings, "lines[].shipping.instructions")) || null
  };

  return Object.values(shipping).some(Boolean) ? shipping : null;
}

function buildLine(
  row: Record<string, string | number | boolean | null>,
  mappings: FieldMapping[],
  index: number
): CanonicalOrderLine {
  const sku = valueAsString(getMappedValue(row, mappings, "lines[].customer_sku"));
  const unitNumber = valueAsString(getMappedValue(row, mappings, "lines[].unit_number"), sku || `line_${index + 1}`);
  const productName = valueAsString(getMappedValue(row, mappings, "lines[].product_name"));
  const description = valueAsString(getMappedValue(row, mappings, "lines[].description"), productName);

  return {
    line_number: index + 1,
    unit_number: unitNumber,
    customer_sku: sku || null,
    description: description || null,
    product_id: valueAsString(getMappedValue(row, mappings, "lines[].product_id")) || null,
    product_name: productName || description || null,
    quantity: Math.max(1, Math.round(valueAsNumber(getMappedValue(row, mappings, "lines[].quantity"), 1))),
    artwork: {
      file_name: valueAsString(getMappedValue(row, mappings, "lines[].artwork.file_name")) || null,
      file_url: valueAsString(getMappedValue(row, mappings, "lines[].artwork.file_url")) || null,
      checksum: null
    },
    dimensions: {
      final_width: valueAsNumber(getMappedValue(row, mappings, "lines[].dimensions.final_width"), 0),
      final_height: valueAsNumber(getMappedValue(row, mappings, "lines[].dimensions.final_height"), 0),
      live_width: valueAsNumber(getMappedValue(row, mappings, "lines[].dimensions.live_width"), 0) || null,
      live_height: valueAsNumber(getMappedValue(row, mappings, "lines[].dimensions.live_height"), 0) || null,
      bleed: valueAsNumber(getMappedValue(row, mappings, "lines[].dimensions.bleed"), 0) || null
    },
    production: {
      material: valueAsString(getMappedValue(row, mappings, "lines[].production.material")) || null,
      laminate: valueAsString(getMappedValue(row, mappings, "lines[].production.laminate")) || null,
      coating: valueAsString(getMappedValue(row, mappings, "lines[].production.coating")) || null,
      premask: valueAsString(getMappedValue(row, mappings, "lines[].production.premask")) || null,
      ink: valueAsString(getMappedValue(row, mappings, "lines[].production.ink")) || null
    },
    shipping: buildLineShipping(row, mappings),
    line_note: valueAsString(getMappedValue(row, mappings, "lines[].line_note")) || null
  };
}

export function mapSourceRowsToCanonicalOrder(
  rows: SourceGrid["rows"],
  mappings: FieldMapping[],
  options: CanonicalBuildOptions
): CanonicalOrder {
  const firstOrderId = firstMappedValue(rows, mappings, "order.external_order_id", "UNMAPPED-ORDER");
  const poNumber = firstMappedValue(rows, mappings, "order.po_number", "");
  const contractNumber = firstMappedValue(rows, mappings, "order.contract_number", "");

  const order: CanonicalOrder = {
    customer: {
      customer_id: options.customerId,
      customer_name: options.customerName,
      destination_customer_id: options.destinationCustomerId,
      crm_id: firstMappedValue(rows, mappings, "customer.crm_id", options.customerCrmId ?? "") || null
    },
    contacts: buildContact(rows, mappings),
    source: {
      source_system: options.sourceSystem,
      source_customer: options.sourceCustomer,
      source_record_id: firstOrderId,
      source_record_url: null,
      source_template: options.sourceTemplate ?? null,
      submitted_at: options.submittedAt ?? new Date().toISOString()
    },
    target: {
      target_system: options.targetSystem
    },
    order: {
      external_order_id: firstOrderId,
      po_number: poNumber || null,
      contract_number: contractNumber || null,
      order_title: firstMappedValue(rows, mappings, "order.order_title", "") || null,
      due_date: firstMappedValue(rows, mappings, "order.due_date", "") || null,
      order_attachment: firstMappedValue(rows, mappings, "order.order_attachment", "") || null,
      ship_date: firstMappedValue(rows, mappings, "order.ship_date", "") || null,
      shipping: buildShipping(rows, mappings)
    },
    lines: rows.map((row, index) => buildLine(row, mappings, index))
  };

  rows.forEach((row, rowIndex) => {
    mappings.forEach((mapping) => applySupplementalMapping(order, row, rowIndex, mapping));
  });

  return order;
}
