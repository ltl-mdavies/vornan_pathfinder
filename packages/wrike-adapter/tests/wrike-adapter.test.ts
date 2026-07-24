import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWrikeAuthorizationUrl,
  buildWrikeIngestionIdentity,
  checkWrikeOAuthConnection,
  createDefaultWrikeSourceConfig,
  discoverApprovedWrikeTask,
  exchangeWrikeAuthorizationCode,
  evaluateWrikeReadOnlyQaReadiness,
  fetchQualifiedWrikeWorkbookSources,
  getWrikeContractReadiness,
  normalizeWrikeHost,
  normalizeWrikeSourceConfig,
  parseWrikeOrderNameContract,
  resolveWrikeArtworkFolderUrl,
  selectWrikeWorkbookAttachments,
  WrikeConnectionError
} from "../src/index.ts";

test("normalizes a fail-closed Wrike intake contract without retaining secrets", () => {
  const normalized = normalizeWrikeSourceConfig({
    enabled: true,
    connection_id: " source_wrike_momentara ",
    folder_id: "  IEABFOLDER  ",
    approved_discovery_task_id: " IETESTTASK ",
    trigger_mode: "webhook_with_reconciliation",
    trigger_status_id: " IEABORDERED ",
    trigger_status_label: " Sent to Print - LTL ",
    artwork_folder_custom_field_id: " IECUSTOMART ",
    attachment_filename_contains: " Momentara Order ",
    attachment_extensions: [".XLSX", "pdf", "csv", "xlsx"],
    attachment_selection: "newest_matching_workbook",
    poll_interval_minutes: 2,
    access_token: "must-not-persist",
    create_preview_only: false
  });

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.connection_id, "source_wrike_momentara");
  assert.equal(normalized.folder_id, "IEABFOLDER");
  assert.equal(normalized.approved_discovery_task_id, "IETESTTASK");
  assert.equal(normalized.trigger_status_id, "IEABORDERED");
  assert.equal(normalized.trigger_status_label, "Sent to Print - LTL");
  assert.equal(normalized.artwork_folder_custom_field_id, "IECUSTOMART");
  assert.equal(normalized.task_title_rule, "contract_order_ooh");
  assert.equal(normalized.workbook_name_rule, "contract_order_ooh");
  assert.equal(normalized.attachment_selection, "all_matching_current_workbooks");
  assert.deepEqual(normalized.attachment_extensions, ["xlsx", "csv"]);
  assert.equal(normalized.poll_interval_minutes, 5);
  assert.equal(normalized.create_preview_only, true);
  assert.equal("access_token" in normalized, false);
  assert.equal(getWrikeContractReadiness(normalized).status, "Configured");
});

test("snaps reconciliation intervals to the operator-visible presets", () => {
  assert.equal(normalizeWrikeSourceConfig({ poll_interval_minutes: 17 }).poll_interval_minutes, 15);
  assert.equal(normalizeWrikeSourceConfig({ poll_interval_minutes: 58 }).poll_interval_minutes, 60);
});

test("reports the durable identifiers still needed before connection", () => {
  assert.deepEqual(getWrikeContractReadiness(createDefaultWrikeSourceConfig()), {
    status: "Incomplete",
    missing: ["connection_id", "folder_id", "trigger_status_id"]
  });
});

test("keeps Wrike QA dark until an explicit bounded window opens", () => {
  const config = normalizeWrikeSourceConfig({
    connection_id: "source_wrike_momentara",
    folder_id: "IEABFOLDER",
    approved_discovery_task_id: "IETESTTASK",
    trigger_status_id: "IEABORDERED",
    attachment_extensions: ["xlsx"]
  });
  const readiness = evaluateWrikeReadOnlyQaReadiness({
    config,
    method_saved: true,
    connection_configured: true,
    connection_test_enabled: false,
    discovery_preview_enabled: false,
    identity_confirmed: false
  });

  assert.equal(readiness.status, "ready_for_explicit_qa_window");
  assert.equal(readiness.capabilities.approved_task_preview, false);
  assert.equal(readiness.capabilities.attachment_download, false);
  assert.equal(readiness.capabilities.preview_job_creation, false);
  assert.equal(readiness.capabilities.wrike_writes, false);
  assert.equal(readiness.capabilities.lift_actions, false);
});

