import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedResponseBytes, fetchQualifiedWrikeWorkbookSources, normalizeWrikeSourceConfig, WrikeConnectionError } from "../src/index.ts";
const context = { kind: "reference_pdf" as const, file_name: "reference.pdf" };
test("exact limit succeeds; declared PDF size overflow is accurate and cancels download", async () => {
  assert.equal((await readBoundedResponseBytes(new Response(new Uint8Array(32)), 32, context)).byteLength, 32);
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "33" } });
  await assert.rejects(() => readBoundedResponseBytes(response, 32, context), (error: unknown) => {
    assert.ok(error instanceof WrikeConnectionError); assert.match(error.message, /reference PDF/); assert.doesNotMatch(error.message, /workbook/);
    assert.equal(error.attachment_failure?.observed_bytes, 33); assert.equal(error.attachment_failure?.size_source, "content_length"); return true;
  }); assert.equal(cancelled, true);
});

async function capture(pdfSizes: number[], options: { invalid?: boolean; workbookSize?: number; requestedLimit?: number } = {}) {
  const now = new Date("2026-10-28T16:00:00Z");
  const files = [{ id: "IEGRID", name: "C317112 - Test - OOH Order.xlsx", size: options.workbookSize ?? 23978 }, ...pdfSizes.map((size, i) => ({ id: `IEPDF${i}`, name: `Proof ${i}.pdf`, size }))];
  const json = (data: unknown[]) => new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
  return fetchQualifiedWrikeWorkbookSources({ host: "www.wrike.com", access_token: "test", access_token_expires_at: "2026-10-28T17:00:00Z" },
    normalizeWrikeSourceConfig({ folder_id: "IEROOT", approved_discovery_task_id: "IETASK", trigger_status_id: "IEREADY", contract_number_custom_field_id: "IECONTRACT", attachment_extensions: ["xlsx"], reference_proof_intake: { enabled: true, filename_contains: "Proof", attachment_selection: "all_matching_current_attachments" } }), {
      now: () => now, max_reference_proof_bytes: options.requestedLimit,
      prequalified_scope: { task_id: "IETASK", checked_at: now.toISOString(), resolved_root_folder_ids: ["IEROOT"], parent_ids: ["IECAMPAIGN"] },
      fetch_impl: async input => {
        const url = String(input);
        if (url.endsWith("/tasks/IETASK")) return json([{ id: "IETASK", accountId: "IEACCOUNT", parentIds: ["IECAMPAIGN"], customStatusId: "IEREADY", title: "Placard Order", attachmentCount: files.length, customFields: [{ id: "IECONTRACT", value: "C317112" }] }]);
        if (url.includes("/attachments?")) return json(files.map(file => ({ id: file.id, currentAttachmentId: `${file.id}V1`, name: file.name, updatedDate: now.toISOString(), url: `https://files.example.test/${file.id}` })));
        if (url.endsWith("/folders/IECAMPAIGN")) return json([{ id: "IECAMPAIGN", title: "Test" }]);
        const file = files.find(file => url === `https://files.example.test/${file.id}`);
        if (!file) throw new Error("Unexpected request");
        let offset = 0;
        return new Response(new ReadableStream({ pull(controller) {
          if (offset >= file.size) { controller.close(); return; }
          const bytes = new Uint8Array(Math.min(65536, file.size - offset));
          if (!offset && file.id !== "IEGRID" && !options.invalid) bytes.set(new TextEncoder().encode("%PDF-1.7"));
          offset += bytes.length; controller.enqueue(bytes);
        } }), { headers: { "content-type": "application/octet-stream", "content-length": String(file.size) } });
      }
    });
}
test("qualified capture accepts incident-size and exact32MiB PDF; hard cap and15MiB workbook remain enforced", async () => {
  assert.equal((await capture([27673344])).reference_proofs[0]?.byte_size, 27673344);
  assert.equal((await capture([32 * 1024 * 1024])).reference_proofs[0]?.byte_size, 32 * 1024 * 1024);
  await assert.rejects(() => capture([32 * 1024 * 1024 + 1], { requestedLimit: 100 * 1024 * 1024 }), (error: unknown) => error instanceof WrikeConnectionError && error.attachment_failure?.limit_bytes === 32 * 1024 * 1024);
  await assert.rejects(() => capture([], { workbookSize: 15 * 1024 * 1024 + 1 }), (error: unknown) => error instanceof WrikeConnectionError && error.attachment_failure?.kind === "workbook");
});
test("qualified PDF signature and50MiB aggregate budget remain mandatory", async () => {
  await assert.rejects(() => capture([32], { invalid: true }), (error: unknown) => error instanceof WrikeConnectionError && error.attachment_failure?.reason === "invalid_pdf");
  await assert.rejects(() => capture([32 * 1024 * 1024, 20 * 1024 * 1024]), (error: unknown) => error instanceof WrikeConnectionError && error.attachment_failure?.reason === "total_budget_exceeded");
});
test("missing or understated header cannot bypass streaming or total-budget limits", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12)); controller.enqueue(new Uint8Array(12)); }, cancel() { cancelled = true; } });
    await assert.rejects(() => readBoundedResponseBytes(new Response(body, { headers }), 20, { ...context, total_budget: true }), (error: unknown) => {
      assert.ok(error instanceof WrikeConnectionError); assert.equal(error.attachment_failure?.reason, "total_budget_exceeded");
      assert.equal(error.attachment_failure?.size_source, "stream_lower_bound"); assert.equal(error.attachment_failure?.observed_bytes, 24); return true;
    }); assert.equal(cancelled, true);
  }
});
test("bounded workbook error retains non-enumerable rotated credentials", async () => {
  const credentials = { host: "www.wrike.com", client_id: "id", client_secret: "secret", refresh_token: "secret" };
  await assert.rejects(() => readBoundedResponseBytes(new Response("too large"), 2, { kind: "workbook", file_name: "grid.xlsx", credentials }), (error: unknown) => {
    assert.ok(error instanceof WrikeConnectionError); assert.equal(error.rotated_credentials, credentials); assert.match(error.message, /workbook/);
    assert.ok(!JSON.stringify(error).includes("secret")); return true;
  });
});
