import * as XLSX from "xlsx";
import type { CanonicalOrder, CanonicalOrderLine, ShippingAddress } from "@pathfinder/canonical";

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

export const canonicalTargetFields = [
  "order.external_order_id",
  "order.po_number",
  "order.contract_number",
  "order.order_title",
  "order.ship_date",
  "order.shipping.method",
  "order.shipping.account_number",
  "order.shipping.attention_to",
  "order.shipping.company",
  "order.shipping.address_1",
  "order.shipping.address_2",
  "order.shipping.city",
  "order.shipping.state",
  "order.shipping.postal_code",
  "order.shipping.country",
  "order.shipping.phone",
  "order.shipping.email",
  "order.shipping.instructions",
  "lines[].unit_number",
  "lines[].customer_sku",
  "lines[].description",
  "lines[].product_name",
  "lines[].quantity",
  "lines[].line_number",
  "lines[].dimensions.final_width",
  "lines[].dimensions.final_height",
  "lines[].dimensions.live_width",
  "lines[].dimensions.live_height",
  "lines[].dimensions.bleed",
  "lines[].artwork.file_name",
  "lines[].artwork.file_url",
  "lines[].artwork.checksum",
  "lines[].production.material",
  "lines[].production.laminate",
  "lines[].production.coating",
  "lines[].production.premask",
  "lines[].production.ink",
  "lines[].production.cut_type",
  "lines[].production.hem",
  "lines[].production.grommets",
  "lines[].shipping.method",
  "lines[].shipping.account_number",
  "lines[].shipping.attention_to",
  "lines[].shipping.company",
  "lines[].shipping.address_1",
  "lines[].shipping.address_2",
  "lines[].shipping.city",
  "lines[].shipping.state",
  "lines[].shipping.postal_code",
  "lines[].shipping.country",
  "lines[].shipping.phone",
  "lines[].shipping.email",
  "lines[].shipping.instructions",
  "lines[].line_note"
] as const;

export type CanonicalTargetField = (typeof canonicalTargetFields)[number];

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

export interface CanonicalBuildOptions {
  customerId: string;
  customerName: string;
  destinationCustomerId?: string;
  sourceSystem: string;
  sourceCustomer: string;
  sourceTemplate?: string | null;
  targetSystem: string;
  submittedAt?: string;
}

const sourceColumnAliases: Record<string, CanonicalTargetField> = {
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
  "ship date": "order.ship_date",
  "requested ship date": "order.ship_date",
  "ship method": "order.shipping.method",
  "shipping method": "order.shipping.method",
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

function isLikelyRepeatedHeader(row: Record<string, string | number | boolean | null>) {
  let matches = 0;
  Object.entries(row).forEach(([column, value]) => {
    if (valueAsString(value).toLowerCase() === column.toLowerCase()) {
      matches += 1;
    }
  });
  return matches >= 2;
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
  workbook: XLSX.WorkBook,
  sheetName: string
): { columns: string[]; rows: ParsedSourceRow[] } {
  const worksheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false
  });
  const headerRow = matrix.find((row) => row.some((cell) => cellToPrimitive(cell) !== null)) ?? [];
  const headerIndex = matrix.indexOf(headerRow);
  const columns = headerRow.map((cell, index) => normalizeColumnName(String(cellToPrimitive(cell) ?? `Column ${index + 1}`)));
  const quantityColumn = findQuantityColumn(columns);

  const rows = matrix
    .slice(headerIndex + 1)
    .map((row, index) => {
      const values = columns.reduce<Record<string, string | number | boolean | null>>((record, column, columnIndex) => {
        record[column] = cellToPrimitive(row[columnIndex]);
        return record;
      }, {});
      const rowNumber = headerIndex + index + 2;
      const hasQuantity = quantityColumn ? isValidQuantity(values[quantityColumn]) : false;

      return {
        sheet_name: sheetName,
        row_number: rowNumber,
        row_type: hasQuantity ? "order" : "reference",
        values
      } satisfies ParsedSourceRow;
    })
    .filter((row) => hasAnyValue(row.values) && !isLikelyRepeatedHeader(row.values));

  return { columns, rows };
}

export function parseWorkbookArrayBuffer(buffer: ArrayBuffer, preferredSheetName?: string): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const allSheetRows = workbook.SheetNames.map((candidateSheetName) => {
    const { columns, rows } = parseWorksheetRows(workbook, candidateSheetName);
    return {
      sheet_name: candidateSheetName,
      columns,
      order_row_count: rows.filter((row) => row.row_type === "order").length,
      reference_row_count: rows.filter((row) => row.row_type === "reference").length,
      parsed_rows: rows
    } satisfies ParsedWorkbookSheet;
  });
  const parsedOrderRows = allSheetRows.flatMap((sheet) => sheet.parsed_rows.filter((row) => row.row_type === "order"));
  const referenceRows = allSheetRows.flatMap((sheet) => sheet.parsed_rows.filter((row) => row.row_type === "reference"));
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

function buildShipping(rows: SourceGrid["rows"], mappings: FieldMapping[]): ShippingAddress | null {
  const shipping: ShippingAddress = {
    method: firstMappedValue(rows, mappings, "order.shipping.method", "") || null,
    attention_to: firstMappedValue(rows, mappings, "order.shipping.attention_to", "") || null,
    company: firstMappedValue(rows, mappings, "order.shipping.company", "") || null,
    address_1: firstMappedValue(rows, mappings, "order.shipping.address_1", "") || null,
    address_2: firstMappedValue(rows, mappings, "order.shipping.address_2", "") || null,
    city: firstMappedValue(rows, mappings, "order.shipping.city", "") || null,
    state: firstMappedValue(rows, mappings, "order.shipping.state", "") || null,
    postal_code: firstMappedValue(rows, mappings, "order.shipping.postal_code", "") || null,
    country: firstMappedValue(rows, mappings, "order.shipping.country", "US") || null
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
    shipping: null,
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

  return {
    customer: {
      customer_id: options.customerId,
      customer_name: options.customerName,
      destination_customer_id: options.destinationCustomerId
    },
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
      ship_date: firstMappedValue(rows, mappings, "order.ship_date", "") || null,
      shipping: buildShipping(rows, mappings)
    },
    lines: rows.map((row, index) => buildLine(row, mappings, index))
  };
}
