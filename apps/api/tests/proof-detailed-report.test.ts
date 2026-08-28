import assert from "node:assert/strict";
import test from "node:test";
import { createProofDetailedReportService } from "../src/proof/detailed-report-service.ts";
import { proofDetailedReportRecordId } from "../src/proof/detailed-report-store.ts";

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

test("uses the exact Lift Detailed Report API base URL and target Basic credentials", async () => {
  const records = new Map<string, any>();
  let calledBaseUrl = "";
  let calledCredentials: unknown = null;
  const service = createProofDetailedReportService({
    getOrder: async () => order,
    focusedRead: async () => ({ order_line_id: "line_2", payload: { rowset: [{ ORDER_LINE_ID: "line_2", ATTACHMENT_ID: "attachment_2", DETAILED_REPORT: [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report" }] }] } }),
    readTarget: async () => ({ target_id: "lift-standard-graphics", adapter: "lift-standard-graphics", environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://lift.example/order-import" }] }),
    readCredentials: async () => ({ username: "PATHFINDER", password: "secret" }),
    getRecord: async (_order, id) => records.get(id) ?? null,
    saveRecord: async (record) => { records.set(record.record_id, record); return record; },
    createRecord: async (record) => { records.set(record.record_id, record); return record; },
    start: async (input) => { calledBaseUrl = input.base_url; calledCredentials = input.credentials; return { report_id: "report_1", status: "running", report_url: null }; },
    audit: async () => undefined
  });
  const result = await service.begin({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" });
  assert.equal(calledBaseUrl, "https://lift.example/ords/lifterp/lift/erp/api/v1");
  assert.deepEqual(calledCredentials, { username: "PATHFINDER", password: "secret" });
  assert.equal(result.state, "running");
});

test("retries a failed report only after the customer explicitly starts it again", async () => {
  const records = new Map<string, any>();
  const recordId = proofDetailedReportRecordId({ customer_id: "1249", order_number: order.order_number, order_line_id: "line_2", attachment_id: "attachment_2", definition_id: "4441" });
  records.set(recordId, {
    record_id: recordId, customer_id: "1249", order_number: order.order_number, task_id: "ptask_1", order_line_id: "line_2", attachment_id: "attachment_2",
    version_id: "pversion_1", definition_id: "4441", definition_label: "Detailed Report", report_id: null, state: "failed",
    created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z", generation_deadline_at: null
  });
  let started = 0;
  let created = 0;
  const service = createProofDetailedReportService({
    getOrder: async () => order,
    focusedRead: async () => ({ order_line_id: "line_2", payload: { rowset: [{ ORDER_LINE_ID: "line_2", ATTACHMENT_ID: "attachment_2", DETAILED_REPORT: [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report" }] }] } }),
    readTarget: async () => ({ target_id: "lift-standard-graphics", adapter: "lift-standard-graphics", environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://lift.example/order-import" }] }),
    readCredentials: async () => ({ username: "PATHFINDER", password: "secret" }),
    getRecord: async (_order, id) => records.get(id) ?? null,
    saveRecord: async (record) => { records.set(record.record_id, record); return record; },
    createRecord: async () => { created += 1; throw new Error("a retry must reuse the existing record"); },
    start: async () => { started += 1; return { report_id: "report_retry", status: "RUNNING", report_url: null }; },
    audit: async () => undefined
  });

  const result = await service.begin({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" });
  assert.equal(started, 1);
  assert.equal(created, 0);
  assert.equal(result.state, "running");
  assert.equal(records.get(recordId)?.report_id, "report_retry");
});

test("uses the exact Lift Detailed Report API base URL when polling a generated report", async () => {
  const records = new Map<string, any>();
  let statusBaseUrl = "";
  const service = createProofDetailedReportService({
    getOrder: async () => order,
    focusedRead: async () => ({ order_line_id: "line_2", payload: { rowset: [{ ORDER_LINE_ID: "line_2", ATTACHMENT_ID: "attachment_2", DETAILED_REPORT: [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report" }] }] } }),
    readTarget: async () => ({ target_id: "lift-standard-graphics", adapter: "lift-standard-graphics", environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://lift.example/order-import" }] }),
    readCredentials: async () => ({ username: "PATHFINDER", password: "secret" }),
    getRecord: async (_order, id) => records.get(id) ?? null,
    saveRecord: async (record) => { records.set(record.record_id, record); return record; },
    createRecord: async (record) => { records.set(record.record_id, record); return record; },
    start: async () => ({ report_id: "report_1", status: "running", report_url: null }),
    status: async (input) => { statusBaseUrl = input.base_url; return { report_id: "report_1", status: "ready", report_url: "https://lift.example/report.pdf" }; },
    audit: async () => undefined
  });
  await service.begin({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" });
  const result = await service.check({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" });
  assert.equal(statusBaseUrl, "https://lift.example/ords/lifterp/lift/erp/api/v1");
  assert.equal(result.state, "ready");
});

test("uses a report URL returned by Lift's initial POST without an immediate status read", async () => {
  const records = new Map<string, any>();
  let statusReads = 0;
  const service = createProofDetailedReportService({
    getOrder: async () => order,
    focusedRead: async () => ({ order_line_id: "line_2", payload: { rowset: [{ ORDER_LINE_ID: "line_2", ATTACHMENT_ID: "attachment_2", DETAILED_REPORT: [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report" }] }] } }),
    readTarget: async () => ({ target_id: "lift-standard-graphics", adapter: "lift-standard-graphics", environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://lift.example/order-import" }] }),
    readCredentials: async () => ({ username: "PATHFINDER", password: "secret" }),
    getRecord: async (_order, id) => records.get(id) ?? null,
    saveRecord: async (record) => { records.set(record.record_id, record); return record; },
    createRecord: async (record) => { records.set(record.record_id, record); return record; },
    start: async () => ({ report_id: "report_1", status: "RUNNING", report_url: "https://lift.example/report.pdf?token=private" }),
    status: async () => { statusReads += 1; throw new Error("must not poll during begin"); },
    audit: async () => undefined
  });
  const result = await service.begin({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" });
  assert.equal(result.state, "ready");
  assert.equal(statusReads, 0);
});

test("keeps a ready report viewable when Lift resyncs the same attachment into a new normalized version", async () => {
  const records = new Map<string, any>();
  const resyncedOrder = structuredClone(order);
  const task = resyncedOrder.tasks[0]!;
  task.current_version.version_id = "pversion_resynced";
  task.current_version.detailed_report = [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report", REPORT_ID: "report_1", REPORT_URL: "https://lift.example/report.pdf" }];
  const recordId = proofDetailedReportRecordId({
    customer_id: "1249", order_number: order.order_number, order_line_id: task.order_line_id,
    attachment_id: task.attachment_id, definition_id: "4441"
  });
  records.set(recordId, {
    record_id: recordId, customer_id: "1249", order_number: order.order_number, task_id: task.task_id,
    order_line_id: task.order_line_id, attachment_id: task.attachment_id, version_id: "pversion_prior",
    definition_id: "4441", definition_label: "Detailed Report", report_id: "report_1", state: "ready",
    created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z", generation_deadline_at: null
  });
  const service = createProofDetailedReportService({
    getOrder: async () => resyncedOrder,
    focusedRead: async () => ({ order_line_id: task.order_line_id, payload: { rowset: [{ ORDER_LINE_ID: task.order_line_id, ATTACHMENT_ID: task.attachment_id, DETAILED_REPORT: task.current_version.detailed_report }] } }),
    readTarget: async () => ({ target_id: "lift-standard-graphics", adapter: "lift-standard-graphics", environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://lift.example/order-import" }] }),
    readCredentials: async () => ({ username: "PATHFINDER", password: "secret" }),
    getRecord: async (_order, id) => records.get(id) ?? null,
    status: async () => ({ report_id: "report_1", status: "SUCCESS", report_url: "https://lift.example/report.pdf" }),
    audit: async () => undefined
  });

  const result = await service.viewByRecord({ session, record_id: recordId, correlation_id: "test" });
  assert.equal(result, "https://lift.example/report.pdf");
});

test("fails closed when the active production target endpoint is malformed", async () => {
  const records = new Map<string, any>();
  let started = 0;
  const service = createProofDetailedReportService({
    getOrder: async () => order,
    focusedRead: async () => ({ order_line_id: "line_2", payload: { rowset: [{ ORDER_LINE_ID: "line_2", ATTACHMENT_ID: "attachment_2", DETAILED_REPORT: [{ DEFINITION_ID: 4441, DEFINITION_LABEL: "Detailed Report" }] }] } }),
    readTarget: async () => ({ target_id: "lift-standard-graphics", adapter: "lift-standard-graphics", environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "not-a-url" }] }),
    readCredentials: async () => ({ username: "PATHFINDER", password: "secret" }),
    getRecord: async (_order, id) => records.get(id) ?? null,
    saveRecord: async (record) => { records.set(record.record_id, record); return record; },
    createRecord: async (record) => { records.set(record.record_id, record); return record; },
    start: async () => { started += 1; return { report_id: "report_1", status: "running", report_url: null }; },
    audit: async () => undefined
  });
  await assert.rejects(
    () => service.begin({ session, task_id: "ptask_1", definition_id: "4441", correlation_id: "test" }),
    /preparing your report/
  );
  assert.equal(started, 0);
});