test("requires identity confirmation before the exact-task preview", () => {
  const config = normalizeWrikeSourceConfig({
    connection_id: "source_wrike_momentara",
    folder_id: "IEABFOLDER",
    approved_discovery_task_id: "IETESTTASK",
    trigger_status_id: "IEABORDERED",
    attachment_extensions: ["xlsx"]
  });
  const waiting = evaluateWrikeReadOnlyQaReadiness({
    config,
    method_saved: true,
    connection_configured: true,
    connection_test_enabled: true,
    discovery_preview_enabled: true,
    identity_confirmed: false
  });
  assert.equal(waiting.status, "run_identity_check");
  assert.equal(waiting.capabilities.approved_task_preview, false);

  const ready = evaluateWrikeReadOnlyQaReadiness({
    config,
    method_saved: true,
    connection_configured: true,
    connection_test_enabled: true,
    discovery_preview_enabled: true,
    identity_confirmed: true
  });
  assert.equal(ready.status, "ready_for_approved_task_preview");
  assert.equal(ready.capabilities.approved_task_preview, true);
});

test("uses account, task, attachment, and version for deterministic ingestion identity", () => {
  const first = buildWrikeIngestionIdentity({
    account_id: "IEACCOUNT",
    task_id: "IETASK",
    attachment_id: "IEATTACHMENT",
    version_id: "2"
  });
  const same = buildWrikeIngestionIdentity({
    account_id: "IEACCOUNT",
    task_id: "IETASK",
    attachment_id: "IEATTACHMENT",
    version_id: "2"
  });
  const replacement = buildWrikeIngestionIdentity({
    account_id: "IEACCOUNT",
    task_id: "IETASK",
    attachment_id: "IEATTACHMENT",
    version_id: "3"
  });

  assert.equal(first, same);
  assert.notEqual(first, replacement);
});

test("parses only the agreed task and workbook naming contract", () => {
  assert.deepEqual(parseWrikeOrderNameContract("C123456 - Summer Placards - OOH Order"), {
    contract_number: "C123456",
    order_name: "Summer Placards"
  });
  assert.equal(parseWrikeOrderNameContract("123456 - Summer Placards - OOH Order"), null);
  assert.equal(parseWrikeOrderNameContract("C12345 - Summer Placards - OOH Order"), null);
  assert.equal(parseWrikeOrderNameContract("C123456 - Summer Placards - Reference Proof"), null);
  assert.equal(parseWrikeOrderNameContract("C123456 - \nSummer Placards - OOH Order"), null);
});

test("reads only the configured safe artwork-folder custom field", () => {
  const task = {
    customFields: [
      { id: "IEOTHER", value: "https://example.com/ignore" },
      { id: "IEART", value: " https://momentara.sharepoint.com/sites/art/Shared%20Documents/Order " }
    ]
  };

  assert.deepEqual(resolveWrikeArtworkFolderUrl(task, ""), {
    status: "not_configured",
    url: null
  });
  assert.deepEqual(resolveWrikeArtworkFolderUrl(task, "IEMISSING"), {
    status: "missing",
    url: null
  });
  assert.deepEqual(resolveWrikeArtworkFolderUrl(task, "IEART"), {
    status: "ready",
    url: "https://momentara.sharepoint.com/sites/art/Shared%20Documents/Order"
  });
  assert.deepEqual(
    resolveWrikeArtworkFolderUrl(
      { customFields: [{ id: "IEART", value: "http://momentara.example/art" }] },
      "IEART"
    ),
    { status: "invalid", url: null }
  );
  assert.deepEqual(
    resolveWrikeArtworkFolderUrl(
      { customFields: [{ id: "IEART", value: "https://user:secret@example.com/art" }] },
      "IEART"
    ),
    { status: "invalid", url: null }
  );
});

