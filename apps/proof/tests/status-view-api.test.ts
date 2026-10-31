import assert from "node:assert/strict";
import test from "node:test";
import { endSession, exchangeToken, loadProofOrder } from "../src/api.ts";

test("Status entry uses its isolated session, CSRF and exact order without touching normal Proof", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousFetch = globalThis.fetch;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  try {
    const location = { search: "?statusView=1&statusOrder=A0233367", hash: "#/proof" };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "vornan_proof_csrf=normal; vornan_proof_status_csrf=status" } });
    globalThis.fetch = (async (path, init) => {
      calls.push({ path: String(path), init: init! });
      return { status: 200, ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
    await exchangeToken("synthetic"); await loadProofOrder(); await endSession();
    assert.deepEqual(calls.map(call => call.path), ["/api/public/proof/status-view/sessions", "/api/public/proof/status-view/order", "/api/public/proof/status-view/sessions/current"]);
    for (const call of calls) assert.equal((call.init.headers as Record<string,string>)["X-Vornan-Proof-Status-Order"], "A0233367");
    assert.equal((calls[2]!.init.headers as Record<string,string>)["X-Vornan-Proof-Csrf"], "status");
    location.search = "?statusView=1";
    await assert.rejects(() => exchangeToken("synthetic"));
    assert.equal(calls.length, 3);
    location.search = "";
    await endSession();
    assert.equal(calls[3]!.path, "/api/public/proof/sessions/current");
    assert.equal((calls[3]!.init.headers as Record<string,string>)["X-Vornan-Proof-Csrf"], "normal");
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, descriptor] of [["window", previousWindow], ["document", previousDocument]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
