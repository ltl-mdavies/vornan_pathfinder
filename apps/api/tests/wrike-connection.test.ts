import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import request from "supertest";
import * as XLSX from "xlsx";

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
  process.env.PATHFINDER_ENABLE_WRIKE_WORKBOOK_EVIDENCE = "true";
  process.env.PATHFINDER_ENABLE_WRIKE_EVIDENCE_PREVIEW = "true";
  process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR = join(testDirectory, "source-evidence");
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
  assert.equal(saved.body.provider_status.workbook_evidence_enabled, true);
  assert.equal(saved.body.provider_status.evidence_preview_enabled, true);
  assert.equal(saved.body.provider_status.capabilities.task_discovery, true);
  assert.equal(saved.body.provider_status.capabilities.attachment_metadata, true);
  assert.equal(saved.body.provider_status.capabilities.attachment_download, true);
  assert.equal(saved.body.provider_status.capabilities.source_evidence_persistence, true);
  assert.equal(saved.body.provider_status.capabilities.preview_job_creation, true);
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
        quantity_column: "QTY",
        wrike: {
          connection_id: connectionId,
          folder_id: "IEAPPROVEDFOLDER",
          approved_discovery_task_id: "IEAPPROVEDTASK",
          trigger_status_id: "IESENTTOPRINTLTL",
          trigger_status_label: "Sent to Print - LTL",
          artwork_folder_custom_field_id: "IEARTWORKFOLDER",
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
          title: "C123456 - Private Momentara - OOH Order",
          customFields: [{
            id: "IEARTWORKFOLDER",
            value: "https://momentara.sharepoint.com/sites/art/Private-Momentara"
          }]
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
  assert.equal(response.body.observed.artwork_folder_status, "ready");
  assert.equal(response.body.capabilities.artwork_folder_value_read, true);
  assert.equal(response.body.capabilities.attachment_download, false);
  assert.deepEqual(calls, [
    "https://www.wrike.com/oauth2/token",
    "https://www.wrike.com/api/v4/tasks/IEAPPROVEDTASK?fields=%5B%22attachmentCount%22%5D",
    "https://www.wrike.com/api/v4/tasks/IEAPPROVEDTASK/attachments?versions=false&withUrls=false"
  ]);
  const publicPayload = JSON.stringify(response.body);
  assert.equal(publicPayload.includes("Private Momentara"), false);
  assert.equal(publicPayload.includes("temporary.example"), false);
  assert.equal(publicPayload.includes("momentara.sharepoint.com"), false);
  assert.equal(publicPayload.includes("discovery-access-token"), false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("discovery-rotated-refresh-token"), true);
});

