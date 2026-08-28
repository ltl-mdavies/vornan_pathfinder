import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWrikeAuthorizationUrl,
  buildWrikeIngestionIdentity,
  checkWrikeOAuthConnection,
  createDefaultWrikeSourceConfig,
  discoverApprovedWrikeTask,
  discoverWrikeCustomFields,
  discoverScopedWrikeIntakeTasks,
  exchangeWrikeAuthorizationCode,
  evaluateWrikeReadOnlyQaReadiness,
  fetchQualifiedWrikeWorkbookSources,
  getWrikeContractReadiness,
  normalizeWrikeHost,
  normalizeWrikeSourceConfig,
  parseWrikeOrderNameContract,
  postWrikeTaskComment,
  resolveWrikeArtworkFolderUrl,
  resolveWrikeContractNumber,
  selectWrikeReferenceProofAttachment,
  selectWrikeWorkbookAttachments,
  WrikeConnectionError
} from "../src/index.ts";

test("normalizes a fail-closed Wrike intake contract without retaining secrets", () => {
  const normalized = normalizeWrikeSourceConfig({
    enabled: true,
    connection_id: " source_wrike_momentara ",
    folder_ids: ["  IEABFOLDER  ", " IEIBAFOLDER ", "IEABFOLDER"],
    folder_id: "  IEABFOLDER  ",
    approved_discovery_task_id: " IETESTTASK ",
    trigger_mode: "webhook_with_reconciliation",
    trigger_status_id: " IEABORDERED ",
    trigger_status_label: " Sent to Print - LTL ",
    artwork_folder_custom_field_id: " IECUSTOMART ",
    contract_number_custom_field_id: " IECONTRACT ",
    ltl_exception_custom_field_id: " IEEXCEPTION ",
    print_vendor_custom_field_id: " IEVENDOR ",
    order_task_identity_mode: "custom_item_type",
    order_task_custom_item_type_id: " IEPLACARDTYPE ",
    required_print_vendor_value: " Larger Than Life ",
    attachment_filename_contains: " Momentara Order ",
    attachment_extensions: [".XLSX", "pdf", "csv", "xlsx"],
    attachment_selection: "newest_matching_workbook",
    poll_interval_minutes: 2,
    access_token: "must-not-persist",
    create_preview_only: false
    ,
    reference_proof_intake: {
      enabled: true,
      filename_contains: " Campaign Proof ",
      attachment_extensions: ["pdf"]
    },
    shipping_intake: {
      enabled: true,
      task_identity_mode: "custom_item_type",
      custom_item_type_id: " IESHIPPINGTYPE ",
      task_title: " ignored ",
      trigger_status_id: " IESHIPPINGREADY ",
      trigger_status_label: " Have Address - LTL ",
      attachment_filename_contains: " Ship List ",
      attachment_extensions: [".XLSX", "pdf"],
      attachment_selection: "newest"
    }
  });

  assert.equal(normalized.enabled, false);
  assert.equal(normalized.connection_id, "source_wrike_momentara");
  assert.equal(normalized.folder_id, "IEABFOLDER");
  assert.deepEqual(normalized.folder_ids, ["IEABFOLDER", "IEIBAFOLDER"]);
  assert.equal(normalized.approved_discovery_task_id, "IETESTTASK");
  assert.equal(normalized.trigger_status_id, "IEABORDERED");
  assert.equal(normalized.trigger_status_label, "Sent to Print - LTL");
  assert.equal(normalized.artwork_folder_custom_field_id, "IECUSTOMART");
  assert.equal(normalized.contract_number_custom_field_id, "IECONTRACT");
  assert.equal(normalized.ltl_exception_custom_field_id, "IEEXCEPTION");
  assert.equal(normalized.print_vendor_custom_field_id, "IEVENDOR");
  assert.equal(normalized.order_task_identity_mode, "custom_item_type");
  assert.equal(normalized.order_task_custom_item_type_id, "IEPLACARDTYPE");
  assert.equal(normalized.required_print_vendor_value, "Larger Than Life");
  assert.equal(normalized.task_title_rule, "contract_order_ooh");
  assert.equal(normalized.workbook_name_rule, "contract_order_ooh");
  assert.equal(normalized.attachment_selection, "all_matching_current_workbooks");
  assert.deepEqual(normalized.attachment_extensions, ["xlsx", "csv"]);
  assert.equal(normalized.poll_interval_minutes, 5);
  assert.equal(normalized.create_preview_only, true);
  assert.deepEqual(normalized.reference_proof_intake, {
    enabled: true,
    filename_contains: "Campaign Proof",
    attachment_extensions: ["pdf"],
    attachment_selection: "single_current_attachment",
    archive_file_name_template: "<contract_number>_referenceProofs.zip"
  });
  assert.deepEqual(normalized.shipping_intake, {
    enabled: false,
    task_identity_mode: "custom_item_type",
    task_title: "ignored",
    custom_item_type_id: "IESHIPPINGTYPE",
    trigger_status_id: "IESHIPPINGREADY",
    trigger_status_label: "Have Address - LTL",
    attachment_filename_contains: "Ship List",
    attachment_extensions: ["xlsx"],
    attachment_selection: "all_matching_current_workbooks"
  });
  assert.equal("access_token" in normalized, false);
  assert.equal(getWrikeContractReadiness(normalized).status, "Configured");
});

test("snaps reconciliation intervals to the operator-visible presets", () => {
  assert.equal(normalizeWrikeSourceConfig({ poll_interval_minutes: 17 }).poll_interval_minutes, 15);
  assert.equal(normalizeWrikeSourceConfig({ poll_interval_minutes: 58 }).poll_interval_minutes, 60);
});

test("normalizes the explicit numbered Placard Order title mode", () => {
  assert.equal(
    normalizeWrikeSourceConfig({
      order_task_identity_mode: "exact_title_with_numbered_follow_ons"
    }).order_task_identity_mode,
    "exact_title_with_numbered_follow_ons"
  );
});

test("normalizes only an explicit, safe multi-proof ZIP naming contract", () => {
  const configured = normalizeWrikeSourceConfig({
    reference_proof_intake: {
      enabled: true,
      attachment_selection: "all_matching_current_attachments",
      archive_file_name_template: "Momentara_<contract_number>_proofs.zip"
    }
  });
  assert.equal(configured.reference_proof_intake.attachment_selection, "all_matching_current_attachments");
  assert.equal(
    configured.reference_proof_intake.archive_file_name_template,
    "Momentara_<contract_number>_proofs.zip"
  );

  const unsafe = normalizeWrikeSourceConfig({
    reference_proof_intake: {
      enabled: true,
      attachment_selection: "all_matching_current_attachments",
      archive_file_name_template: "../proofs.zip"
    }
  });
  assert.equal(
    unsafe.reference_proof_intake.archive_file_name_template,
    "<contract_number>_referenceProofs.zip"
  );
});

test("selects at most one optional reference-proof PDF and fails closed on ambiguity", () => {
  const config = {
    ...createDefaultWrikeSourceConfig().reference_proof_intake,
    enabled: true,
    filename_contains: "proof"
  };
  const first = {
    attachment_id: "IEPROOF1",
    version_id: "IEPROOFVERSION1",
    file_name: "C316870 - Campaign Proof.pdf",
    updated_at: "2026-07-31T12:00:00.000Z",
    download_url: "https://files.example.test/proof-one"
  };
  const selected = selectWrikeReferenceProofAttachment([first], config);
  assert.equal(selected.status, "matched");
  assert.equal(selected.attachment?.attachment_id, "IEPROOF1");

  const ambiguous = selectWrikeReferenceProofAttachment([
    first,
    {
      ...first,
      attachment_id: "IEPROOF2",
      version_id: "IEPROOFVERSION2",
      file_name: "C316870 - Second Proof.pdf"
    }
  ], config);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.attachment, null);

  const missing = selectWrikeReferenceProofAttachment([
    { ...first, file_name: "C316870 - Order.xlsx" }
  ], config);
  assert.equal(missing.status, "missing");
});

