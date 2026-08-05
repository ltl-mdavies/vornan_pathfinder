export type WrikeTriggerMode = "scheduled_polling" | "webhook_with_reconciliation";
export * from "./lift-source-document-contract.js";
export type WrikeWorkbookExtension = "xlsx" | "xls" | "csv";
export type WrikeReferenceProofExtension = "pdf";
export type WrikeTaskTitleRule = "contract_order_ooh";
export type WrikeWorkbookNameRule = "contract_order_ooh";
export type WrikeAttachmentSelectionPolicy = "all_matching_current_workbooks";
export type WrikeIdempotencyStrategy = "task_attachment_version";
export type WrikeTaskIdentityMode = "exact_title" | "custom_item_type";

export interface WrikeShippingIntakeConfig {
  enabled: boolean;
  task_identity_mode: WrikeTaskIdentityMode;
  task_title: string;
  custom_item_type_id: string;
  trigger_status_id: string;
  trigger_status_label: string;
  attachment_filename_contains: string;
  attachment_extensions: WrikeWorkbookExtension[];
  attachment_selection: WrikeAttachmentSelectionPolicy;
}

export interface WrikeReferenceProofIntakeConfig {
  enabled: boolean;
  filename_contains: string;
  attachment_extensions: WrikeReferenceProofExtension[];
  attachment_selection: "single_current_attachment";
}

export interface WrikeOAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
  access_token_expires_at?: string;
  host: string;
  scope?: "wsReadOnly" | "wsReadWrite";
}

export interface WrikeTaskCommentResult {
  credentials: WrikeOAuthCredentials;
  comment: {
    comment_id: string;
    created_at: string | null;
  };
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

export interface WrikeOAuthAuthorizationResult {
  credentials: WrikeOAuthCredentials;
  authorized_at: string;
}

export class WrikeConnectionError extends Error {
  public readonly rotated_credentials?: WrikeOAuthCredentials;

