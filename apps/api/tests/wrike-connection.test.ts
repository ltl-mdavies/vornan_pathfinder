import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import request from "supertest";

const customerId = "284619";
let testDirectory = "";
let connectionId = "";
let app: typeof import("../src/server.ts")["app"];
let writeCustomerSourceConnectionSecrets: typeof import("../src/secrets-store.ts")["writeCustomerSourceConnectionSecrets"];
let originalFetch: typeof fetch;

function connectionPath(suffix = "") {
  return `/api/customers/${customerId}/source-connections/${connectionId}${suffix}`;
}

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
  process.env.PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW = "true";
  originalFetch = globalThis.fetch;
  ({ app } = await import("../src/server.ts"));
  ({ writeCustomerSourceConnectionSecrets } = await import("../src/secrets-store.ts"));
});

after(async () => {
  globalThis.fetch = originalFetch;
  await rm(testDirectory, { recursive: true, force: true });
});

test("stores customer Wrike app credentials only in the isolated secret boundary", async () => {
  await request(app).get("/api/wrike/connection").expect(410);

  const planned = await request(app)
    .post(`/api/customers/${customerId}/source-connections`)
    .send({ provider: "odoo", name: "Momentara Odoo" })
    .expect(409);
  assert.match(planned.body.error, /planned but is not available/i);

  const created = await request(app)
    .post(`/api/customers/${customerId}/source-connections`)
    .send({ provider: "wrike", name: "Momentara Wrike", environment: "Production" })
    .expect(201);
  connectionId = created.body.connection_id;
  assert.match(connectionId, /^source_wrike_/);

  const saved = await request(app)
    .put(connectionPath())
    .send({
      name: "Momentara Wrike",
      environment: "Production",
      status: "Active",
      client_id: "wrike-client-id",
      client_secret: "wrike-client-secret"
    })
    .expect(200);

  assert.equal(saved.body.provider, "wrike");
  assert.equal(saved.body.status, "Active");
  assert.equal(saved.body.provider_status.configured, false);
  assert.equal(saved.body.provider_status.oauth_connect_ready, true);
  assert.deepEqual(saved.body.provider_status.credentials, {
    client_id_configured: true,
    client_secret_configured: true,
    refresh_token_configured: false,
    access_token_cached: false,
    access_token_expires_at: null
  });
  assert.equal(saved.body.provider_status.discovery_preview_enabled, true);
  assert.equal(saved.body.provider_status.capabilities.attachment_download, false);
  assert.equal(saved.body.provider_status.capabilities.wrike_writes, false);
  assert.equal(JSON.stringify(saved.body).includes("wrike-client-secret"), false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("wrike-client-secret"), true);
  assert.equal(stored.includes(connectionId), true);
  assert.equal(stored.includes(`"${customerId}"`), true);

  const loaded = await request(app)
    .get(`/api/customers/${customerId}/source-connections`)
    .expect(200);
  assert.equal(loaded.body.connections.length, 1);
  assert.equal(loaded.body.connections[0].connection_id, connectionId);
  assert.equal(JSON.stringify(loaded.body).includes("wrike-client-secret"), false);

  const otherCustomer = await request(app)
    .get("/api/customers/customer-isolation-check/source-connections")
    .expect(200);
  assert.deepEqual(otherCustomer.body.connections, []);

  await request(app)
    .put(`/api/customers/customer-isolation-check/source-connections/${connectionId}`)
    .send({ name: "Must not cross customer boundaries" })
    .expect(404);

  const metadataOnlyUpdate = await request(app)
    .put(connectionPath())
    .send({ name: "Momentara Wrike API" })
    .expect(200);
  assert.equal(metadataOnlyUpdate.body.environment, "Production");
});

test("runs only OAuth refresh and the read-only authorized-user endpoint", async () => {
  await writeCustomerSourceConnectionSecrets(customerId, connectionId, {
    provider: "wrike",
    wrike: {
      oauth: {
        client_id: "wrike-client-id",
        client_secret: "wrike-client-secret",
        refresh_token: "wrike-refresh-token",
        host: "www.wrike.com"
      }
    }
  });

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

  const response = await request(app).post(connectionPath("/wrike/test")).expect(200);
  assert.deepEqual(calls, [
    "https://www.wrike.com/oauth2/token",
    "https://www.wrike.com/api/v4/contacts?me=true"
  ]);
  assert.equal(calls.some((url) => /tasks|folders|attachments|webhooks/.test(url)), false);
  assert.equal(response.body.provider_status.health.status, "Connected");
  assert.equal(response.body.provider_status.health.identity_confirmed, true);
  assert.equal(JSON.stringify(response.body).includes("rotated-access"), false);
  assert.equal(JSON.stringify(response.body).includes("rotated-refresh"), false);
});

