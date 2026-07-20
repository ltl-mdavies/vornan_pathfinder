import assert from "node:assert/strict";
import test from "node:test";
import { runProofReadOnlySmoke } from "../smoke-proof-read-only.mjs";

const securityHeaders = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=()",
  "x-request-id": "qa-request-1",
  "content-type": "application/json"
};

function fakeResponse(status, body = { error: "Proof access is not available." }, headers = securityHeaders) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("passes a default-off same-origin read-only deployment", async () => {
  const calls = [];
  const result = await runProofReadOnlySmoke(
    {
      PATHFINDER_PROOF_SMOKE_BASE_URL: "https://proof-qa.example.invalid",
      PATHFINDER_PROOF_SMOKE_DIRECT_API_URL: "https://api-qa.example.invalid",
      PATHFINDER_PROOF_EXPECT_PUBLIC_READ: "false"
    },
    async (url, init = {}) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.startsWith("https://api-qa.example.invalid")) return fakeResponse(403);
      if (url.endsWith("/health")) {
        return fakeResponse(200, { phase: "tokenized_customer_read_foundation", public_read: false, decisions_enabled: false });
      }
      if (url.endsWith("/sessions")) return fakeResponse(503);
      if (url.endsWith("/order") || url.endsWith("/order/refresh")) return fakeResponse(401);
      return fakeResponse(404);
    }
  );
  assert.equal(result.decisions_enabled, false);
  assert.equal(result.direct_api_bypass_rejected, true);
  assert.equal(calls.some((call) => call.includes("approve")), true);
});

test("fails when a deployment exposes a public decision route", async () => {
  await assert.rejects(
    () => runProofReadOnlySmoke(
      { PATHFINDER_PROOF_SMOKE_BASE_URL: "https://proof-qa.example.invalid" },
      async (url) => {
        if (url.endsWith("/health")) {
          return fakeResponse(200, { phase: "tokenized_customer_read_foundation", public_read: false, decisions_enabled: false });
        }
        if (url.endsWith("/sessions")) return fakeResponse(503);
        if (url.endsWith("/order") || url.endsWith("/order/refresh")) return fakeResponse(401);
        if (url.includes("approve")) return fakeResponse(200);
        return fakeResponse(404);
      }
    ),
    /decision-route probe/
  );
});
