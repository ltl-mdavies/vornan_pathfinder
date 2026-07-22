export type WrikeTriggerMode = "scheduled_polling" | "webhook_with_reconciliation";
export type WrikeWorkbookExtension = "xlsx" | "xls" | "csv";
export type WrikeAttachmentSelectionPolicy = "newest_matching_workbook";
export type WrikeIdempotencyStrategy = "task_attachment_version";

export interface WrikeOAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
  access_token_expires_at?: string;
  host: string;
}

export interface WrikeConnectionHealth {
  status: "Connected";
  host: string;
  checked_at: string;
  identity_confirmed: true;
}

export interface WrikeConnectionCheckResult {
  credentials: WrikeOAuthCredentials;
  health: WrikeConnectionHealth;
}

export interface WrikeOAuthRefreshResult {
  credentials: WrikeOAuthCredentials;
  refreshed_at: string;
}

export class WrikeConnectionError extends Error {
  constructor(
    public readonly code:
      | "invalid_configuration"
      | "oauth_refresh_failed"
      | "identity_check_failed"
      | "task_discovery_failed"
      | "attachment_metadata_failed"
      | "invalid_response",
    message: string,
    public readonly rotated_credentials?: WrikeOAuthCredentials
  ) {
    super(message);
    this.name = "WrikeConnectionError";
  }
}

export interface WrikeSourceConfig {
  enabled: boolean;
  folder_id: string;
  approved_discovery_task_id: string;
  trigger_mode: WrikeTriggerMode;
  trigger_status_id: string;
  trigger_status_label: string;
  attachment_filename_contains: string;
  attachment_extensions: WrikeWorkbookExtension[];
  attachment_selection: WrikeAttachmentSelectionPolicy;
  poll_interval_minutes: number;
  idempotency_strategy: WrikeIdempotencyStrategy;
  create_preview_only: true;
}

export interface WrikeDiscoveryCheck {
  check_id: "task" | "folder_scope" | "trigger_status" | "attachment_metadata" | "workbook_candidates";
  status: "Passed" | "Warning" | "Blocked";
  message: string;
}

export interface WrikeTaskDiscoveryPreview {
  status: "Confirmed" | "Needs review";
  checked_at: string;
  approved_scope: {
    task_id: string;
    folder_id: string;
    trigger_status_id: string;
  };
  observed: {
    task_id: string;
    account_id: string | null;
    parent_ids: string[];
    super_parent_ids: string[];
    custom_status_id: string | null;
    task_attachment_count: number | null;
    attachment_metadata_count: number | null;
    workbook_candidate_count: number | null;
  };
  checks: WrikeDiscoveryCheck[];
  capabilities: {
    task_read: true;
    attachment_metadata_read: boolean;
    attachment_download: false;
    preview_job_creation: false;
    webhook: false;
    polling: false;
    wrike_writes: false;
    lift_actions: false;
  };
}

export interface WrikeTaskDiscoveryResult {
  credentials: WrikeOAuthCredentials;
  preview: WrikeTaskDiscoveryPreview;
}

export interface WrikeAttachmentCandidate {
  attachment_id: string;
  version_id: string;
  file_name: string;
  updated_at: string;
  download_url?: string | null;
}

export interface WrikeAttachmentSelectionResult {
  status: "matched" | "missing" | "ambiguous";
  attachment: WrikeAttachmentCandidate | null;
  matches: WrikeAttachmentCandidate[];
  message: string;
}

export interface WrikeContractReadiness {
  status: "Incomplete" | "Configured";
  missing: Array<"folder_id" | "trigger_status_id" | "attachment_extensions">;
}

export type WrikeReadOnlyQaReadinessStatus =
  | "needs_setup"
  | "ready_for_explicit_qa_window"
  | "run_identity_check"
  | "ready_for_approved_task_preview";

export interface WrikeReadOnlyQaReadinessItem {
  item_id:
    | "saved_method"
    | "source_contract"
    | "approved_task"
    | "oauth_credentials"
    | "connection_gate"
    | "discovery_gate"
    | "identity_check";
  status: "Passed" | "Waiting" | "Blocked";
  label: string;
  message: string;
}

