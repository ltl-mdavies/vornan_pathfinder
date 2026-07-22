import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWrikeIngestionIdentity,
  checkWrikeOAuthConnection,
  createDefaultWrikeSourceConfig,
  getWrikeContractReadiness,
  normalizeWrikeHost,
  normalizeWrikeSourceConfig,
  selectWrikeWorkbookAttachment,
  WrikeConnectionError
} from "../src/index.ts";

test("normalizes a fail-closed Wrike intake contract without retaining secrets", () => {
  const normalized = normalizeWrikeSourceConfig({
    enabled: true,
    folder_id: "  IEABFOLDER  ",
    trigger_mode: "webhook_with_reconciliation",
    trigger_status_id: " IEABORDERED ",
    trigger_status_label: " Ordered ",
    attachment_filename_contains: " Momentara Order ",
    attachment_extensions: [".XLSX", "pdf", "csv", "xlsx"],
    poll_interval_minutes: 2,
    access_token: "must-not-persist",
    create_preview_only: false
  });

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.folder_id, "IEABFOLDER");
  assert.equal(normalized.trigger_status_id, "IEABORDERED");
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
    missing: ["folder_id", "trigger_status_id"]
  });
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

test("selects the newest matching workbook and fails closed on a timestamp tie", () => {
  const config = normalizeWrikeSourceConfig({
    folder_id: "IEABFOLDER",
    trigger_status_id: "IEABORDERED",
    attachment_filename_contains: "order",
    attachment_extensions: ["xlsx"]
  });
  const candidates = [
    {
      attachment_id: "old",
      version_id: "1",
      file_name: "Momentara order.xlsx",
      updated_at: "2026-07-21T12:00:00.000Z"
    },
    {
      attachment_id: "ignored",
      version_id: "1",
      file_name: "Momentara order.pdf",
      updated_at: "2026-07-21T14:00:00.000Z"
    },
    {
      attachment_id: "new",
      version_id: "2",
      file_name: "Momentara order.xlsx",
      updated_at: "2026-07-21T13:00:00.000Z"
    }
  ];

  assert.equal(selectWrikeWorkbookAttachment(candidates, config).attachment?.attachment_id, "new");
  assert.equal(
    selectWrikeWorkbookAttachment(
      [
        ...candidates,
        {
          attachment_id: "tied",
          version_id: "1",
          file_name: "Replacement order.xlsx",
          updated_at: "2026-07-21T13:00:00.000Z"
        }
      ],
      config
    ).status,
    "ambiguous"
  );
});

test("accepts only a bare HTTPS Wrike regional host", () => {
  assert.equal(normalizeWrikeHost("app-eu.wrike.com"), "app-eu.wrike.com");
  assert.equal(normalizeWrikeHost("https://WWW.WRIKE.COM/"), "www.wrike.com");
  assert.throws(() => normalizeWrikeHost("http://www.wrike.com"), WrikeConnectionError);
  assert.throws(() => normalizeWrikeHost("https://wrike.example.com"), WrikeConnectionError);
  assert.throws(() => normalizeWrikeHost("https://www.wrike.com/api/v4/tasks"), WrikeConnectionError);
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