  constructor(
    public readonly code:
      | "invalid_configuration"
      | "oauth_authorization_failed"
      | "oauth_refresh_failed"
      | "identity_check_failed"
      | "custom_field_discovery_failed"
      | "task_discovery_failed"
      | "attachment_metadata_failed"
      | "attachment_download_failed"
      | "attachment_validation_failed"
      | "comment_write_failed"
      | "invalid_response",
    message: string,
    rotatedCredentials?: WrikeOAuthCredentials
  ) {
    super(message);
    this.name = "WrikeConnectionError";
    // Lambda serializes enumerable custom Error properties when an async
    // invocation escapes the handler. Keep rotated credentials available to
    // the in-process persistence recovery path without ever serializing them
    // into logs or API responses.
    Object.defineProperty(this, "rotated_credentials", {
      value: rotatedCredentials,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
}

export interface WrikeSourceConfig {
  enabled: boolean;
  connection_id: string;
  folder_id: string;
  approved_discovery_task_id: string;
  trigger_mode: WrikeTriggerMode;
  trigger_status_id: string;
  trigger_status_label: string;
  task_title_rule: WrikeTaskTitleRule;
  workbook_name_rule: WrikeWorkbookNameRule;
  contract_number_custom_field_id: string;
  artwork_folder_custom_field_id: string;
  ltl_exception_custom_field_id: string;
  print_vendor_custom_field_id: string;
  order_task_identity_mode: WrikeTaskIdentityMode;
  order_task_title: string;
  order_task_custom_item_type_id: string;
  required_print_vendor_value: string;
  attachment_filename_contains: string;
  attachment_extensions: WrikeWorkbookExtension[];
  attachment_selection: WrikeAttachmentSelectionPolicy;
  poll_interval_minutes: number;
  idempotency_strategy: WrikeIdempotencyStrategy;
  create_preview_only: true;
  reference_proof_intake: WrikeReferenceProofIntakeConfig;
  shipping_intake: WrikeShippingIntakeConfig;
}

export interface WrikeDiscoveryCheck {
  check_id:
    | "task"
    | "folder_scope"
    | "task_identity"
    | "trigger_status"
    | "print_vendor"
    | "contract_number"
    | "artwork_folder"
    | "attachment_metadata"
    | "workbook_candidates";
  status: "Passed" | "Warning" | "Blocked";
  message: string;
}

export interface WrikeCustomFieldDefinition {
  id: string;
  title: string;
  type: string;
}

export interface WrikeCustomFieldDiscoveryResult {
  credentials: WrikeOAuthCredentials;
  checked_at: string;
  requested_titles: string[];
  fields: WrikeCustomFieldDefinition[];
  missing_titles: string[];
  capabilities: {
    account_custom_field_metadata_read: true;
    task_values_read: false;
    attachment_metadata_read: false;
    attachment_download: false;
    persistence: false;
    wrike_writes: false;
    lift_actions: false;
  };
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
    ignored_attachment_count: number | null;
    artwork_folder_status: WrikeArtworkFolderStatus | null;
  };
  checks: WrikeDiscoveryCheck[];
  capabilities: {
    task_read: true;
    artwork_folder_value_read: boolean;
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
  qualification: {
    account_id: string;
    task_id: string;
    task_title: string;
    contract_number: string;
    task_qualified: boolean;
  };
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
  attachments: WrikeAttachmentCandidate[];
  matches: WrikeAttachmentCandidate[];
  message: string;
}

export interface WrikeQualifiedWorkbookSource {
  account_id: string;
  task_id: string;
  attachment_id: string;
  version_id: string;
  file_name: string;
  extension: WrikeWorkbookExtension;
  updated_at: string;
  content_type: string;
  byte_size: number;
  bytes: Uint8Array;
}

export interface WrikeQualifiedWorkbookSourceResult {
  credentials: WrikeOAuthCredentials;
  checked_at: string;
  task_id: string;
  order_context: {
    contract_number: string;
    artwork_folder_url: string | null;
  };
  workbooks: WrikeQualifiedWorkbookSource[];
  reference_proof: WrikeQualifiedReferenceProofSource | null;
}

export interface WrikeQualifiedReferenceProofSource {
  account_id: string;
  task_id: string;
  attachment_id: string;
  version_id: string;
  file_name: string;
  extension: WrikeReferenceProofExtension;
  updated_at: string;
  content_type: "application/pdf";
  byte_size: number;
  bytes: Uint8Array;
}

export interface WrikeReferenceProofSelectionResult {
  status: "matched" | "missing" | "ambiguous";
  attachment: WrikeAttachmentCandidate | null;
  matches: WrikeAttachmentCandidate[];
  message: string;
}

export interface WrikeOrderNameContract {
  contract_number: string;
  order_name: string;
}

export type WrikeArtworkFolderStatus = "not_configured" | "missing" | "ready" | "invalid";
export type WrikeContractNumberStatus = "not_configured" | "missing" | "ready" | "invalid";

export interface WrikeArtworkFolderResolution {
  status: WrikeArtworkFolderStatus;
  url: string | null;
}

export interface WrikeContractNumberResolution {
  status: WrikeContractNumberStatus;
  contract_number: string | null;
}

export interface WrikeContractReadiness {
  status: "Incomplete" | "Configured";
  missing: Array<
    | "connection_id"
    | "folder_id"
    | "trigger_status_id"
    | "contract_number_custom_field_id"
    | "print_vendor_custom_field_id"
    | "attachment_extensions"
  >;
}

export interface WrikeEligibleOrderTask {
  task_id: string;
  account_id: string;
  parent_ids: string[];
  super_parent_ids: string[];
  contract_number: string;
  attachment_count: number | null;
  artwork_folder_status: WrikeArtworkFolderStatus;
}

export interface WrikeShippingAttachmentMetadata {
  attachment_id: string;
  version_id: string;
  extension: WrikeWorkbookExtension;
  updated_at: string | null;
}

export interface WrikeEligibleShippingTask {
  task_id: string;
  account_id: string;
  parent_ids: string[];
  super_parent_ids: string[];
  custom_status_id: string;
  attachment_count: number | null;
  matching_attachment_count: number;
  attachments: WrikeShippingAttachmentMetadata[];
}

export interface WrikeScopedIntakeDiscoveryResult {
  credentials: WrikeOAuthCredentials;
  checked_at: string;
  folder_id: string;
  order_candidates: WrikeEligibleOrderTask[];
  shipping: {
    status: "Inactive" | "Discovered";
    candidates: WrikeEligibleShippingTask[];
  };
  summary: {
    task_count: number;
    scoped_task_count: number;
    order_identity_match_count: number;
    order_status_match_count: number;
    order_status_and_identity_match_count: number;
    order_vendor_match_count: number;
    order_contract_ready_count: number;
    eligible_order_count: number;
    eligible_shipping_task_count: number;
    order_status_id_count: number;
    shipping_status_id_count: number;
  };
  capabilities: {
    folder_task_metadata_read: true;
    workflow_status_metadata_read: boolean;
    shipping_attachment_metadata_read: boolean;
    attachment_download: false;
    workbook_parse: false;
    evidence_persistence: false;
    preview_job_creation: false;
    wrike_writes: false;
    lift_actions: false;
  };
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
    connection_id: "",
    folder_id: "",
    approved_discovery_task_id: "",
    trigger_mode: "scheduled_polling",
    trigger_status_id: "",
    trigger_status_label: "Sent to Print - LTL",
    task_title_rule: "contract_order_ooh",
    workbook_name_rule: "contract_order_ooh",
    contract_number_custom_field_id: "",
    artwork_folder_custom_field_id: "",
    ltl_exception_custom_field_id: "",
    print_vendor_custom_field_id: "",
    order_task_identity_mode: "exact_title",
    order_task_title: "Placard Order",
    order_task_custom_item_type_id: "",
    required_print_vendor_value: "Larger Than Life",
    attachment_filename_contains: "",
    attachment_extensions: ["xlsx"],
    attachment_selection: "all_matching_current_workbooks",
    poll_interval_minutes: 15,
    idempotency_strategy: "task_attachment_version",
    create_preview_only: true,
    reference_proof_intake: {
      enabled: false,
      filename_contains: "proof",
      attachment_extensions: ["pdf"],
      attachment_selection: "single_current_attachment"
    },
    shipping_intake: {
      enabled: false,
      task_identity_mode: "exact_title",
      task_title: "Shipping Information",
      custom_item_type_id: "",
      trigger_status_id: "",
      trigger_status_label: "Have Address - LTL",
      attachment_filename_contains: "",
      attachment_extensions: ["xlsx"],
      attachment_selection: "all_matching_current_workbooks"
    }
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

export function parseWrikeOrderNameContract(value: unknown): WrikeOrderNameContract | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (/[\r\n]/.test(normalized)) {
    return null;
  }
  const match = normalized.match(/^C(\d{6})\s+-\s+(.{1,160}?)\s+-\s+OOH Order$/i);
  const orderName = match?.[2]?.trim() ?? "";
  if (!match || !orderName) {
    return null;
  }
  return {
    contract_number: `C${match[1]}`,
    order_name: orderName
  };
}

export function resolveWrikeArtworkFolderUrl(
  task: unknown,
  customFieldId: unknown
): WrikeArtworkFolderResolution {
  const fieldId = cleanIdentifier(customFieldId);
  if (!fieldId) {
    return { status: "not_configured", url: null };
  }

  const customFields = Array.isArray(asRecord(task).customFields)
    ? (asRecord(task).customFields as unknown[])
    : [];
  const field = customFields
    .map(asRecord)
    .find((candidate) => cleanIdentifier(candidate.id) === fieldId);
  const rawValue = typeof field?.value === "string" ? field.value.trim() : "";
  if (!rawValue) {
    return { status: "missing", url: null };
  }
  if (rawValue.length > 2048 || /[\u0000-\u001f\u007f]/.test(rawValue)) {
    return { status: "invalid", url: null };
  }

  try {
    const url = new URL(rawValue);
    if (url.protocol !== "https:" || url.username || url.password) {
      return { status: "invalid", url: null };
    }
    return { status: "ready", url: url.toString() };
  } catch {
    return { status: "invalid", url: null };
  }
}

export function resolveWrikeContractNumber(
  task: unknown,
  customFieldId: unknown
): WrikeContractNumberResolution {
  const fieldId = cleanIdentifier(customFieldId);
  if (!fieldId) {
    return { status: "not_configured", contract_number: null };
  }

  const customFields = Array.isArray(asRecord(task).customFields)
    ? (asRecord(task).customFields as unknown[])
    : [];
  const field = customFields
    .map(asRecord)
    .find((candidate) => cleanIdentifier(candidate.id) === fieldId);
  const rawValue = typeof field?.value === "string" ? field.value.trim() : "";
  if (!rawValue) {
    return { status: "missing", contract_number: null };
  }

  const normalized = rawValue.toUpperCase();
  if (!/^C\d{6,10}$/.test(normalized)) {
    return { status: "invalid", contract_number: null };
  }
  return { status: "ready", contract_number: normalized };
}

function normalizedComparableText(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : "";
}

function resolveWrikeTextCustomField(task: unknown, customFieldId: unknown) {
  const fieldId = cleanIdentifier(customFieldId);
  if (!fieldId) {
    return null;
  }
  const customFields = Array.isArray(asRecord(task).customFields)
    ? (asRecord(task).customFields as unknown[])
    : [];
  const field = customFields
    .map(asRecord)
    .find((candidate) => cleanIdentifier(candidate.id) === fieldId);
  const value = typeof field?.value === "string" ? field.value.trim().replace(/\s+/g, " ") : "";
  return value && value.length <= 256 ? value : null;
}

function taskIdentityMatches(
  task: Record<string, unknown>,
  mode: WrikeTaskIdentityMode,
  title: string,
  customItemTypeId: string
) {
  if (mode === "custom_item_type") {
    return Boolean(customItemTypeId) && providerIdentifier(task.customItemTypeId) === customItemTypeId;
  }
  return Boolean(title) && normalizedComparableText(task.title) === normalizedComparableText(title);
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
  const shippingSource = asRecord(source.shipping_intake);
  const referenceProofSource = asRecord(source.reference_proof_intake);
  const shippingExtensions = Array.from(
    new Set(
      (Array.isArray(shippingSource.attachment_extensions)
        ? shippingSource.attachment_extensions
        : fallback.shipping_intake.attachment_extensions)
        .map((extension) => String(extension).trim().toLowerCase().replace(/^\./, ""))
        .filter((extension): extension is WrikeWorkbookExtension =>
          extension === "xlsx" || extension === "xls" || extension === "csv"
        )
    )
  );

  return {
    enabled: false,
    connection_id: cleanIdentifier(source.connection_id),
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
    task_title_rule: "contract_order_ooh",
    workbook_name_rule: "contract_order_ooh",
    contract_number_custom_field_id: cleanIdentifier(source.contract_number_custom_field_id),
    artwork_folder_custom_field_id: cleanIdentifier(source.artwork_folder_custom_field_id),
    ltl_exception_custom_field_id: cleanIdentifier(source.ltl_exception_custom_field_id),
    print_vendor_custom_field_id: cleanIdentifier(source.print_vendor_custom_field_id),
    order_task_identity_mode:
      source.order_task_identity_mode === "custom_item_type"
        ? "custom_item_type"
        : "exact_title",
    order_task_title:
      typeof source.order_task_title === "string"
        ? source.order_task_title.trim().replace(/\s+/g, " ").slice(0, 160)
        : fallback.order_task_title,
    order_task_custom_item_type_id: cleanIdentifier(source.order_task_custom_item_type_id),
    required_print_vendor_value:
      typeof source.required_print_vendor_value === "string"
        ? source.required_print_vendor_value.trim().replace(/\s+/g, " ").slice(0, 160)
        : fallback.required_print_vendor_value,
    attachment_filename_contains:
      typeof source.attachment_filename_contains === "string"
        ? source.attachment_filename_contains.trim().slice(0, 160)
        : "",
    attachment_extensions: extensions.length ? extensions : fallback.attachment_extensions,
    attachment_selection: "all_matching_current_workbooks",
    poll_interval_minutes: normalizedInterval,
    idempotency_strategy: "task_attachment_version",
    create_preview_only: true,
    reference_proof_intake: {
      // Reference-proof collection is an independently reviewed capability.
      // Persist its matching rules now, but keep it default-inactive.
      enabled: source.reference_proof_intake !== undefined && referenceProofSource.enabled === true,
      filename_contains:
        typeof referenceProofSource.filename_contains === "string"
          ? referenceProofSource.filename_contains.trim().slice(0, 160)
          : fallback.reference_proof_intake.filename_contains,
      attachment_extensions: ["pdf"],
      attachment_selection: "single_current_attachment"
    },
    shipping_intake: {
      // Shipping activation remains a separately reviewed runtime capability.
      // Persist the configuration now, but fail closed if a client attempts to
      // enable it before that boundary exists.
      enabled: false,
      task_identity_mode:
        shippingSource.task_identity_mode === "custom_item_type"
          ? "custom_item_type"
          : "exact_title",
      task_title:
        typeof shippingSource.task_title === "string"
          ? shippingSource.task_title.trim().replace(/\s+/g, " ").slice(0, 160)
          : fallback.shipping_intake.task_title,
      custom_item_type_id: cleanIdentifier(shippingSource.custom_item_type_id),
      trigger_status_id: cleanIdentifier(shippingSource.trigger_status_id),
      trigger_status_label:
        typeof shippingSource.trigger_status_label === "string"
          ? shippingSource.trigger_status_label.trim().replace(/\s+/g, " ").slice(0, 100)
          : fallback.shipping_intake.trigger_status_label,
      attachment_filename_contains:
        typeof shippingSource.attachment_filename_contains === "string"
          ? shippingSource.attachment_filename_contains.trim().slice(0, 160)
          : "",
      attachment_extensions: shippingExtensions.length
        ? shippingExtensions
        : fallback.shipping_intake.attachment_extensions,
      attachment_selection: "all_matching_current_workbooks"
    }
  };
}

export function getWrikeContractReadiness(config: WrikeSourceConfig): WrikeContractReadiness {
  const missing: WrikeContractReadiness["missing"] = [];
  if (!config.connection_id) {
    missing.push("connection_id");
  }
  if (!config.folder_id) {
    missing.push("folder_id");
  }
  if (!config.trigger_status_id) {
    missing.push("trigger_status_id");
  }
  if (!config.contract_number_custom_field_id) {
    missing.push("contract_number_custom_field_id");
  }
  if (!config.print_vendor_custom_field_id) {
    missing.push("print_vendor_custom_field_id");
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
        ? "Folder, intake-ready status, Contract Number field, and workbook rules are configured."
        : "Configure the folder/project, intake-ready status ID, Contract Number field, and workbook rule."
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

export function buildWrikeAuthorizationUrl(args: {
  client_id: string;
  redirect_uri: string;
  state: string;
}) {
  const clientId = requiredCredential(args.client_id, "Wrike OAuth client ID");
  const redirectUri = requiredCredential(args.redirect_uri, "Wrike OAuth redirect URI");
  const state = requiredCredential(args.state, "Wrike OAuth state");
  const authorizationUrl = new URL("https://login.wrike.com/oauth2/authorize");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("scope", "wsReadWrite");
  authorizationUrl.searchParams.set("state", state);
  return authorizationUrl.toString();
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

export async function exchangeWrikeAuthorizationCode(
  args: {
    client_id: string;
    client_secret: string;
    code: string;
    redirect_uri: string;
  },
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WrikeOAuthAuthorizationResult> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const now = options.now ?? (() => new Date());
  const clientId = requiredCredential(args.client_id, "Wrike OAuth client ID");
  const clientSecret = requiredCredential(args.client_secret, "Wrike OAuth client secret");
  const code = requiredCredential(args.code, "Wrike OAuth authorization code");
  const redirectUri = requiredCredential(args.redirect_uri, "Wrike OAuth redirect URI");
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetchImpl("https://login.wrike.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody
    });
  } catch {
    throw new WrikeConnectionError(
      "oauth_authorization_failed",
      "Pathfinder could not reach the Wrike OAuth service."
    );
  }

  if (!tokenResponse.ok) {
    throw new WrikeConnectionError(
      "oauth_authorization_failed",
      `Wrike OAuth authorization was rejected (HTTP ${tokenResponse.status}).`
    );
  }

  const tokenPayload = await responseJson(tokenResponse);
  const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token.trim() : "";
  const refreshToken = typeof tokenPayload.refresh_token === "string" ? tokenPayload.refresh_token.trim() : "";
  const host = normalizeWrikeHost(tokenPayload.host);
  if (!accessToken || !refreshToken) {
    throw new WrikeConnectionError(
      "invalid_response",
      "Wrike OAuth did not return the required access and refresh tokens."
    );
  }

  const authorizedAt = now();
  const expiresIn = Number(tokenPayload.expires_in);
  const accessTokenExpiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(authorizedAt.getTime() + expiresIn * 1000).toISOString()
    : undefined;

  return {
    credentials: {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      access_token: accessToken,
      access_token_expires_at: accessTokenExpiresAt,
      host,
      scope: "wsReadWrite"
    },
    authorized_at: authorizedAt.toISOString()
  };
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
    scope: credentials.scope ?? "wsReadOnly"
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
      host: responseHost,
      scope: credentials.scope ?? "wsReadOnly"
    },
    refreshed_at: refreshedAt.toISOString()
  };
}

function normalizedWrikeTaskId(value: string) {
  const taskId = value.trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(taskId)) {
    throw new WrikeConnectionError("invalid_configuration", "The Wrike task identifier is invalid.");
  }
  return taskId;
}

export async function postWrikeTaskComment(
  credentials: WrikeOAuthCredentials,
  args: { task_id: string; text: string },
  options: { fetch_impl?: typeof fetch; now?: () => Date } = {}
): Promise<WrikeTaskCommentResult> {
  if (credentials.scope !== "wsReadWrite") {
    throw new WrikeConnectionError(
      "invalid_configuration",
      "Reconnect Wrike with read/write authorization before posting a status comment."
    );
  }
  const taskId = normalizedWrikeTaskId(args.task_id);
  const text = args.text.replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > 4000) {
    throw new WrikeConnectionError("invalid_configuration", "The Wrike comment must contain 1 to 4,000 characters.");
  }