test("keeps every current matching workbook as a separate order candidate", () => {
  const config = normalizeWrikeSourceConfig({
    folder_id: "IEABFOLDER",
    trigger_status_id: "IEABORDERED",
    attachment_extensions: ["xlsx"]
  });
  const candidates = [
    {
      attachment_id: "order-one",
      version_id: "1",
      file_name: "C123456 - Retail Placards - OOH Order.xlsx",
      updated_at: "2026-07-21T12:00:00.000Z"
    },
    {
      attachment_id: "reference-proof",
      version_id: "1",
      file_name: "C123456 - Retail Placards - OOH Order.pdf",
      updated_at: "2026-07-21T14:00:00.000Z"
    },
    {
      attachment_id: "order-two",
      version_id: "1",
      file_name: "C123456 - Airport Placards - OOH Order.xlsx",
      updated_at: "2026-07-21T13:00:00.000Z"
    },
    {
      attachment_id: "other-contract",
      version_id: "1",
      file_name: "C654321 - Other Campaign - OOH Order.xlsx",
      updated_at: "2026-07-21T15:00:00.000Z"
    }
  ];

  const selected = selectWrikeWorkbookAttachments(
    candidates,
    config,
    "C123456 - Momentara Campaign - OOH Order"
  );
  assert.equal(selected.status, "matched");
  assert.deepEqual(
    selected.attachments.map((candidate) => candidate.attachment_id),
    ["order-two", "order-one"]
  );
  assert.equal(selected.matches.length, 2);
});

test("deduplicates replacement versions per attachment and fails closed on an unresolved current-version tie", () => {
  const config = normalizeWrikeSourceConfig({
    folder_id: "IEABFOLDER",
    trigger_status_id: "IEABORDERED",
    attachment_extensions: ["xlsx"]
  });
  const candidates = [
    {
      attachment_id: "order-one",
      version_id: "1",
      file_name: "C123456 - Retail Placards - OOH Order.xlsx",
      updated_at: "2026-07-21T12:00:00.000Z"
    },
    {
      attachment_id: "order-one",
      version_id: "2",
      file_name: "C123456 - Retail Placards - OOH Order.xlsx",
      updated_at: "2026-07-21T13:00:00.000Z"
    }
  ];

  const selected = selectWrikeWorkbookAttachments(
    candidates,
    config,
    "C123456 - Momentara Campaign - OOH Order"
  );
  assert.equal(selected.status, "matched");
  assert.deepEqual(selected.attachments.map((candidate) => candidate.version_id), ["2"]);

  assert.equal(
    selectWrikeWorkbookAttachments(
      [
        ...candidates,
        {
          attachment_id: "order-one",
          version_id: "3",
          file_name: "C123456 - Retail Placards - OOH Order.xlsx",
          updated_at: "2026-07-21T13:00:00.000Z"
        }
      ],
      config,
      "C123456 - Momentara Campaign - OOH Order"
    ).status,
    "ambiguous"
  );
});

test("rejects a malformed task title before considering workbook candidates", () => {
  const selected = selectWrikeWorkbookAttachments(
    [{
      attachment_id: "order-one",
      version_id: "1",
      file_name: "C123456 - Retail Placards - OOH Order.xlsx",
      updated_at: "2026-07-21T12:00:00.000Z"
    }],
    normalizeWrikeSourceConfig({ attachment_extensions: ["xlsx"] }),
    "Retail Placards"
  );
  assert.equal(selected.status, "missing");
  assert.equal(selected.attachments.length, 0);
});

test("accepts only a bare HTTPS Wrike regional host", () => {
  assert.equal(normalizeWrikeHost("app-eu.wrike.com"), "app-eu.wrike.com");
  assert.equal(normalizeWrikeHost("https://WWW.WRIKE.COM/"), "www.wrike.com");
  assert.throws(() => normalizeWrikeHost("http://www.wrike.com"), WrikeConnectionError);
  assert.throws(() => normalizeWrikeHost("https://wrike.example.com"), WrikeConnectionError);
  assert.throws(() => normalizeWrikeHost("https://www.wrike.com/api/v4/tasks"), WrikeConnectionError);
});

