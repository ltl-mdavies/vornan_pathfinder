import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSharedProofLink, loadSharedProofLinks, revokeSharedProofLink, shareRecoveryStorageKey } from "../src/api";

test("all sharing operations bind the displayed order and session; mutations retain CSRF", async () => {
  const originalFetch = globalThis.fetch, originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const calls: Array<{ path: string; init: RequestInit }> = [];
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "vornan_proof_csrf=local-only-token" } });
    globalThis.fetch = (async (path, init) => {
      calls.push({ path: String(path), init: init! });
      return { ok: true, status: 200, json: async () => ({ links: [] }) } as Response;
    }) as typeof fetch;
    const authority = { expected_order_number: "A0232139", expected_share_context: "context-A" };
    await loadSharedProofLinks(authority);
    await createSharedProofLink({ ...authority, idempotency_key: "request-A", scope: "view", days: 1, description: "Art team" });
    await revokeSharedProofLink("link-A", authority);
    for (const call of [calls[0]!, calls[2]!]) {
      const url = new URL(call.path, "https://proof.example.invalid");
      assert.equal(url.searchParams.get("order"), authority.expected_order_number);
      assert.equal(url.searchParams.get("context"), authority.expected_share_context);
    }
    assert.deepEqual(JSON.parse(calls[1]!.init.body as string), { ...authority, idempotency_key: "request-A", scope: "view", days: 1, description: "Art team" });
    for (const call of [calls[1]!, calls[2]!]) assert.equal((call.init.headers as Record<string, string>)["X-Vornan-Proof-Csrf"], "local-only-token");
    const key = await shareRecoveryStorageKey("A0232139");
    assert.ok(key?.startsWith("proof-share-request:A0232139:"));
    assert.equal(key?.includes("local-only-token"), false);
    Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "vornan_proof_csrf=another-session" } });
    assert.notEqual(await shareRecoveryStorageKey("A0232139"), key);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("share panel stays gated, guards delayed lists, preserves recovery and reconciles revoked URLs", () => {
  const source = readFileSync(new URL("../src/share-order.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /access\.sharing_enabled && order!\.access\.sharing_context/);
  assert.match(source, /requestId === listRequest\.current && version === mutationVersion\.current/);
  assert.match(source, /refreshed && live\(refreshed\)/);
  assert.match(source, /saved\.expected_share_context === authority\.expected_share_context/);
  assert.match(source, /pending\.current \?\? \{ \.\.\.authority/);
  assert.match(source, /failure\.code === "access_changed"/);
  assert.match(source, /failure\.code === "request_conflict"/);
  assert.match(source, /navigator\.clipboard\.writeText\(created\.access_url\); setCopyState\("Copied"\)/);
  assert.doesNotMatch(source, /sessionStorage\.setItem\([^\n]*(access_url|csrf)/);
  assert.match(source, /onClose=\{\(\) => \{ setRevokeId\(null\); opener\.current\?\.focus/);
});