  const fetchImpl = options.fetch_impl ?? fetch;
  const refreshed = await refreshWrikeOAuthCredentials(credentials, options);
  const rotatedCredentials = refreshed.credentials;
  const body = new URLSearchParams({ text, plainText: "true" });
  let response: Response;
  try {
    response = await fetchImpl(`https://${rotatedCredentials.host}/api/v4/tasks/${taskId}/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rotatedCredentials.access_token ?? ""}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new WrikeConnectionError(
      "comment_write_failed",
      "Wrike did not provide a definitive response to the comment request. Do not retry automatically.",
      rotatedCredentials
    );
  }
  if (!response.ok) {
    throw new WrikeConnectionError(
      "comment_write_failed",
      `Wrike rejected the comment request (HTTP ${response.status}).`,
      rotatedCredentials
    );
  }
  const payload = await responseJson(response);
  const data = Array.isArray(payload.data) ? payload.data[0] : undefined;
  const commentId = data && typeof data === "object" && typeof data.id === "string" ? data.id.trim() : "";
  const createdAt = data && typeof data === "object" && typeof data.createdDate === "string"
    ? data.createdDate.trim()
    : null;
  if (!commentId) {
    throw new WrikeConnectionError(
      "invalid_response",
      "Wrike accepted the request but did not return a comment identifier.",
      rotatedCredentials
    );
  }
  return {
    credentials: rotatedCredentials,
    comment: { comment_id: commentId, created_at: createdAt || options.now?.().toISOString() || null }
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
  code: "custom_field_discovery_failed" | "task_discovery_failed" | "attachment_metadata_failed",
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

async function discoverWrikeStatusIdsByLabel(args: {
  host: string;
  access_token: string;
  labels: string[];
  fetch_impl: typeof fetch;
}) {
  const requestedLabels = new Set(
    args.labels.map(normalizedComparableText).filter(Boolean)
  );
  const statusIdsByLabel = new Map<string, Set<string>>();
  if (requestedLabels.size === 0) {
    return { read: false, status_ids_by_label: statusIdsByLabel };
  }

  let response: Response;
  try {
    response = await args.fetch_impl(`https://${args.host}/api/v4/workflows`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${args.access_token}`,
        Accept: "application/json"
      }
    });
  } catch {
    return { read: false, status_ids_by_label: statusIdsByLabel };
  }
  if (!response.ok) {
    return { read: false, status_ids_by_label: statusIdsByLabel };
  }

  let payload: Record<string, unknown>;
  try {
    payload = await responseJson(response);
  } catch {
    return { read: false, status_ids_by_label: statusIdsByLabel };
  }
  for (const workflow of Array.isArray(payload.data) ? payload.data.map(asRecord) : []) {
    const statuses = Array.isArray(workflow.customStatuses)
      ? workflow.customStatuses.map(asRecord)
      : [];
    for (const status of statuses) {
      const label = normalizedComparableText(status.name ?? status.title);
      const statusId = providerIdentifier(status.id);
      if (!requestedLabels.has(label) || !statusId) {
        continue;
      }
      const matches = statusIdsByLabel.get(label) ?? new Set<string>();
      matches.add(statusId);
      statusIdsByLabel.set(label, matches);
    }
  }
  return { read: true, status_ids_by_label: statusIdsByLabel };
}

