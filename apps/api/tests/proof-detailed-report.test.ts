import assert from "node:assert/strict";
import test from "node:test";
import { createProofDetailedReportService } from "../src/proof/detailed-report-service.ts";

const order = {
  order_number: "A0229507",
  customer_id: "1249",
  tasks: [{
    task_id: "ptask_1", order_line_id: "line_2", attachment_id: "attachment_2", state: "approved", actionable: false,
    current_version: { current: true, version_id: "pversion_1", detailed_report: [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report" }] }
  }]
} as any;

const session = {
  session_id: "psession_test", order_number: "A0229507", scope: "review", grant_id: "pgrant_test", participant_id: "pparticipant_test",
  capability: { proof_customer_id: "1249" }
} as any;

test("detailed reports fail closed before the focused Lift read for another customer", async () => {
  let focusedReads = 0;
  const service = createProofDetailedReportService({
    getOrder: async () => ({ ...order, customer_id: "9999" }),
    focusedRead: async () => { focusedReads += 1; return { order_line_id: "line_2", payload: {} }; }
  });
  await assert.rejects(
    () => service.begin({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" }),
    /not available/
  );
  assert.equal(focusedReads, 0);
});

test("reuses an authoritative ready report without a generation POST or provider URL in JSON", async () => {
  let started = 0;
  const records = new Map<string, any>();
  const service = createProofDetailedReportService({
    getOrder: async () => order,
    focusedRead: async () => ({ order_line_id: "line_2", payload: { rowset: [{ ORDER_LINE_ID: "line_2", ATTACHMENT_ID: "attachment_2", DETAILED_REPORT: [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report", REPORT_ID: "report_1", REPORT_URL: "https://lift.example/report.pdf?token=private" }] }] } }),
    getRecord: async (_order, id) => records.get(id) ?? null,
    saveRecord: async (record) => { records.set(record.record_id, record); return record; },
    createRecord: async (record) => { records.set(record.record_id, record); return record; },
    start: async () => { started += 1; throw new Error("must not start"); },
    audit: async () => undefined
  });
  const result = await service.begin({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" });
  assert.equal(result.state, "ready");
  assert.equal(started, 0);
  assert.equal(JSON.stringify(result).includes("lift.example"), false);
  assert.match(result.view_url ?? "", /^\/api\/public\/proof\/detailed-reports\//);
});
