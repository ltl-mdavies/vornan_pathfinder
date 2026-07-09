import * as XLSX from "xlsx";
import type { CanonicalOrder, CanonicalOrderLine, ShippingAddress } from "@pathfinder/canonical";

export interface SourceGrid {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
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
  "order.shipping.attention_to",
  "order.shipping.company",
  "order.shipping.address_1",
  "order.shipping.address_2",
  "order.shipping.city",
  "order.shipping.state",
  "order.shipping.postal_code",
  "order.shipping.country",
  "lines[].unit_number",
  "lines[].customer_sku",
  "lines[].description",
  "lines[].product_name",
  "lines[].quantity",
  "lines[].dimensions.final_width",
  "lines[].dimensions.final_height",
  "lines[].dimensions.live_width",
  "lines[].dimensions.live_height",
  "lines[].dimensions.bleed",
  "lines[].artwork.file_name",
  "lines[].artwork.file_url",
  "lines[].production.material",
  "lines[].production.laminate",
  "lines[].production.coating",
  "lines[].production.premask",
  "lines[].production.ink",
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
  width: "lines[].dimensions.final_width",
  "final width": "lines[].dimensions.final_width",
  height: "lines[].dimensions.final_height",
  "final height": "lines[].dimensions.final_height",
  "live width": "lines[].dimensions.live_width",
  "live height": "lines[].dimensions.live_height",
  bleed: "lines[].dimensions.bleed",
  "art file": "lines[].artwork.file_name",
  "artwork file": "lines[].artwork.file_name",
  "art url": "lines[].artwork.file_url",
  "artwork url": "lines[].artwork.file_url",
  material: "lines[].production.material",
  laminate: "lines[].production.laminate",
  coating: "lines[].production.coating",
  premask: "lines[].production.premask",
  ink: "lines[].production.ink",
  note: "lines[].line_note",
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

export function parseWorkbookArrayBuffer(buffer: ArrayBuffer, preferredSheetName?: string): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = preferredSheetName && workbook.Sheets[preferredSheetName] ? preferredSheetName : workbook.SheetNames[0];

  if (!sheetName) {
    return { sheetName: "Empty workbook", sheetNames: [], columns: [], rows: [] };
  }

  const worksheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false
  });
  const headerRow = matrix.find((row) => row.some((cell) => cellToPrimitive(cell) !== null)) ?? [];
  const columns = headerRow.map((cell, index) => normalizeColumnName(String(cellToPrimitive(cell) ?? `Column ${index + 1}`)));
  const dataRows = matrix.slice(matrix.indexOf(headerRow) + 1);
  const rows = dataRows
    .map((row) =>
      columns.reduce<Record<string, string | number | boolean | null>>((record, column, index) => {
        record[column] = cellToPrimitive(row[index]);
        return record;
      }, {})
    )
    .filter(hasAnyValue);

  return { sheetName, sheetNames: workbook.SheetNames, columns, rows };
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
