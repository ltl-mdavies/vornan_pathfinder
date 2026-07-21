export type WrikeTriggerMode = "scheduled_polling" | "webhook_with_reconciliation";
export type WrikeWorkbookExtension = "xlsx" | "xls" | "csv";
export type WrikeAttachmentSelectionPolicy = "newest_matching_workbook";
export type WrikeIdempotencyStrategy = "task_attachment_version";

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
