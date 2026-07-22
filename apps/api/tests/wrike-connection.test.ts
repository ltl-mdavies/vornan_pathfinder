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
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-wrike-connection-test-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_STORE_PATH = join(testDirectory, "store.json");
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");
  process.env.PATHFINDER_REQUIRE_AUTH = "false";
  process.env.PATHFINDER_ENABLE_LIFT_SUBMIT = "false";
  process.env.PATHFINDER_ENABLE_WRIKE_CONNECTION_TEST = "true";
  originalFetch = globalThis.fetch;
  ({ app } = await import("../src/server.ts"));
});

after(async () => {
  globalThis.fetch = originalFetch;
  await rm(testDirectory, { recursive: true, force: true });
});

test("stores Wrike OAuth material only in the secret boundary and returns redacted posture", async () => {
  const saved = await request(app)
    .put("/api/wrike/connection")
    .send({
      host: "www.wrike.com",
      client_id: "wrike-client-id",
      client_secret: "wrike-client-secret",
      refresh_token: "wrike-refresh-token"
    })
    .expect(200);

  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.host, "www.wrike.com");
  assert.deepEqual(saved.body.credentials, {
    client_id_configured: true,
    client_secret_configured: true,
    refresh_token_configured: true,
    access_token_cached: false,
    access_token_expires_at: null
  });
  assert.equal(saved.body.capabilities.task_discovery, false);
  assert.equal(saved.body.capabilities.wrike_writes, false);
  assert.equal(JSON.stringify(saved.body).includes("wrike-client-secret"), false);
  assert.equal(JSON.stringify(saved.body).includes("wrike-refresh-token"), false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("wrike-client-secret"), true);
  assert.equal(stored.includes("wrike-refresh-token"), true);

  const loaded = await request(app).get("/api/wrike/connection").expect(200);
  assert.equal(loaded.body.health.status, "Not tested");
  assert.equal(JSON.stringify(loaded.body).includes("wrike-refresh-token"), false);
});

test("runs only OAuth refresh and the read-only authorized-user endpoint", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
          host: "www.wrike.com"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ data: [{ id: "CURRENTUSER" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const response = await request(app).post("/api/wrike/connection/test").expect(200);
  assert.deepEqual(calls, [
    "https://www.wrike.com/oauth2/token",
    "https://www.wrike.com/api/v4/contacts?me=true"
  ]);
  assert.equal(calls.some((url) => /tasks|folders|attachments|webhooks/.test(url)), false);
  assert.equal(response.body.health.status, "Connected");
  assert.equal(response.body.health.identity_confirmed, true);
  assert.equal(JSON.stringify(response.body).includes("rotated-access"), false);
  assert.equal(JSON.stringify(response.body).includes("rotated-refresh"), false);
});

test("rejects non-Wrike and path-bearing hosts before storing credentials", async () => {
  await request(app)
    .put("/api/wrike/connection")
    .send({ host: "https://example.com/api/v4", client_id: "x", client_secret: "y", refresh_token: "z" })
    .expect(400);
});

test("persists rotated OAuth credentials when the identity check fails", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "failure-path-access",
          refresh_token: "failure-path-refresh",
          expires_in: 3600,
          host: "app-eu.wrike.com"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: "temporarily unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  };

  const response = await request(app).post("/api/wrike/connection/test").expect(502);
  assert.equal(response.body.health.status, "Error");
  assert.equal(response.body.host, "app-eu.wrike.com");
  assert.equal(JSON.stringify(response.body).includes("failure-path-refresh"), false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("failure-path-refresh"), true);
  assert.equal(stored.includes("failure-path-access"), true);
});