export interface WrikeReadOnlyQaReadiness {
  status: WrikeReadOnlyQaReadinessStatus;
  summary: string;
  next_action: string;
  items: WrikeReadOnlyQaReadinessItem[];
  capabilities: {
    approved_task_preview: boolean;
    attachment_download: false;
    preview_job_creation: false;
    webhook: false;
    polling: false;
    wrike_writes: false;
    lift_actions: false;
  };
}

export function createDefaultWrikeSourceConfig(): WrikeSourceConfig {
  return {
    enabled: false,
    folder_id: "",
    approved_discovery_task_id: "",
    trigger_mode: "scheduled_polling",
    trigger_status_id: "",
    trigger_status_label: "Ordered",
    attachment_filename_contains: "",
    attachment_extensions: ["xlsx"],
    attachment_selection: "newest_matching_workbook",
    poll_interval_minutes: 15,
    idempotency_strategy: "task_attachment_version",
    create_preview_only: true
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanIdentifier(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

export function normalizeWrikeSourceConfig(value: unknown): WrikeSourceConfig {
  const source = asRecord(value);
  const fallback = createDefaultWrikeSourceConfig();
  const extensions = Array.from(
    new Set(
      (Array.isArray(source.attachment_extensions) ? source.attachment_extensions : fallback.attachment_extensions)
        .map((extension) => String(extension).trim().toLowerCase().replace(/^\./, ""))
        .filter((extension): extension is WrikeWorkbookExtension =>
          extension === "xlsx" || extension === "xls" || extension === "csv"
        )
    )
  );
  const interval = Number(source.poll_interval_minutes ?? fallback.poll_interval_minutes);
  const pollIntervalPresets = [5, 10, 15, 30, 60] as const;
  const normalizedInterval = Number.isFinite(interval)
    ? pollIntervalPresets.reduce((closest, candidate) =>
        Math.abs(candidate - interval) < Math.abs(closest - interval) ? candidate : closest
      )
    : fallback.poll_interval_minutes;

  return {
    enabled: false,
    folder_id: cleanIdentifier(source.folder_id),
    approved_discovery_task_id: cleanIdentifier(source.approved_discovery_task_id),
    trigger_mode:
      source.trigger_mode === "webhook_with_reconciliation"
        ? "webhook_with_reconciliation"
        : "scheduled_polling",
    trigger_status_id: cleanIdentifier(source.trigger_status_id),
    trigger_status_label:
      typeof source.trigger_status_label === "string"
        ? source.trigger_status_label.trim().slice(0, 100)
        : fallback.trigger_status_label,
    attachment_filename_contains:
      typeof source.attachment_filename_contains === "string"
        ? source.attachment_filename_contains.trim().slice(0, 160)
        : "",
    attachment_extensions: extensions.length ? extensions : fallback.attachment_extensions,
    attachment_selection: "newest_matching_workbook",
    poll_interval_minutes: normalizedInterval,
    idempotency_strategy: "task_attachment_version",
    create_preview_only: true
  };
}

export function getWrikeContractReadiness(config: WrikeSourceConfig): WrikeContractReadiness {
  const missing: WrikeContractReadiness["missing"] = [];
  if (!config.folder_id) {
    missing.push("folder_id");
  }
  if (!config.trigger_status_id) {
    missing.push("trigger_status_id");
  }
  if (!config.attachment_extensions.length) {
    missing.push("attachment_extensions");
  }
  return {
    status: missing.length ? "Incomplete" : "Configured",
    missing
  };
}

export function evaluateWrikeReadOnlyQaReadiness(args: {
  config: WrikeSourceConfig;
  method_saved: boolean;
  connection_configured: boolean;
  connection_test_enabled: boolean;
  discovery_preview_enabled: boolean;
  identity_confirmed: boolean;
}): WrikeReadOnlyQaReadiness {
  const contract = getWrikeContractReadiness(args.config);
  const approvedTaskConfigured = Boolean(args.config.approved_discovery_task_id);
  const items: WrikeReadOnlyQaReadinessItem[] = [
    {
      item_id: "saved_method",
      status: args.method_saved ? "Passed" : "Blocked",
      label: "Saved Import Method",
      message: args.method_saved
        ? "The QA check will use the persisted Import Method contract."
        : "Save the Import Method before requesting any provider read."
    },
    {
      item_id: "source_contract",
      status: contract.status === "Configured" ? "Passed" : "Blocked",
      label: "Wrike source contract",
      message: contract.status === "Configured"
        ? "Folder, ordered-status, and workbook rules are configured."
        : "Configure the folder/project, ordered-status ID, and workbook rule."
    },
    {
      item_id: "approved_task",
      status: approvedTaskConfigured ? "Passed" : "Blocked",
      label: "Approved task scope",
      message: approvedTaskConfigured
        ? "One exact task ID is recorded for the bounded discovery preview."
        : "Record one explicitly approved Wrike task ID."
    },
    {
      item_id: "oauth_credentials",
      status: args.connection_configured ? "Passed" : "Blocked",
      label: "Read-only OAuth connection",
      message: args.connection_configured
        ? "Secret-backed OAuth credentials and a regional host are configured."
        : "Configure the least-privilege technical-user OAuth connection in Settings."
    },
    {
      item_id: "connection_gate",
      status: args.connection_test_enabled ? "Passed" : "Waiting",
      label: "Connection-test gate",
      message: args.connection_test_enabled
        ? "The bounded read-only identity test is available."
        : "Gate remains dark until an explicit QA window is approved."
    },
    {
      item_id: "discovery_gate",
      status: args.discovery_preview_enabled ? "Passed" : "Waiting",
      label: "Approved-task preview gate",
      message: args.discovery_preview_enabled
        ? "Exact-task and attachment-metadata reads are available."
        : "Gate remains dark until the same explicit QA window is approved."
    },
    {
      item_id: "identity_check",
      status: args.identity_confirmed ? "Passed" : args.connection_test_enabled ? "Waiting" : "Blocked",
      label: "Authorized-user identity",
      message: args.identity_confirmed
        ? "The read-only Wrike identity check has passed."
        : args.connection_test_enabled
          ? "Run the read-only connection test before task discovery."
          : "Identity remains unverified while the QA gate is dark."
    }
  ];

  const setupComplete =
    args.method_saved &&
    contract.status === "Configured" &&
    approvedTaskConfigured &&
    args.connection_configured;

  let status: WrikeReadOnlyQaReadinessStatus = "needs_setup";
  let summary = "Complete the saved scope and read-only connection setup.";
  let nextAction = "Resolve the blocked setup items before requesting a QA window.";

  if (setupComplete && (!args.connection_test_enabled || !args.discovery_preview_enabled)) {
    status = "ready_for_explicit_qa_window";
    summary = "Setup is complete; provider access remains dark.";
    nextAction = "Request explicit approval for a bounded read-only QA window before enabling either server gate.";
  } else if (setupComplete && !args.identity_confirmed) {
    status = "run_identity_check";
    summary = "The bounded QA gates are open, but identity is not confirmed.";
    nextAction = "Run the read-only connection test, then review this readiness check again.";
  } else if (setupComplete && args.identity_confirmed) {
    status = "ready_for_approved_task_preview";
    summary = "The exact approved task is ready for a bounded read-only preview.";
    nextAction = "Run the approved task preview and record sanitized evidence; do not download an attachment or create a job.";
  }

  return {
    status,
    summary,
    next_action: nextAction,
    items,
    capabilities: {
      approved_task_preview:
        status === "ready_for_approved_task_preview" && args.discovery_preview_enabled,
      attachment_download: false,
      preview_job_creation: false,
      webhook: false,
      polling: false,
      wrike_writes: false,
      lift_actions: false
    }
  };
}

export function buildWrikeIngestionIdentity(args: {
  account_id: string;
  task_id: string;
  attachment_id: string;
  version_id: string;
}) {
  return ["wrike", args.account_id, args.task_id, args.attachment_id, args.version_id]
    .map((part) => encodeURIComponent(part.trim()))
    .join(":");
}

export function normalizeWrikeHost(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new WrikeConnectionError("invalid_configuration", "Wrike regional host is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new WrikeConnectionError("invalid_configuration", "Wrike regional host is invalid.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const isWrikeHost = hostname === "wrike.com" || hostname.endsWith(".wrike.com");
  if (
    parsed.protocol !== "https:" ||
    !isWrikeHost ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new WrikeConnectionError(
      "invalid_configuration",
      "Use only the HTTPS Wrike regional host returned by OAuth, such as www.wrike.com."
    );
  }

  return hostname;
}

function requiredCredential(value: string, label: string) {
  if (!value.trim()) {
    throw new WrikeConnectionError("invalid_configuration", `${label} is required.`);
  }
  return value.trim();
}

async function responseJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new WrikeConnectionError("invalid_response", "Wrike returned an unreadable response.");
  }
}

export async function refreshWrikeOAuthCredentials(
  credentials: WrikeOAuthCredentials,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WrikeOAuthRefreshResult> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const now = options.now ?? (() => new Date());
  const host = normalizeWrikeHost(credentials.host);
  const clientId = requiredCredential(credentials.client_id, "Wrike OAuth client ID");
  const clientSecret = requiredCredential(credentials.client_secret, "Wrike OAuth client secret");
  const refreshToken = requiredCredential(credentials.refresh_token, "Wrike OAuth refresh token");
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "wsReadOnly"
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImpl(`https://${host}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody
    });
  } catch {
    throw new WrikeConnectionError("oauth_refresh_failed", "Pathfinder could not reach the Wrike OAuth host.");
  }

  if (!tokenResponse.ok) {
    throw new WrikeConnectionError(
      "oauth_refresh_failed",
      `Wrike OAuth refresh was rejected (HTTP ${tokenResponse.status}).`
    );
  }

  const tokenPayload = await responseJson(tokenResponse);
  const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token.trim() : "";
  const nextRefreshToken =
    typeof tokenPayload.refresh_token === "string" && tokenPayload.refresh_token.trim()
      ? tokenPayload.refresh_token.trim()
      : refreshToken;
  const responseHost = normalizeWrikeHost(tokenPayload.host ?? host);
  if (!accessToken) {
    throw new WrikeConnectionError("invalid_response", "Wrike OAuth did not return an access token.");
  }

  const refreshedAt = now();
  const expiresIn = Number(tokenPayload.expires_in);
  const accessTokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(refreshedAt.getTime() + expiresIn * 1000).toISOString()
    : undefined;

  return {
    credentials: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: nextRefreshToken,
      access_token: accessToken,
      access_token_expires_at: accessTokenExpiresAt,
      host: responseHost
    },
    refreshed_at: refreshedAt.toISOString()
  };
}

export async function checkWrikeOAuthConnection(
  credentials: WrikeOAuthCredentials,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WrikeConnectionCheckResult> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const refreshed = await refreshWrikeOAuthCredentials(credentials, options);
  const rotatedCredentials = refreshed.credentials;
  const responseHost = rotatedCredentials.host;
  const accessToken = rotatedCredentials.access_token ?? "";

  let identityResponse: Response;
  try {
    identityResponse = await fetchImpl(`https://${responseHost}/api/v4/contacts?me=true`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
  } catch {
    throw new WrikeConnectionError(
      "identity_check_failed",
      "Pathfinder could not reach the Wrike API host.",
      rotatedCredentials
    );
  }

  if (!identityResponse.ok) {
    throw new WrikeConnectionError(
      "identity_check_failed",
      `Wrike rejected the read-only identity check (HTTP ${identityResponse.status}).`,
      rotatedCredentials
    );
  }

  let identityPayload: Record<string, unknown>;
  try {
    identityPayload = await responseJson(identityResponse);
  } catch {
    throw new WrikeConnectionError(
      "invalid_response",
      "Wrike returned an unreadable identity response.",
      rotatedCredentials
    );
  }
  if (!Array.isArray(identityPayload.data) || identityPayload.data.length === 0) {
    throw new WrikeConnectionError(
      "invalid_response",
      "Wrike did not return the authorized user identity.",
      rotatedCredentials
    );
  }

  return {
    credentials: rotatedCredentials,
    health: {
      status: "Connected",
      host: responseHost,
      checked_at: refreshed.refreshed_at,
      identity_confirmed: true
    }
  };
}

function providerIdentifier(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_:.=-]{1,256}$/.test(value.trim())
    ? value.trim()
    : "";
}

function providerIdentifierList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(providerIdentifier).filter(Boolean)))
    : [];
}