test("selects every matching current proof only when ZIP delivery is explicit", () => {
  const first = {
    attachment_id: "IEPROOF1",
    version_id: "IEPROOFVERSION1",
    file_name: "C316870 - Indoor Proof.pdf",
    updated_at: "2026-07-31T12:00:00.000Z",
    download_url: "https://files.example.test/proof-one"
  };
  const second = {
    ...first,
    attachment_id: "IEPROOF2",
    version_id: "IEPROOFVERSION2",
    file_name: "C316870 - GPA Proof.pdf",
    updated_at: "2026-07-31T12:05:00.000Z"
  };
  const selected = selectWrikeReferenceProofAttachment(
    [first, second],
    {
      ...createDefaultWrikeSourceConfig().reference_proof_intake,
      enabled: true,
      filename_contains: "proof",
      attachment_selection: "all_matching_current_attachments"
    }
  );
  assert.equal(selected.status, "matched");
  assert.equal(selected.attachment, null);
  assert.deepEqual(
    selected.attachments.map((attachment) => attachment.attachment_id),
    ["IEPROOF2", "IEPROOF1"]
  );
  assert.match(selected.message, /2 current Wrike PDFs/i);
});

test("reports the durable identifiers still needed before connection", () => {
  assert.deepEqual(getWrikeContractReadiness(createDefaultWrikeSourceConfig()), {
    status: "Incomplete",
    missing: [
      "connection_id",
      "folder_id",
      "trigger_status_id",
      "contract_number_custom_field_id",
      "print_vendor_custom_field_id"
    ]
  });
});