test("rejects a non-Wrike OAuth host before contacting a provider", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Provider must not be contacted.");
  };
  await writeCustomerSourceConnectionSecrets(customerId, connectionId, {
    provider: "wrike",
    wrike: {
      oauth: {
        client_id: "x",
        client_secret: "y",
        refresh_token: "z",
        host: "https://example.com/api/v4"
      }
    }
  });

  await request(app).post(connectionPath("/wrike/test")).expect(400);
  assert.equal(fetchCalls, 0);
});

test("persists rotated OAuth credentials when the identity check fails", async () => {
  await writeCustomerSourceConnectionSecrets(customerId, connectionId, {
    provider: "wrike",
    wrike: {
      oauth: {
        client_id: "wrike-client-id",
        client_secret: "wrike-client-secret",
        refresh_token: "wrike-refresh-token",
        host: "www.wrike.com"
      }
    }
  });
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

  const response = await request(app).post(connectionPath("/wrike/test")).expect(502);
  assert.equal(response.body.health.status, "Error");
  assert.equal(response.body.host, "app-eu.wrike.com");
  assert.equal(JSON.stringify(response.body).includes("failure-path-refresh"), false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("failure-path-refresh"), true);
  assert.equal(stored.includes("failure-path-access"), true);
});

test("runs a bounded saved-scope discovery preview through the Import Method's customer connection", async () => {
  await writeCustomerSourceConnectionSecrets(customerId, connectionId, {
    provider: "wrike",
    wrike: {
      oauth: {
        client_id: "discovery-client-id",
        client_secret: "discovery-client-secret",
        refresh_token: "discovery-refresh-token",
        host: "www.wrike.com"
      }
    }
  });

  await request(app)
    .put(`/api/customers/${customerId}/import-methods/manual-xlsx`)
    .send({
      source: "Wrike",
      type: "Scheduled",
      source_config: {
        wrike: {
          connection_id: connectionId,
          folder_id: "IEAPPROVEDFOLDER",
          approved_discovery_task_id: "IEAPPROVEDTASK",
          trigger_status_id: "IESENTTOPRINTLTL",
          trigger_status_label: "Sent to Print - LTL",
          attachment_filename_contains: "",
          attachment_extensions: ["xlsx"]
        }
      }
    })
    .expect(200);

  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "discovery-access-token",
          refresh_token: "discovery-rotated-refresh-token",
          host: "www.wrike.com"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/attachments")) {
      return new Response(
        JSON.stringify({
          data: [{
            id: "IEATTACHMENT0001",
            version: 2,
            name: "C123456 - Private Momentara - OOH Order.xlsx",
            url: "https://temporary.example/private-download"
          }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        data: [{
          id: "IEAPPROVEDTASK",
          accountId: "IEACCOUNT",
          parentIds: ["IEAPPROVEDFOLDER"],
          customStatusId: "IESENTTOPRINTLTL",
          attachmentCount: 1,
          title: "C123456 - Private Momentara - OOH Order"
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const response = await request(app)
    .post(`/api/customers/${customerId}/import-methods/manual-xlsx/wrike/discovery-preview`)
    .expect(200);

  assert.equal(response.body.status, "Confirmed");
  assert.equal(response.body.observed.task_id, "IEAPPROVEDTASK");
  assert.equal(response.body.observed.workbook_candidate_count, 1);
  assert.equal(response.body.capabilities.attachment_download, false);
  assert.deepEqual(calls, [
    "https://www.wrike.com/oauth2/token",
    "https://www.wrike.com/api/v4/tasks/IEAPPROVEDTASK?fields=%5B%22attachmentCount%22%5D",
    "https://www.wrike.com/api/v4/tasks/IEAPPROVEDTASK/attachments?versions=false&withUrls=false"
  ]);
  const publicPayload = JSON.stringify(response.body);
  assert.equal(publicPayload.includes("Private Momentara"), false);
  assert.equal(publicPayload.includes("temporary.example"), false);
  assert.equal(publicPayload.includes("discovery-access-token"), false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("discovery-rotated-refresh-token"), true);
});
