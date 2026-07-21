import assert from "node:assert/strict";
import test from "node:test";
import {
  configurePathfinderApiAuth,
  PATHFINDER_SESSION_EXPIRED_MESSAGE,
  pathfinderFetch
} from "../src/api-client.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  configurePathfinderApiAuth({ apiBaseUrl: "https://api.pathfinder.test", token: null });
});

test("refreshes an expired Firebase token and retries one Pathfinder API request", async () => {
  const authorization: Array<string | null> = [];
  let tokenCalls = 0;

  globalThis.fetch = async (_input, init) => {
    const header = new Headers(init?.headers).get("Authorization");
    authorization.push(header);
    return new Response(null, { status: authorization.length === 1 ? 401 : 200 });
  };

  configurePathfinderApiAuth({
    apiBaseUrl: "https://api.pathfinder.test",
    token: "expired-token",
    getToken: async (forceRefresh) => {
      tokenCalls += 1;
      return forceRefresh ? "refreshed-token" : "expired-token";
    }
  });

  const response = await pathfinderFetch("https://api.pathfinder.test/api/customers");

  assert.equal(response.status, 200);
  assert.equal(tokenCalls, 2);
  assert.deepEqual(authorization, ["Bearer expired-token", "Bearer refreshed-token"]);
});

test("requires sign-in when forced token refresh cannot restore authorization", async () => {
  let expiredMessage = "";
  let requestCount = 0;

  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(null, { status: 401 });
  };

  configurePathfinderApiAuth({
    apiBaseUrl: "https://api.pathfinder.test",
    token: "expired-token",
    getToken: async (forceRefresh) => {
      if (forceRefresh) throw new Error("refresh failed");
      return "expired-token";
    },
    onSessionExpired: (message) => {
      expiredMessage = message;
    }
  });

  const response = await pathfinderFetch("https://api.pathfinder.test/api/customers");

  assert.equal(response.status, 401);
  assert.equal(requestCount, 1);
  assert.equal(expiredMessage, PATHFINDER_SESSION_EXPIRED_MESSAGE);
});

test("never attaches the Pathfinder bearer token to another origin", async () => {
  let authorization: string | null = "unexpected";
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("Authorization");
    return new Response(null, { status: 200 });
  };

  configurePathfinderApiAuth({
    apiBaseUrl: "https://api.pathfinder.test",
    token: "pathfinder-token",
    getToken: async () => "pathfinder-token"
  });

  await pathfinderFetch("https://example.test/catalog");
  assert.equal(authorization, null);
});