async function resolveWrikeFolderId(
  folderId: string,
  host: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  rotatedCredentials: WrikeOAuthCredentials
) {
  if (!/^\d{1,32}$/.test(folderId)) {
    return folderId;
  }

  const converterUrl = new URL(`https://${host}/api/v4/ids`);
  converterUrl.searchParams.set("type", "ApiV2Folder");
  converterUrl.searchParams.set("ids", JSON.stringify([folderId]));

  let response: Response;
  try {
    response = await fetchImpl(converterUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
  } catch {
    throw new WrikeConnectionError(
      "task_discovery_failed",
      "Pathfinder could not resolve the configured Wrike campaign folder.",
      rotatedCredentials
    );
  }

  const payload = await readWrikeApiJson(
    response,
    "task_discovery_failed",
    rotatedCredentials
  );
  const matches = (Array.isArray(payload.data) ? payload.data : [])
    .map(asRecord)
    .filter((record) => String(record.apiV2Id ?? "") === folderId)
    .map((record) => providerIdentifier(record.id))
    .filter(Boolean);
  if (matches.length !== 1) {
    throw new WrikeConnectionError(
      "invalid_response",
      "Wrike did not return one exact API folder ID for the configured campaign folder.",
      rotatedCredentials
    );
  }
  return matches[0];
}

async function taskBelongsToWrikeFolderScope(
  task: Record<string, unknown>,
  folderId: string,
  host: string,
  accessToken: string,
  fetchImpl: typeof fetch,
  rotatedCredentials: WrikeOAuthCredentials
) {
  const parentIds = providerIdentifierList(task.parentIds);
  const superParentIds = providerIdentifierList(task.superParentIds);
  if (parentIds.includes(folderId) || superParentIds.includes(folderId)) {
    return true;
  }

  const pending = [...parentIds, ...superParentIds];
  const visited = new Set<string>();
  const maxFolderReads = 32;

  while (pending.length > 0) {
    const currentFolderId = pending.shift();
    if (!currentFolderId || visited.has(currentFolderId)) {
      continue;
    }
    if (currentFolderId === folderId) {
      return true;
    }
    if (visited.size >= maxFolderReads) {
      throw new WrikeConnectionError(
        "invalid_response",
        "The approved Wrike task ancestry exceeded the bounded folder limit.",
        rotatedCredentials
      );
    }
    visited.add(currentFolderId);

    const folderUrl = new URL(
      `https://${host}/api/v4/folders/${encodeURIComponent(currentFolderId)}`
    );
    let response: Response;
    try {
      response = await fetchImpl(folderUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
    } catch {
      throw new WrikeConnectionError(
        "task_discovery_failed",
        "Pathfinder could not verify the approved Wrike task folder ancestry.",
        rotatedCredentials
      );
    }

    const payload = await readWrikeApiJson(
      response,
      "task_discovery_failed",
      rotatedCredentials
    );
    const records = Array.isArray(payload.data) ? payload.data.map(asRecord) : [];
    const folder = records[0];
    if (records.length !== 1 || providerIdentifier(folder?.id) !== currentFolderId) {
      throw new WrikeConnectionError(
        "invalid_response",
        "Wrike did not return the exact approved task parent folder.",
        rotatedCredentials
      );
    }
    const ancestors = [
      ...providerIdentifierList(folder.parentIds),
      ...providerIdentifierList(folder.superParentIds)
    ];
    if (ancestors.includes(folderId)) {
      return true;
    }
    pending.push(...ancestors);
  }

  return false;
}

function normalizeWrikeFieldTitle(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : "";
}

export async function discoverWrikeCustomFields(
  credentials: WrikeOAuthCredentials,
  requestedTitles: string[],
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WrikeCustomFieldDiscoveryResult> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const now = options.now ?? (() => new Date());
  const requested = Array.from(
    new Set(
      requestedTitles
        .map((title) => (typeof title === "string" ? title.trim().replace(/\s+/g, " ") : ""))
        .filter((title) => title.length > 0 && title.length <= 128)
    )
  ).slice(0, 20);
  if (!requested.length || requested.length !== requestedTitles.length) {
    throw new WrikeConnectionError(
      "invalid_configuration",
      "Provide one to twenty unique Wrike custom-field titles."
    );
  }

  const refreshed = await refreshWrikeOAuthCredentials(credentials, options);
  const rotatedCredentials = refreshed.credentials;
  const host = rotatedCredentials.host;
  const accessToken = rotatedCredentials.access_token ?? "";
  const customFieldsUrl = new URL(`https://${host}/api/v4/customfields`);

  let response: Response;
  try {
    response = await fetchImpl(customFieldsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
  } catch {
    throw new WrikeConnectionError(
      "custom_field_discovery_failed",
      "Pathfinder could not reach Wrike custom-field metadata.",
      rotatedCredentials
    );
  }

  const payload = await readWrikeApiJson(
    response,
    "custom_field_discovery_failed",
    rotatedCredentials
  );
  const requestedByTitle = new Map(
    requested.map((title) => [normalizeWrikeFieldTitle(title), title] as const)
  );
  const fields = (Array.isArray(payload.data) ? payload.data : [])
    .map(asRecord)
    .map((field): WrikeCustomFieldDefinition | null => {
      const id = providerIdentifier(field.id);
      const title = typeof field.title === "string" ? field.title.trim().replace(/\s+/g, " ") : "";
      const type = typeof field.type === "string" ? field.type.trim().slice(0, 64) : "";
      if (!id || !title || !type || !requestedByTitle.has(normalizeWrikeFieldTitle(title))) {
        return null;
      }
      return { id, title, type };
    })
    .filter((field): field is WrikeCustomFieldDefinition => field !== null)
    .sort((first, second) =>
      first.title.localeCompare(second.title) || first.id.localeCompare(second.id)
    );
  const matchedTitles = new Set(fields.map((field) => normalizeWrikeFieldTitle(field.title)));

  return {
    credentials: rotatedCredentials,
    checked_at: now().toISOString(),
    requested_titles: requested,
    fields,
    missing_titles: requested.filter((title) => !matchedTitles.has(normalizeWrikeFieldTitle(title))),
    capabilities: {
      account_custom_field_metadata_read: true,
      task_values_read: false,
      attachment_metadata_read: false,
      attachment_download: false,
      persistence: false,
      wrike_writes: false,
      lift_actions: false
    }
  };
}

function scopedTaskRecord(task: Record<string, unknown>, folderId: string) {
  const taskId = providerIdentifier(task.id);
  const parentIds = providerIdentifierList(task.parentIds);
  const superParentIds = providerIdentifierList(task.superParentIds);
  if (!taskId || (!parentIds.includes(folderId) && !superParentIds.includes(folderId))) {
    return null;
  }
  return {
    task_id: taskId,
    account_id: providerIdentifier(task.accountId),
    parent_ids: parentIds,
    super_parent_ids: superParentIds,
    custom_status_id: providerIdentifier(task.customStatusId),
    attachment_count: providerCount(task.attachmentCount)
  };
}

function safeAttachmentUpdatedAt(attachment: Record<string, unknown>) {
  const value =
    typeof attachment.updatedDate === "string"
      ? attachment.updatedDate
      : typeof attachment.createdDate === "string"
        ? attachment.createdDate
        : "";
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function effectiveAttachmentVersionId(attachment: Record<string, unknown>) {
  const attachmentId = providerIdentifier(attachment.id);
  const providerVersionId = providerIdentifier(
    attachment.currentAttachmentId ?? attachment.versionId
  );
  if (!attachmentId) {
    return "";
  }
  if (providerVersionId && providerVersionId !== attachmentId) {
    return providerVersionId;
  }
  const updatedAt = safeAttachmentUpdatedAt(attachment);
  return updatedAt ? `${attachmentId}:${updatedAt}` : "";
}

function shippingAttachmentMetadata(
  attachment: Record<string, unknown>,
  config: WrikeShippingIntakeConfig
): WrikeShippingAttachmentMetadata | null {
  const fileName = typeof attachment.name === "string" ? attachment.name.trim() : "";
  const extension = attachmentExtension(fileName);
  const nameNeedle = config.attachment_filename_contains.toLocaleLowerCase("en-US");
  if (
    !config.attachment_extensions.includes(extension as WrikeWorkbookExtension) ||
    (nameNeedle && !fileName.toLocaleLowerCase("en-US").includes(nameNeedle))
  ) {
    return null;
  }
  const attachmentId = providerIdentifier(attachment.id);
  const versionId = effectiveAttachmentVersionId(attachment);
  if (!attachmentId || !versionId) {
    return null;
  }
  return {
    attachment_id: attachmentId,
    version_id: versionId,
    extension: extension as WrikeWorkbookExtension,
    updated_at: safeAttachmentUpdatedAt(attachment)
  };
}

/**
 * Performs a bounded, metadata-only discovery across the configured Wrike
 * folder/project boundary. It does not download attachments, parse a workbook,
 * persist evidence, create a job, write to Wrike, or call Lift.
 */
export async function discoverScopedWrikeIntakeTasks(
  credentials: WrikeOAuthCredentials,
  config: WrikeSourceConfig,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
    max_pages?: number;
    max_tasks?: number;
    max_shipping_tasks?: number;
  } = {}
): Promise<WrikeScopedIntakeDiscoveryResult> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const now = options.now ?? (() => new Date());
  const configuredFolderId = providerIdentifier(config.folder_id);
  const triggerStatusId = providerIdentifier(config.trigger_status_id);
  const vendorFieldId = providerIdentifier(config.print_vendor_custom_field_id);
  const orderTaskTitle = config.order_task_title.trim();
  const orderTaskTypeId = providerIdentifier(config.order_task_custom_item_type_id);
  const vendorValue = config.required_print_vendor_value.trim();
  if (
    !configuredFolderId ||
    !triggerStatusId ||
    !vendorFieldId ||
    !vendorValue ||
    (config.order_task_identity_mode === "custom_item_type"
      ? !orderTaskTypeId
      : !orderTaskTitle)
  ) {
    throw new WrikeConnectionError(
      "invalid_configuration",
      "Save the Wrike folder, exact order-task identity, intake-ready status, Print Vendor field, and required vendor value before discovery."
    );
  }
  if (
    config.shipping_intake.enabled &&
    (!providerIdentifier(config.shipping_intake.trigger_status_id) ||
      (config.shipping_intake.task_identity_mode === "custom_item_type"
        ? !providerIdentifier(config.shipping_intake.custom_item_type_id)
        : !config.shipping_intake.task_title.trim()))
  ) {
    throw new WrikeConnectionError(
      "invalid_configuration",
      "Active shipping intake requires an exact task identity and shipping-ready status ID."
    );
  }

  const refreshed = await refreshWrikeOAuthCredentials(credentials, options);
  const rotatedCredentials = refreshed.credentials;
  const host = rotatedCredentials.host;
  const accessToken = rotatedCredentials.access_token ?? "";
  const folderId = await resolveWrikeFolderId(
    configuredFolderId,
    host,
    accessToken,
    fetchImpl,
    rotatedCredentials
  );
  const maxPages = Math.max(1, Math.min(options.max_pages ?? 10, 10));
  const maxTasks = Math.max(1, Math.min(options.max_tasks ?? 10_000, 10_000));
  const taskRecords: Record<string, unknown>[] = [];
  let nextPageToken = "";

  for (let page = 0; page < maxPages; page += 1) {
    const taskUrl = new URL(
      `https://${host}/api/v4/folders/${encodeURIComponent(folderId)}/tasks`
    );
    taskUrl.searchParams.set("descendants", "true");
    taskUrl.searchParams.set(
      "fields",
      JSON.stringify([
        "attachmentCount",
        "customFields",
        "customItemTypeId",
        "parentIds",
        "superParentIds"
      ])
    );
    // Scan the configured campaign boundary without relying on Wrike's
    // provider-side status filter. Accounts can contain distinct workflow
    // status IDs with the same visible label, so eligibility remains an exact
    // client-side contract over the returned task metadata.
    taskUrl.searchParams.set("pageSize", "1000");
    if (nextPageToken) {
      taskUrl.searchParams.set("nextPageToken", nextPageToken);
    }
    let response: Response;
    try {
      response = await fetchImpl(taskUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
    } catch {
      throw new WrikeConnectionError(
        "task_discovery_failed",
        "Pathfinder could not reach the configured Wrike campaign scope.",
        rotatedCredentials
      );
    }
    const payload = await readWrikeApiJson(response, "task_discovery_failed", rotatedCredentials);
    taskRecords.push(
      ...(Array.isArray(payload.data) ? payload.data : []).map(asRecord)
    );
    if (taskRecords.length > maxTasks) {
      throw new WrikeConnectionError(
        "invalid_response",
        "The configured Wrike campaign scope exceeds the bounded discovery limit.",
        rotatedCredentials
      );
    }
    nextPageToken =
      typeof payload.nextPageToken === "string"
        ? payload.nextPageToken.trim().slice(0, 2048)
        : "";
    if (!nextPageToken) {
      break;
    }
    if (page === maxPages - 1) {
      throw new WrikeConnectionError(
        "invalid_response",
        "Wrike discovery exceeded the bounded page limit.",
        rotatedCredentials
      );
    }
  }

  const workflowStatuses = await discoverWrikeStatusIdsByLabel({
    host,
    access_token: accessToken,
    labels: [
      config.trigger_status_label,
      ...(config.shipping_intake.enabled
        ? [config.shipping_intake.trigger_status_label]
        : [])
    ],
    fetch_impl: fetchImpl
  });
  const orderStatusIds = new Set([
    triggerStatusId,
    ...(workflowStatuses.status_ids_by_label.get(
      normalizedComparableText(config.trigger_status_label)
    ) ?? [])
  ]);
  const configuredShippingStatusId = providerIdentifier(
    config.shipping_intake.trigger_status_id
  );
  const shippingStatusIds = new Set([
    ...(configuredShippingStatusId ? [configuredShippingStatusId] : []),
    ...(workflowStatuses.status_ids_by_label.get(
      normalizedComparableText(config.shipping_intake.trigger_status_label)
    ) ?? [])
  ]);

  const scopedOrderTasks = taskRecords
    .map((task) => ({ task, scoped: scopedTaskRecord(task, folderId) }))
    .filter(
      (
        candidate
      ): candidate is {
        task: Record<string, unknown>;
        scoped: NonNullable<ReturnType<typeof scopedTaskRecord>>;
      } => candidate.scoped !== null
    );
  const orderIdentityMatchCount = scopedOrderTasks.filter(({ task }) =>
    taskIdentityMatches(
      task,
      config.order_task_identity_mode,
      orderTaskTitle,
      orderTaskTypeId
    )
  ).length;
  const orderStatusMatchCount = scopedOrderTasks.filter(({ scoped }) =>
    orderStatusIds.has(scoped.custom_status_id)
  ).length;
  const orderStatusAndIdentityTasks = scopedOrderTasks.filter(
    ({ task, scoped }) =>
      orderStatusIds.has(scoped.custom_status_id) &&
      taskIdentityMatches(
        task,
        config.order_task_identity_mode,
        orderTaskTitle,
        orderTaskTypeId
      )
  );
  const orderVendorMatchTasks = orderStatusAndIdentityTasks.filter(
    ({ task }) =>
      normalizedComparableText(resolveWrikeTextCustomField(task, vendorFieldId)) ===
      normalizedComparableText(vendorValue)
  );
  const orderContractReadyCount = orderVendorMatchTasks.filter(
    ({ task }) =>
      resolveWrikeContractNumber(task, config.contract_number_custom_field_id).status ===
      "ready"
  ).length;

  const orderCandidates = taskRecords
    .map((task): WrikeEligibleOrderTask | null => {
      const scoped = scopedTaskRecord(task, folderId);
      if (
        !scoped ||
        !orderStatusIds.has(scoped.custom_status_id) ||
        !taskIdentityMatches(
          task,
          config.order_task_identity_mode,
          orderTaskTitle,
          orderTaskTypeId
        )
      ) {
        return null;
      }
      const vendor = resolveWrikeTextCustomField(task, vendorFieldId);
      const contract = resolveWrikeContractNumber(task, config.contract_number_custom_field_id);
      if (
        normalizedComparableText(vendor) !== normalizedComparableText(vendorValue) ||
        contract.status !== "ready"
      ) {
        return null;
      }
      const artwork = resolveWrikeArtworkFolderUrl(task, config.artwork_folder_custom_field_id);
      return {
        ...scoped,
        contract_number: contract.contract_number ?? "",
        artwork_folder_status: artwork.status
      };
    })
    .filter((task): task is WrikeEligibleOrderTask => task !== null)
    .sort((left, right) => left.task_id.localeCompare(right.task_id));

  const shippingCandidates: WrikeEligibleShippingTask[] = [];
  if (config.shipping_intake.enabled) {
    const shippingTypeId = providerIdentifier(config.shipping_intake.custom_item_type_id);
    const shippingTasks = taskRecords
      .map((task) => ({ task, scoped: scopedTaskRecord(task, folderId) }))
      .filter(({ task, scoped }) =>
        Boolean(
          scoped &&
            shippingStatusIds.has(scoped.custom_status_id) &&
            taskIdentityMatches(
              task,
              config.shipping_intake.task_identity_mode,
              config.shipping_intake.task_title,
              shippingTypeId
            )
        )
      );
    const maxShippingTasks = Math.max(
      1,
      Math.min(options.max_shipping_tasks ?? 25, 25)
    );
    if (shippingTasks.length > maxShippingTasks) {
      throw new WrikeConnectionError(
        "invalid_response",
        "The configured Wrike scope has more shipping-ready tasks than the bounded metadata review allows.",
        rotatedCredentials
      );
    }
    for (const { scoped } of shippingTasks) {
      if (!scoped) {
        continue;
      }
      const attachmentUrl = new URL(
        `https://${host}/api/v4/tasks/${encodeURIComponent(scoped.task_id)}/attachments`
      );
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
          "Pathfinder could not reach shipping attachment metadata.",
          rotatedCredentials
        );
      }
      const payload = await readWrikeApiJson(
        attachmentResponse,
        "attachment_metadata_failed",
        rotatedCredentials
      );
      const attachments = (Array.isArray(payload.data) ? payload.data : [])
        .map(asRecord)
        .map((attachment) =>
          shippingAttachmentMetadata(attachment, config.shipping_intake)
        )
        .filter(
          (attachment): attachment is WrikeShippingAttachmentMetadata =>
            attachment !== null
        )
        .sort(
          (left, right) =>
            left.attachment_id.localeCompare(right.attachment_id) ||
            left.version_id.localeCompare(right.version_id)
        );
      shippingCandidates.push({
        ...scoped,
        matching_attachment_count: attachments.length,
        attachments
      });
    }
  }

  return {
    credentials: rotatedCredentials,
    checked_at: now().toISOString(),
    folder_id: folderId,
    order_candidates: orderCandidates,
    shipping: {
      status: config.shipping_intake.enabled ? "Discovered" : "Inactive",
      candidates: shippingCandidates
    },
    summary: {
      task_count: taskRecords.length,
      scoped_task_count: scopedOrderTasks.length,
      order_identity_match_count: orderIdentityMatchCount,
      order_status_match_count: orderStatusMatchCount,
      order_status_and_identity_match_count: orderStatusAndIdentityTasks.length,
      order_vendor_match_count: orderVendorMatchTasks.length,
      order_contract_ready_count: orderContractReadyCount,
      eligible_order_count: orderCandidates.length,
      eligible_shipping_task_count: shippingCandidates.length,
      order_status_id_count: orderStatusIds.size,
      shipping_status_id_count: shippingStatusIds.size
    },
    capabilities: {
      folder_task_metadata_read: true,
      workflow_status_metadata_read: workflowStatuses.read,
      shipping_attachment_metadata_read: config.shipping_intake.enabled,
      attachment_download: false,
      workbook_parse: false,
      evidence_persistence: false,
      preview_job_creation: false,
      wrike_writes: false,
      lift_actions: false
    }
  };
}

async function discoverApprovedWrikeTaskWithContext(
  credentials: WrikeOAuthCredentials,
  config: WrikeSourceConfig,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<{
  discovery: WrikeTaskDiscoveryResult;
  order_context: WrikeQualifiedWorkbookSourceResult["order_context"];
}> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const configuredFolderId = providerIdentifier(config.folder_id);
  const taskId = providerIdentifier(config.approved_discovery_task_id);
  const triggerStatusId = providerIdentifier(config.trigger_status_id);
  if (!configuredFolderId || !taskId || !triggerStatusId) {
    throw new WrikeConnectionError(
      "invalid_configuration",
      "Save the Wrike folder, intake-ready status, and approved discovery task IDs before running discovery."
    );
  }

  const refreshed = await refreshWrikeOAuthCredentials(credentials, options);
  const rotatedCredentials = refreshed.credentials;
  const host = rotatedCredentials.host;
  const accessToken = rotatedCredentials.access_token ?? "";
  const folderId = await resolveWrikeFolderId(
    configuredFolderId,
    host,
    accessToken,
    fetchImpl,
    rotatedCredentials
  );
  const taskUrl = new URL(`https://${host}/api/v4/tasks/${encodeURIComponent(taskId)}`);
  // Wrike returns customFields and parentIds in the default task payload. Its
  // exact-task endpoint rejects customFields and superParentIds when they are
  // explicitly requested, so ancestry is verified through exact parent-folder
  // reads below instead of widening discovery to unrelated tasks.
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
  const contractNumber = resolveWrikeContractNumber(task, config.contract_number_custom_field_id);
  const artworkFolder = resolveWrikeArtworkFolderUrl(task, config.artwork_folder_custom_field_id);
  const folderMatches = await taskBelongsToWrikeFolderScope(
    task,
    folderId,
    host,
    accessToken,
    fetchImpl,
    rotatedCredentials
  );
  const taskIdentityMatch = taskIdentityMatches(
    task,
    config.order_task_identity_mode,
    config.order_task_title,
    providerIdentifier(config.order_task_custom_item_type_id)
  );
  const statusMatches = customStatusId === triggerStatusId;
  const printVendorMatches =
    !config.print_vendor_custom_field_id ||
    normalizedComparableText(
      resolveWrikeTextCustomField(task, config.print_vendor_custom_field_id)
    ) === normalizedComparableText(config.required_print_vendor_value);
  const contractNumberMatches = contractNumber.status === "ready";
  const taskQualifies =
    folderMatches &&
    taskIdentityMatch &&
    statusMatches &&
    printVendorMatches &&
    contractNumberMatches;
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
      check_id: "task_identity",
      status: taskIdentityMatch ? "Passed" : "Blocked",
      message: taskIdentityMatch
        ? "The task matches the configured Placard Order identity."
        : "The task does not match the configured Placard Order identity; attachment metadata was not read."
    },
    {
      check_id: "trigger_status",
      status: statusMatches ? "Passed" : "Blocked",
      message: statusMatches
        ? "The task uses the configured intake-ready status ID."
        : "The task does not use the configured intake-ready status ID; attachment metadata was not read."
    },
    {
      check_id: "print_vendor",
      status: printVendorMatches ? "Passed" : "Blocked",
      message: printVendorMatches
        ? config.print_vendor_custom_field_id
          ? "The configured Print Vendor field matches the required Larger Than Life value."
          : "The bounded exact-task QA preview predates the required Print Vendor binding."
        : "The configured Print Vendor field does not match the required value; attachment metadata was not read."
    },
    {
      check_id: "contract_number",
      status: contractNumberMatches ? "Passed" : "Blocked",
      message:
        contractNumber.status === "ready"
          ? "The configured Contract Number field contains a valid bounded contract identifier."
          : contractNumber.status === "not_configured"
            ? "The Contract Number custom field is not configured; attachment metadata was not read."
            : contractNumber.status === "missing"
              ? "The configured Contract Number field is empty; attachment metadata was not read."
              : "The configured Contract Number field must contain C followed by 6–10 digits; attachment metadata was not read."
    },
    {
      check_id: "artwork_folder",
      status:
        !taskQualifies || artworkFolder.status === "invalid"
          ? "Blocked"
          : artworkFolder.status === "missing"
            ? "Warning"
            : "Passed",
      message:
        !taskQualifies
          ? "The artwork-folder field was not evaluated because the task did not pass every routing guardrail."
          : artworkFolder.status === "not_configured"
            ? "No artwork-folder custom field is configured; the order remains eligible without an artwork link."
            : artworkFolder.status === "ready"
              ? "The configured artwork-folder field contains a valid HTTPS URL."
              : artworkFolder.status === "missing"
                ? "The configured artwork-folder field is empty; the order can be reviewed without an artwork link."
                : "The configured artwork-folder field is not a safe HTTPS URL."
    }
  ];

  let attachmentMetadataCount: number | null = null;
  let workbookCandidateCount: number | null = null;
  let ignoredAttachmentCount: number | null = null;
  if (taskQualifies) {
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
    ignoredAttachmentCount = attachmentMetadataCount - workbookCandidateCount;
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
      status: workbookCandidateCount >= 1 ? "Passed" : "Warning",
      message:
        workbookCandidateCount === 1
          ? "One current workbook has an allowed extension and remains one separate order candidate."
          : workbookCandidateCount > 1
            ? `${workbookCandidateCount} current workbooks have allowed extensions; each remains a separate order candidate.`
            : "No current workbook has an allowed extension and optional filename match; reference files and unrelated attachments remain ignored."
    });
  } else {
    checks.push({
      check_id: "attachment_metadata",
      status: "Blocked",
      message: "Attachment metadata was not requested because the task did not pass every routing guardrail."
    });
    checks.push({
      check_id: "workbook_candidates",
      status: "Blocked",
      message: "Workbook candidates were not evaluated because the task did not pass every routing guardrail."
    });
  }

  return {
    discovery: {
      credentials: rotatedCredentials,
      qualification: {
        account_id: accountId ?? "",
        task_id: taskId,
        task_title: typeof task.title === "string" ? task.title.trim() : "",
        contract_number: contractNumber.contract_number ?? "",
        task_qualified: taskQualifies
      },
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
          workbook_candidate_count: workbookCandidateCount,
          ignored_attachment_count: ignoredAttachmentCount,
          artwork_folder_status: taskQualifies ? artworkFolder.status : null
        },
        checks,
        capabilities: {
          task_read: true,
          artwork_folder_value_read:
            taskQualifies && Boolean(config.artwork_folder_custom_field_id),
          attachment_metadata_read: taskQualifies,
          attachment_download: false,
          preview_job_creation: false,
          webhook: false,
          polling: false,
          wrike_writes: false,
          lift_actions: false
        }
      }
    },
    order_context: {
      contract_number: contractNumber.contract_number ?? "",
      artwork_folder_url: taskQualifies ? artworkFolder.url : null
    }
  };
}

