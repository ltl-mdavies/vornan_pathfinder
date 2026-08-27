import assert from "node:assert/strict";
import test from "node:test";
import { startLiftProofDetailedReport } from "../src/proof-detailed-report-runtime.ts";

test("starts one detailed report with the exact bounded path and no response URL projection", async () => {
  let request: Request | null = null;
  const result = await startLiftProofDetailedReport({
    base_url: "https://lift.example/api",
    credentials: { client_id: "client_1", client_secret: "a".repeat(32) },
    order_number: "A0229507", order_line_id: "line_2", attachment_id: "attachment_2", definition_id: "4441",
    timeout_ms: 1_000,
    now: new Date("2026-08-27T20:00:00.000Z"),
    fetcher: async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ reportId: "report_1", reportUrl: "https://lift.example/report.pdf?secret=1" }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(request?.method, "POST");
  assert.equal(request?.url, "https://lift.example/api/orders/A0229507/lines/line_2/proofs/attachment_2/reports");
  assert.equal(await request?.text(), JSON.stringify({ reportDefinitionId: "4441" }));
  assert.equal(result.report_id, "report_1");
  assert.equal(result.report_url, "https://lift.example/report.pdf?secret=1");
});