test("builds a read-only Wrike authorization request with opaque state", () => {
  const authorizationUrl = new URL(
    buildWrikeAuthorizationUrl({
      client_id: "client-id",
      redirect_uri: "https://api.pathfinder.vornan.co/oauth/wrike/callback",
      state: "opaque-state"
    })
  );

  assert.equal(authorizationUrl.origin, "https://login.wrike.com");
  assert.equal(authorizationUrl.pathname, "/oauth2/authorize");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "client-id");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("scope"), "wsReadOnly");
  assert.equal(authorizationUrl.searchParams.get("state"), "opaque-state");
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    "https://api.pathfinder.vornan.co/oauth/wrike/callback"
  );
});

test("exchanges an authorization code without returning provider error details", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await exchangeWrikeAuthorizationCode(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      code: "authorization-code",
      redirect_uri: "https://api.pathfinder.vornan.co/oauth/wrike/callback"
    },
    {
      now: () => new Date("2026-07-22T15:00:00.000Z"),
      fetch_impl: async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            host: "app-us2.wrike.com"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://login.wrike.com/oauth2/token");
  assert.equal(calls[0].init?.method, "POST");
  const body = calls[0].init?.body as URLSearchParams;
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "authorization-code");
  assert.equal(body.get("redirect_uri"), "https://api.pathfinder.vornan.co/oauth/wrike/callback");
  assert.equal(result.credentials.host, "app-us2.wrike.com");
  assert.equal(result.credentials.refresh_token, "refresh-token");
  assert.equal(result.credentials.access_token_expires_at, "2026-07-22T16:00:00.000Z");
  assert.equal(result.authorized_at, "2026-07-22T15:00:00.000Z");

  const providerSecret = "do-not-echo";
  await assert.rejects(
    exchangeWrikeAuthorizationCode(
      {
        client_id: "client-id",
        client_secret: "client-secret",
        code: "rejected-code",
        redirect_uri: "https://api.pathfinder.vornan.co/oauth/wrike/callback"
      },
      {
        fetch_impl: async () =>
          new Response(JSON.stringify({ error_description: providerSecret }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          })
      }
    ),
    (error: unknown) =>
      error instanceof WrikeConnectionError &&
      error.code === "oauth_authorization_failed" &&
      !error.message.includes(providerSecret)
  );
});