export async function discoverApprovedWrikeTask(
  credentials: WrikeOAuthCredentials,
  config: WrikeSourceConfig,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<WrikeTaskDiscoveryResult> {
  return (await discoverApprovedWrikeTaskWithContext(credentials, config, options)).discovery;
}

const WRIKE_DEFAULT_MAX_WORKBOOK_BYTES = 15 * 1024 * 1024;
const WRIKE_DEFAULT_MAX_REFERENCE_PROOF_BYTES = 25 * 1024 * 1024;
const WRIKE_DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const WRIKE_MAX_WORKBOOKS = 10;

function safeWrikeAttachmentDownloadUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    return null;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const unsafeIpv4 =
      /^(?:127|10)\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
    const unsafeIpv6 =
      host === "::1" ||
      host === "[::1]" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      unsafeIpv4 ||
      unsafeIpv6
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function workbookContentTypeAllowed(extension: WrikeWorkbookExtension, value: string | null) {
  const contentType = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!contentType || contentType === "application/octet-stream") {
    return true;
  }
  if (extension === "xlsx") {
    return contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === "xls") {
    return contentType === "application/vnd.ms-excel";
  }
  return contentType === "text/csv" || contentType === "application/csv" || contentType === "text/plain";
}

function canonicalWorkbookContentType(extension: WrikeWorkbookExtension) {
  if (extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === "xls") {
    return "application/vnd.ms-excel";
  }
  return "text/csv";
}

