import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWrikeSourceConfig, type WrikeOAuthCredentials } from "@pathfinder/wrike-adapter";
import { discoverWrikeCaptureScope } from "../src/wrike-capture-discovery.js";
import type { WrikeProviderBudgetReport } from "../src/wrike-provider-budget.js";
const credentials: WrikeOAuthCredentials = { client_id: "synthetic", client_secret: "synthetic", refresh_token: "old", host: "www.wrike.com" };
const source = normalizeWrikeSourceConfig({ folder_ids: ["ROOTA", "ROOTB"], trigger_status_id: "READY", trigger_status_label: "Sent to Print - LTL",
  contract_number_custom_field_id: "CONTRACT", print_vendor_custom_field_id: "VENDOR", order_task_title: "Placard Order", required_print_vendor_value: "Larger Than Life" });
function fixture() {
  const urls: string[] = []; const saves: WrikeOAuthCredentials[] = []; const reports: (WrikeProviderBudgetReport & { mode: string })[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.ok(init?.signal); const url = new URL(String(input)); urls.push(url.pathname);
    if (url.pathname.endsWith("/oauth2/token")) return Response.json({ access_token: "new", refresh_token: "rotated", host: "www.wrike.com" });
    assert.equal(init!.method, "GET");
    if (url.pathname.endsWith("/workflows")) return Response.json({ data: [{ id: "WORKFLOW", customStatuses: [{ id: "READY", name: "Sent to Print - LTL" }] }] });
    if (url.pathname.endsWith("/spaces") || url.pathname.includes("/customfields")) return Response.json({ data: [] });
    assert.match(url.pathname, /\/folders\/ROOT[AB]\/tasks$/);
    const page = Number(url.searchParams.get("nextPageToken") ?? 0);
    return Response.json({ data: [{ id: `${url.pathname.includes("ROOTA") ? "A" : "B"}${page}`, accountId: "ACCOUNT", title: "Placard Order",
      customStatusId: "READY", updatedDate: "2026-09-10T10:00:00Z", parentIds: ["ROOTA"],
      customFields: [{ id: "CONTRACT", value: "C123456" }, { id: "VENDOR", value: "Larger Than Life" }] }],
      ...(page < 2 ? { nextPageToken: String(page + 1) } : {}) });
  };
  return { urls, saves, reports, args: { credentials, source, limits: { max_requests: 10, max_elapsed_ms: 10000 },
    mode: "manual" as const, now: () => new Date("2026-09-10T12:00:00Z"), fetchImpl,
    saveCredentials: async (oauth: WrikeOAuthCredentials) => { saves.push(oauth); },
    report: (row: WrikeProviderBudgetReport & { mode: string }) => { reports.push(row); } } };
}
test("manual, scheduled and batch discovery budget the full multi-root paginated scan", async () => {
  for (const mode of ["manual", "scheduled", "manual_batch"] as const) {
    const f = fixture();
    const discovery = await discoverWrikeCaptureScope({ ...f.args, mode });
    assert.equal(discovery.order_candidates.length, 6);
    assert.equal(discovery.order_candidates.filter(task => task.task_id === "A0").length, 1);
    assert.equal(f.urls.length, 10); // Filtering the requested task cannot discount upstream reads.
    assert.equal(f.saves[0]!.refresh_token, "rotated");
    assert.equal(f.reports[0]!.provider_requests, 10); assert.equal(f.reports[0]!.exhausted, null);
    assert.deepEqual(Object.keys(f.reports[0]!).sort(), ["elapsed_ms", "exhausted", "mode", "provider_requests"]);
  }
});
test("request exhaustion during pagination or optional metadata never returns a partial capture", async () => {
  for (const cap of [3, 9]) {
    const f = fixture(); let captures = 0;
    await assert.rejects(async () => { await discoverWrikeCaptureScope({ ...f.args, limits: { ...f.args.limits, max_requests: cap } }); captures++; });
    assert.equal(captures, 0); assert.equal(f.urls.length, cap);
    assert.equal(f.saves.at(-1)!.refresh_token, "rotated");
    assert.equal(f.reports[0]!.exhausted, "requests");
  }
});
test("elapsed budget includes response processing and credential persistence before capture", async () => {
  const f = fixture(); let elapsed = 0; let captures = 0;
  await assert.rejects(async () => {
    await discoverWrikeCaptureScope({ ...f.args, monotonicNow: () => elapsed, limits: { max_requests: 10, max_elapsed_ms: 100 },
      saveCredentials: async oauth => { f.saves.push(oauth); elapsed = 100; } });
    captures++;
  });
  assert.equal(captures, 0); assert.equal(f.saves[0]!.refresh_token, "rotated");
  assert.equal(f.reports[0]!.exhausted, "elapsed");
});
test("shared deadline aborts in-flight paginated reads and preserves returned rotations", async () => {
  const f = fixture();
  await assert.rejects(discoverWrikeCaptureScope({ ...f.args, limits: { max_requests: 10, max_elapsed_ms: 50 },
    fetchImpl: async (input, init) => {
      if (String(input).includes("/oauth2/token")) return f.args.fetchImpl(input, init);
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ data: [] })), 1000);
        const abort = () => { clearTimeout(timer); reject(new Error("aborted")); };
        if (init!.signal!.aborted) abort(); else init!.signal!.addEventListener("abort", abort, { once: true });
      });
    } }));
  assert.equal(f.reports[0]!.exhausted, "elapsed");
  assert.equal(f.saves.at(-1)!.refresh_token, "rotated");
});