test("keeps Wrike QA dark until an explicit bounded window opens", () => {
  const config = normalizeWrikeSourceConfig({
    connection_id: "source_wrike_momentara",
    folder_id: "IEABFOLDER",
    approved_discovery_task_id: "IETESTTASK",
    trigger_status_id: "IEABORDERED",
    contract_number_custom_field_id: "IECONTRACT",
    print_vendor_custom_field_id: "IEVENDOR",
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
    contract_number_custom_field_id: "IECONTRACT",
    print_vendor_custom_field_id: "IEVENDOR",
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

test("keeps the legacy order-name parser strict without using it as a routing key", () => {
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

test("reads a bounded Contract Number from only the configured custom field", () => {
  const task = {
    customFields: [
      { id: "IEOTHER", value: "C999999" },
      { id: "IECONTRACT", value: " c3168700 " }
    ]
  };

  assert.deepEqual(resolveWrikeContractNumber(task, ""), {
    status: "not_configured",
    contract_number: null
  });
  assert.deepEqual(resolveWrikeContractNumber(task, "IEMISSING"), {
    status: "missing",
    contract_number: null
  });
  assert.deepEqual(resolveWrikeContractNumber(task, "IECONTRACT"), {
    status: "ready",
    contract_number: "C3168700"
  });
  assert.deepEqual(
    resolveWrikeContractNumber({ customFields: [{ id: "IECONTRACT", value: "3168700" }] }, "IECONTRACT"),
    { status: "invalid", contract_number: null }
  );
  assert.deepEqual(
    resolveWrikeContractNumber({ customFields: [{ id: "IECONTRACT", value: "C12345" }] }, "IECONTRACT"),
    { status: "invalid", contract_number: null }
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
      file_name: "Momentara_3 product_DEMO.xlsx",
      updated_at: "2026-07-21T12:00:00.000Z"
    },
    {
      attachment_id: "reference-proof",
      version_id: "1",
      file_name: "reference-proof.pdf",
      updated_at: "2026-07-21T14:00:00.000Z"
    },
    {
      attachment_id: "order-two",
      version_id: "1",
      file_name: "airport placards final.xlsx",
      updated_at: "2026-07-21T13:00:00.000Z"
    },
    {
      attachment_id: "other-contract",
      version_id: "1",
      file_name: "C654321 - Other Campaign - OOH Order.xlsx",
      updated_at: "2026-07-21T15:00:00.000Z"
    }
  ];

  const selected = selectWrikeWorkbookAttachments(candidates, config);
  assert.equal(selected.status, "matched");
  assert.deepEqual(
    selected.attachments.map((candidate) => candidate.attachment_id),
    ["other-contract", "order-two", "order-one"]
  );
  assert.equal(selected.matches.length, 3);
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

  const selected = selectWrikeWorkbookAttachments(candidates, config);
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
      config
    ).status,
    "ambiguous"
  );
});

test("uses the optional filename filter without requiring a naming convention", () => {
  const selected = selectWrikeWorkbookAttachments(
    [
      {
        attachment_id: "order-one",
        version_id: "1",
        file_name: "Momentara_3 product_DEMO.xlsx",
        updated_at: "2026-07-21T12:00:00.000Z"
      },
      {
        attachment_id: "order-two",
        version_id: "1",
        file_name: "another workbook.xlsx",
        updated_at: "2026-07-21T13:00:00.000Z"
      }
    ],
    normalizeWrikeSourceConfig({
      attachment_extensions: ["xlsx"],
      attachment_filename_contains: "product_demo"
    })
  );
  assert.equal(selected.status, "matched");
  assert.deepEqual(selected.attachments.map((candidate) => candidate.attachment_id), ["order-one"]);
});

test("accepts only a bare HTTPS Wrike regional host", () => {
  assert.equal(normalizeWrikeHost("app-eu.wrike.com"), "app-eu.wrike.com");
  assert.equal(normalizeWrikeHost("https://WWW.WRIKE.COM/"), "www.wrike.com");
  assert.throws(() => normalizeWrikeHost("http://www.wrike.com"), WrikeConnectionError);
  assert.throws(() => normalizeWrikeHost("https://wrike.example.com"), WrikeConnectionError);
  assert.throws(() => normalizeWrikeHost("https://www.wrike.com/api/v4/tasks"), WrikeConnectionError);
});

test("builds a read/write Wrike authorization request with opaque state", () => {
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
  assert.equal(authorizationUrl.searchParams.get("scope"), "wsReadWrite");
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
  assert.equal(result.credentials.scope, "wsReadWrite");
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

test("reuses a current OAuth access token without rotating the refresh token", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await checkWrikeOAuthConnection(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      access_token: "current-access-token",
      access_token_expires_at: "2026-07-21T20:10:00.000Z",
      host: "app-us2.wrike.com",
      scope: "wsReadWrite"
    },
    {
      now: () => new Date("2026-07-21T20:00:00.000Z"),
      fetch_impl: async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify({ data: [{ id: "CURRENTUSER" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );

  assert.deepEqual(calls.map((call) => call.url), [
    "https://app-us2.wrike.com/api/v4/contacts?me=true"
  ]);
  assert.equal(result.credentials.access_token, "current-access-token");
  assert.equal(result.credentials.refresh_token, "refresh-token");
  assert.equal(result.credentials.access_token_expires_at, "2026-07-21T20:10:00.000Z");
  assert.equal(result.health.identity_confirmed, true);
});

test("posts one plain-text task comment with read/write OAuth and returns only safe metadata", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await postWrikeTaskComment(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com",
      scope: "wsReadWrite"
    },
    {
      task_id: "MAAAAAENlV9Z",
      text: "Larger Than Life print order created successfully.\nLift order #A0227641.",
    },
    {
      fetch_impl: async (input, init) => {
        calls.push({ url: String(input), init });
        if (String(input).endsWith("/oauth2/token")) {
          return new Response(JSON.stringify({
            access_token: "rotated-access-token",
            refresh_token: "rotated-refresh-token",
            host: "app-us2.wrike.com"
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          data: [{ id: "IECOMMENT", createdDate: "2026-08-03T18:00:00Z", text: "do-not-return" }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
  );

  assert.deepEqual(calls.map((call) => call.url), [
    "https://www.wrike.com/oauth2/token",
    "https://app-us2.wrike.com/api/v4/tasks/MAAAAAENlV9Z/comments"
  ]);
  const refreshBody = calls[0].init?.body as URLSearchParams;
  assert.equal(refreshBody.get("scope"), "wsReadWrite");
  const commentBody = calls[1].init?.body as URLSearchParams;
  assert.equal(commentBody.get("plainText"), "true");
  assert.match(commentBody.get("text") ?? "", /Larger Than Life/);
  assert.equal(calls[1].init?.redirect, "error");
  assert.deepEqual(result.comment, { comment_id: "IECOMMENT", created_at: "2026-08-03T18:00:00Z" });
  assert.equal(JSON.stringify(result).includes("do-not-return"), false);
  assert.equal(result.credentials.scope, "wsReadWrite");
});

test("refuses comment posting unless the saved OAuth grant is read/write", async () => {
  await assert.rejects(
    postWrikeTaskComment(
      {
        client_id: "client-id",
        client_secret: "client-secret",
        refresh_token: "refresh-token",
        host: "www.wrike.com",
        scope: "wsReadOnly"
      },
      { task_id: "MAAAAAENlV9Z", text: "comment" },
      { fetch_impl: async () => { throw new Error("must not call"); } }
    ),
    (error: unknown) => error instanceof WrikeConnectionError && error.code === "invalid_configuration"
  );
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

test("keeps rotated OAuth credentials non-enumerable on provider errors", () => {
  const error = new WrikeConnectionError(
    "task_discovery_failed",
    "Wrike discovery failed.",
    {
      client_id: "client-id",
      client_secret: "must-not-serialize",
      refresh_token: "must-not-serialize",
      access_token: "must-not-serialize",
      host: "www.wrike.com"
    }
  );

  assert.equal(error.rotated_credentials?.client_id, "client-id");
  const serialized = JSON.stringify(error);
  assert.equal(serialized.includes("rotated_credentials"), false);
  assert.equal(serialized.includes("must-not-serialize"), false);
});

test("reconciles equivalent task and workbook sequence formats without returning provider content", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const config = normalizeWrikeSourceConfig({
    folder_id: "IEAPPROVEDFOLDER",
    approved_discovery_task_id: "IEAPPROVEDTASK",
    trigger_status_id: "IEORDEREDSTATUS",
    contract_number_custom_field_id: "IECONTRACT",
    artwork_folder_custom_field_id: "IEARTWORKFOLDER",
    order_task_identity_mode: "exact_title_with_numbered_follow_ons",
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
                  name: "Momentara_3 product_DEMO.xlsx",
                  url: "https://temporary.example/never-return",
                  previewUrl: "https://temporary.example/never-return-preview"
                },
                {
                  id: "IEATTACHMENT0002",
                  version: 1,
                  name: "C123456 - Private Airport Placards - OOH Order 02.xlsx"
                },
                {
                  id: "IEATTACHMENT0003",
                  version: 1,
                  name: "C123456 - Creative Reference - OOH Order.pdf"
                },
                {
                  id: "IEATTACHMENT0004",
                  version: 1,
                  name: "layout-reference.psd"
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (new URL(url).pathname === "/api/v4/folders/IEOTHERFOLDER") {
          return new Response(
            JSON.stringify({
              data: [{
                id: "IEOTHERFOLDER",
                title: "Private Airport Placards - C3168700",
                parentIds: ["IEAPPROVEDFOLDER"]
              }]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (
          new URL(url).pathname === "/api/v4/tasks/IEAPPROVEDTASK" &&
          new URL(url).search
        ) {
          return new Response(JSON.stringify({ error: "parameterNotAllowed" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
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
                title: "Placard Order #2",
                customFields: [
                  {
                    id: "IECONTRACT",
                    value: "C3168700"
                  },
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
  assert.equal(result.qualification.contract_number, "C3168700");
  assert.equal(result.preview.observed.workbook_candidate_count, 2);
  assert.equal(result.preview.observed.attachment_metadata_count, 4);
  assert.equal(result.preview.observed.ignored_attachment_count, 2);
  assert.equal(result.preview.observed.artwork_folder_status, "ready");
  assert.equal(result.preview.capabilities.artwork_folder_value_read, true);
  assert.deepEqual(result.preview.observed.super_parent_ids, ["IEAPPROVEDFOLDER"]);
  assert.equal(result.preview.capabilities.attachment_download, false);
  assert.deepEqual(calls.map((call) => call.init?.method), ["POST", "GET", "GET", "GET"]);
  assert.equal(new URL(calls[1].url).pathname, "/api/v4/tasks/IEAPPROVEDTASK");
  assert.equal(new URL(calls[1].url).search, "");
  assert.equal(new URL(calls[2].url).pathname, "/api/v4/folders/IEOTHERFOLDER");
  assert.match(calls[3].url, /\/api\/v4\/tasks\/IEAPPROVEDTASK\/attachments\?versions=false&withUrls=false$/);
  assert.equal(calls.some((call) => /download|preview|webhooks/.test(call.url)), false);
  const publicPayload = JSON.stringify(result.preview);
  assert.equal(publicPayload.includes("Private customer"), false);
  assert.equal(publicPayload.includes("Private Retail"), false);
  assert.equal(publicPayload.includes("temporary.example"), false);
  assert.equal(publicPayload.includes("momentara.sharepoint.com"), false);
  assert.equal(publicPayload.includes("rotated-access-token"), false);
});

test("converts a saved numeric campaign folder and requests exact-task ancestry", async () => {
  const calls: string[] = [];
  const result = await discoverApprovedWrikeTask(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "34000804",
      approved_discovery_task_id: "MAAAAAENlV9Z",
      trigger_status_id: "IEAALTG3JMHQJJJE",
      contract_number_custom_field_id: "IECONTRACT",
      attachment_extensions: ["xlsx"]
    }),
    {
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "rotated-access-token",
              refresh_token: "rotated-refresh-token",
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/api/v4/ids?")) {
          return new Response(
            JSON.stringify({ data: [{ id: "IEAALTG3I4BANT5E", apiV2Id: "34000804" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/folders/MQAAAAENlV9D")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "MQAAAAENlV9D",
                  parentIds: ["IEAALTG3I4BANT5E"]
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/attachments")) {
          return new Response(JSON.stringify({
            data: [
              {
                id: "IEATTACHMENT",
                version: 1,
                taskId: "MAAAAAENlV9Z",
                name: "C3168700 - Synthetic - OOH Order.xlsx"
              }
            ]
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "MAAAAAENlV9Z",
                accountId: "IEACCOUNT",
                parentIds: ["MQAAAAENlV9D"],
                customStatusId: "IEAALTG3JMHQJJJE",
                attachmentCount: 1,
                title: "Placard Order",
                customFields: [{ id: "IECONTRACT", value: "C3168700" }]
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.preview.status, "Confirmed");
  const converterUrl = new URL(calls[1]);
  assert.equal(converterUrl.pathname, "/api/v4/ids");
  assert.equal(converterUrl.searchParams.get("type"), "ApiV2Folder");
  assert.deepEqual(JSON.parse(converterUrl.searchParams.get("ids") ?? "[]"), ["34000804"]);
  const taskUrl = new URL(calls[2]);
  assert.equal(taskUrl.pathname, "/api/v4/tasks/MAAAAAENlV9Z");
  assert.equal(taskUrl.search, "");
  assert.equal(new URL(calls[3]).pathname, "/api/v4/folders/MQAAAAENlV9D");
  assert.deepEqual(result.preview.approved_scope.folder_id, "IEAALTG3I4BANT5E");
});

test("requalifies and downloads only current matching workbooks without forwarding OAuth", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const workbookBytes = new TextEncoder().encode("bounded-workbook");
  const referenceProofBytes = new TextEncoder().encode("%PDF-1.7 bounded-reference-proof");
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
      contract_number_custom_field_id: "IECONTRACT",
      artwork_folder_custom_field_id: "IEARTWORKFOLDER",
      attachment_extensions: ["xlsx"],
      reference_proof_intake: {
        enabled: true,
        filename_contains: "proof"
      }
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
              data: [
                {
                  id: "IEATTACHMENT",
                  name: "Momentara_3 product_DEMO.xlsx"
                },
                {
                  id: "IEPROOF",
                  name: "Momentara reference proof.pdf"
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/attachments?versions=false&withUrls=true")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "IEATTACHMENT",
                  currentAttachmentId: "IEATTACHMENT",
                  name: "Momentara_3 product_DEMO.xlsx",
                  updatedDate: "2026-07-23T11:45:00.000Z",
                  url: "https://files.example.test/signed/current"
                },
                {
                  id: "IEPROOF",
                  currentAttachmentId: "IEPROOFVERSION1",
                  name: "Momentara reference proof.pdf",
                  updatedDate: "2026-07-23T11:50:00.000Z",
                  url: "https://files.example.test/signed/reference-proof"
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.endsWith("/folders/IEAPPROVEDFOLDER")) {
          return new Response(
            JSON.stringify({ data: [{ id: "IEAPPROVEDFOLDER", title: "Synthetic Campaign" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url === "https://files.example.test/signed/current") {
          assert.deepEqual(init?.headers, { Accept: "*/*" });
          assert.equal(init?.redirect, "error");
          return new Response(workbookBytes, {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(workbookBytes.byteLength)
            }
          });
        }
        if (url === "https://files.example.test/signed/reference-proof") {
          assert.deepEqual(init?.headers, { Accept: "application/pdf" });
          assert.equal(init?.redirect, "error");
          return new Response(referenceProofBytes, {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.wrike.attachment; charset=binary",
              "Content-Length": String(referenceProofBytes.byteLength)
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
              attachmentCount: 2,
              title: "Placard Order",
              customFields: [
                { id: "IECONTRACT", value: "C3168700" },
                {
                  id: "IEARTWORKFOLDER",
                  value: "https://momentara.sharepoint.com/sites/art/Private-Momentara"
                }
              ]
            }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.workbooks.length, 1);
  assert.equal(result.reference_proofs.length, 1);
  assert.ok(result.reference_proof);
  assert.equal(result.reference_proof.attachment_id, "IEPROOF");
  assert.equal(result.reference_proof.version_id, "IEPROOFVERSION1");
  assert.equal(result.reference_proof.content_type, "application/pdf");
  assert.equal(new TextDecoder().decode(result.reference_proof.bytes), "%PDF-1.7 bounded-reference-proof");
  assert.equal(result.workbooks[0].version_id, "IEATTACHMENT:2026-07-23T11:45:00.000Z");
  assert.equal(
    result.workbooks[0].content_type,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(new TextDecoder().decode(result.workbooks[0].bytes), "bounded-workbook");
  assert.deepEqual(result.order_context, {
    contract_number: "C3168700",
    artwork_folder_url: "https://momentara.sharepoint.com/sites/art/Private-Momentara",
    task_title: "Placard Order",
    root_folder_id: "IEAPPROVEDFOLDER",
    campaign_folder_id: "IEAPPROVEDFOLDER",
    campaign_name: "Synthetic Campaign"
  });
  assert.deepEqual(calls.map((call) => call.init?.method), ["POST", "GET", "GET", "GET", "GET", "GET", "GET"]);
  assert.equal(
    calls
      .filter((call) => call.url.startsWith("https://files.example.test/signed/"))
      .some((call) => JSON.stringify(call.init?.headers).includes("rotated-access-token")),
    false
  );
  assert.equal(JSON.stringify(result).includes("files.example.test"), false);
});

test("scheduled preparation reuses fresh provider-scoped ancestry without repeated root conversion or folder walking", async () => {
  const calls: string[] = [];
  const now = new Date("2026-08-28T16:57:53.202Z");
  const result = await fetchQualifiedWrikeWorkbookSources(
    {
      access_token: "current-access-token",
      access_token_expires_at: "2026-08-28T17:57:53.202Z",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_ids: ["34000804", "49405755"],
      folder_id: "34000804",
      approved_discovery_task_id: "IETASK02",
      trigger_status_id: "IEREADY",
      contract_number_custom_field_id: "IECONTRACT",
      order_task_identity_mode: "exact_title_with_numbered_follow_ons",
      order_task_title: "Placard Order",
      attachment_extensions: ["xlsx"]
    }),
    {
      now: () => now,
      prequalified_scope: {
        task_id: "IETASK02",
        checked_at: now.toISOString(),
        resolved_root_folder_ids: ["IEIBACAMPAIGNS"],
        parent_ids: ["IETESTCAMPAIGN"]
      },
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/tasks/IETASK02")) {
          return new Response(JSON.stringify({
            data: [{
              id: "IETASK02",
              accountId: "IEACCOUNT",
              parentIds: ["IETESTCAMPAIGN"],
              superParentIds: [],
              customStatusId: "IEREADY",
              attachmentCount: 1,
              title: "Placard Order 02",
              customFields: [{ id: "IECONTRACT", value: "C234567" }]
            }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/attachments?versions=false&withUrls=false")) {
          return new Response(JSON.stringify({
            data: [{ id: "IEGRID", name: "C234567 - Test - OOH Order 02.xlsx" }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/attachments?versions=false&withUrls=true")) {
          return new Response(JSON.stringify({
            data: [{
              id: "IEGRID",
              currentAttachmentId: "IEGRIDV1",
              name: "C234567 - Test - OOH Order 02.xlsx",
              updatedDate: "2026-08-28T16:55:00.000Z",
              url: "https://files.example.test/order-02"
            }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.endsWith("/folders/IETESTCAMPAIGN")) {
          return new Response(JSON.stringify({
            data: [{ id: "IETESTCAMPAIGN", title: "IBA Multi-Placard Test" }]
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url === "https://files.example.test/order-02") {
          return new Response(new TextEncoder().encode("bounded-workbook"), {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" }
          });
        }
        throw new Error(`Unexpected provider request: ${url}`);
      }
    }
  );

  assert.equal(result.task_id, "IETASK02");
  assert.equal(result.order_context.root_folder_id, "IEIBACAMPAIGNS");
  assert.equal(result.order_context.campaign_folder_id, "IETESTCAMPAIGN");
  assert.equal(result.workbooks.length, 1);
  assert.equal(calls.some((url) => url.includes("/api/v4/ids")), false);
  assert.deepEqual(
    calls.filter((url) => url.includes("/api/v4/folders/")),
    ["https://www.wrike.com/api/v4/folders/IETESTCAMPAIGN"]
  );
});

test("scheduled preparation rejects stale or changed scope evidence without widening provider reads", async () => {
  const config = normalizeWrikeSourceConfig({
    folder_id: "49405755",
    approved_discovery_task_id: "IETASK02",
    trigger_status_id: "IEREADY",
    contract_number_custom_field_id: "IECONTRACT",
    attachment_extensions: ["xlsx"]
  });
  const credentials = {
    access_token: "current-access-token",
    access_token_expires_at: "2026-08-28T17:57:53.202Z",
    host: "www.wrike.com"
  };
  let staleReads = 0;
  await assert.rejects(
    () => fetchQualifiedWrikeWorkbookSources(credentials, config, {
      now: () => new Date("2026-08-28T16:57:53.202Z"),
      prequalified_scope: {
        task_id: "IETASK02",
        checked_at: "2026-08-28T16:50:00.000Z",
        resolved_root_folder_ids: ["IEIBACAMPAIGNS"],
        parent_ids: ["IETESTCAMPAIGN"]
      },
      fetch_impl: async () => {
        staleReads += 1;
        throw new Error("Provider should not be read for stale scope evidence.");
      }
    }),
    (error: unknown) => error instanceof WrikeConnectionError && error.code === "invalid_configuration"
  );
  assert.equal(staleReads, 0);

  const changedCalls: string[] = [];
  await assert.rejects(
    () => fetchQualifiedWrikeWorkbookSources(credentials, config, {
      now: () => new Date("2026-08-28T16:57:53.202Z"),
      prequalified_scope: {
        task_id: "IETASK02",
        checked_at: "2026-08-28T16:57:53.202Z",
        resolved_root_folder_ids: ["IEIBACAMPAIGNS"],
        parent_ids: ["IETESTCAMPAIGN"]
      },
      fetch_impl: async (input) => {
        const url = String(input);
        changedCalls.push(url);
        return new Response(JSON.stringify({
          data: [{
            id: "IETASK02",
            accountId: "IEACCOUNT",
            parentIds: ["IEMOVEDCAMPAIGN"],
            superParentIds: [],
            customStatusId: "IEREADY",
            attachmentCount: 1,
            title: "Placard Order 02",
            customFields: [{ id: "IECONTRACT", value: "C234567" }]
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }),
    (error: unknown) => error instanceof WrikeConnectionError && error.code === "attachment_validation_failed"
  );
  assert.deepEqual(changedCalls, ["https://www.wrike.com/api/v4/tasks/IETASK02"]);
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
        contract_number_custom_field_id: "IECONTRACT",
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
              data: [{ id: "IEATTACHMENT", name: "Momentara_3 product_DEMO.xlsx" }]
            }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          if (url.includes("withUrls=true")) {
            return new Response(JSON.stringify({
              data: [{
                id: "IEATTACHMENT",
                currentAttachmentId: "IEVERSION1",
                name: "Momentara_3 product_DEMO.xlsx",
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
                title: "Placard Order",
                customFields: [{ id: "IECONTRACT", value: "C3168700" }]
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

test("does not read attachment metadata before status and Contract Number guardrails both pass", async () => {
  for (const task of [
    {
      id: "IEAPPROVEDTASK",
      accountId: "IEACCOUNT",
      parentIds: ["IEAPPROVEDFOLDER"],
      customStatusId: "IEORDEREDSTATUS",
      attachmentCount: 1,
      title: "Placard Order",
      customFields: [{ id: "IECONTRACT", value: "C3168700" }]
    },
    {
      id: "IEAPPROVEDTASK",
      accountId: "IEACCOUNT",
      parentIds: ["IEAPPROVEDFOLDER"],
      customStatusId: "IESENTTOPRINTLTL",
      attachmentCount: 1,
      title: "Placard Order",
      customFields: [{ id: "IECONTRACT", value: "not-a-contract" }]
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
        trigger_status_id: "IESENTTOPRINTLTL",
        contract_number_custom_field_id: "IECONTRACT"
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
      trigger_status_id: "IEORDEREDSTATUS",
      contract_number_custom_field_id: "IECONTRACT"
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
        if (url.includes("/folders/IEUNAPPROVEDFOLDER")) {
          return new Response(
            JSON.stringify({ data: [{ id: "IEUNAPPROVEDFOLDER", parentIds: [] }] }),
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
                attachmentCount: 1,
                title: "Placard Order",
                customFields: [{ id: "IECONTRACT", value: "C3168700" }]
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
  assert.equal(calls.length, 3);
  assert.equal(calls.some((url) => url.includes("/attachments")), false);
});

test("discovers only requested Wrike custom-field metadata through read-only OAuth", async () => {
  const calls: string[] = [];
  const result = await discoverWrikeCustomFields(
    {
      client_id: "synthetic-client",
      client_secret: "synthetic-secret",
      refresh_token: "synthetic-refresh",
      host: "www.wrike.com"
    },
    ["Contract Number", "LTL Artwork Folder URL", "LTL Exception", "Print Vendor"],
    {
      now: () => new Date("2026-07-26T14:00:00.000Z"),
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "synthetic-access",
              refresh_token: "synthetic-rotated-refresh",
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
              { id: "IEART", title: "LTL Artwork Folder URL", type: "Text" },
              { id: "IEEXCEPTION", title: "LTL Exception", type: "Checkbox" },
              { id: "IEVENDOR", title: "Print Vendor", type: "DropDown" },
              { id: "IEOTHER", title: "Unrelated Customer Field", type: "Text" }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.deepEqual(calls, [
    "https://www.wrike.com/oauth2/token",
    "https://www.wrike.com/api/v4/customfields"
  ]);
  assert.equal(result.checked_at, "2026-07-26T14:00:00.000Z");
  assert.deepEqual(result.fields, [
    { id: "IECONTRACT", title: "Contract Number", type: "Text" },
    { id: "IEART", title: "LTL Artwork Folder URL", type: "Text" },
    { id: "IEEXCEPTION", title: "LTL Exception", type: "Checkbox" },
    { id: "IEVENDOR", title: "Print Vendor", type: "DropDown" }
  ]);
  assert.deepEqual(result.missing_titles, []);
  assert.equal(result.capabilities.task_values_read, false);
  assert.equal(result.capabilities.attachment_metadata_read, false);
  assert.equal(result.capabilities.wrike_writes, false);
});

test("discovers eligible Placard Orders across configured campaign descendants and keeps shipping inactive by default", async () => {
  const calls: string[] = [];
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEGPACAMPAIGNS",
      trigger_status_id: "IESENTTOPRINT",
      contract_number_custom_field_id: "IECONTRACT",
      artwork_folder_custom_field_id: "IEART",
      print_vendor_custom_field_id: "IEVENDOR",
      order_task_title: "Placard Order",
      required_print_vendor_value: "Larger Than Life"
    }),
    {
      now: () => new Date("2026-07-28T12:00:00.000Z"),
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "rotated-refresh-token",
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "IEPLACARD1",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGN1"],
                // Wrike's descendant query does not always repeat a deeply
                // nested campaign root in task ancestry metadata.
                superParentIds: ["IECAMPAIGNYEAR"],
                customStatusId: "IESENTTOPRINT",
                attachmentCount: 2,
                title: "Placard Order",
                customFields: [
                  { id: "IECONTRACT", value: "C3168700" },
                  { id: "IEVENDOR", value: "Larger Than Life" },
                  { id: "IEART", value: "https://example.test/private-art" }
                ]
              },
              {
                id: "IEPLACARDOTHER",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGN2"],
                superParentIds: ["IEGPACAMPAIGNS"],
                customStatusId: "IESENTTOPRINT",
                attachmentCount: 1,
                title: "Placard Order",
                customFields: [
                  { id: "IECONTRACT", value: "C3168701" },
                  { id: "IEVENDOR", value: "Another Vendor" }
                ]
              },
              {
                id: "IESHIPPING1",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGN1"],
                superParentIds: ["IEGPACAMPAIGNS"],
                customStatusId: "IEHAVADDRESS",
                attachmentCount: 1,
                title: "Shipping Information"
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.summary.task_count, 3);
  assert.equal(result.summary.scoped_task_count, 3);
  assert.equal(result.summary.order_identity_match_count, 2);
  assert.equal(result.summary.order_status_match_count, 2);
  assert.equal(result.summary.order_status_and_identity_match_count, 2);
  assert.equal(result.summary.order_vendor_match_count, 1);
  assert.equal(result.summary.order_contract_ready_count, 1);
  assert.equal(result.summary.eligible_order_count, 1);
  assert.equal(result.summary.pending_order_count, 1);
  assert.equal(result.summary.placard_order_pending_count, 1);
  assert.equal(result.summary.likely_pending_order_count, 1);
  assert.equal(result.summary.order_status_id_count, 1);
  assert.deepEqual(result.summary.order_identity_status_ids, ["IESENTTOPRINT"]);
  assert.deepEqual(result.summary.resolved_order_status_ids, ["IESENTTOPRINT"]);
  assert.equal(result.order_candidates[0].task_id, "IEPLACARD1");
  assert.deepEqual(result.order_candidates[0].root_folder_ids, ["IEGPACAMPAIGNS"]);
  assert.equal(result.order_candidates[0].contract_number, "C3168700");
  assert.equal(result.order_candidates[0].artwork_folder_status, "ready");
  assert.deepEqual(result.pending_order_candidates, [
    {
      task_id: "IEPLACARDOTHER",
      task_title: "Placard Order",
      updated_at: null,
      account_id: "IEACCOUNT",
      root_folder_ids: ["IEGPACAMPAIGNS"],
      custom_status_id: "IESENTTOPRINT",
      contract_number: "C3168701",
      identity_matches: true,
      readiness_score: 2,
      reasons: [
        {
          code: "print_vendor",
          message: "Set Print Vendor to Larger Than Life."
        }
      ]
    }
  ]);
  assert.equal(result.shipping.status, "Inactive");
  assert.deepEqual(result.shipping.candidates, []);
  assert.equal(result.capabilities.shipping_attachment_metadata_read, false);
  assert.equal(result.capabilities.attachment_download, false);
  assert.equal(result.capabilities.workbook_parse, false);
  assert.equal(result.capabilities.evidence_persistence, false);
  assert.equal(result.capabilities.wrike_writes, false);
  assert.equal(result.capabilities.lift_actions, false);
  assert.equal(calls.some((url) => url.includes("/attachments")), false);
  const folderUrl = new URL(calls[1]);
  assert.equal(folderUrl.pathname, "/api/v4/folders/IEGPACAMPAIGNS/tasks");
  assert.equal(folderUrl.searchParams.get("descendants"), "true");
  assert.deepEqual(JSON.parse(folderUrl.searchParams.get("fields") ?? "[]"), [
    "attachmentCount",
    "customFields",
    "customItemTypeId",
    "parentIds",
    "superParentIds"
  ]);
  assert.equal(folderUrl.searchParams.get("pageSize"), "1000");
  assert.equal(folderUrl.searchParams.has("customStatuses"), false);
});

test("discovers bounded numbered Placard Order title variants", async () => {
  const titles = [
    "Placard Order",
    "Placard Order 02",
    "Placard Order 03",
    "Placard Order #02",
    "Placard Order #03",
    "Placard Order #2",
    "Placard Order #9",
    "Placard Order 2",
    "Placard Order 9",
    "Placard Order 01",
    "Placard Order #01",
    "Placard Order #1",
    "Placard Order #0",
    "Placard Order # 02",
    "Placard Order 100"
  ];
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEIBACAMPAIGNS",
      trigger_status_id: "IESENTTOPRINT",
      contract_number_custom_field_id: "IECONTRACT",
      print_vendor_custom_field_id: "IEVENDOR",
      order_task_identity_mode: "exact_title_with_numbered_follow_ons",
      order_task_title: "Placard Order",
      required_print_vendor_value: "Larger Than Life"
    }),
    {
      now: () => new Date("2026-08-27T16:00:00.000Z"),
      fetch_impl: async (input) => {
        const url = String(input);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "rotated-refresh-token",
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            data: titles.map((title, index) => ({
              id: `IETASK${index}`,
              accountId: "IEACCOUNT",
              parentIds: ["IETESTCAMPAIGN"],
              superParentIds: ["IEIBACAMPAIGNS"],
              customStatusId: "IESENTTOPRINT",
              attachmentCount: 1,
              title,
              customFields: [
                { id: "IECONTRACT", value: "C234567" },
                { id: "IEVENDOR", value: "Larger Than Life" }
              ]
            }))
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.summary.task_count, 15);
  assert.equal(result.summary.order_identity_match_count, 9);
  assert.equal(result.summary.eligible_order_count, 9);
  assert.deepEqual(
    result.order_candidates.map((candidate) => candidate.task_title),
    [
      "Placard Order",
      "Placard Order 02",
      "Placard Order 03",
      "Placard Order #02",
      "Placard Order #03",
      "Placard Order #2",
      "Placard Order #9",
      "Placard Order 2",
      "Placard Order 9"
    ]
  );
});

test("returns the true pending count and prioritizes likely Placard Order candidates beyond 100 tasks", async () => {
  const placardTasks = Array.from({ length: 120 }, (_, index) => ({
    id: `IEPLACARD${String(index).padStart(3, "0")}`,
    accountId: "IEACCOUNT",
    parentIds: ["IECAMPAIGN"],
    superParentIds: ["IEROOT"],
    customStatusId: "IEREADY",
    updatedDate: new Date(Date.UTC(2026, 7, 12, 12, index % 60)).toISOString(),
    title: "Placard Order",
    customFields: [{ id: "IECONTRACT", value: `C${String(3100000 + index)}` }]
  }));
  const statusNoise = Array.from({ length: 5 }, (_, index) => ({
    id: `IENOISE${index}`,
    accountId: "IEACCOUNT",
    parentIds: ["IECAMPAIGN"],
    superParentIds: ["IEROOT"],
    customStatusId: "IEREADY",
    title: "Unrelated task",
    customFields: []
  }));
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEROOT",
      trigger_status_id: "IEREADY",
      contract_number_custom_field_id: "IECONTRACT",
      print_vendor_custom_field_id: "IEVENDOR",
      order_task_title: "Placard Order",
      required_print_vendor_value: "Larger Than Life"
    }),
    {
      fetch_impl: async (input) => {
        const url = String(input);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "rotated-refresh-token",
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/folders/IEROOT/tasks")) {
          return new Response(JSON.stringify({ data: [...placardTasks, ...statusNoise] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );

  assert.equal(result.pending_order_candidates.length, 120);
  assert.equal(result.summary.pending_order_count, 120);
  assert.equal(result.summary.placard_order_pending_count, 120);
  assert.equal(result.summary.likely_pending_order_count, 120);
  assert.equal(result.pending_order_candidates[0]?.identity_matches, true);
  assert.equal(result.pending_order_candidates[0]?.readiness_score, 2);
  assert.equal(result.pending_order_candidates.at(-1)?.identity_matches, true);
});

test("discovers and deduplicates eligible orders across multiple configured campaign roots", async () => {
  const taskRequests: string[] = [];
  const config = normalizeWrikeSourceConfig({
    folder_ids: ["IEGPACAMPAIGNS", "IEIBACAMPAIGNS"],
    trigger_status_id: "IESENTTOPRINT",
    contract_number_custom_field_id: "IECONTRACT",
    print_vendor_custom_field_id: "IEVENDOR",
    order_task_title: "Placard Order",
    required_print_vendor_value: "Larger Than Life"
  });
  const task = (id: string, contract: string, root: string) => ({
    id,
    accountId: "IEACCOUNT",
    parentIds: [`${root}-CAMPAIGN`],
    superParentIds: [root],
    customStatusId: "IESENTTOPRINT",
    attachmentCount: 1,
    title: "Placard Order",
    customFields: [
      { id: "IECONTRACT", value: contract },
      { id: "IEVENDOR", value: "Larger Than Life" }
    ]
  });

  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    config,
    {
      fetch_impl: async (input) => {
        const url = String(input);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({ access_token: "access-token", host: "app-us2.wrike.com" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/folders/IEGPACAMPAIGNS/tasks")) {
          taskRequests.push(url);
          return new Response(
            JSON.stringify({
              data: [
                task("IEGPAORDER", "C316870", "IEGPACAMPAIGNS"),
                task("IESHAREDORDER", "C316871", "IEGPACAMPAIGNS")
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/folders/IEIBACAMPAIGNS/tasks")) {
          taskRequests.push(url);
          return new Response(
            JSON.stringify({
              data: [
                task("IEIBAORDER", "C316872", "IEIBACAMPAIGNS"),
                task("IESHAREDORDER", "C316871", "IEIBACAMPAIGNS")
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
  );

  assert.deepEqual(result.folder_ids, ["IEGPACAMPAIGNS", "IEIBACAMPAIGNS"]);
  assert.equal(result.folder_id, "IEGPACAMPAIGNS");
  assert.deepEqual(
    result.root_scopes.map((scope) => [scope.configured_folder_id, scope.task_count]),
    [
      ["IEGPACAMPAIGNS", 2],
      ["IEIBACAMPAIGNS", 2]
    ]
  );
  assert.equal(result.summary.task_count, 3);
  assert.deepEqual(
    result.order_candidates.map((candidate) => candidate.task_id).sort(),
    ["IEGPAORDER", "IEIBAORDER", "IESHAREDORDER"]
  );
  assert.deepEqual(
    result.order_candidates.find((candidate) => candidate.task_id === "IESHAREDORDER")
      ?.root_folder_ids,
    ["IEGPACAMPAIGNS", "IEIBACAMPAIGNS"]
  );
  assert.equal(taskRequests.length, 2);
});

test("resolves a required print vendor from a Wrike dropdown option ID", async () => {
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEGPACAMPAIGNS",
      trigger_status_id: "IESENTTOPRINT",
      contract_number_custom_field_id: "IECONTRACT",
      print_vendor_custom_field_id: "IEVENDOR",
      order_task_title: "Placard Order",
      required_print_vendor_value: "Larger Than Life"
    }),
    {
      fetch_impl: async (input) => {
        const url = String(input);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({ access_token: "access-token", host: "app-us2.wrike.com" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/api/v4/customfields")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "IEVENDOR",
                  type: "DropDown",
                  settings: {
                    values: [
                      { id: "IEOPTIONLTL", value: "Larger Than Life" },
                      { id: "IEOPTIONOTHER", value: "Another Vendor" }
                    ]
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("/api/v4/workflows") || url.includes("/api/v4/spaces")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "IEPLACARD1",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGN1"],
                superParentIds: ["IEGPACAMPAIGNS"],
                customStatusId: "IESENTTOPRINT",
                attachmentCount: 2,
                title: "Placard Order",
                customFields: [
                  { id: "IECONTRACT", value: "C111111" },
                  { id: "IEVENDOR", value: JSON.stringify(["Larger Than Life"]) }
                ]
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.summary.order_vendor_match_count, 1);
  assert.equal(result.summary.order_contract_ready_count, 1);
  assert.equal(result.summary.eligible_order_count, 1);
  assert.equal(result.order_candidates[0]?.contract_number, "C111111");
});

test("matches the configured ready-status label across distinct Wrike workflows", async () => {
  const calls: string[] = [];
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEGPACAMPAIGNS",
      trigger_status_id: "IEEARLIERWORKFLOWSTATUS",
      trigger_status_label: "Sent to Print - LTL",
      contract_number_custom_field_id: "IECONTRACT",
      print_vendor_custom_field_id: "IEVENDOR",
      order_task_title: "Placard Order",
      required_print_vendor_value: "Larger Than Life"
    }),
    {
      now: () => new Date("2026-08-05T22:30:00.000Z"),
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "rotated-refresh-token",
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.endsWith("/api/v4/workflows")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "IEWORKFLOW",
                  name: "GPA Campaigns",
                  customStatuses: [
                    { id: "IENEWWORKFLOWSTATUS", name: "Sent to Print - LTL" },
                    { id: "IEOTHERSTATUS", name: "In Progress" }
                  ]
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
                id: "IEREADY",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGNNEW"],
                superParentIds: ["IEGPACAMPAIGNS"],
                customStatusId: "IENEWWORKFLOWSTATUS",
                attachmentCount: 2,
                title: "Placard Order",
                customFields: [
                  { id: "IECONTRACT", value: "C111111" },
                  { id: "IEVENDOR", value: "Larger Than Life" }
                ]
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.summary.task_count, 1);
  assert.equal(result.summary.scoped_task_count, 1);
  assert.equal(result.summary.order_identity_match_count, 1);
  assert.equal(result.summary.order_status_match_count, 1);
  assert.equal(result.summary.order_status_and_identity_match_count, 1);
  assert.equal(result.summary.order_vendor_match_count, 1);
  assert.equal(result.summary.order_contract_ready_count, 1);
  assert.equal(result.summary.order_status_id_count, 2);
  assert.equal(result.summary.eligible_order_count, 1);
  assert.equal(result.order_candidates[0].task_id, "IEREADY");
  assert.equal(result.capabilities.workflow_status_metadata_read, true);
  assert.equal(calls.some((url) => url.endsWith("/api/v4/workflows")), true);
});

test("matches a ready status defined only in a Wrike space workflow", async () => {
  const calls: string[] = [];
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEGPACAMPAIGNS",
      trigger_status_id: "IEEARLIERWORKFLOWSTATUS",
      trigger_status_label: "Sent to Print - LTL",
      contract_number_custom_field_id: "IECONTRACT",
      print_vendor_custom_field_id: "IEVENDOR",
      order_task_title: "Placard Order",
      required_print_vendor_value: "Larger Than Life"
    }),
    {
      now: () => new Date("2026-08-05T23:00:00.000Z"),
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "rotated-refresh-token",
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.endsWith("/api/v4/workflows")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.includes("/api/v4/spaces?")) {
          return new Response(JSON.stringify({ data: [{ id: "IESPACEONE" }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url.endsWith("/api/v4/spaces/IESPACEONE/workflows")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "IESPACEWORKFLOW",
                  customStatuses: [
                    { id: "IESPACEREADYSTATUS", name: "Sent to Print - LTL" }
                  ]
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
                id: "IEREADY",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGNNEW"],
                superParentIds: ["IEGPACAMPAIGNS"],
                customStatusId: "IESPACEREADYSTATUS",
                attachmentCount: 2,
                title: "Placard Order",
                customFields: [
                  { id: "IECONTRACT", value: "C111111" },
                  { id: "IEVENDOR", value: "Larger Than Life" }
                ]
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.summary.order_status_id_count, 2);
  assert.equal(result.summary.order_status_match_count, 1);
  assert.equal(result.summary.eligible_order_count, 1);
  assert.equal(result.order_candidates[0].task_id, "IEREADY");
  assert.equal(
    calls.some((url) => url.endsWith("/api/v4/spaces/IESPACEONE/workflows")),
    true
  );
});

test("discovers an eligible Placard Order on a later bounded Wrike page", async () => {
  const calls: string[] = [];
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    normalizeWrikeSourceConfig({
      folder_id: "IEGPACAMPAIGNS",
      trigger_status_id: "IESENTTOPRINT",
      contract_number_custom_field_id: "IECONTRACT",
      print_vendor_custom_field_id: "IEVENDOR",
      order_task_title: "Placard Order",
      required_print_vendor_value: "Larger Than Life"
    }),
    {
      now: () => new Date("2026-08-05T22:00:00.000Z"),
      max_pages: 10,
      max_tasks: 10_000,
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "rotated-refresh-token",
              host: "app-us2.wrike.com"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.endsWith("/api/v4/workflows") || url.includes("/api/v4/spaces?")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        const taskUrl = new URL(url);
        if (!taskUrl.searchParams.has("nextPageToken")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: "IEHISTORICAL",
                  accountId: "IEACCOUNT",
                  parentIds: ["IECAMPAIGNOLD"],
                  superParentIds: ["IEGPACAMPAIGNS"],
                  customStatusId: "IECOMPLETE",
                  attachmentCount: 0,
                  title: "Placard Order"
                }
              ],
              nextPageToken: "page-two"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "IEREADY",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGNNEW"],
                superParentIds: ["IEGPACAMPAIGNS"],
                customStatusId: "IESENTTOPRINT",
                attachmentCount: 2,
                title: "Placard Order",
                customFields: [
                  { id: "IECONTRACT", value: "C111111" },
                  { id: "IEVENDOR", value: "Larger Than Life" }
                ]
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.summary.task_count, 2);
  assert.equal(result.summary.eligible_order_count, 1);
  assert.equal(result.order_candidates[0].task_id, "IEREADY");
  assert.equal(result.order_candidates[0].contract_number, "C111111");
  assert.equal(calls.length, 6);
  assert.equal(calls.some((url) => url.includes("/api/v4/customfields")), true);
  const firstPage = new URL(calls[1]);
  const secondPage = new URL(calls[2]);
  assert.equal(firstPage.searchParams.get("pageSize"), "1000");
  assert.equal(firstPage.searchParams.has("customStatuses"), false);
  assert.equal(secondPage.searchParams.get("nextPageToken"), "page-two");
});

test("discovers only safe shipping task and attachment metadata when the pure contract is explicitly activated", async () => {
  const calls: string[] = [];
  const normalizedConfig = normalizeWrikeSourceConfig({
    folder_id: "IEGPACAMPAIGNS",
    trigger_status_id: "IESENTTOPRINT",
    contract_number_custom_field_id: "IECONTRACT",
    print_vendor_custom_field_id: "IEVENDOR",
    shipping_intake: {
      enabled: true,
      task_identity_mode: "exact_title",
      task_title: "Shipping Information",
      trigger_status_id: "IEHAVADDRESS",
      trigger_status_label: "Have Address - LTL",
      attachment_filename_contains: "Ship List",
      attachment_extensions: ["xlsx"]
    }
  });
  const result = await discoverScopedWrikeIntakeTasks(
    {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
      host: "www.wrike.com"
    },
    {
      ...normalizedConfig,
      shipping_intake: {
        ...normalizedConfig.shipping_intake,
        enabled: true
      }
    },
    {
      now: () => new Date("2026-07-28T12:00:00.000Z"),
      fetch_impl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/oauth2/token")) {
          return new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "rotated-refresh-token",
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
                  id: "IESHIPATTACHMENT",
                  currentAttachmentId: "IESHIPVERSION2",
                  name: "C316664 - Private Customer - Ship List.xlsx",
                  updatedDate: "2026-07-28T11:30:00.000Z",
                  url: "https://temporary.example.test/must-not-return",
                  previewUrl: "https://temporary.example.test/must-not-return-preview"
                },
                {
                  id: "IEOTHERATTACHMENT",
                  name: "private-addresses.pdf",
                  url: "https://temporary.example.test/ignore"
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
                id: "IESHIPPING1",
                accountId: "IEACCOUNT",
                parentIds: ["IECAMPAIGN1"],
                superParentIds: ["IEGPACAMPAIGNS"],
                customStatusId: "IEHAVADDRESS",
                attachmentCount: 2,
                title: "Shipping Information",
                description: "Private recipient details must not return."
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  );

  assert.equal(result.shipping.status, "Discovered");
  assert.equal(result.shipping.candidates.length, 1);
  assert.deepEqual(result.shipping.candidates[0].attachments, [
    {
      attachment_id: "IESHIPATTACHMENT",
      version_id: "IESHIPVERSION2",
      extension: "xlsx",
      updated_at: "2026-07-28T11:30:00.000Z"
    }
  ]);
  assert.equal(result.shipping.candidates[0].matching_attachment_count, 1);
  assert.equal(result.capabilities.shipping_attachment_metadata_read, true);
  const folderUrl = new URL(calls[1]);
  assert.equal(folderUrl.searchParams.has("customStatuses"), false);
  assert.equal(
    calls.some((url) =>
      /\/api\/v4\/tasks\/IESHIPPING1\/attachments\?versions=false&withUrls=false$/.test(url)
    ),
    true
  );
  assert.equal(calls.some((url) => /download|withUrls=true|webhooks/.test(url)), false);
  const { credentials: _credentials, ...safeResult } = result;
  const serialized = JSON.stringify(safeResult);
  assert.equal(serialized.includes("Private Customer"), false);
  assert.equal(serialized.includes("Private recipient"), false);
  assert.equal(serialized.includes("temporary.example.test"), false);
  assert.equal(serialized.includes("access-token"), false);
});

test("requires a complete explicit shipping identity before metadata discovery can be active", async () => {
  const normalizedConfig = normalizeWrikeSourceConfig({
    folder_id: "IEGPACAMPAIGNS",
    trigger_status_id: "IESENTTOPRINT",
    contract_number_custom_field_id: "IECONTRACT",
    print_vendor_custom_field_id: "IEVENDOR",
    shipping_intake: {
      enabled: true,
      task_title: "Shipping Information",
      trigger_status_id: ""
    }
  });
  await assert.rejects(
    discoverScopedWrikeIntakeTasks(
      {
        client_id: "client-id",
        client_secret: "client-secret",
        refresh_token: "refresh-token",
        host: "www.wrike.com"
      },
      {
        ...normalizedConfig,
        shipping_intake: {
          ...normalizedConfig.shipping_intake,
          enabled: true
        }
      },
      {
        fetch_impl: async () => {
          throw new Error("No provider call should occur.");
        }
      }
    ),
    (error: unknown) =>
      error instanceof WrikeConnectionError &&
      error.code === "invalid_configuration"
  );
});
