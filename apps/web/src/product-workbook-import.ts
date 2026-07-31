import type { ParsedSourceRow, ParsedWorkbookSheet, SourceGrid } from "@pathfinder/templates";

export type ProductWorkbookProfileKind = "standard" | "hardware" | "ignore";

export interface ProductWorkbookSheetProfile {
  sheet_name: string;
  kind: ProductWorkbookProfileKind;
  included: boolean;
  columns: string[];
  rows: ParsedSourceRow[];
  key_column: string;
  name_column: string;
  detail_columns: string[];
  width_column: string;
  height_column: string;
  valid_row_count: number;
}

export const PRODUCT_WORKBOOK_KEY_COLUMN = "Pathfinder Product Key";
export const PRODUCT_WORKBOOK_NAME_COLUMN = "Pathfinder Product Name";
export const PRODUCT_WORKBOOK_SHEET_COLUMN = "Pathfinder Source Sheet";
export const PRODUCT_WORKBOOK_ROW_COLUMN = "Pathfinder Source Row";
export const PRODUCT_WORKBOOK_SOURCE_COLUMN = "Pathfinder Original Key Column";

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function workbookColumn(columns: string[], candidates: RegExp[]) {
  return columns.find((column) => candidates.some((candidate) => candidate.test(column.trim()))) ?? "";
}

export function inferProductWorkbookProfile(sheet: ParsedWorkbookSheet): ProductWorkbookSheetProfile {
  const hardwareKey = workbookColumn(sheet.columns, [/^PS SKU$/i, /^OPS SKU$/i]);
  const standardKey = workbookColumn(sheet.columns, [/^DESCRIPTION$/i]);
  const kind: ProductWorkbookProfileKind = hardwareKey ? "hardware" : standardKey ? "standard" : "ignore";
  const keyColumn = hardwareKey || standardKey;
  const nameColumn = hardwareKey
    ? workbookColumn(sheet.columns, [/^Hardware$/i, /^Description$/i])
    : standardKey;
  const detailColumns = hardwareKey
    ? ["Item SKU", "Description"].filter((column) => sheet.columns.includes(column) && column !== nameColumn)
    : [];
  const widthColumn = workbookColumn(sheet.columns, [/^Final Size Width$/i, /^Width$/i]);
  const heightColumn = workbookColumn(sheet.columns, [/^Final Size (Length|Height)$/i, /^Height$/i]);
  const validRowCount = sheet.parsed_rows.filter((row) => textValue(row.values[keyColumn])).length;
  return {
    sheet_name: sheet.sheet_name,
    kind,
    included: kind !== "ignore" && validRowCount > 0,
    columns: sheet.columns,
    rows: sheet.parsed_rows,
    key_column: keyColumn,
    name_column: nameColumn,
    detail_columns: detailColumns,
    width_column: widthColumn,
    height_column: heightColumn,
    valid_row_count: validRowCount
  };
}

export function productWorkbookProfileGrid(profiles: ProductWorkbookSheetProfile[]): SourceGrid {
  const rows = profiles.flatMap((profile) => {
    if (!profile.included || profile.kind === "ignore" || !profile.key_column) {
      return [];
    }
    return profile.rows.flatMap((sourceRow) => {
      const key = textValue(sourceRow.values[profile.key_column]);
      if (!key) {
        return [];
      }
      const nameParts = [
        textValue(sourceRow.values[profile.name_column]),
        ...(profile.kind === "hardware"
          ? [key, ...profile.detail_columns.map((column) => textValue(sourceRow.values[column]))]
          : [])
      ].filter((value, index, values) => value && values.indexOf(value) === index);
      return [{
        ...sourceRow.values,
        [PRODUCT_WORKBOOK_KEY_COLUMN]: key,
        [PRODUCT_WORKBOOK_NAME_COLUMN]: nameParts.join(" · ") || key,
        [PRODUCT_WORKBOOK_SHEET_COLUMN]: profile.sheet_name,
        [PRODUCT_WORKBOOK_ROW_COLUMN]: sourceRow.row_number,
        [PRODUCT_WORKBOOK_SOURCE_COLUMN]: profile.key_column,
        "Final Size Width": textValue(sourceRow.values[profile.width_column]),
        "Final Size Length": textValue(sourceRow.values[profile.height_column])
      }];
    });
  });
  return {
    columns: [
      PRODUCT_WORKBOOK_KEY_COLUMN,
      PRODUCT_WORKBOOK_NAME_COLUMN,
      PRODUCT_WORKBOOK_SHEET_COLUMN,
      PRODUCT_WORKBOOK_ROW_COLUMN,
      PRODUCT_WORKBOOK_SOURCE_COLUMN,
      "Final Size Width",
      "Final Size Length"
    ],
    rows
  };
}