test("refreshes OAuth and performs only the read-only current-user health check", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "rotated-access-token",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
          host: "app-eu.wrike.com"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ data: [{ id: "CURRENTUSER" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await checkWrikeOAuthConnection(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    { fetch_impl: fetchImpl, now: () => new Date("2026-07-21T20:00:00.000Z") }
  );

  assert.deepEqual(calls.map((call) => call.url), [
    "https://www.wrike.com/oauth2/token",
    "https://app-eu.wrike.com/api/v4/contacts?me=true"
  ]);
  assert.equal(calls.some((call) => /tasks|folders|attachments|webhooks/.test(call.url)), false);
  assert.match(String(calls[1].init?.headers && (calls[1].init.headers as Record<string, string>).Authorization), /^Bearer /);
  assert.equal(result.credentials.refresh_token, "rotated-refresh-token");
  assert.equal(result.credentials.host, "app-eu.wrike.com");
  assert.equal(result.credentials.access_token_expires_at, "2026-07-21T21:00:00.000Z");
  assert.deepEqual(result.health, {
    status: "Connected",
    host: "app-eu.wrike.com",
    checked_at: "2026-07-21T20:00:00.000Z",
    identity_confirmed: true
  });
});

test("returns safe OAuth errors without echoing provider secrets", async () => {
  const secret = "never-echo-this-token";
  await assert.rejects(
    checkWrikeOAuthConnection(
      {
        client_id: "client-id",
        client_secret: "client-secret",
        refresh_token: secret,
        host: "www.wrike.com"
      },
      {
        fetch_impl: async () =>
          new Response(JSON.stringify({ errorDescription: `invalid ${secret}` }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          })
      }
    ),
    (error: unknown) =>
      error instanceof WrikeConnectionError &&
      error.code === "oauth_refresh_failed" &&
      !error.message.includes(secret)
  );
});

test("retains rotated OAuth credentials when the identity check fails", async () => {
  await assert.rejects(
    checkWrikeOAuthConnection(
      {
        client_id: "client-id",
        client_secret: "client-secret",
        refresh_token: "original-refresh-token",
        host: "www.wrike.com"
      },
      {
        fetch_impl: async (input) => {
          const url = String(input);
          if (url.endsWith("/oauth2/token")) {
            return new Response(
              JSON.stringify({
                access_token: "rotated-access-token",
                refresh_token: "rotated-refresh-token",
                expires_in: 3600,
                host: "app-eu.wrike.com"
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(JSON.stringify({ error: "identity unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" }
          });
        },
        now: () => new Date("2026-07-21T20:00:00.000Z")
      }
    ),
    (error: unknown) =>
      error instanceof WrikeConnectionError &&
      error.code === "identity_check_failed" &&
      error.rotated_credentials?.refresh_token === "rotated-refresh-token" &&
      error.rotated_credentials?.host === "app-eu.wrike.com"
  );
});

test("previews one qualified task and counts every matching workbook without returning provider content", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const config = normalizeWrikeSourceConfig({
    folder_id: "IEAPPROVEDFOLDER",
    approved_discovery_task_id: "IEAPPROVEDTASK",
    trigger_status_id: "IEORDEREDSTATUS",
    artwork_folder_custom_field_id: "IEARTWORKFOLDER",
    attachment_filename_contains: "order",
    attachment_extensions: ["xlsx"]
  });
  const result = await discoverApprovedWrikeTask(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    config,
    {
      now: () => new Date("2026-07-22T01:00:00.000Z"),
      fetch_impl: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "rotated-access-token",
              refresh_token: "rotated-refresh-token",
              expires_in: 3600,
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/attachments")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "IEATTACHMENT0001",
                  version: 3,
                  taskId: "IEAPPROVEDTASK",
                  name: "C123456 - Private Retail Placards - OOH Order.xlsx",
                  url: "https://temporary.example/never-return",
                  previewUrl: "https://temporary.example/never-return-preview"
                },
                {
                  id: "IEATTACHMENT0002",
                  version: 1,
                  name: "C123456 - Private Airport Placards - OOH Order.xlsx"
                },
                {
                  id: "IEATTACHMENT0003",
                  version: 1,
                  name: "C123456 - Creative Reference - OOH Order.pdf"
                },
                {
                  id: "IEATTACHMENT0004",
                  version: 1,
                  name: "C654321 - Other Contract - OOH Order.xlsx"
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "IEAPPROVEDTASK",
                accountId: "IEACCOUNT",
                parentIds: ["IEOTHERFOLDER"],
                superParentIds: ["IEAPPROVEDFOLDER"],
                customStatusId: "IEORDEREDSTATUS",
                attachmentCount: 4,
                title: "C123456 - Private Customer Campaign - OOH Order",
                customFields: [
                  {
                    id: "IEARTWORKFOLDER",
                    value: "https://momentara.sharepoint.com/sites/art/Private-Customer-Campaign"
                  }
                ],
                description: "Private customer description"
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.preview.status, "Confirmed");
  assert.equal(result.preview.observed.workbook_candidate_count, 2);
  assert.equal(result.preview.observed.attachment_metadata_count, 4);
  assert.equal(result.preview.observed.ignored_attachment_count, 2);
  assert.equal(result.preview.observed.artwork_folder_status, "ready");
  assert.equal(result.preview.capabilities.artwork_folder_value_read, true);
  assert.deepEqual(result.preview.observed.super_parent_ids, ["IEAPPROVEDFOLDER"]);
  assert.equal(result.preview.capabilities.attachment_download, false);
  assert.deepEqual(calls.map((call) => call.init?.method), ["POST", "GET", "GET"]);
  assert.match(calls[1].url, /\/api\/v4\/tasks\/IEAPPROVEDTASK\?fields=/);
  assert.deepEqual(
    JSON.parse(new URL(calls[1].url).searchParams.get("fields") ?? "[]"),
    ["attachmentCount"]
  );
  assert.match(calls[2].url, /\/api\/v4\/tasks\/IEAPPROVEDTASK\/attachments\?versions=false&withUrls=false$/);
  assert.equal(calls.some((call) => /download|preview|webhooks/.test(call.url)), false);
  const publicPayload = JSON.stringify(result.preview);
  assert.equal(publicPayload.includes("Private customer"), false);
  assert.equal(publicPayload.includes("Private Retail"), false);
  assert.equal(publicPayload.includes("temporary.example"), false);
  assert.equal(publicPayload.includes("momentara.sharepoint.com"), false);
  assert.equal(publicPayload.includes("rotated-access-token"), false);
});

test("requalifies and downloads only current matching workbooks without forwarding OAuth", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const workbookBytes = new TextEncoder().encode("bounded-workbook");
  const result = await fetchQualifiedWrikeWorkbookSources(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEAPPROVEDFOLDER",
      approved_discovery_task_id: "IEAPPROVEDTASK",
      trigger_status_id: "IEORDEREDSTATUS",
      attachment_extensions: ["xlsx"]
    }),
    {
      now: () => new Date("2026-07-23T12:00:00.000Z"),
      fetch_impl: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "rotated-access-token",
              refresh_token: "rotated-refresh-token",
              expires_in: 3600,
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/attachments?versions=false&withUrls=false")) {
          return new Response(
            JSON.stringify({
              data: [{
                id: "IEATTACHMENT",
                name: "C123456 - Summer Placards - OOH Order.xlsx"
              }]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/attachments?versions=false&withUrls=true")) {
          return new Response(
            JSON.stringify({
              data: [{
                id: "IEATTACHMENT",
                currentAttachmentId: "IEVERSION1",
                name: "C123456 - Summer Placards - OOH Order.xlsx",
                updatedDate: "2026-07-23T11:45:00.000Z",
                url: "https://files.example.test/signed/current"
              }]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url === "https://files.example.test/signed/current") {
          assert.deepEqual(init?.headers, { Accept: "*/*" });
          assert.equal(init?.redirect, "error");
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
              superParentIds: [],
              customStatusId: "IEORDEREDSTATUS",
              attachmentCount: 1,
              title: "C123456 - Summer Placards - OOH Order",
              customFields: []
            }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.workbooks.length, 1);
  assert.equal(result.workbooks[0].version_id, "IEVERSION1");
  assert.equal(new TextDecoder().decode(result.workbooks[0].bytes), "bounded-workbook");
  assert.deepEqual(calls.map((call) => call.init?.method), ["POST", "GET", "GET", "GET", "GET"]);
  assert.equal(
    calls
      .filter((call) => call.url === "https://files.example.test/signed/current")
      .some((call) => JSON.stringify(call.init?.headers).includes("rotated-access-token")),
    false
  );
  assert.equal(JSON.stringify(result).includes("files.example.test"), false);
});

test("rejects unsafe workbook URLs and oversized content before retaining bytes", async () => {
  async function run(downloadUrl: string, contentLength = "10") {
    return fetchQualifiedWrikeWorkbookSources(
      {
        client_id: "client-id",
        client_secret: "client-secret",
        refresh_token: "refresh-token",
        host: "www.wrike.com"
      },
      normalizeWrikeSourceConfig({
        folder_id: "IEAPPROVEDFOLDER",
        approved_discovery_task_id: "IEAPPROVEDTASK",
        trigger_status_id: "IEORDEREDSTATUS",
        attachment_extensions: ["xlsx"]
      }),
      {
        max_workbook_bytes: 8,
        fetch_impl: async (input) => {
          const url = String(input);
          if (url.endsWith("/oauth2/token")) {
            return new Response(
              JSON.stringify({
                access_token: "access-token",
                refresh_token: "refresh-token",
                host: "www.wrike.com"
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          if (url.includes("withUrls=false")) {
            return new Response(JSON.stringify({
              data: [{ id: "IEATTACHMENT", name: "C123456 - Summer - OOH Order.xlsx" }]
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (url.includes("withUrls=true")) {
            return new Response(JSON.stringify({
              data: [{
                id: "IEATTACHMENT",
                currentAttachmentId: "IEVERSION1",
                name: "C123456 - Summer - OOH Order.xlsx",
                updatedDate: "2026-07-23T11:45:00.000Z",
                url: downloadUrl
              }]
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (url.includes("/api/v4/tasks/")) {
            return new Response(JSON.stringify({
              data: [{
                id: "IEAPPROVEDTASK",
                accountId: "IEACCOUNT",
                parentIds: ["IEAPPROVEDFOLDER"],
                customStatusId: "IEORDEREDSTATUS",
                attachmentCount: 1,
                title: "C123456 - Summer - OOH Order"
              }]
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response("0123456789", {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Length": contentLength
            }
          });
        }
      }
    );
  }

  await assert.rejects(
    run("https://127.0.0.1/private"),
    (error: unknown) =>
      error instanceof WrikeConnectionError && error.code === "attachment_validation_failed"
  );
  await assert.rejects(
    run("https://files.example.test/signed/current"),
    (error: unknown) =>
      error instanceof WrikeConnectionError && error.code === "attachment_validation_failed"
  );
});

test("does not read attachment metadata before status and task naming guardrails both pass", async () => {
  for (const task of [
    {
      id: "IEAPPROVEDTASK",
      accountId: "IEACCOUNT",
      parentIds: ["IEAPPROVEDFOLDER"],
      customStatusId: "IEORDEREDSTATUS",
      attachmentCount: 1,
      title: "C123456 - Campaign - OOH Order"
    },
    {
      id: "IEAPPROVEDTASK",
      accountId: "IEACCOUNT",
      parentIds: ["IEAPPROVEDFOLDER"],
      customStatusId: "IESENTTOPRINTLTL",
      attachmentCount: 1,
      title: "Campaign without contract"
    }
  ]) {
    const calls: string[] = [];
    const result = await discoverApprovedWrikeTask(
      {
        client_id: "client-id",
        client_secret: "client-secret",
        refresh_token: "refresh-token",
        host: "www.wrike.com"
      },
      normalizeWrikeSourceConfig({
        folder_id: "IEAPPROVEDFOLDER",
        approved_discovery_task_id: "IEAPPROVEDTASK",
        trigger_status_id: "IESENTTOPRINTLTL"
      }),
      {
        fetch_impl: async (input) => {
          const url = String(input);
          calls.push(url);
          if (url.endsWith("/oauth2/token")) {
            return new Response(
              JSON.stringify({ access_token: "access", refresh_token: "refresh", host: "www.wrike.com" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(JSON.stringify({ data: [task] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
    );

    assert.equal(result.preview.status, "Needs review");
    assert.equal(result.preview.capabilities.attachment_metadata_read, false);
    assert.equal(calls.length, 2);
    assert.equal(calls.some((url) => url.includes("/attachments")), false);
  }
});

test("does not read attachment metadata when the approved task is outside the saved folder scope", async () => {
  const calls: string[] = [];
  const result = await discoverApprovedWrikeTask(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEAPPROVEDFOLDER",
      approved_discovery_task_id: "IEAPPROVEDTASK",
      trigger_status_id: "IEORDEREDSTATUS"
    }),
    {
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({ access_token: "access", refresh_token: "refresh", host: "www.wrike.com" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "IEAPPROVEDTASK",
                accountId: "IEACCOUNT",
                parentIds: ["IEUNAPPROVEDFOLDER"],
                customStatusId: "IEORDEREDSTATUS",
                attachmentCount: 1
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.preview.status, "Needs review");
  assert.equal(result.preview.capabilities.attachment_metadata_read, false);
  assert.equal(result.preview.observed.attachment_metadata_count, null);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((url) => url.includes("/attachments")), false);
});
