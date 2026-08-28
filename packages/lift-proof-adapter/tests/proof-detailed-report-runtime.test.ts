import assert from "node:assert/strict";
import test from "node:test";
import {
  readLiftProofDetailedReportStatus,
  startLiftProofDetailedReport
} from "../src/proof-detailed-report-runtime.ts";

test("starts one detailed report with the exact bounded path and no response URL projection", async () => {
  let request: Request | null = null;
  const result = await startLiftProofDetailedReport({
    base_url: "https://lift.example/ords/lifterp/lift/erp/api/v1",
    credentials: { username: "PATHFINDER", password: "secret" },
    order_number: "A0229507", order_line_id: "line_2", attachment_id: "attachment_2", definition_id: "4441",
    timeout_ms: 1_000,
    fetcher: async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ reportId: "report_1", reportUrl: "https://lift.example/report.pdf?secret=1" }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(request?.method, "POST");
  assert.equal(request?.url, "https://lift.example/ords/lifterp/lift/erp/api/v1/orders/0229507/lines/line_2/proofs/attachment_2/reports");
  assert.equal(request?.headers.get("authorization"), `Basic ${Buffer.from("PATHFINDER:secret").toString("base64")}`);
  assert.equal(await request?.text(), JSON.stringify({ reportDefinitionId: "4441" }));
  assert.equal(result.report_id, "report_1");
  assert.equal(result.report_url, "https://lift.example/report.pdf?secret=1");
});

test("reads the Lift report status with the same numeric order path and Basic auth", async () => {
  let request: Request | null = null;
  const result = await readLiftProofDetailedReportStatus({
    base_url: "https://lift.example/ords/lifterp/lift/erp/api/v1",
    credentials: { username: "PATHFINDER", password: "secret" },
    order_number: "A0229507", order_line_id: "line_2", attachment_id: "attachment_2", report_id: "162246",
    timeout_ms: 1_000,
    fetcher: async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ id: 162246, status: "SUCCESS", url: "https://lift.example/report.pdf?token=private" }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(request?.method, "GET");
  assert.equal(request?.url, "https://lift.example/ords/lifterp/lift/erp/api/v1/orders/0229507/lines/line_2/proofs/attachment_2/reports/162246");
  assert.equal(request?.headers.get("authorization"), `Basic ${Buffer.from("PATHFINDER:secret").toString("base64")}`);
  assert.equal(result.report_id, "162246");
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.report_url, "https://lift.example/report.pdf?token=private");
});