async function readBoundedResponseBytes(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new WrikeConnectionError(
      "attachment_validation_failed",
      `The Wrike workbook exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB evidence limit.`
    );
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new WrikeConnectionError("attachment_validation_failed", "The Wrike workbook exceeds the evidence limit.");
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new WrikeConnectionError("attachment_validation_failed", "The Wrike workbook exceeds the evidence limit.");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchQualifiedWrikeWorkbookSources(
  credentials: WrikeOAuthCredentials,
  config: WrikeSourceConfig,
  options: {
    fetch_impl?: typeof fetch;
    now?: () => Date;
    max_workbook_bytes?: number;
    max_reference_proof_bytes?: number;
    max_total_bytes?: number;
  } = {}
): Promise<WrikeQualifiedWorkbookSourceResult> {
  const fetchImpl = options.fetch_impl ?? fetch;
  const internalDiscovery = await discoverApprovedWrikeTaskWithContext(credentials, config, options);
  const discovery = internalDiscovery.discovery;
  const rotatedCredentials = discovery.credentials;
  const qualification = discovery.qualification;
  if (
    !qualification.task_qualified ||
    !qualification.account_id ||
    discovery.preview.checks.some((check) => check.status === "Blocked")
  ) {
    throw new WrikeConnectionError(
      "attachment_validation_failed",
      "The approved Wrike task no longer passes the saved folder, status, and Contract Number guardrails.",
      rotatedCredentials
    );
  }

  const host = rotatedCredentials.host;
  const accessToken = rotatedCredentials.access_token ?? "";
  const attachmentUrl = new URL(
    `https://${host}/api/v4/tasks/${encodeURIComponent(qualification.task_id)}/attachments`
  );
  attachmentUrl.searchParams.set("versions", "false");
  attachmentUrl.searchParams.set("withUrls", "true");
  let attachmentResponse: Response;
  try {
    attachmentResponse = await fetchImpl(attachmentUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
    });
  } catch {
    throw new WrikeConnectionError(
      "attachment_metadata_failed",
      "Pathfinder could not retrieve the approved Wrike workbook URLs.",
      rotatedCredentials
    );
  }
  const attachmentPayload = await readWrikeApiJson(
    attachmentResponse,
    "attachment_metadata_failed",
    rotatedCredentials
  );
  const candidates = (Array.isArray(attachmentPayload.data) ? attachmentPayload.data : [])
    .map(asRecord)
    .map((attachment): WrikeAttachmentCandidate => ({
      attachment_id: providerIdentifier(attachment.id),
      version_id: effectiveAttachmentVersionId(attachment),
      file_name: typeof attachment.name === "string" ? attachment.name.trim() : "",
      updated_at: safeAttachmentUpdatedAt(attachment) ?? "",
      download_url:
        typeof attachment.url === "string"
          ? attachment.url
          : typeof attachment.downloadUrl === "string"
            ? attachment.downloadUrl
            : null
    }));
  const selection = selectWrikeWorkbookAttachments(candidates, config);
  if (selection.status !== "matched" || !selection.attachments.length) {
    throw new WrikeConnectionError("attachment_validation_failed", selection.message, rotatedCredentials);
  }
  if (selection.attachments.length > WRIKE_MAX_WORKBOOKS) {
    throw new WrikeConnectionError(
      "attachment_validation_failed",
      `The approved Wrike task has more than ${WRIKE_MAX_WORKBOOKS} matching workbooks; operator review is required.`,
      rotatedCredentials
    );
  }
  const referenceProofSelection = selectWrikeReferenceProofAttachment(
    candidates,
    config.reference_proof_intake
  );
  if (referenceProofSelection.status === "ambiguous") {
    throw new WrikeConnectionError(
      "attachment_validation_failed",
      referenceProofSelection.message,
      rotatedCredentials
    );
  }

  const maxWorkbookBytes = Math.max(
    1,
    Math.min(options.max_workbook_bytes ?? WRIKE_DEFAULT_MAX_WORKBOOK_BYTES, WRIKE_DEFAULT_MAX_WORKBOOK_BYTES)
  );
  const maxTotalBytes = Math.max(
    maxWorkbookBytes,
    Math.min(options.max_total_bytes ?? WRIKE_DEFAULT_MAX_TOTAL_BYTES, WRIKE_DEFAULT_MAX_TOTAL_BYTES)
  );
  const workbooks: WrikeQualifiedWorkbookSource[] = [];
  let totalBytes = 0;
  for (const candidate of selection.attachments) {
    const extension = attachmentExtension(candidate.file_name) as WrikeWorkbookExtension;
    const downloadUrl = safeWrikeAttachmentDownloadUrl(candidate.download_url);
    if (!downloadUrl) {
      throw new WrikeConnectionError(
        "attachment_validation_failed",
        "Wrike did not return a safe HTTPS URL for one matching workbook.",
        rotatedCredentials
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(downloadUrl, {
        method: "GET",
        headers: { Accept: "*/*" },
        redirect: "error"
      });
    } catch {
      throw new WrikeConnectionError(
        "attachment_download_failed",
        "Pathfinder could not download one approved Wrike workbook.",
        rotatedCredentials
      );
    }
    if (!response.ok) {
      throw new WrikeConnectionError(
        "attachment_download_failed",
        `Wrike workbook download failed (HTTP ${response.status}).`,
        rotatedCredentials
      );
    }
    if (!workbookContentTypeAllowed(extension, response.headers.get("content-type"))) {
      throw new WrikeConnectionError(
        "attachment_validation_failed",
        "A matching Wrike workbook returned an unexpected content type.",
        rotatedCredentials
      );
    }
    const bytes = await readBoundedResponseBytes(response, Math.min(maxWorkbookBytes, maxTotalBytes - totalBytes));
    totalBytes += bytes.byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new WrikeConnectionError(
        "attachment_validation_failed",
        "The approved Wrike workbooks exceed the total evidence limit.",
        rotatedCredentials
      );
    }
    workbooks.push({
      account_id: qualification.account_id,
      task_id: qualification.task_id,
      attachment_id: candidate.attachment_id,
      version_id: candidate.version_id,
      file_name: candidate.file_name,
      extension,
      updated_at: new Date(candidate.updated_at).toISOString(),
      content_type: canonicalWorkbookContentType(extension),
      byte_size: bytes.byteLength,
      bytes
    });
  }

  let referenceProof: WrikeQualifiedReferenceProofSource | null = null;
  if (referenceProofSelection.attachment) {
    const candidate = referenceProofSelection.attachment;
    const downloadUrl = safeWrikeAttachmentDownloadUrl(candidate.download_url);
    if (!downloadUrl) {
      throw new WrikeConnectionError(
        "attachment_validation_failed",
        "Wrike did not return a safe HTTPS URL for the matching reference proof.",
        rotatedCredentials
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(downloadUrl, {
        method: "GET",
        headers: { Accept: "application/pdf" },
        redirect: "error"
      });
    } catch {
      throw new WrikeConnectionError(
        "attachment_download_failed",
        "Pathfinder could not download the approved Wrike reference proof.",
        rotatedCredentials
      );
    }
    if (!response.ok) {
      throw new WrikeConnectionError(
        "attachment_download_failed",
        `Wrike reference-proof download failed (HTTP ${response.status}).`,
        rotatedCredentials
      );
    }
    const maxReferenceProofBytes = Math.max(
      1,
      Math.min(
        options.max_reference_proof_bytes ?? WRIKE_DEFAULT_MAX_REFERENCE_PROOF_BYTES,
        WRIKE_DEFAULT_MAX_REFERENCE_PROOF_BYTES
      )
    );
    // Wrike's signed-download edge may use a provider-specific content type. The
    // bounded bytes and PDF signature are authoritative for this qualified .pdf.
    const bytes = await readBoundedResponseBytes(
      response,
      Math.min(maxReferenceProofBytes, maxTotalBytes - totalBytes)
    );
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      throw new WrikeConnectionError(
        "attachment_validation_failed",
        "The matching Wrike reference proof is not a valid PDF document.",
        rotatedCredentials
      );
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new WrikeConnectionError(
        "attachment_validation_failed",
        "The approved Wrike source documents exceed the total evidence limit.",
        rotatedCredentials
      );
    }
    referenceProof = {
      account_id: qualification.account_id,
      task_id: qualification.task_id,
      attachment_id: candidate.attachment_id,
      version_id: candidate.version_id,
      file_name: candidate.file_name,
      extension: "pdf",
      updated_at: new Date(candidate.updated_at).toISOString(),
      content_type: "application/pdf",
      byte_size: bytes.byteLength,
      bytes
    };
  }

  return {
    credentials: rotatedCredentials,
    checked_at: discovery.preview.checked_at,
    task_id: qualification.task_id,
    order_context: internalDiscovery.order_context,
    workbooks,
    reference_proof: referenceProof
  };
}

function attachmentExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function matchesWrikeWorkbookContract(fileName: string, config: WrikeSourceConfig) {
  const extension = attachmentExtension(fileName);
  const nameNeedle = config.attachment_filename_contains.toLowerCase();
  return (
    config.attachment_extensions.includes(extension as WrikeWorkbookExtension) &&
    (!nameNeedle || fileName.toLowerCase().includes(nameNeedle))
  );
}

export function selectWrikeWorkbookAttachments(
  candidates: WrikeAttachmentCandidate[],
  config: WrikeSourceConfig
): WrikeAttachmentSelectionResult {
  const matches = candidates
    .filter((candidate) => matchesWrikeWorkbookContract(candidate.file_name, config))
    .filter(
      (candidate) =>
        Boolean(candidate.attachment_id && candidate.version_id) && Number.isFinite(Date.parse(candidate.updated_at))
    )
    .sort((left, right) => {
      const timeDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
      return timeDifference || left.attachment_id.localeCompare(right.attachment_id) || left.version_id.localeCompare(right.version_id);
    });

  if (!matches.length) {
    return {
      status: "missing",
      attachments: [],
      matches,
      message: "No current Wrike attachment matches the configured workbook extension and optional filename filter."
    };
  }

  const currentByAttachment = new Map<string, WrikeAttachmentCandidate>();
  for (const candidate of matches) {
    const current = currentByAttachment.get(candidate.attachment_id);
    if (!current) {
      currentByAttachment.set(candidate.attachment_id, candidate);
      continue;
    }
    if (
      current.version_id !== candidate.version_id &&
      Date.parse(current.updated_at) === Date.parse(candidate.updated_at)
    ) {
      return {
        status: "ambiguous",
        attachments: [],
        matches,
        message: "One Wrike attachment has multiple current versions with the same timestamp; operator review is required."
      };
    }
  }

  const attachments = Array.from(currentByAttachment.values()).sort(
    (left, right) =>
      Date.parse(right.updated_at) - Date.parse(left.updated_at) ||
      left.file_name.localeCompare(right.file_name) ||
      left.attachment_id.localeCompare(right.attachment_id)
  );
  return {
    status: "matched",
    attachments,
    matches,
    message:
      attachments.length === 1
        ? "Selected one current matching workbook as one separate order candidate."
        : `Selected ${attachments.length} current matching workbooks as separate order candidates.`
  };
}

