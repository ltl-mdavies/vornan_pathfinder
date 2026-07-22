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

export class WrikeConnectionError extends Error {
  constructor(
    public readonly code:
      | "invalid_configuration"
      | "oauth_refresh_failed"
      | "identity_check_failed"
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

export function createDefaultWrikeSourceConfig(): WrikeSourceConfig {
  return {
    enabled: false,
    folder_id: "",
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

export async function checkWrikeOAuthConnection(
  credentials: WrikeOAuthCredentials,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WrikeConnectionCheckResult> {
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

  const checkedAt = now();
  const expiresIn = Number(tokenPayload.expires_in);
  const accessTokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(checkedAt.getTime() + expiresIn * 1000).toISOString()
    : undefined;
  const rotatedCredentials: WrikeOAuthCredentials = {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: nextRefreshToken,
    access_token: accessToken,
    access_token_expires_at: accessTokenExpiresAt,
    host: responseHost
  };

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
      checked_at: checkedAt.toISOString(),
      identity_confirmed: true
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
