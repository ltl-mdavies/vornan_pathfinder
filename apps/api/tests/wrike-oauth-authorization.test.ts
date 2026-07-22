import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import request from "supertest";

let testDirectory = "";
let app: typeof import("../src/server.ts")["app"];
let originalFetch: typeof fetch;

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-wrike-oauth-test-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_STORE_PATH = join(testDirectory, "store.json");
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");
  process.env.PATHFINDER_REQUIRE_AUTH = "false";
  process.env.PATHFINDER_ENABLE_LIFT_SUBMIT = "false";
  process.env.PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST = "false";
  process.env.PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW = "false";
  process.env.PATHFINDER_WRIKE_OAUTH_REDIRECT_URI = "https://api.pathfinder.vornan.co/oauth/wrike/callback";
  process.env.PATHFINDER_APP_BASE_URL = "https://pathfinder.vornan.co";
  originalFetch = globalThis.fetch;
  ({ app } = await import("../src/server.ts"));
});

after(async () => {
  globalThis.fetch = originalFetch;
  await rm(testDirectory, { recursive: true, force: true });
});

test("authorizes Wrike with expiring one-time state and stores tokens only in the secret boundary", async () => {
  const saved = await request(app)
    .put("/api/wrike/connection")
    .send({ client_id: "wrike-client-id", client_secret: "wrike-client-secret" })
    .expect(200);
  assert.equal(saved.body.oauth_connect_ready, true);
  assert.equal(saved.body.configured, false);
  assert.equal(saved.body.oauth_redirect_uri, "https://api.pathfinder.vornan.co/oauth/wrike/callback");

  const started = await request(app).post("/api/wrike/oauth/start").expect(200);
  const authorizationUrl = new URL(started.body.authorization_url);
  const state = authorizationUrl.searchParams.get("state") ?? "";
  assert.equal(authorizationUrl.origin, "https://login.wrike.com");
  assert.equal(authorizationUrl.searchParams.get("scope"), "wsReadOnly");
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    "https://api.pathfinder.vornan.co/oauth/wrike/callback"
  );
  assert.ok(state.length >= 32);

  const pendingSecret = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(pendingSecret.includes(state), false);
  assert.equal(pendingSecret.includes("state_hash"), true);
  assert.equal(pendingSecret.includes("refresh-token"), false);

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        access_token: "authorized-access-token",
        refresh_token: "authorized-refresh-token",
        expires_in: 3600,
        host: "app-us2.wrike.com"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const callback = await request(app)
    .get("/oauth/wrike/callback")
    .query({ code: "one-time-code", state })
    .expect(303);
  assert.equal(callback.headers.location, "https://pathfinder.vornan.co/?wrike_oauth=connected");
  assert.equal(callback.headers["cache-control"], "no-store");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://login.wrike.com/oauth2/token");
  const tokenBody = calls[0].init?.body as URLSearchParams;
  assert.equal(tokenBody.get("code"), "one-time-code");
  assert.equal(tokenBody.get("grant_type"), "authorization_code");

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("authorized-access-token"), true);
  assert.equal(stored.includes("authorized-refresh-token"), true);
  assert.equal(stored.includes("oauth_pending"), false);

  const status = await request(app).get("/api/wrike/connection").expect(200);
  assert.equal(status.body.configured, true);
  assert.equal(status.body.host, "app-us2.wrike.com");
  assert.equal(status.body.health.status, "Not tested");
  assert.equal(status.body.connection_test_enabled, false);
  assert.equal(status.body.discovery_preview_enabled, false);
  assert.equal(status.body.capabilities.task_discovery, false);
  assert.equal(JSON.stringify(status.body).includes("authorized-access-token"), false);
  assert.equal(JSON.stringify(status.body).includes("authorized-refresh-token"), false);

  await request(app)
    .get("/oauth/wrike/callback")
    .query({ code: "replayed-code", state })
    .expect(303)
    .expect("Location", "https://pathfinder.vornan.co/?wrike_oauth=error&reason=invalid_state");
  assert.equal(calls.length, 1);
});

test("does not consume a valid pending authorization when an unrelated state is presented", async () => {
  const started = await request(app).post("/api/wrike/oauth/start").expect(200);
  const state = new URL(started.body.authorization_url).searchParams.get("state") ?? "";

  await request(app)
    .get("/oauth/wrike/callback")
    .query({ code: "attacker-code", state: "unrelated-state" })
    .expect(303)
    .expect("Location", "https://pathfinder.vornan.co/?wrike_oauth=error&reason=invalid_state");

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("oauth_pending"), true);
  assert.equal(stored.includes(state), false);
});

test("invalidates the prior Wrike grant when app credentials change", async () => {
  const response = await request(app)
    .put("/api/wrike/connection")
    .send({ client_id: "replacement-client-id", client_secret: "replacement-client-secret" })
    .expect(200);

  assert.equal(response.body.oauth_connect_ready, true);
  assert.equal(response.body.configured, false);
  assert.equal(response.body.host, null);
  assert.equal(response.body.authorization_pending, false);
  assert.equal(response.body.health.identity_confirmed, false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("authorized-access-token"), false);
  assert.equal(stored.includes("authorized-refresh-token"), false);
  assert.equal(stored.includes("app-us2.wrike.com"), false);
});