function providerCount(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

async function readWrikeApiJson(
  response: Response,
  code: "task_discovery_failed" | "attachment_metadata_failed",
  rotatedCredentials: WrikeOAuthCredentials
) {
  if (!response.ok) {
    throw new WrikeConnectionError(
      code,
      `Wrike rejected the read-only discovery request (HTTP ${response.status}).`,
      rotatedCredentials
    );
  }
  try {
    return await responseJson(response);
  } catch {
    throw new WrikeConnectionError(
      "invalid_response",
      "Wrike returned an unreadable discovery response.",
      rotatedCredentials
    );
  }
}

export async function discoverApprovedWrikeTask(
  credentials: WrikeOAuthCredentials,
  config: WrikeSourceConfig,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WrikeTaskDiscoveryResult> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const folderId = providerIdentifier(config.folder_id);
  const taskId = providerIdentifier(config.approved_discovery_task_id);
  const triggerStatusId = providerIdentifier(config.trigger_status_id);
  if (!folderId || !taskId || !triggerStatusId) {
    throw new WrikeConnectionError(
      "invalid_configuration",
      "Save the Wrike folder, ordered status, and approved discovery task IDs before running discovery."
    );
  }

  const refreshed = await refreshWrikeOAuthCredentials(credentials, options);
  const rotatedCredentials = refreshed.credentials;
  const host = rotatedCredentials.host;
  const accessToken = rotatedCredentials.access_token ?? "";
  const taskUrl = new URL(`https://${host}/api/v4/tasks/${encodeURIComponent(taskId)}`);
  taskUrl.searchParams.set("fields", JSON.stringify(["attachmentCount"]));

  let taskResponse: Response;
  try {
    taskResponse = await fetchImpl(taskUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
  } catch {
    throw new WrikeConnectionError(
      "task_discovery_failed",
      "Pathfinder could not reach the approved Wrike task.",
      rotatedCredentials
    );
  }
  const taskPayload = await readWrikeApiJson(taskResponse, "task_discovery_failed", rotatedCredentials);
  const taskRecords = Array.isArray(taskPayload.data) ? taskPayload.data.map(asRecord) : [];
  const task = taskRecords[0];
  if (taskRecords.length !== 1 || providerIdentifier(task?.id) !== taskId) {
    throw new WrikeConnectionError(
      "invalid_response",
      "Wrike did not return the exact approved task.",
      rotatedCredentials
    );
  }

  const parentIds = providerIdentifierList(task.parentIds);
  const superParentIds = providerIdentifierList(task.superParentIds);
  const customStatusId = providerIdentifier(task.customStatusId) || null;
  const accountId = providerIdentifier(task.accountId) || null;
  const taskAttachmentCount = providerCount(task.attachmentCount);
  const folderMatches = parentIds.includes(folderId) || superParentIds.includes(folderId);
  const statusMatches = customStatusId === triggerStatusId;
  const checks: WrikeDiscoveryCheck[] = [
    { check_id: "task", status: "Passed", message: "Wrike returned the exact approved task ID." },
    {
      check_id: "folder_scope",
      status: folderMatches ? "Passed" : "Blocked",
      message: folderMatches
        ? "The approved task belongs to the configured folder or project."
        : "The approved task is outside the configured folder or project; attachment metadata was not read."
    },
    {
      check_id: "trigger_status",
      status: statusMatches ? "Passed" : "Warning",
      message: statusMatches
        ? "The task uses the configured ordered status ID."
        : "The task does not currently use the configured ordered status ID."
    }
  ];

  let attachmentMetadataCount: number | null = null;
  let workbookCandidateCount: number | null = null;
  if (folderMatches) {
    const attachmentUrl = new URL(`https://${host}/api/v4/tasks/${encodeURIComponent(taskId)}/attachments`);
    attachmentUrl.searchParams.set("versions", "false");
    attachmentUrl.searchParams.set("withUrls", "false");
    let attachmentResponse: Response;
    try {
      attachmentResponse = await fetchImpl(attachmentUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
    } catch {
      throw new WrikeConnectionError(
        "attachment_metadata_failed",
        "Pathfinder could not reach Wrike attachment metadata for the approved task.",
        rotatedCredentials
      );
    }
    const attachmentPayload = await readWrikeApiJson(
      attachmentResponse,
      "attachment_metadata_failed",
      rotatedCredentials
    );
    const attachments = Array.isArray(attachmentPayload.data) ? attachmentPayload.data.map(asRecord) : [];
    const nameNeedle = config.attachment_filename_contains.toLowerCase();
    attachmentMetadataCount = attachments.length;
    workbookCandidateCount = attachments.filter((attachment) => {
      const name = typeof attachment.name === "string" ? attachment.name : "";
      const extension = attachmentExtension(name);
      return (
        config.attachment_extensions.includes(extension as WrikeWorkbookExtension) &&
        (!nameNeedle || name.toLowerCase().includes(nameNeedle))
      );
    }).length;
    checks.push({
      check_id: "attachment_metadata",
      status: taskAttachmentCount !== null && taskAttachmentCount === attachmentMetadataCount ? "Passed" : "Warning",
      message:
        taskAttachmentCount !== null && taskAttachmentCount === attachmentMetadataCount
          ? "Attachment metadata counts are internally consistent."
          : taskAttachmentCount === null
            ? "Wrike did not return the requested task attachment count; rerun before proceeding."
            : "The task and attachment metadata counts differ; rerun before proceeding."
    });
    checks.push({
      check_id: "workbook_candidates",
      status: workbookCandidateCount === 1 ? "Passed" : "Warning",
      message:
        workbookCandidateCount === 1
          ? "Exactly one attachment matches the saved workbook rule."
          : `${workbookCandidateCount} attachments match the saved workbook rule; later selection remains blocked.`
    });
  } else {
    checks.push({
      check_id: "attachment_metadata",
      status: "Blocked",
      message: "Attachment metadata was not requested because the folder scope did not match."
    });
    checks.push({
      check_id: "workbook_candidates",
      status: "Blocked",
      message: "Workbook candidates were not evaluated outside the configured folder scope."
    });
  }

  return {
    credentials: rotatedCredentials,
    preview: {
      status: checks.every((check) => check.status === "Passed") ? "Confirmed" : "Needs review",
      checked_at: refreshed.refreshed_at,
      approved_scope: { task_id: taskId, folder_id: folderId, trigger_status_id: triggerStatusId },
      observed: {
        task_id: taskId,
        account_id: accountId,
        parent_ids: parentIds,
        super_parent_ids: superParentIds,
        custom_status_id: customStatusId,
        task_attachment_count: taskAttachmentCount,
        attachment_metadata_count: attachmentMetadataCount,
        workbook_candidate_count: workbookCandidateCount
      },
      checks,
      capabilities: {
        task_read: true,
        attachment_metadata_read: folderMatches,
        attachment_download: false,
        preview_job_creation: false,
        webhook: false,
        polling: false,
        wrike_writes: false,
        lift_actions: false
      }
    }
  };
}

function attachmentExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function selectWrikeWorkbookAttachment(
  candidates: WrikeAttachmentCandidate[],
  config: WrikeSourceConfig
): WrikeAttachmentSelectionResult {
  const nameNeedle = config.attachment_filename_contains.toLowerCase();
  const matches = candidates
    .filter((candidate) => config.attachment_extensions.includes(attachmentExtension(candidate.file_name) as WrikeWorkbookExtension))
    .filter((candidate) => !nameNeedle || candidate.file_name.toLowerCase().includes(nameNeedle))
    .filter(
      (candidate) =>
        Boolean(candidate.attachment_id && candidate.version_id) && Number.isFinite(Date.parse(candidate.updated_at))
    )
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));

  if (!matches.length) {
    return {
      status: "missing",
      attachment: null,
      matches,
      message: "No Wrike attachment matches the configured workbook rule."
    };
  }

  if (matches.length > 1 && Date.parse(matches[0].updated_at) === Date.parse(matches[1].updated_at)) {
    return {
      status: "ambiguous",
      attachment: null,
      matches,
      message: "Multiple Wrike workbooks share the newest timestamp; operator review is required."
    };
  }

  return {
    status: "matched",
    attachment: matches[0],
    matches,
    message: `Selected ${matches[0].file_name} as the newest matching workbook.`
  };
}
