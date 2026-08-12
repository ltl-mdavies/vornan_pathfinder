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

function rehearsalRequest(extension?: string) {
  return {
    ...(extension ? { extension } : {}),
    task_id: "IEAPPROVEDTASK",
    confirmation_phrase: "PREPARE WRIKE PREVIEW IEAPPROVEDTASK"
  };
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
  process.env.PATHFINDER_ENABLE_WRIKE_CUSTOM_FIELD_DISCOVERY = "true";
  process.env.PATHFINDER_ENABLE_WRIKE_DISCOVERY_PREVIEW = "true";
  process.env.PATHFINDER_ENABLE_WRIKE_WORKBOOK_EVIDENCE = "true";
  process.env.PATHFINDER_ENABLE_WRIKE_EVIDENCE_PREVIEW = "true";
  process.env.PATHFINDER_ENABLE_WRIKE_MANUAL_INTAKE = "true";
  process.env.PATHFINDER_ENABLE_WRIKE_ORDER_REHEARSAL = "true";
  process.env.PATHFINDER_WRIKE_ORDER_REHEARSAL_CUSTOMER_ID = customerId;
  process.env.PATHFINDER_WRIKE_ORDER_REHEARSAL_IMPORT_METHOD_ID = "manual-xlsx";
  process.env.PATHFINDER_WRIKE_ORDER_REHEARSAL_TASK_ID = "IEAPPROVEDTASK";
  process.env.PATHFINDER_WRIKE_ORDER_REHEARSAL_EXPIRES_AT = new Date(
    Date.now() + 60 * 60 * 1000
  ).toISOString();
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
  assert.equal(saved.body.provider_status.custom_field_discovery_enabled, true);
  assert.equal(saved.body.provider_status.workbook_evidence_enabled, true);
  assert.equal(saved.body.provider_status.evidence_preview_enabled, true);
  assert.equal(saved.body.provider_status.manual_intake_enabled, true);
  assert.equal(saved.body.provider_status.capabilities.task_discovery, true);
  assert.equal(saved.body.provider_status.capabilities.custom_field_metadata, true);
  assert.equal(saved.body.provider_status.capabilities.attachment_metadata, true);
  assert.equal(saved.body.provider_status.capabilities.attachment_download, true);
  assert.equal(saved.body.provider_status.capabilities.source_evidence_persistence, true);
  assert.equal(saved.body.provider_status.capabilities.preview_job_creation, true);
  assert.equal(saved.body.provider_status.capabilities.manual_intake, true);
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

test("discovers only the four requested Wrike custom-field definitions", async () => {
  await writeCustomerSourceConnectionSecrets(customerId, connectionId, {
    provider: "wrike",
    wrike: {
      oauth: {
        client_id: "field-client-id",
        client_secret: "field-client-secret",
        refresh_token: "field-refresh-token",
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
          access_token: "field-access-token",
          refresh_token: "field-rotated-refresh-token",
          host: "www.wrike.com"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        kind: "customfields",
        data: [
          { id: "IECONTRACT", title: "Contract Number", type: "Text" },
          { id: "IEARTWORK", title: "LTL Artwork Folder URL", type: "Text" },
          { id: "IEEXCEPTION", title: "LTL Exception", type: "Checkbox" },
          { id: "IEVENDOR", title: "Print Vendor", type: "DropDown" },
          { id: "IEPRIVATE", title: "Private Unrelated Field", type: "Text" }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const response = await request(app)
    .post(connectionPath("/wrike/custom-fields/discover"))
    .expect("Cache-Control", "no-store")
    .expect(200);

  assert.deepEqual(calls, [
    "https://www.wrike.com/oauth2/token",
    "https://www.wrike.com/api/v4/customfields"
  ]);
  assert.deepEqual(response.body.requested_titles, [
    "Contract Number",
    "LTL Artwork Folder URL",
    "LTL Exception",
    "Print Vendor"
  ]);
  assert.deepEqual(response.body.fields, [
    { id: "IECONTRACT", title: "Contract Number", type: "Text" },
    { id: "IEARTWORK", title: "LTL Artwork Folder URL", type: "Text" },
    { id: "IEEXCEPTION", title: "LTL Exception", type: "Checkbox" },
    { id: "IEVENDOR", title: "Print Vendor", type: "DropDown" }
  ]);
  assert.deepEqual(response.body.missing_titles, []);
  assert.equal(response.body.capabilities.task_values_read, false);
  assert.equal(response.body.capabilities.attachment_metadata_read, false);
  assert.equal(response.body.capabilities.wrike_writes, false);
  const publicPayload = JSON.stringify(response.body);
  assert.equal(publicPayload.includes("Private Unrelated Field"), false);
  assert.equal(publicPayload.includes("field-access-token"), false);
  assert.equal(publicPayload.includes("field-rotated-refresh-token"), false);

  const stored = await readFile(join(testDirectory, "secrets.json"), "utf8");
  assert.equal(stored.includes("field-rotated-refresh-token"), true);
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
          contract_number_custom_field_id: "IECONTRACT",
          artwork_folder_custom_field_id: "IEARTWORKFOLDER",
          print_vendor_custom_field_id: "IEVENDOR",
          attachment_filename_contains: "",
          attachment_extensions: ["xlsx"],
          reference_proof_intake: {
            enabled: true,
            filename_contains: "Proof",
            attachment_extensions: ["pdf"]
          }
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
            name: "Momentara_3 product_DEMO.xlsx",
            url: "https://temporary.example/private-download"
          }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url === "https://www.wrike.com/api/v4/folders/IEAPPROVEDFOLDER") {
      return new Response(
        JSON.stringify({
          data: [{
            id: "IEAPPROVEDFOLDER",
            title: "MDHHS - Eat Safe Fish FY 26 - GPA - C316969",
            parentIds: []
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
          title: "Placard Order",
          customFields: [
            { id: "IECONTRACT", value: "C3168700" },
            { id: "IEVENDOR", value: "Larger Than Life" },
            {
              id: "IEARTWORKFOLDER",
              value: "https://momentara.sharepoint.com/sites/art/Private-Momentara"
            }
          ]
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const response = await request(app)
    .post(`/api/customers/${customerId}/import-methods/manual-xlsx/wrike/discovery-preview`)
    .send(rehearsalRequest())
    .expect(200);

  assert.equal(response.body.status, "Confirmed");
  assert.equal(response.body.observed.task_id, "IEAPPROVEDTASK");
  assert.equal(response.body.observed.workbook_candidate_count, 1);
  assert.equal(response.body.observed.artwork_folder_status, "ready");
  assert.equal(response.body.capabilities.artwork_folder_value_read, true);
  assert.equal(response.body.capabilities.attachment_download, false);
  assert.deepEqual(calls, [
    "https://www.wrike.com/oauth2/token",
    "https://www.wrike.com/api/v4/tasks/IEAPPROVEDTASK",
    "https://www.wrike.com/api/v4/folders/IEAPPROVEDFOLDER",
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

test("stores qualified evidence, then creates a context-bound Wrike preview with its artwork link", async () => {
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
  const proofBytes = new TextEncoder().encode("%PDF-1.7 synthetic campaign reference");
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
          data: [
            {
              id: "IEATTACHMENT0001",
              name: "Momentara_3 product_DEMO.xlsx"
            },
            {
              id: "IEREFERENCEPROOF0001",
              name: "C3168700 - Campaign Proof.pdf"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("withUrls=true")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "IEATTACHMENT0001",
              currentAttachmentId: "IEVERSION0002",
              name: "Momentara_3 product_DEMO.xlsx",
              updatedDate: "2026-07-23T14:00:00.000Z",
              url: "https://files.example.test/private-signed-url"
            },
            {
              id: "IEREFERENCEPROOF0001",
              currentAttachmentId: "IEREFERENCEPROOFVERSION0002",
              name: "C3168700 - Campaign Proof.pdf",
              updatedDate: "2026-07-23T14:01:00.000Z",
              url: "https://files.example.test/private-proof-url"
            }
          ]
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
    if (url === "https://files.example.test/private-proof-url") {
      return new Response(proofBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(proofBytes.byteLength)
        }
      });
    }
    if (url === "https://www.wrike.com/api/v4/folders/IEAPPROVEDFOLDER") {
      return new Response(
        JSON.stringify({
          data: [{
            id: "IEAPPROVEDFOLDER",
            title: "MDHHS - Eat Safe Fish FY 26 - GPA - C316969",
            parentIds: []
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
          attachmentCount: 2,
          title: "Placard Order",
          customFields: [
            { id: "IECONTRACT", value: "C3168700" },
            { id: "IEVENDOR", value: "Larger Than Life" },
            {
              id: "IEARTWORKFOLDER",
              value: "https://momentara.sharepoint.com/sites/art/Private-Momentara"
            }
          ]
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const stored = await request(app)
    .post(`/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence`)
    .send(rehearsalRequest())
    .expect(201);
  assert.equal(stored.body.status, "Stored");
  assert.equal(stored.body.evidence.length, 1);
  assert.equal(stored.body.evidence[0].storage_status, "Stored");
  assert.equal(stored.body.evidence[0].version_id, "IEVERSION0002");
  assert.equal(stored.body.evidence[0].byte_size, workbookBytes.byteLength);
  assert.match(stored.body.evidence[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(stored.body.reference_proof_evidence.document_role, "reference_proof");
  assert.equal(stored.body.reference_proof_evidence.extension, "pdf");
  assert.equal(stored.body.reference_proof_evidence.byte_size, proofBytes.byteLength);
  assert.match(stored.body.reference_proof_evidence.sha256, /^[a-f0-9]{64}$/);
  assert.equal(stored.body.capabilities.preview_job_creation, true);
  assert.equal(stored.body.capabilities.lift_actions, false);
  const publicPayload = JSON.stringify(stored.body);
  assert.equal(publicPayload.includes("private-signed-url"), false);
  assert.equal(publicPayload.includes("private-proof-url"), false);
  assert.equal(publicPayload.includes("momentara.sharepoint.com"), false);
  assert.equal(publicPayload.includes("evidence-access-token"), false);
  assert.equal(publicPayload.includes("evidence-refresh-token"), false);

  const downloadCall = calls.find((call) => call.url === "https://files.example.test/private-signed-url");
  assert.deepEqual(downloadCall?.headers, { Accept: "*/*" });
  const proofDownloadCall = calls.find((call) => call.url === "https://files.example.test/private-proof-url");
  assert.deepEqual(proofDownloadCall?.headers, { Accept: "application/pdf" });

  const replayed = await request(app)
    .post(`/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence`)
    .send(rehearsalRequest())
    .expect(200);
  assert.equal(replayed.body.status, "Replayed");
  assert.equal(replayed.body.evidence[0].storage_status, "Replayed");
  assert.equal(replayed.body.reference_proof_evidence.storage_status, "Replayed");

  const evidence = stored.body.evidence[0];
  const wrikeCallsBeforePreview = calls.length;
  const preview = await request(app)
    .post(
      `/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence/${evidence.evidence_id}/preview`
    )
    .send(rehearsalRequest(evidence.extension))
    .expect(201);
  assert.equal(preview.body.preview_status, "Created");
  assert.equal(preview.body.job.import_method_id, "manual-xlsx");
  assert.equal(preview.body.job.source_file_name, evidence.file_name);
  assert.equal(preview.body.job.source_evidence.evidence_id, evidence.evidence_id);
  assert.equal(preview.body.job.source_evidence.evidence_sha256, evidence.sha256);
  assert.equal(preview.body.job.source_evidence.account_id, "IEACCOUNT");
  assert.equal(preview.body.job.parsed_order_rows.length, 1);
  assert.equal(preview.body.job.canonical_order.order.artwork_folder_url, null);
  assert.equal(calls.length, wrikeCallsBeforePreview);

  const previewReplay = await request(app)
    .post(
      `/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence/${evidence.evidence_id}/preview`
    )
    .send(rehearsalRequest(evidence.extension))
    .expect(200);
  assert.equal(previewReplay.body.preview_status, "Replayed");
  assert.equal(previewReplay.body.job.job_id, preview.body.job.job_id);
  assert.equal(previewReplay.body.workspace.jobs.length, preview.body.workspace.jobs.length);
  assert.equal(calls.length, wrikeCallsBeforePreview);

  const unresolvedMapping = preview.body.job.unresolved_products[0];
  assert.ok(unresolvedMapping?.mapping_id);
  await request(app)
    .put(`/api/customers/${customerId}/product-mappings/${unresolvedMapping.mapping_id}`)
    .send({
      status: "Mapped",
      lift_product_id: "358208",
      product_identifier_value: "358208",
      product_name: "One Sheet Poster"
    })
    .expect(200);
  const mappingReprocessedPreview = await request(app)
    .post(
      `/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence/${evidence.evidence_id}/preview`
    )
    .send(rehearsalRequest(evidence.extension))
    .expect(200);
  assert.equal(mappingReprocessedPreview.body.preview_status, "Replayed");
  assert.equal(mappingReprocessedPreview.body.job.job_id, preview.body.job.job_id);
  assert.notEqual(
    mappingReprocessedPreview.body.job.source_evidence.import_method_fingerprint,
    preview.body.job.source_evidence.import_method_fingerprint
  );
  assert.equal(mappingReprocessedPreview.body.job.unresolved_products.length, 0);
  assert.equal(mappingReprocessedPreview.body.job.product_resolution_results[0].status, "Mapped");
  assert.equal(
    mappingReprocessedPreview.body.job.product_resolution_results[0].resolved_product_identifier,
    "358208"
  );
  assert.equal(calls.length, wrikeCallsBeforePreview);

  const prepared = await request(app)
    .post(`/api/customers/${customerId}/import-methods/manual-xlsx/wrike/prepare-order`)
    .send(rehearsalRequest())
    .expect(200);
  assert.equal(prepared.body.status, "Prepared");
  assert.equal(prepared.body.task_id, "IEAPPROVEDTASK");
  assert.deepEqual(prepared.body.summary, {
    workbook_count: 1,
    created_count: 0,
    replayed_count: 1,
    blocked_count: 0
  });
  assert.equal(prepared.body.workbooks[0].evidence_id, evidence.evidence_id);
  assert.equal(prepared.body.workbooks[0].preview_status, "Replayed");
  assert.equal(prepared.body.workbooks[0].job_id, preview.body.job.job_id);
  assert.equal(prepared.body.capabilities.operator_controlled, true);
  assert.equal(prepared.body.capabilities.polling, false);
  assert.equal(prepared.body.capabilities.webhook, false);
  assert.equal(prepared.body.capabilities.wrike_writes, false);
  assert.equal(prepared.body.capabilities.lift_actions, false);
  assert.equal(JSON.stringify(prepared.body).includes("private-signed-url"), false);
  assert.equal(JSON.stringify(prepared.body).includes("evidence-access-token"), false);
  assert.equal(JSON.stringify(prepared.body).includes("Private-Momentara"), false);
  const preparedJob = await request(app)
    .get(`/api/customers/${customerId}/jobs/${prepared.body.workbooks[0].job_id}`)
    .expect(200);
  assert.equal(
    preparedJob.body.job.canonical_order.order.artwork_folder_url,
    "https://momentara.sharepoint.com/sites/art/Private-Momentara"
  );
  assert.equal(
    preparedJob.body.job.lift_payload.order.artwork_folder_url,
    "https://momentara.sharepoint.com/sites/art/Private-Momentara"
  );
  assert.equal("FLEX_FIELD9" in preparedJob.body.job.lift_payload.order, false);
  assert.equal(preparedJob.body.job.canonical_order.source.source_record_id, "IEAPPROVEDTASK");
  const wrikeCallsAfterPrepare = calls.length;

  await request(app)
    .put(`/api/customers/${customerId}/import-methods/manual-xlsx`)
    .send({ name: "Manual XLSX · revised saved contract" })
    .expect(200);
  const revisedPreview = await request(app)
    .post(
      `/api/customers/${customerId}/import-methods/manual-xlsx/wrike/workbook-evidence/${evidence.evidence_id}/preview`
    )
    .send(rehearsalRequest(evidence.extension))
    .expect(200);
  assert.equal(revisedPreview.body.preview_status, "Replayed");
  assert.equal(revisedPreview.body.job.job_id, preview.body.job.job_id);
  assert.notEqual(
    revisedPreview.body.job.source_evidence.import_method_fingerprint,
    preview.body.job.source_evidence.import_method_fingerprint
  );
  assert.equal(calls.length, wrikeCallsAfterPrepare);
});