export function selectWrikeReferenceProofAttachment(
  candidates: WrikeAttachmentCandidate[],
  config: WrikeReferenceProofIntakeConfig
): WrikeReferenceProofSelectionResult {
  if (!config.enabled) {
    return {
      status: "missing",
      attachment: null,
      matches: [],
      message: "Reference-proof intake is inactive."
    };
  }

  const nameNeedle = config.filename_contains.trim().toLocaleLowerCase("en-US");
  const matches = candidates
    .filter((candidate) => attachmentExtension(candidate.file_name) === "pdf")
    .filter((candidate) => !nameNeedle || candidate.file_name.toLocaleLowerCase("en-US").includes(nameNeedle))
    .filter(
      (candidate) =>
        Boolean(candidate.attachment_id && candidate.version_id) && Number.isFinite(Date.parse(candidate.updated_at))
    )
    .sort(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at) ||
        left.file_name.localeCompare(right.file_name) ||
        left.attachment_id.localeCompare(right.attachment_id)
    );

  if (!matches.length) {
    return {
      status: "missing",
      attachment: null,
      matches,
      message: "No current Wrike PDF matches the optional reference-proof filename rule."
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      attachment: null,
      matches,
      message: "More than one current Wrike PDF matches the reference-proof rule; operator review is required."
    };
  }
  return {
    status: "matched",
    attachment: matches[0] ?? null,
    matches,
    message: "Selected one current Wrike PDF as the optional order reference proof."
  };
}
