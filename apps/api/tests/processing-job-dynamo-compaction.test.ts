import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedSourceRow, ParsedWorkbookSheet } from "@pathfinder/templates";
import {
  compactProcessingJobForDynamo,
  type ProcessingJobPreview
} from "../src/store.js";

function row(rowNumber: number, rowType: ParsedSourceRow["row_type"]): ParsedSourceRow {
  return {
    sheet_name: "AMZ LOCKERS",
    row_number: rowNumber,
    row_type: rowType,
    scope_id: "amz-lockers",
    section_id: "products",
    section_label: "Products",
    line_kind: "print",
    values: {
      Description: `Catalog product ${rowNumber}`,
      Qty: rowType === "order" ? 2 : null
    }
  };
}

test("Dynamo job compaction retains ordered rows and workbook counts without catalog row bodies", () => {
  const orderedRow = row(2, "order");
  const referenceRows = Array.from({ length: 220 }, (_, index) => row(index + 3, "reference"));
  const incompleteRow = row(223, "incomplete");
  const allRows = [orderedRow, ...referenceRows, incompleteRow];
  const sheet: ParsedWorkbookSheet = {
    sheet_name: "AMZ LOCKERS",
    role: "order_lines",
    columns: ["Description", "Qty"],
    order_row_count: 1,
    reference_row_count: 220,
    incomplete_row_count: 1,
    parsed_rows: allRows,
    sections: [{
      scope_id: "amz-lockers",
      section_id: "products",
      label: "Products",
      line_kind: "print",
      columns: ["Description", "Qty"],
      header_row: 1,
      header_row_count: 1,
      quantity_column: "Qty",
      missing_quantity_behavior: "reference",
      order_row_count: 1,
      reference_row_count: 220,
      incomplete_row_count: 1,
      parsed_rows: allRows
    }]
  };
  const job = {
    job_id: "job-large-reference-catalog",
    customer_id: "284619",
    source_grid: {
      columns: ["Description", "Qty"],
      rows: [orderedRow.values]
    },
    source_sheets: [sheet],
    parsed_order_rows: [orderedRow, ...referenceRows],
    reference_rows: referenceRows,
    source_evidence: {
      provider: "wrike",
      evidence_id: "evidence_immutable_workbook",
      evidence_sha256: "a".repeat(64),
      import_method_fingerprint: "b".repeat(64),
      connection_id: "connection",
      account_id: "account",
      task_id: "task",
      attachment_id: "attachment",
      version_id: "version",
      captured_at: "2026-08-10T17:00:00.000Z"
    },
    lift_payload: { order: { lines: [{ quantity: 2 }] } }
  } as unknown as ProcessingJobPreview;

  const compacted = compactProcessingJobForDynamo(job);

  assert.deepEqual(compacted.parsed_order_rows, [orderedRow]);
  assert.deepEqual(compacted.reference_rows, []);
  assert.deepEqual(compacted.source_sheets[0]?.parsed_rows, [orderedRow]);
  assert.deepEqual(compacted.source_sheets[0]?.sections[0]?.parsed_rows, [orderedRow]);
  assert.equal(compacted.source_sheets[0]?.reference_row_count, 220);
  assert.equal(compacted.source_sheets[0]?.incomplete_row_count, 1);
  assert.equal(compacted.source_sheets[0]?.sections[0]?.reference_row_count, 220);
  assert.equal(compacted.source_evidence?.evidence_id, "evidence_immutable_workbook");
  assert.deepEqual(compacted.source_grid, job.source_grid);
  assert.deepEqual(compacted.lift_payload, job.lift_payload);
  assert.ok(JSON.stringify(compacted).length < JSON.stringify(job).length / 4);
});

test("Dynamo job compaction safely normalizes legacy jobs without workbook row collections", () => {
  const legacyJob = {
    job_id: "job-legacy",
    customer_id: "284619"
  } as ProcessingJobPreview;

  const compacted = compactProcessingJobForDynamo(legacyJob);

  assert.deepEqual(compacted.parsed_order_rows, []);
  assert.deepEqual(compacted.reference_rows, []);
  assert.deepEqual(compacted.source_sheets, []);
});
