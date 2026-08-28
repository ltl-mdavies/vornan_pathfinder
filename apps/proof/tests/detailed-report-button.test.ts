import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DetailedReportButton, detailedReportOptionStatus } from "../src/detailed-report-button.tsx";
import type { ProofTask, ProofVersion } from "../src/types.ts";

const version: ProofVersion = {
  version_id: "pversion_report",
  created_at: null,
  filename: "proof.pdf",
  content_type: "application/pdf",
  preview_kind: "pdf",
  preview_url: "https://files.example/proof.jpg",
  download_url: "https://files.example/proof.pdf",
  approval_status: "PENDING",
  approved_at: null,
  comments: [],
  technical_checks: [],
  current: true,
  report_definitions: [
    { definition_id: "5843", label: "Detailed Report", ready: false },
    { definition_id: "5981", label: "New Report TEST", ready: false }
  ]
};

const task: ProofTask = {
  task_id: "ptask_report",
  line_number: "1",
  product_name: "Test proof",
  quantity: 1,
  state: "pending",
  sibling_index: 1,
  sibling_count: 1,
  feedback_required: false,
  feedback_acknowledged: true,
  current_version: version,
  versions: [version]
};

test("moves detailed report selection into a modal without changing the toolbar height", () => {
  const markup = renderToStaticMarkup(createElement(DetailedReportButton, { task, version }));

  assert.match(markup, /Generate detailed report/);
  assert.match(markup, /Choose a report type to generate or view\./);
  assert.match(markup, /Detailed Report/);
  assert.match(markup, /New Report TEST/);
  assert.doesNotMatch(markup, /<select/);
  assert.doesNotMatch(markup, /We’re still preparing your report/);
});

test("shows an immediate busy state for the selected report type", () => {
  assert.deepEqual(detailedReportOptionStatus(false, true), {
    description: "Generating report…",
    action: "Generating…"
  });
  assert.deepEqual(detailedReportOptionStatus(true, false), {
    description: "Ready to view",
    action: "View"
  });
});
