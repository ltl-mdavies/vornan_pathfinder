import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntakeDiagnosticDetails, IntakeDiagnostics, readIntakeDiagnosticsPage, type IntakeDiagnosticRow } from "../src/IntakeDiagnostics";
import { configurePathfinderApiAuth } from "../src/api-client";
const row: IntakeDiagnosticRow = { customer_id: "284619", diagnostic_id: "id", import_method_id: "method", task_id: "task", contract_number: "C317112", task_url: "https://www.wrike.com/open.htm?id=4585490590", state: "open", stage: "preparation", reason_code: "file_too_large", message: "Reference PDF exceeds the file-size limit.", first_seen_at: "2026-10-28T20:00:00Z", last_seen_at: "2026-10-28T20:01:00Z", resolved_at: null, occurrences: 2, attachment: { kind: "reference_pdf", file_name: "Reference.pdf", observed_bytes: 27673344, size_source: "content_length", limit_bytes: 25 * 1024 * 1024 } };
test("pre-job issue exposes reason, declared size, bounded limit and task link without requiring a job", () => {
  const html = renderToStaticMarkup(<IntakeDiagnosticDetails row={row} customerName="Momentara"/>);
  for (const text of ["C317112", "Momentara", "Intake blocked", "Reference.pdf", "Declared size", "26.39 MiB", "25.00 MiB", "First seen", "Last failure", "2 observations", "4585490590"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("Review job"));
  const recovered = renderToStaticMarkup(<IntakeDiagnosticDetails row={{ ...row, state: "resolved", resolved_at: "2026-10-28T20:05:00Z" }}/>);
  assert.ok(recovered.includes("Lift confirmation and writeback remain separate job statuses"));
});
test("unloaded diagnostic state is unknown, never zero-success and provides history filter", () => {
  const html = renderToStaticMarkup(<IntakeDiagnostics apiBaseUrl="https://api.example.test"/>);
  assert.ok(html.includes("Coverage unknown")); assert.ok(html.includes("All recorded issues"));
  assert.ok(html.includes("not a historical backfill")); assert.ok(!html.includes("0 open"));
});
test("diagnostic fetch is authenticated, no-store, bounded and passes pagination without provider action", async () => {
  const original = globalThis.fetch; const calls: Array<{ url: string; init: RequestInit }> = [];
  configurePathfinderApiAuth({ apiBaseUrl: "https://api.example.test", token: "test-token" });
  globalThis.fetch = async (input, init = {}) => { calls.push({ url: String(input), init }); return new Response(JSON.stringify({ items: [row], next_cursor: "next", checked_at: "2026-10-28T20:00:00Z", coverage: "recorded_preparation_observations" })); };
  try {
    const signal = new AbortController().signal;
    assert.equal((await readIntakeDiagnosticsPage("https://api.example.test", "284619", "prior", signal)).next_cursor, "next");
    assert.equal(calls.length, 1); assert.equal(calls[0].init.cache, "no-store"); assert.equal(calls[0].init.signal, signal);
    assert.match(calls[0].url, /customer=284619&cursor=prior&state=open/);
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer test-token");
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    await assert.rejects(() => readIntakeDiagnosticsPage("https://api.example.test", "", undefined, signal), /unknown/);
  } finally { globalThis.fetch = original; configurePathfinderApiAuth({ apiBaseUrl: "", token: null }); }
});