test("stores qualified evidence, then creates and replays one saved-method preview without another Wrike call", async () => {
  await writeCustomerSourceConnectionSecrets(customerId, connectionId, {
    provider: "wrike",
    wrike: {
      oauth: {
        client_id: "evidence-client-id",
        client_secret: "evidence-client-secret",
        refresh_token: "evidence-refresh-token",
        host: "www.wrike.com"
      }
    }
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Order Number", "DESCRIPTION", "QTY"],
      ["C123456", "One Sheet Poster", 2]
    ]),
    "Sheet1"
  );
  const workbookBytes = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer);
  const calls: Array<{ url: string; headers: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers });
    if (url.endsWith("/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "evidence-access-token",
          refresh_token: "evidence-rotated-refresh-token",
          host: "www.wrike.com"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("withUrls=false")) {
      return new Response(
        JSON.stringify({
          data: [{
            id: "IEATTACHMENT0001",
            name: "C123456 - Private Momentara - OOH Order.xlsx"
          }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("withUrls=true")) {
      return new Response(
        JSON.stringify({
          data: [{
            id: "IEATTACHMENT0001",
            currentAttachmentId: "IEVERSION0002",
            name: "C123456 - Private Momentara - OOH Order.xlsx",
            updatedDate: "2026-07-23T14:00:00.000Z",
            url: "https://files.example.test/private-signed-url"
          }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url === "https://files.example.test/private-signed-url") {
      return new Response(workbookBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Length": String(workbookBytes.byteLength)
        }
      });
    }
    return new Response(
      JSON.stringify({
        data: [{
          id: "IEAPPROVEDTASK",
          accountId: "IEACCOUNT",
          parentIds: ["IEAPPROVEDFOLDER"],
          customStatusId: "IESENTTOPRINTLTL",
          attachmentCount: 1,
          title: "C123456 - Private Momentara - OOH Order",
          customFields: [{
            id: "IEARTWORKFOLDER",
            value: "https://momentara.sharepoint.com/sites/art/Private-Momentara"
          }]
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const stored = await request(app)
    .post(`/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence`)
    .expect(201);
  assert.equal(stored.body.status, "Stored");
  assert.equal(stored.body.evidence.length, 1);
  assert.equal(stored.body.evidence[0].storage_status, "Stored");
  assert.equal(stored.body.evidence[0].version_id, "IEVERSION0002");
  assert.equal(stored.body.evidence[0].byte_size, workbookBytes.byteLength);
  assert.match(stored.body.evidence[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(stored.body.capabilities.preview_job_creation, true);
  assert.equal(stored.body.capabilities.lift_actions, false);
  const publicPayload = JSON.stringify(stored.body);
  assert.equal(publicPayload.includes("private-signed-url"), false);
  assert.equal(publicPayload.includes("evidence-access-token"), false);
  assert.equal(publicPayload.includes("evidence-refresh-token"), false);

  const downloadCall = calls.find((call) => call.url === "https://files.example.test/private-signed-url");
  assert.deepEqual(downloadCall?.headers, { Accept: "*/*" });

  const replayed = await request(app)
    .post(`/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence`)
    .expect(200);
  assert.equal(replayed.body.status, "Replayed");
  assert.equal(replayed.body.evidence[0].storage_status, "Replayed");

  const evidence = stored.body.evidence[0];
  const wrikeCallsBeforePreview = calls.length;
  const preview = await request(app)
    .post(
      `/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence/${evidence.evidence_id}/preview`
    )
    .send({ extension: evidence.extension })
    .expect(201);
  assert.equal(preview.body.preview_status, "Created");
  assert.equal(preview.body.job.import_method_id, "manual-xlsx");
  assert.equal(preview.body.job.source_file_name, evidence.file_name);
  assert.equal(preview.body.job.source_evidence.evidence_id, evidence.evidence_id);
  assert.equal(preview.body.job.source_evidence.evidence_sha256, evidence.sha256);
  assert.equal(preview.body.job.source_evidence.account_id, "IEACCOUNT");
  assert.equal(preview.body.job.parsed_order_rows.length, 1);
  assert.equal(calls.length, wrikeCallsBeforePreview);

  const previewReplay = await request(app)
    .post(
      `/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence/${evidence.evidence_id}/preview`
    )
    .send({ extension: evidence.extension })
    .expect(200);
  assert.equal(previewReplay.body.preview_status, "Replayed");
  assert.equal(previewReplay.body.job.job_id, preview.body.job.job_id);
  assert.equal(previewReplay.body.workspace.jobs.length, preview.body.workspace.jobs.length);
  assert.equal(calls.length, wrikeCallsBeforePreview);

  await request(app)
    .put(`/api/customers/${customerId}/import-methods/manual-xlsx`)
    .send({ name: "Manual XLSX · revised saved contract" })
    .expect(200);
  const revisedPreview = await request(app)
    .post(
      `/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence/${evidence.evidence_id}/preview`
    )
    .send({ extension: evidence.extension })
    .expect(201);
  assert.equal(revisedPreview.body.preview_status, "Created");
  assert.notEqual(revisedPreview.body.job.job_id, preview.body.job.job_id);
  assert.notEqual(
    revisedPreview.body.job.source_evidence.import_method_fingerprint,
    preview.body.job.source_evidence.import_method_fingerprint
  );
  assert.equal(calls.length, wrikeCallsBeforePreview);
});
