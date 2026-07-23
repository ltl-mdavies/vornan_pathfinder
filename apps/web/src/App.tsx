import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Archive,
  Bell,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ClipboardList,
  Copy,
  Database,
  Edit3,
  FileSpreadsheet,
  FileText,
  Gauge,
  History,
  LogOut,
  Map,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
  Workflow,
  X
} from "lucide-react";
import type { LiftCustomer, LiftCustomerDirectory } from "@pathfinder/customer-directory";
import {
  validateCanonicalOrder,
  type CanonicalFieldDefinition,
  type CanonicalOrder,
  type ProcessingState,
  type ValidationMessage
} from "@pathfinder/canonical";
import {
  applyValueNormalizationToLiftPayload,
  buildLiftSubmitRequest,
  generateLiftPayload,
  maskLiftSubmitRequest,
  validateLiftPayload,
  type LiftOrderPayload,
  type LiftSubmitErrorTranslation,
  type LiftSubmitRequest,
  type LiftTargetConfig,
  type ValueNormalizationRule
} from "@pathfinder/lift-adapter";
import type { LiftStepDefinition, NormalizedLiftOrder, OrderRollupShipmentSummary } from "@pathfinder/order-rollup";
import { OrderRollup } from "@pathfinder/order-rollup-ui";
import "@pathfinder/order-rollup-ui/styles.css";
import {
  SOURCE_CONNECTOR_DEFINITIONS,
  type CustomerSourceConnection,
  type SourceConnectorDefinition,
  type SourceConnectorProvider
} from "@pathfinder/source-connections";
import {
  applyOrderNameResolution,
  buildDefaultMappings,
  canonicalTargetFields,
  createDefaultOrderNameResolutionConfig,
  mapSourceRowsToCanonicalOrder,
  parseWorkbookArrayBuffer,
  sampleSourceGrid,
  validateOrderNameResolution,
  type FieldMapping,
  type LiftExtIdStrategy,
  type OrderNameResolutionCase,
  type OrderNameResolutionConfig,
  type OrderNameResolutionResult,
  type OrderNameResolutionStrategy,
  type ParsedWorkbook,
  type ParsedSourceRow,
  type ParsedWorkbookSheet,
  type SourceGrid
} from "@pathfinder/templates";
import {
  createDefaultWrikeSourceConfig,
  evaluateWrikeReadOnlyQaReadiness,
  getWrikeContractReadiness,
  normalizeWrikeSourceConfig,
  type WrikeSourceConfig,
  type WrikeTaskDiscoveryPreview,
  type WrikeTriggerMode,
  type WrikeWorkbookExtension
} from "@pathfinder/wrike-adapter";
import type { PathfinderAuthSession } from "./auth";
import { configurePathfinderApiAuth, pathfinderFetch as fetch } from "./api-client";
import { WorkspaceLoading } from "./WorkspaceLoading";
import { ProofOpsPanel } from "./ProofOpsPanel";
import { ProofingApiSetup } from "./ProofingApiSetup";

type GlobalView = "Dashboard" | "Customers" | "Targets" | "Jobs" | "Audit" | "Settings";
type CustomerView = "Overview" | "Import Methods" | "Output Product Map" | "Manual Import" | "Jobs" | "Settings";
type JobArchiveFilter = "Active" | "Archived" | "All";
type JobIntakeFilter = "All" | "Customer Dropbox" | "Operator";
type JobSortField = "state" | "updated_at" | "created_at";
type JobSortDirection = "asc" | "desc";

type ImportMethodStatus = "Active" | "Inactive" | "Draft" | "Paused" | "Archived";
type ImportMethodSource = "XLSX" | "Google Sheet" | "PDF PO" | "REST API" | "Clipboard" | "SFTP" | "Wrike";
type ProductResolverStrategy = "derived_key" | "composite_key" | "direct_lift_unit_number";
type ProductResolutionMode = "map_to_lift_unit" | "send_derived_unit";
type ProductMappingStatus = "Mapped" | "Unmapped" | "Ambiguous" | "Inactive";
type ProductMappingSource = "Observed order" | "Preloaded catalog" | "Manual entry";
type OutputProductIdentifierType =
  | "lift_unit_number"
  | "lift_product_id"
  | "sku"
  | "variant_id"
  | "catalog_item_id"
  | "custom";
type TargetType = "ERP" | "Ecommerce" | "Print Factory" | "SFTP" | "Webhook" | "Custom";
type TargetEnvironmentRole = "PROD" | "QA" | "DEV" | "Sandbox" | "Custom";
type TargetAuthMethod = "Header credentials" | "Bearer token" | "API key" | "None";
type OutputDestinationMethod = "HTTP POST" | "SFTP file" | "Email attachment" | "Manual download";
type OutputFormat = "JSON" | "XML" | "CSV" | "XLSX";
type TargetsView = "Overview" | "Environments" | "Output Templates" | "Output Routes" | "Value Rules" | "Test & Health";
type TargetDetailView = Exclude<TargetsView, "Overview">;

function getAuthInitials(authSession: PathfinderAuthSession | null) {
  const fallback = "PF";
  const label = authSession?.displayName || authSession?.email;

  if (!label) {
    return fallback;
  }

  const nameParts = label
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (nameParts.length === 0) {
    return fallback;
  }

  return nameParts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
type SubmitProfileMode = "live_customer" | "sandbox_customer";
type SubmitCertificationStatus = "Passed" | "Warning" | "Blocked";
type RouteDiagnosticStatus = "Passed" | "Warning" | "Blocked";
type EmailReadinessStatus = "Ready" | "Warning" | "Blocked";
type SubmitAttemptStatus = "Blocked" | "Gate Locked" | "Dry Run" | "Submitted" | "Failed";
type SubmitAttemptTransportMode = "dry_run" | "mock" | "live";
type SubmitCertificationActionKey =
  | "manual-import"
  | "field-mapping"
  | "product-map"
  | "target-environments"
  | "target-output-routes"
  | "target-output-templates"
  | "target-health";

type EmailStatusPayload = {
  mode: "log" | "ses";
  sender: {
    from: string;
    from_domain: string | null;
    status_reply_to: string;
    status_reply_to_domain: string | null;
  };
  ses: {
    region: string;
    configuration_set: string | null;
  };
  public_intake_email_verification: {
    gate_enabled: boolean;
    available: boolean;
    delivery_mode: "log" | "ses";
    debug_code_enabled: boolean;
    code_ttl_minutes: number;
    max_attempts: number;
  };
  readiness: {
    status: EmailReadinessStatus;
    items: {
      item_id: string;
      status: EmailReadinessStatus;
      label: string;
      message: string;
    }[];
  };
};

type WrikeConnectionStatusPayload = {
  configured: boolean;
  oauth_connect_ready: boolean;
  oauth_redirect_uri: string;
  authorization_pending: boolean;
  authorization_expires_at: string | null;
  connection_test_enabled: boolean;
  discovery_preview_enabled: boolean;
  host: string | null;
  credentials: {
    client_id_configured: boolean;
    client_secret_configured: boolean;
    refresh_token_configured: boolean;
    access_token_cached: boolean;
    access_token_expires_at: string | null;
  };
  health: {
    status: "Connected" | "Error" | "Not tested";
    host: string | null;
    checked_at: string | null;
    identity_confirmed: boolean;
    message: string;
  };
  capabilities: {
    oauth_authorization: boolean;
    oauth_refresh: boolean;
    identity_check: boolean;
    requested_scope: "wsReadOnly";
    task_discovery: boolean;
    attachment_metadata: boolean;
    attachment_download: boolean;
    webhook: false;
    polling: false;
    wrike_writes: false;
    lift_actions: false;
  };
};

type CustomerSourceConnectionPayload = CustomerSourceConnection & {
  definition: SourceConnectorDefinition | null;
  provider_status: WrikeConnectionStatusPayload | null;
};

type SourceConnectionsPayload = {
  definitions: SourceConnectorDefinition[];
  connections: CustomerSourceConnectionPayload[];
};

type SubmitRuntimeStatus = {
  external_submit_enabled: boolean;
  transport_mode: SubmitAttemptTransportMode;
  live_transport_enabled: boolean;
  live_customer_submit_allowed: boolean;
};

interface ProductResolutionConfig {
  strategy: ProductResolverStrategy;
  mode: ProductResolutionMode;
  source_column: string;
  prefix: string;
  suffix: string;
  composite_columns: string[];
  fallback_strategy: "none" | "composite_key";
  direct_unit_number_column?: string | null;
}

interface CustomerProductMapping {
  mapping_id: string;
  output_route_id: string;
  target_id: string;
  target_template: string;
  customer_product_key: string;
  display_label: string;
  source_columns: string[];
  product_identifier_type: OutputProductIdentifierType;
  product_identifier_value: string | null;
  lift_unit_number: string | null;
  lift_product_id?: string | null;
  product_name: string | null;
  status: ProductMappingStatus;
  mapping_source?: ProductMappingSource;
  source_file_name?: string | null;
  last_seen_examples: Array<{
    sheet_name: string;
    row_number: number;
    description?: string | null;
    sign_type?: string | null;
    media_type?: string | null;
    final_width?: string | null;
    final_height?: string | null;
  }>;
  created_at: string;
  updated_at: string;
}

interface RouteStrategyChange {
  from: OutputProductIdentifierType;
  to: OutputProductIdentifierType;
}

interface BulkProductMappingReview {
  mappings: Array<{
    mapping_id: string;
    customer_product_key: string;
    display_label: string;
    current_identifier: string | null;
  }>;
  route_id: string;
  route_name: string;
  identifier_type: OutputProductIdentifierType;
  identifier_label: string;
  identifier: string;
  lift_unit_number: string | null;
  lift_product_id: string | null;
  product_name: string | null;
  catalog_scope: string;
  source: "manual" | "catalog";
}

interface LiftUnitCatalogItem {
  catalog_item_id: string;
  product_id: string | null;
  unit_number: string | null;
  unit_numbers?: string[];
  product_name: string;
  company_id: string;
  target_id: string;
  environment_id?: string | null;
  catalog_id?: string | null;
  catalog_name?: string | null;
  accounting_item_code?: string | null;
  product_type?: string | null;
  parent_product_id?: string | null;
  unit_price?: number | null;
  quantity?: number | null;
  attribute_1?: number | null;
  attribute_2?: number | null;
  material_id?: string | null;
  storage_type_id?: string | null;
  warehouse_location_id?: string | null;
  image_url?: string | null;
  status: "Active" | "Inactive";
  category?: string | null;
  description?: string | null;
  raw_payload?: Record<string, unknown> | null;
  source?: "Local seed" | "Lift import" | "Manual";
  updated_at: string;
}

interface LiftCatalogPreset {
  preset_id: string;
  output_route_id: string;
  target_id: string;
  catalog_id: string;
  catalog_name: string;
  status: "Active" | "Inactive";
  created_at: string;
  updated_at: string;
}

interface ProductResolutionResult {
  output_route_id: string;
  source_sheet_name: string;
  source_row_number: number;
  line_number: number;
  strategy: ProductResolverStrategy;
  mode: ProductResolutionMode;
  customer_product_key: string;
  display_label: string;
  source_columns: string[];
  resolved_product_identifier?: string | null;
  resolved_unit_number: string | null;
  resolved_product_id?: string | null;
  product_name: string | null;
  status: ProductMappingStatus;
  message: string;
}

interface SavedFieldMappingTemplate {
  template_id: string;
  name: string;
  version: string;
  status: "Draft" | "Published" | "Archived";
  mappings: FieldMapping[];
  updated_at: string;
}

interface DetectedSourceSchemaSheet {
  sheet_name: string;
  columns: string[];
  order_row_count: number;
  reference_row_count: number;
  header_row?: number | null;
  header_row_count?: 1 | 2;
  ignored_header_rows?: number[];
}

interface SourceSheetHeaderOverride {
  header_row: number | null;
  header_row_count: 1 | 2;
}

interface DetectedSourceParserConfig {
  header_row: number | null;
  header_row_count: 1 | 2;
  quantity_column: string | null;
  ignore_repeated_headers: boolean;
  reference_rows_mode: "rows_without_quantity" | "ignore";
  sheet_header_overrides: Record<string, SourceSheetHeaderOverride>;
}

interface DetectedSourceSchema {
  source_file_name: string;
  selected_sheet_name: string;
  columns: string[];
  sheets: DetectedSourceSchemaSheet[];
  detected_at: string;
  parser_config?: DetectedSourceParserConfig;
}

interface PublicIntakeConfig {
  enabled: boolean;
  public_key: string;
  headline: string;
  instructions: string;
  require_email: boolean;
  require_email_verification: boolean;
  allowed_email_domains: string[];
  submit_profile_id: string | null;
  max_order_rows: number;
  published_at: string | null;
}

interface ImportMethod {
  import_method_id: string;
  name: string;
  type: "Manual upload" | "API import" | "Manual paste" | "Scheduled";
  source: ImportMethodSource;
  status: ImportMethodStatus;
  output_route_id: string;
  target_id: string;
  target_template: string;
  template_id: string;
  mappings: FieldMapping[];
  source_config: {
    google_sheet_url?: string | null;
    google_sheet_tab?: string | null;
    google_sheet_range?: string | null;
    pdf_review_mode?: "manual_review" | "assisted_extract";
    api_endpoint_url?: string | null;
    sftp_path?: string | null;
    wrike?: WrikeSourceConfig;
    header_row?: number | null;
    header_row_count?: 1 | 2;
    quantity_column?: string | null;
    ignore_repeated_headers?: boolean;
    reference_rows_mode?: "rows_without_quantity" | "ignore";
    sheet_header_overrides?: Record<string, SourceSheetHeaderOverride>;
    sample_template_name?: string | null;
    detected_schema?: DetectedSourceSchema | null;
    detected_schema_history?: DetectedSourceSchema[];
  };
  workbook_sheet_policy: "rows_with_quantity";
  product_resolution_config: ProductResolutionConfig;
  order_name_resolution_config: OrderNameResolutionConfig;
  ext_id_strategy: LiftExtIdStrategy;
  public_intake: PublicIntakeConfig;
  last_run_at?: string | null;
  success_rate?: string | null;
  created_at: string;
  updated_at: string;
}

interface TargetConfig {
  target_id: string;
  name: string;
  target_type: TargetType;
  adapter: LiftTargetConfig["destination_adapter"];
  format: "JSON";
  template: string;
  status: "Ready" | "Configured" | "Draft";
  health_status: "Healthy" | "Untested" | "Warning" | "Error";
  environments: TargetEnvironment[];
  output_templates: OutputTemplate[];
  lift: LiftTargetConfig;
  last_test_at?: string | null;
  updated_at: string;
}

interface TargetEnvironment {
  environment_id: string;
  name: string;
  role: TargetEnvironmentRole;
  endpoint_url: string;
  auth_method: TargetAuthMethod;
  headers: Record<string, string>;
  credentials: {
    User?: string;
    Password?: string;
    token?: string;
    api_key?: string;
  };
  status: "Active" | "Draft" | "Inactive";
  last_test_at?: string | null;
  last_test_status?: "Not tested" | "Passed" | "Failed" | null;
}

type DestructiveConfirmation =
  | { kind: "import-method"; method: ImportMethod }
  | { kind: "public-intake-link"; action: "rotate" | "revoke"; method: ImportMethod }
  | { kind: "target"; target: TargetConfig }
  | { kind: "jobs"; jobs: ProcessingJobPreview[]; archived: boolean }
  | {
      kind: "target-environment";
      target_id: string;
      target_name: string;
      environment_id: string;
      environment_name: string;
    };

interface OutputTemplate {
  output_template_id: string;
  name: string;
  destination_method: OutputDestinationMethod;
  output_format: OutputFormat;
  body_template: string;
  header_template: string;
  canonical_mappings: FieldMapping[];
  filename_format: string;
  status: "Active" | "Draft" | "Inactive";
  updated_at: string;
}

interface OutputRoute {
  output_route_id: string;
  name: string;
  target_id: string;
  environment_id: string;
  output_template_id: string;
  target_system: string;
  destination_account_name: string;
  destination_account_id: string;
  company_id?: string | null;
  output_template: string;
  product_identifier_type: OutputProductIdentifierType;
  product_identifier_label: string;
  submit_profiles: SubmitProfile[];
  value_normalization_rules: ValueNormalizationRule[];
  order_lookup_url?: string | null;
  proof_report_url?: string | null;
  package_details_url?: string | null;
  status: "Active" | "Draft" | "Inactive";
  updated_at: string;
}

interface SubmitProfile {
  profile_id: string;
  name: string;
  mode: SubmitProfileMode;
  enabled: boolean;
  customer_override?: {
    lift_customer_id: string;
    customer_name: string;
  } | null;
  description?: string | null;
}

interface SubmitCertificationItem {
  item_id: string;
  label: string;
  status: SubmitCertificationStatus;
  blocking: boolean;
  message: string;
  suggested_action?: string;
  action_key?: SubmitCertificationActionKey;
}

interface SubmitCertification {
  can_submit: boolean;
  external_submit_enabled: boolean;
  live_transport_enabled?: boolean;
  live_customer_submit_allowed?: boolean;
  summary: string;
  items: SubmitCertificationItem[];
}

interface ProcessingJobPreview {
  job_id: string;
  pathfinder_order_id: string;
  customer_id: string;
  customer_name: string;
  source_customer_id?: string;
  source_customer_name?: string;
  submit_customer_id?: string;
  submit_customer_name?: string;
  submit_profile_id?: string;
  submit_profile_name?: string;
  submit_mode?: SubmitProfileMode;
  sandbox?: boolean;
  import_method_id: string;
  import_method_name: string;
  output_route_id: string;
  output_route_name: string;
  target_order_number?: string | null;
  target_order_lookup_url?: string | null;
  state: ProcessingState;
  source_file_name: string;
  sheet_name?: string | null;
  source_grid: SourceGrid;
  source_sheets: ParsedWorkbookSheet[];
  parsed_order_rows: ParsedSourceRow[];
  reference_rows: ParsedSourceRow[];
  mappings: FieldMapping[];
  product_resolution_results: ProductResolutionResult[];
  order_name_resolution_result?: OrderNameResolutionResult;
  unresolved_products: CustomerProductMapping[];
  canonical_order: CanonicalOrder;
  canonical_validation: ValidationMessage[];
  lift_payload: LiftOrderPayload;
  lift_validation: ValidationMessage[];
  submit_certification?: SubmitCertification;
  submit_request_masked: Omit<LiftSubmitRequest, "headers"> & {
    headers: Omit<LiftSubmitRequest["headers"], "Password"> & { Password: string };
  };
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  archived_by_email?: string | null;
  public_intake?: {
    channel: "customer_dropbox";
    submitted_by_email: string;
    submitted_at: string;
  } | null;
}

interface NormalizedLiftSubmitResponse {
  status: "not_sent" | "accepted" | "rejected" | "error";
  http_status?: number | null;
  lift_order_id?: string | null;
  message: string;
  raw_body?: unknown;
  error_translation?: LiftSubmitErrorTranslation | null;
  received_at: string;
}

interface SubmitAttempt {
  attempt_id: string;
  idempotency_key: string;
  customer_id: string;
  customer_name: string;
  job_id: string;
  output_route_id: string;
  output_route_name: string;
  submit_profile_id: string;
  submit_profile_name: string;
  submit_mode: SubmitProfileMode;
  sandbox: boolean;
  state: SubmitAttemptStatus;
  transport_mode?: SubmitAttemptTransportMode;
  external_submit_enabled: boolean;
  endpoint_url: string;
  ext_id: string;
  company_id: string;
  submit_request_masked: ProcessingJobPreview["submit_request_masked"];
  certification: SubmitCertification;
  blocking_items: SubmitCertificationItem[];
  response: NormalizedLiftSubmitResponse;
  created_at: string;
  updated_at: string;
}

type StatusAccessPolicyMode =
  | "Exact email only"
  | "Exact email or approved domain"
  | "Invite only"
  | "Internal only";
type StatusAccessDomainStatus = "Approved" | "Suggested" | "Blocked";
type StatusAccessDomainSource = "Customer email" | "Order email" | "Imported contact" | "Admin" | "Seed";

interface StatusAccessDomain {
  domain: string;
  status: StatusAccessDomainStatus;
  source: StatusAccessDomainSource;
  created_at: string;
  updated_at: string;
}

interface StatusAccessPolicy {
  mode: StatusAccessPolicyMode;
  allow_public_status_links: boolean;
  approved_email_domains: StatusAccessDomain[];
  updated_at: string;
}

interface PathfinderCustomerWorkspace {
  customer: LiftCustomer;
  source_connections: CustomerSourceConnection[];
  import_methods: ImportMethod[];
  output_routes: OutputRoute[];
  templates: SavedFieldMappingTemplate[];
  jobs: ProcessingJobPreview[];
  submit_attempts?: SubmitAttempt[];
  product_mappings: CustomerProductMapping[];
  catalog_presets: LiftCatalogPreset[];
  status_access_policy: StatusAccessPolicy;
  primary_target_id: string;
  primary_output_route_id: string;
  primary_target: TargetConfig;
  updated_at: string;
}

interface LiftOrderLookupResult {
  order_number: string;
  lookup_url: string;
  http_status: number;
  ok: boolean;
  payload: unknown;
  fetched_at: string;
}

interface LiftProofReportProof {
  order_number: string | null;
  order_line_id: string | number | null;
  line_number: string | number | null;
  line_step_number: string | number | null;
  product_name: string | null;
  attachment_id: string | number | null;
  creation_date: string | null;
  proof_filename: string | null;
  proof_link_low: string | null;
  proof_link_high: string | null;
  proof_approval_status: string | null;
  proof_approved_by: string | null;
  proof_approved_date: string | null;
  comments: Array<{
    proof_comment: string | null;
    comment_ts: string | null;
    comment_attachment: unknown;
  }>;
  detailed_report: unknown;
}

interface LiftProofReportResult {
  order_number: string;
  proof_report_url: string;
  http_status: number;
  ok: boolean;
  proofs: LiftProofReportProof[];
  payload: unknown;
  fetched_at: string;
}

interface LiftPackageDetail {
  header_id: string | number | null;
  order_number: string | null;
  order_line_id: string | number | null;
  shipping_id: string | number | null;
  line_number: string | number | null;
  product: string | null;
  material: string | null;
  laminate: string | null;
  height: string | number | null;
  width: string | number | null;
  quantity: string | number | null;
  box_number: string | number | null;
  package_type: string | null;
  tracking_number: string | null;
  dimensions: {
    length: string | number | null;
    width: string | number | null;
    height: string | number | null;
    weight: string | number | null;
  };
  tracker_message: string | null;
  location_name: string | null;
  ship_method: string | null;
}

interface LiftPackageDetailsResult {
  order_number: string;
  package_details_url: string;
  http_status: number;
  ok: boolean;
  packages: LiftPackageDetail[];
  payload: unknown;
  redacted_fields: string[];
  fetched_at: string;
}

interface PathfinderOrderSnapshot {
  snapshot_id: string;
  order_number: string;
  source_order_id: string;
  customer: {
    source_customer_id: string;
    source_customer_name: string;
    submit_customer_id: string;
    submit_customer_name: string;
  };
  job: {
    job_id: string;
    state: ProcessingState;
    import_method_name: string;
    source_file_name: string;
    created_at: string;
    updated_at: string;
  };
  route: {
    output_route_id: string;
    name: string;
    target: string;
    environment_id: string;
    template: string;
  };
  header: LiftOrderPayload["order"] & {
    actual_ship_date?: string | null;
    field_sources?: {
      po_number?: "lift" | "submitted";
      contract_number?: "lift" | "submitted";
      order_title?: "lift" | "submitted";
      requested_ship_date?: "lift" | "submitted";
      due_date?: "lift" | "submitted";
      actual_ship_date?: "lift" | "submitted";
      shipping?: "lift" | "submitted";
    };
  };
  live_order?: NormalizedLiftOrder | null;
  order_status?: NormalizedLiftOrder["status"];
  shipment_summary?: OrderRollupShipmentSummary | null;
  lines: Array<{
    line_number: number;
    order_line_id: string | number | null;
    product_name?: string | null;
    description?: string | null;
    quantity: number;
    unit_number?: string | null;
    product_id?: string | number | null;
    material?: string | null;
    final_height?: number | null;
    final_width?: number | null;
    step?: LiftStepDefinition | null;
    proof_count: number;
    package_count: number;
    latest_proof_status: string | null;
    latest_tracking_message: string | null;
    proofs: LiftProofReportProof[];
    packages: LiftPackageDetail[];
  }>;
  proofs: LiftProofReportProof[];
  packages: LiftPackageDetail[];
  submit_history: SubmitAttempt[];
  lookups: {
    order: { ok: boolean; http_status: number; fetched_at: string; payload: unknown } | null;
    proofs: { ok: boolean; http_status: number; fetched_at: string } | null;
    packages: { ok: boolean; http_status: number; fetched_at: string; redacted_fields: string[] } | null;
  };
  visibility_policy: {
    audience: string;
    redacted_fields: string[];
    public_status_ready: boolean;
  };
  issues: Array<{
    source: string;
    severity: "warning" | "error";
    message: string;
  }>;
  refreshed_at: string;
}

interface OrderSnapshotRefreshMetadata {
  source: "lift" | "recent_snapshot";
  checked_at: string;
  next_refresh_at: string;
}

interface PublicStatusLinkResult {
  status_url: string;
  token: string;
  expires_at: string;
  snapshot: {
    snapshot_id: string;
    order_number: string;
    source_order_id: string;
    refreshed_at: string;
  };
}

interface InternalOrderStatusLookupResult {
  match: {
    customer_id: string;
    customer_name: string;
    job_id: string;
    job_state: ProcessingState;
    source_order_id: string;
    target_order_number: string;
  };
  snapshot: PathfinderOrderSnapshot;
}

interface RouteDiagnosticItem {
  item_id: string;
  label: string;
  status: RouteDiagnosticStatus;
  message: string;
  suggested_action?: string;
  action_key?: SubmitCertificationActionKey;
}

interface RouteDiagnostics {
  status: "Ready" | "Needs Attention" | "Blocked";
  blocking_count: number;
  warning_count: number;
  passed_count: number;
  summary: string;
  items: RouteDiagnosticItem[];
}

type CanonicalRegistryField = CanonicalFieldDefinition & {
  origin?: "core" | "custom";
  usage?: {
    import_method_mappings: number;
    saved_mapping_templates: number;
    output_template_mappings: number;
    output_template_tokens: number;
    value_rules: number;
    total: number;
  };
};

interface CanonicalRegistryPayload {
  registry_id: string;
  version: string;
  status: string;
  updated_at: string;
  fields: CanonicalRegistryField[];
  sections: string[];
  field_count: number;
  history?: CanonicalRegistryChangeEntry[];
  snapshots?: CanonicalRegistrySnapshotSummary[];
}

interface CanonicalRegistryChangeEntry {
  change_id: string;
  action: "field_metadata_updated" | "custom_field_created" | "custom_field_removed" | "custom_field_renamed";
  summary: string;
  field_id?: string;
  field_path?: string;
  previous_path?: string;
  next_path?: string;
  usage_total?: number;
  created_at: string;
}

interface CanonicalRegistrySnapshotSummary {
  snapshot_id: string;
  registry_id: string;
  version: string;
  status: string;
  field_count: number;
  custom_field_count: number;
  change_id: string;
  action: CanonicalRegistryChangeEntry["action"];
  summary: string;
  created_at: string;
}

type CanonicalRegistrySnapshotDetail = CanonicalRegistrySnapshotSummary & {
  fields: CanonicalFieldDefinition[];
};

interface CanonicalRegistrySnapshotCompare {
  snapshot_id: string;
  snapshot_version: string;
  current_version: string;
  counts: {
    added: number;
    removed: number;
    changed: number;
  };
  diff: {
    added: CanonicalFieldDefinition[];
    removed: CanonicalFieldDefinition[];
    changed: Array<{
      path: string;
      before: Partial<CanonicalFieldDefinition>;
      after: Partial<CanonicalFieldDefinition>;
    }>;
  };
}

type CanonicalImpactAction = "metadata" | "rename" | "remove";

interface CanonicalImpactReview {
  action: CanonicalImpactAction;
  field: CanonicalRegistryField;
  nextPath?: string;
}

const canonicalSectionLabels: Record<string, string> = {
  customer: "Customer",
  contacts: "Contacts",
  source: "Source",
  target: "Target",
  order: "Order",
  shipping: "Order Shipping",
  lines: "Lines"
};

function CanonicalFieldOptionGroups({ fields }: { fields: CanonicalFieldDefinition[] }) {
  if (!fields.length) {
    return (
      <optgroup label="Canonical Order">
        {canonicalTargetFields.map((field) => (
          <option key={field} value={field}>
            {field}
          </option>
        ))}
      </optgroup>
    );
  }

  const groupedFields = fields.reduce<Record<string, CanonicalFieldDefinition[]>>((groups, field) => {
    groups[field.section] = [...(groups[field.section] ?? []), field];
    return groups;
  }, {});

  return (
    <>
      {Object.entries(groupedFields).map(([section, sectionFields]) => (
        <optgroup key={section} label={canonicalSectionLabels[section] ?? section}>
          {sectionFields.map((field) => (
            <option key={field.field_id} value={field.path}>
              {field.label} · {field.path}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

const globalNavItems: Array<{ label: GlobalView; icon: typeof Gauge }> = [
  { label: "Dashboard", icon: Gauge },
  { label: "Customers", icon: Users },
  { label: "Targets", icon: Database },
  { label: "Jobs", icon: Archive },
  { label: "Audit", icon: History },
  { label: "Settings", icon: Settings }
];

const customerNavItems: Array<{ label: CustomerView; icon: typeof Gauge }> = [
  { label: "Overview", icon: Gauge },
  { label: "Import Methods", icon: Workflow },
  { label: "Output Product Map", icon: Database },
  { label: "Manual Import", icon: Upload },
  { label: "Jobs", icon: Archive },
  { label: "Settings", icon: SlidersHorizontal }
];

const seedTimestamp = "2026-07-09T13:41:00.000Z";
const defaultLiftOrderLookupUrl = "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360Orders/N?offset=0";
const defaultLiftProofReportUrl = "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0";
const defaultLiftPackageDetailsUrl = "https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/PackageDetails/package_details?offset=0";
const importMethodSourceOptions: ImportMethodSource[] = [
  "XLSX",
  "Google Sheet",
  "PDF PO",
  "Clipboard",
  "REST API",
  "SFTP",
  "Wrike"
];
const importMethodStatusOptions: ImportMethodStatus[] = ["Active", "Inactive", "Draft", "Paused"];

const defaultProductResolutionConfig: ProductResolutionConfig = {
  strategy: "derived_key",
  mode: "map_to_lift_unit",
  source_column: "SIGN TYPE",
  prefix: "MOMENTARA__",
  suffix: "",
  composite_columns: ["DESCRIPTION", "Media Type", "Final Size Width", "Final Size Length", "STOCK", "FINISHING"],
  fallback_strategy: "none",
  direct_unit_number_column: null
};

const defaultOrderNameResolutionConfig = createDefaultOrderNameResolutionConfig();
const defaultPublicIntakeConfig: PublicIntakeConfig = {
  enabled: false,
  public_key: "",
  headline: "Put your print order in motion.",
  instructions: "Upload your completed order spreadsheet. We will validate the rows and send the order to our production team for review.",
  require_email: true,
  require_email_verification: false,
  allowed_email_domains: [],
  submit_profile_id: null,
  max_order_rows: 250,
  published_at: null
};
const pendingPathfinderOrderNumber = "PF-{RESERVED-WHEN-PREVIEW-IS-GENERATED}";

const defaultValueNormalizationRules: ValueNormalizationRule[] = [
  {
    value_rule_id: "value-rule-shipping-ups-ground",
    canonical_field: "order.shipping.method",
    output_field: "order.shipping.method",
    match_mode: "case_insensitive",
    input_value: "UPS Ground, Ground, UPS GND",
    normalized_value: "UPS Ground",
    fallback_behavior: "block_submit",
    status: "Active",
    notes: "Lift requires the shipping method to match the configured Lift value exactly."
  }
];

const defaultOutputRoute: OutputRoute = {
  output_route_id: "route-ltl-lift-91-standard-graphics",
  name: "Larger Than Life · Lift / 91 · Standard Graphics",
  target_id: "lift-standard-graphics",
  environment_id: "env-lift-qa1",
  output_template_id: "template-lift-standard-graphics",
  target_system: "Lift ERP",
  destination_account_name: "Larger Than Life",
  destination_account_id: "91",
  company_id: "91",
  output_template: "Lift Standard Graphics Order",
  product_identifier_type: "lift_unit_number",
  product_identifier_label: "Lift unit_number",
  submit_profiles: [
    {
      profile_id: "live-customer",
      name: "Live Customer",
      mode: "live_customer",
      enabled: true,
      customer_override: null,
      description: "Submit using the selected customer workspace Lift customer."
    },
    {
      profile_id: "sandbox-ltl-demo-1249",
      name: "Sandbox · LTL Demo",
      mode: "sandbox_customer",
      enabled: true,
      customer_override: {
        lift_customer_id: "1249",
        customer_name: "LTL Demo"
      },
      description: "Submit test orders under the internal LTL Demo Lift customer."
    }
  ],
  value_normalization_rules: defaultValueNormalizationRules,
  order_lookup_url: defaultLiftOrderLookupUrl,
  proof_report_url: defaultLiftProofReportUrl,
  package_details_url: defaultLiftPackageDetailsUrl,
  status: "Active",
  updated_at: seedTimestamp
};

const targetDetailTabs: TargetDetailView[] = ["Environments", "Output Templates", "Output Routes", "Value Rules", "Test & Health"];
const filenameTags = ["%y", "%m", "%d", "%h", "%i", "%s", "{{order.ext_id}}", "{{customer.name}}"];
const canonicalOrderOptions = Array.from(new Set([
  "order.ext_id",
  "customer.id",
  "customer.name",
  "customer.lift_customer_id",
  "source.source_system",
  "source.source_customer",
  "source.source_record_id",
  "source.source_record_url",
  "source.source_template",
  "source.submitted_at",
  "lines[]",
  ...canonicalTargetFields,
  "order.order_note",
  "lines[].line_number",
  "lines[].artwork.checksum",
  "lines[].production.cut_type"
]));
const environmentTemplateOptions = [
  "environment.credentials.User",
  "environment.credentials.Password",
  "environment.credentials.token",
  "environment.credentials.api_key",
  "environment.headers.Company",
  "environment.endpoint_url"
];
const routeTemplateOptions = ["route.company_id", "route.destination_account_id", "route.destination_account_name"];
const generatedTemplateOptions = [
  "generated.submitted_at",
  "generated.pathfinder_job_id",
  "generated.pathfinder_canonical_order_id",
  "generated.filename"
];
const pathfinderSystemTemplateOptions = ["system.pathfinder.platform"];
const headerPresetTemplateOptions = ["preset.content_type.application_json"];

const liftStandardGraphicsBodyTemplateText = JSON.stringify(
  {
    customer: {
      lift_customer_id: "{{customer.lift_customer_id}}",
      customer_name: "{{customer.name}}",
      crm_id: "{{customer.crm_id}}"
    },
    contacts: [
      {
        first_name: "{{contacts[].first_name}}",
        last_name: "{{contacts[].last_name}}",
        title: "{{contacts[].title}}",
        email: "{{contacts[].email}}",
        mobile_phone: "{{contacts[].mobile_phone}}",
        office_phone: "{{contacts[].office_phone}}",
        home_phone: "{{contacts[].home_phone}}",
        slack: "{{contacts[].slack}}",
        fax: "{{contacts[].fax}}"
      }
    ],
    source: {
      platform: "Pathfinder",
      pathfinder_customer_id: "{{customer.id}}",
      source_system: "{{source.source_system}}",
      source_customer: "{{source.source_customer}}",
      source_record_id: "{{source.source_record_id}}",
      source_record_url: "{{source.source_record_url}}",
      source_template: "{{source.source_template}}",
      submitted_at: "{{source.submitted_at}}",
      pathfinder_job_id: "{{generated.pathfinder_job_id}}",
      pathfinder_canonical_order_id: "{{generated.pathfinder_canonical_order_id}}"
    },
    order: {
      ext_id: "{{order.external_order_id}}",
      po_number: "{{order.po_number}}",
      contract_number: "{{order.contract_number}}",
      order_title: "{{order.order_title}}",
      order_note: "{{order.order_note}}",
      requested_ship_date: "{{order.ship_date}}",
      due_date: "{{order.due_date}}",
      order_attachment: "{{order.order_attachment}}",
      FLEX_FIELD9: "{{order.artwork_folder_url}}",
      shipping: {
        method: "{{order.shipping.method}}",
        account_number: "{{order.shipping.account_number}}",
        acct_billing_zip: "{{order.shipping.acct_billing_zip}}",
        acct_billing_country: "{{order.shipping.acct_billing_country}}",
        attention_to: "{{order.shipping.attention_to}}",
        company: "{{order.shipping.company}}",
        address_1: "{{order.shipping.address_1}}",
        address_2: "{{order.shipping.address_2}}",
        city: "{{order.shipping.city}}",
        state: "{{order.shipping.state}}",
        postal_code: "{{order.shipping.postal_code}}",
        country: "{{order.shipping.country}}",
        phone: "{{order.shipping.phone}}",
        email: "{{order.shipping.email}}",
        instructions: "{{order.shipping.instructions}}"
      }
    },
    lines: [
      {
        line_number: "{{lines[].line_number}}",
        unit_number: "{{lines[].unit_number}}",
        customer_sku: "{{lines[].customer_sku}}",
        description: "{{lines[].description}}",
        product_id: "{{lines[].product_id}}",
        product_name: "{{lines[].product_name}}",
        quantity: "{{lines[].quantity}}",
        artwork: {
          file_name: "{{lines[].artwork.file_name}}",
          file_url: "{{lines[].artwork.file_url}}",
          checksum: "{{lines[].artwork.checksum}}"
        },
        dimensions: {
          final_height: "{{lines[].dimensions.final_height}}",
          final_width: "{{lines[].dimensions.final_width}}",
          live_height: "{{lines[].dimensions.live_height}}",
          live_width: "{{lines[].dimensions.live_width}}",
          bleed: "{{lines[].dimensions.bleed}}"
        },
        production: {
          material: "{{lines[].production.material}}",
          laminate: "{{lines[].production.laminate}}",
          coating: "{{lines[].production.coating}}",
          premask: "{{lines[].production.premask}}",
          ink: "{{lines[].production.ink}}",
          cut_type: "{{lines[].production.cut_type}}",
          hem: "{{lines[].production.hem}}",
          grommets: "{{lines[].production.grommets}}"
        },
        line_note: "{{lines[].line_note}}"
      }
    ]
  },
  null,
  2
);

const liftStandardGraphicsHeaderTemplateText = JSON.stringify(
  {
    "Content-Type": "application/json",
    Ext_ID: "{{order.external_order_id}}",
    User: "{{environment.credentials.User}}",
    Password: "{{environment.credentials.Password}}",
    Company: "{{environment.headers.Company}}"
  },
  null,
  2
);

interface TemplateFieldReference {
  key: string;
  section: "body" | "header";
  path: string;
  sample: string;
  token?: string;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function valuePreview(value: unknown) {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return Array.isArray(value) ? `Array (${value.length})` : "Object";
  }
  return String(value);
}

function addTemplateField(
  fields: globalThis.Map<string, TemplateFieldReference>,
  section: TemplateFieldReference["section"],
  path: string,
  sample: unknown
) {
  if (!path) {
    return;
  }
  const key = `${section}:${path}`;
  const existing = fields.get(key);
  const sampleText = valuePreview(sample);
  if (!existing || (!existing.sample && sampleText)) {
    fields.set(key, {
      key,
      section,
      path,
      sample: sampleText,
      token: typeof sample === "string" ? sample.match(/^\{\{\s*([^}]+?)\s*\}\}$/)?.[1]?.trim() : undefined
    });
  }
}

function collectTemplateJsonFields(
  value: unknown,
  section: TemplateFieldReference["section"],
  path: string,
  fields: globalThis.Map<string, TemplateFieldReference>
) {
  if (Array.isArray(value)) {
    if (!value.length) {
      addTemplateField(fields, section, `${path}[]`, []);
      return;
    }
    value.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        collectTemplateJsonFields(item, section, `${path}[]`, fields);
      } else {
        addTemplateField(fields, section, `${path}[]`, item);
      }
    });
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      collectTemplateJsonFields(child, section, path ? `${path}.${key}` : key, fields);
    });
    return;
  }

  addTemplateField(fields, section, path, value);
}

function extractTemplateTokenFields(templateText: string, section: TemplateFieldReference["section"]) {
  return Array.from(templateText.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)).map((match) => {
    const token = match[1].trim();
    return {
      key: `${section}:${token}`,
      section,
      path: token,
      sample: `{{${token}}}`,
      token
    } satisfies TemplateFieldReference;
  });
}

function templateFieldsFromText(templateText: string, section: TemplateFieldReference["section"]) {
  const fields = new globalThis.Map<string, TemplateFieldReference>();
  try {
    collectTemplateJsonFields(JSON.parse(templateText), section, "", fields);
    return Array.from(fields.values());
  } catch {
    return extractTemplateTokenFields(templateText, section);
  }
}

function templateFields(template: OutputTemplate) {
  return [
    ...templateFieldsFromText(template.body_template, "body"),
    ...templateFieldsFromText(template.header_template, "header")
  ];
}

function defaultCanonicalForTemplateField(field: TemplateFieldReference) {
  const defaults: Record<string, string> = {
    "order.ext_id": "order.external_order_id",
    "order.external_order_id": "order.external_order_id",
    "order.po_number": "order.po_number",
    "order.contract_number": "order.contract_number",
    "order.order_title": "order.order_title",
    "order.order_note": "order.order_note",
    "order.requested_ship_date": "order.ship_date",
    "customer.name": "customer.name",
    "customer.customer_name": "customer.name",
    "customer.lift_customer_id": "customer.lift_customer_id",
    "source.platform": "system.pathfinder.platform",
    "source.pathfinder_customer_id": "customer.id",
    "source.source_customer": "source.source_customer",
    "source.source_system": "source.source_system",
    "source.source_record_id": "source.source_record_id",
    "source.source_record_url": "source.source_record_url",
    "source.source_template": "source.source_template",
    "source.submitted_at": "source.submitted_at",
    "source.pathfinder_job_id": "generated.pathfinder_job_id",
    "source.pathfinder_canonical_order_id": "generated.pathfinder_canonical_order_id",
    "environment.credentials.User": "environment.credentials.User",
    "environment.credentials.Password": "environment.credentials.Password",
    "environment.credentials.token": "environment.credentials.token",
    "environment.headers.Company": "environment.headers.Company",
    "lines[]": "lines[]"
  };
  const directDefault = defaults[field.path] ?? defaults[field.token ?? ""];
  if (directDefault) {
    return directDefault;
  }
  if (field.section === "header") {
    const headerDefaults: Record<string, string> = {
      "Content-Type": "preset.content_type.application_json",
      Ext_ID: "order.external_order_id",
      User: "environment.credentials.User",
      Password: "environment.credentials.Password",
      Company: "environment.headers.Company",
      Authorization: "environment.credentials.token"
    };
    return headerDefaults[field.path] ?? "";
  }
  if (field.path.startsWith("lines[].")) {
    const linePath = field.path.replace(/^lines\[\]\./, "lines[].");
    return canonicalOrderOptions.includes(linePath) ? linePath : "";
  }
  return canonicalOrderOptions.includes(field.path) ? field.path : "";
}

function templateMappingValue(template: OutputTemplate, field: TemplateFieldReference) {
  return (
    template.canonical_mappings.find(
      (mapping) =>
        mapping.sourceColumn === field.key ||
        mapping.sourceColumn === field.path ||
        (field.token ? mapping.sourceColumn === field.token : false)
    )?.targetField ??
    defaultCanonicalForTemplateField(field)
  );
}

function effectiveTemplateMappings(template: OutputTemplate) {
  return templateFields(template)
    .map((field) => ({
      sourceColumn: field.key,
      targetField: templateMappingValue(template, field),
      required: field.section === "body" && field.path === "order.ext_id"
    }))
    .filter((mapping) => mapping.targetField);
}

function pathSegments(path: string) {
  return path.split(".").filter(Boolean);
}

function setTemplateValueAtPath(current: unknown, segments: string[], replacement: string): unknown {
  if (!segments.length) {
    return replacement;
  }
  const [segment, ...rest] = segments;
  if (segment.endsWith("[]")) {
    const key = segment.slice(0, -2);
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return current;
    }
    const record = current as Record<string, unknown>;
    const items = Array.isArray(record[key]) ? record[key] : [];
    return {
      ...record,
      [key]: items.map((item) => setTemplateValueAtPath(item, rest, replacement))
    };
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    return current;
  }
  const record = current as Record<string, unknown>;
  return {
    ...record,
    [segment]: rest.length ? setTemplateValueAtPath(record[segment], rest, replacement) : replacement
  };
}

function templateReplacementForTargetField(targetField: string) {
  if (targetField === "system.pathfinder.platform") {
    return "Pathfinder";
  }
  if (targetField === "preset.content_type.application_json") {
    return "application/json";
  }
  return targetField ? `{{${targetField}}}` : "";
}

function applyTemplateMappingToJson(templateText: string, fieldPath: string, targetField: string) {
  try {
    const parsed = JSON.parse(templateText);
    const replacement = templateReplacementForTargetField(targetField);
    return JSON.stringify(setTemplateValueAtPath(parsed, pathSegments(fieldPath), replacement), null, 2);
  } catch {
    return templateText.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, placeholder: string) =>
      placeholder.trim() === fieldPath ? templateReplacementForTargetField(targetField) : match
    );
  }
}

function mappedTemplatePreview(template: OutputTemplate, section: TemplateFieldReference["section"]) {
  const fields = templateFields(template).filter((field) => field.section === section);
  const sourceText = section === "body" ? template.body_template : template.header_template;
  return fields.reduce((current, field) => {
    const mappingValue = templateMappingValue(template, field);
    return mappingValue ? applyTemplateMappingToJson(current, field.path, mappingValue) : current;
  }, sourceText);
}

function mappingSourceLabel(value: string) {
  if (!value) {
    return "Static/example value";
  }
  if (pathfinderSystemTemplateOptions.includes(value)) {
    return "Pathfinder system";
  }
  if (headerPresetTemplateOptions.includes(value)) {
    return "Header preset";
  }
  if (environmentTemplateOptions.includes(value)) {
    return "Environment";
  }
  if (routeTemplateOptions.includes(value)) {
    return "Output route";
  }
  if (generatedTemplateOptions.includes(value)) {
    return "Generated";
  }
  return "Canonical Order";
}

function mappingPreviewValue(value: string) {
  if (!value) {
    return "Static";
  }
  if (pathfinderSystemTemplateOptions.includes(value) || headerPresetTemplateOptions.includes(value)) {
    return templateReplacementForTargetField(value);
  }
  return `{{${value}}}`;
}

function isExpectedStaticTemplateField(field: TemplateFieldReference) {
  return (
    (field.section === "body" && field.path === "source.platform") ||
    (field.section === "header" && field.path === "Content-Type")
  );
}

function templateMappingStats(template: OutputTemplate) {
  const fields = templateFields(template);
  const staticFields = fields.filter((field) => !templateMappingValue(template, field));
  const warningFields = staticFields.filter((field) => !isExpectedStaticTemplateField(field));
  return {
    total: fields.length,
    mapped: fields.length - staticFields.length,
    staticCount: staticFields.length,
    warningFields
  };
}

function routeDiagnosticItem(
  item_id: string,
  label: string,
  status: RouteDiagnosticStatus,
  message: string,
  suggested_action?: string,
  action_key?: SubmitCertificationActionKey
): RouteDiagnosticItem {
  return {
    item_id,
    label,
    status,
    message,
    suggested_action,
    action_key
  };
}

function configuredSecret(value?: string | null) {
  if (!value?.trim()) {
    return false;
  }
  return !/TBD|SECRET|REFERENCE/i.test(value);
}

function isMaskedSecret(value?: string | null) {
  return value === "********";
}

function validUrlWithParam(urlValue: string | null | undefined, paramName: string) {
  if (!urlValue?.trim()) {
    return false;
  }
  try {
    const url = new URL(urlValue);
    url.searchParams.set(paramName, "A000000");
    return Boolean(url.protocol && url.host);
  } catch {
    return false;
  }
}

function buildRouteDiagnostics(args: {
  target: TargetConfig | null | undefined;
  route: OutputRoute;
  environment: TargetEnvironment | null | undefined;
  template: OutputTemplate | null | undefined;
}): RouteDiagnostics {
  const { target, route, environment, template } = args;
  const templateStats = template ? templateMappingStats(template) : null;
  const user = environment?.credentials.User ?? target?.lift.credentials.User;
  const password = environment?.credentials.Password ?? target?.lift.credentials.Password;
  const endpointUrl = environment?.endpoint_url ?? "";
  const companyId = route.company_id ?? environment?.headers.Company ?? target?.lift.headers.Company ?? "";
  const enabledProfiles = route.submit_profiles.filter((profile) => profile.enabled);
  const hasSandboxProfile = enabledProfiles.some((profile) => profile.mode === "sandbox_customer");
  const hasOrderLookupUrl = validUrlWithParam(route.order_lookup_url, "p0");
  const hasProofReportUrl = validUrlWithParam(route.proof_report_url, "p1");
  const hasPackageDetailsUrl = validUrlWithParam(route.package_details_url, "p0");
  const liftCatalogReady = target?.adapter === "lift-standard-graphics" && configuredSecret(user) && configuredSecret(password);
  const hasValueRuleIssues = (route.value_normalization_rules ?? []).some(
    (rule) =>
      rule.status === "Active" &&
      (!rule.canonical_field.trim() || !rule.output_field.trim() || !rule.input_value.trim() || !rule.normalized_value.trim())
  );

  const items: RouteDiagnosticItem[] = [
    routeDiagnosticItem(
      "route-status",
      "Route status",
      route.status === "Active" ? "Passed" : "Blocked",
      route.status === "Active" ? "Output route is Active." : `Output route is ${route.status}.`,
      route.status === "Active" ? undefined : "Set this output route to Active before submit.",
      route.status === "Active" ? undefined : "target-output-routes"
    ),
    routeDiagnosticItem(
      "environment-status",
      "Environment status",
      environment?.status === "Active" ? "Passed" : "Blocked",
      environment
        ? environment.status === "Active"
          ? `${environment.name} is Active.`
          : `${environment.name} is ${environment.status}.`
        : "Selected route environment could not be found.",
      environment?.status === "Active" ? undefined : "Open Environments and activate or replace the selected environment.",
      environment?.status === "Active" ? undefined : "target-environments"
    ),
    routeDiagnosticItem(
      "endpoint",
      "Create-order endpoint",
      endpointUrl.trim() ? "Passed" : "Blocked",
      endpointUrl.trim() ? "Selected environment has an endpoint URL." : "Selected environment has no endpoint URL.",
      endpointUrl.trim() ? undefined : "Add the Lift create_order endpoint to the selected environment.",
      endpointUrl.trim() ? undefined : "target-environments"
    ),
    routeDiagnosticItem(
      "credentials",
      "Credentials",
      configuredSecret(user) && configuredSecret(password) ? "Passed" : "Warning",
      configuredSecret(user) && configuredSecret(password)
        ? "Import credentials are configured or saved/masked."
        : "Import credentials appear missing or still use setup placeholders.",
      configuredSecret(user) && configuredSecret(password)
        ? undefined
        : "Enter the selected environment's Lift import username and password.",
      configuredSecret(user) && configuredSecret(password) ? undefined : "target-environments"
    ),
    routeDiagnosticItem(
      "company",
      "Destination account",
      companyId.trim() ? "Passed" : "Blocked",
      companyId.trim() ? `Company/account value is ${companyId}.` : "Company/account value is missing.",
      companyId.trim() ? undefined : "Set the route Company ID or selected environment Company header.",
      companyId.trim() ? undefined : "target-output-routes"
    ),
    routeDiagnosticItem(
      "template",
      "Output template",
      template && template.status === "Active" ? "Passed" : "Blocked",
      template
        ? template.status === "Active"
          ? `${template.name} is Active.`
          : `${template.name} is ${template.status}.`
        : "Selected output template could not be found.",
      template?.status === "Active" ? undefined : "Select or activate the output template for this route.",
      template?.status === "Active" ? undefined : "target-output-templates"
    ),
    routeDiagnosticItem(
      "template-mapping",
      "Template field mapping",
      templateStats && templateStats.total > 0 && templateStats.warningFields.length === 0
        ? "Passed"
        : templateStats && templateStats.total > 0
          ? "Warning"
          : "Blocked",
      templateStats && templateStats.total > 0
        ? templateStats.warningFields.length
          ? `${templateStats.warningFields.length} detected template field${templateStats.warningFields.length === 1 ? "" : "s"} still use unexpected static values.`
          : `${templateStats.mapped} of ${templateStats.total} detected template fields are mapped or approved static values.`
        : "No parseable template fields were found.",
      templateStats && templateStats.total > 0 && templateStats.warningFields.length === 0
        ? undefined
        : "Open Output Templates and map unresolved body/header fields.",
      templateStats && templateStats.total > 0 && templateStats.warningFields.length === 0
        ? undefined
        : "target-output-templates"
    ),
    routeDiagnosticItem(
      "product-identifier",
      "Product identifier strategy",
      route.product_identifier_type && route.product_identifier_label ? "Passed" : "Blocked",
      route.product_identifier_type && route.product_identifier_label
        ? `Route expects ${route.product_identifier_label}.`
        : "Product identifier strategy is missing.",
      route.product_identifier_type && route.product_identifier_label
        ? undefined
        : "Choose whether this route maps by Lift unit_number, product_id, or another identifier.",
      route.product_identifier_type && route.product_identifier_label ? undefined : "target-output-routes"
    ),
    routeDiagnosticItem(
      "submit-profiles",
      "Submit profiles",
      enabledProfiles.length && hasSandboxProfile ? "Passed" : enabledProfiles.length ? "Warning" : "Blocked",
      enabledProfiles.length
        ? hasSandboxProfile
          ? `${enabledProfiles.length} enabled submit profile${enabledProfiles.length === 1 ? "" : "s"}, including sandbox.`
          : `${enabledProfiles.length} enabled submit profile${enabledProfiles.length === 1 ? "" : "s"}, but no sandbox profile.`
        : "No enabled submit profiles are available for this route.",
      enabledProfiles.length && hasSandboxProfile ? undefined : "Enable at least one submit profile, preferably the LTL Demo sandbox profile.",
      enabledProfiles.length && hasSandboxProfile ? undefined : "target-output-routes"
    ),
    routeDiagnosticItem(
      "order-lookup",
      "Order lookup URL",
      hasOrderLookupUrl ? "Passed" : "Warning",
      hasOrderLookupUrl
        ? "Order lookup URL can be built with p0."
        : "Order lookup URL is missing or invalid for p0.",
      hasOrderLookupUrl
        ? undefined
        : "Add the AS360 order lookup URL so submitted jobs can pull Lift order details.",
      hasOrderLookupUrl ? undefined : "target-output-routes"
    ),
    routeDiagnosticItem(
      "proof-report",
      "Proof report URL",
      hasProofReportUrl ? "Passed" : "Warning",
      hasProofReportUrl
        ? "Proof report URL can be built with p1."
        : "Proof report URL is missing or invalid for p1.",
      hasProofReportUrl
        ? undefined
        : "Add the AS360 proof report URL when proof visibility is needed.",
      hasProofReportUrl ? undefined : "target-output-routes"
    ),
    routeDiagnosticItem(
      "package-details",
      "Package details URL",
      hasPackageDetailsUrl ? "Passed" : "Warning",
      hasPackageDetailsUrl
        ? "Package details URL can be built with p0."
        : "Package details URL is missing or invalid for p0.",
      hasPackageDetailsUrl
        ? undefined
        : "Add the PackageDetails URL when shipment/package visibility is needed.",
      hasPackageDetailsUrl ? undefined : "target-output-routes"
    ),
    routeDiagnosticItem(
      "product-catalog",
      "Product catalog lookup",
      liftCatalogReady ? "Passed" : "Warning",
      liftCatalogReady
        ? "Lift product catalog lookup can use the selected environment credentials."
        : "Product catalog lookup may not be available for this route yet.",
      liftCatalogReady
        ? undefined
        : "Confirm the route uses the Lift adapter and has saved credentials.",
      liftCatalogReady ? undefined : "target-environments"
    ),
    routeDiagnosticItem(
      "value-rules",
      "Value rules",
      hasValueRuleIssues ? "Warning" : "Passed",
      hasValueRuleIssues
        ? "One or more active value rules is missing field or value information."
        : `${route.value_normalization_rules.length} value rule${route.value_normalization_rules.length === 1 ? "" : "s"} configured.`,
      hasValueRuleIssues ? "Open Value Rules and complete or deactivate incomplete rows." : undefined,
      hasValueRuleIssues ? "target-output-routes" : undefined
    )
  ];
  const blockingCount = items.filter((item) => item.status === "Blocked").length;
  const warningCount = items.filter((item) => item.status === "Warning").length;
  const passedCount = items.filter((item) => item.status === "Passed").length;
  const status: RouteDiagnostics["status"] =
    blockingCount > 0 ? "Blocked" : warningCount > 0 ? "Needs Attention" : "Ready";

  return {
    status,
    blocking_count: blockingCount,
    warning_count: warningCount,
    passed_count: passedCount,
    summary:
      status === "Ready"
        ? "Route is configured for the current workflow."
        : `${blockingCount} blocking and ${warningCount} warning item${blockingCount + warningCount === 1 ? "" : "s"} found.`,
    items
  };
}

function liftStandardGraphicsTemplateMappings() {
  return templateFieldsFromText(liftStandardGraphicsBodyTemplateText, "body")
    .concat(templateFieldsFromText(liftStandardGraphicsHeaderTemplateText, "header"))
    .map((field) => ({
      sourceColumn: field.key,
      targetField: field.token ?? defaultCanonicalForTemplateField(field),
      required:
        field.path === "order.ext_id" ||
        field.path === "lines[].unit_number" ||
        field.path === "lines[].quantity" ||
        field.path === "Ext_ID" ||
        field.path === "User" ||
        field.path === "Password" ||
        field.path === "Company"
    }))
    .filter((mapping) => mapping.targetField);
}

const fallbackCustomer: LiftCustomer = {
  lift_customer_id: "284619",
  customer_name: "Empirical - Momentara",
  customer_number: "0000000960",
  customer_type: "Standard",
  customer_status: "Regular",
  crm_id: null,
  terms: "Due on receipt",
  terms_status: "PENDING",
  credit_limit: null,
  credit_hold: null,
  unpaid_total: null,
  available_credit: null,
  sales_rep: "Alex Hay",
  default_invoice_email_address: "michael@empirical-inc.com",
  created_date: "2026-06-25"
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";
const publicStatusBaseUrl = import.meta.env.VITE_STATUS_BASE_URL ?? "https://status.vornan.co";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!response.ok) {
    let message = body;
    if (contentType.includes("application/json") && body) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
        message =
          (typeof parsed.error === "string" && parsed.error) ||
          (typeof parsed.message === "string" && parsed.message) ||
          body;
      } catch {
        // Keep the raw response body when the server returned malformed JSON.
      }
    }
    throw new Error(message || `Request failed with HTTP ${response.status}.`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error(`Pathfinder API returned a non-JSON response. Confirm the API server is running at ${apiBaseUrl}.`);
  }

  return JSON.parse(body) as T;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

const publicEmailDomains = new Set([
  "aol.com",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com"
]);

function normalizeStatusDomainInput(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^@/, "")
    .split("/")[0]
    .split(":")[0];
}

function domainFromEmail(value?: string | null) {
  if (!value?.includes("@")) {
    return null;
  }
  const domain = normalizeStatusDomainInput(value.split("@").pop() ?? "");
  if (!domain || publicEmailDomains.has(domain)) {
    return null;
  }
  return domain;
}

function createStatusAccessPolicyFallback(customer: LiftCustomer): StatusAccessPolicy {
  const timestamp = new Date().toISOString();
  const inferredDomain = domainFromEmail(customer.default_invoice_email_address);
  return {
    mode: "Exact email or approved domain",
    allow_public_status_links: true,
    approved_email_domains: inferredDomain
      ? [
          {
            domain: inferredDomain,
            status: "Suggested",
            source: "Customer email",
            created_at: timestamp,
            updated_at: timestamp
          }
        ]
      : [],
    updated_at: timestamp
  };
}

function statusPolicyModeDescription(mode: StatusAccessPolicyMode) {
  switch (mode) {
    case "Exact email only":
      return "Only email addresses already attached to the order can request a secure status link.";
    case "Exact email or approved domain":
      return "Recommended. Known order emails work, and approved customer domains can request secure links.";
    case "Invite only":
      return "Public lookup requests are off; links must be created by an internal user.";
    case "Internal only":
      return "Only signed-in Pathfinder users can view status for this customer.";
    default:
      return "Choose who can request public status access for this customer.";
  }
}

function formatRawBodyPreview(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "No raw response body recorded.";
  }
  const text = typeof value === "string" ? value : formatJson(value);
  return text.length > 1600 ? `${text.slice(0, 1600)}\n...` : text;
}

function slugForFilename(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function downloadJsonFile(filename: string, value: unknown) {
  const blob = new Blob([`${formatJson(value)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function displayCurrency(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unassigned";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function StatePill({ state }: { state: ProcessingState }) {
  const className =
    state === "Failed" || state === "Submit Failed"
      ? "pill pill-danger"
      : state === "Needs Mapping"
        ? "pill pill-warning"
      : state === "Ready" || state === "Order Confirmed" || state === "Completed"
        ? "pill pill-success"
        : "pill pill-neutral";
  return <span className={className}>{state}</span>;
}

function MethodStatusPill({ status }: { status: ImportMethodStatus }) {
  const className =
    status === "Active"
      ? "pill pill-success"
      : status === "Inactive" || status === "Paused"
        ? "pill pill-neutral"
        : status === "Archived"
          ? "pill pill-danger"
          : "pill pill-warning";
  return <span className={className}>{status}</span>;
}

function RouteDiagnosticPill({
  status
}: {
  status: RouteDiagnostics["status"] | RouteDiagnosticStatus | EmailReadinessStatus;
}) {
  const className =
    status === "Ready" || status === "Passed"
      ? "pill pill-success"
      : status === "Blocked"
        ? "pill pill-danger"
        : "pill pill-warning";
  return <span className={className}>{status}</span>;
}

function PanelHeader({
  icon: Icon,
  title,
  detail
}: {
  icon: typeof FileSpreadsheet;
  title: string;
  detail?: string;
}) {
  return (
    <div className="panel-header">
      <div className="panel-title">
        <Icon size={18} strokeWidth={2.2} />
        <h2>{title}</h2>
      </div>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function ArrowGlyph() {
  return (
    <svg className="arrow-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 3.5 10 8l-4.5 4.5" />
    </svg>
  );
}

function updateMapping(mappings: FieldMapping[], sourceColumn: string, targetField: string) {
  const nextMappings = mappings.filter((mapping) => mapping.sourceColumn !== sourceColumn);
  return targetField ? [...nextMappings, { sourceColumn, targetField }] : nextMappings;
}

function DetailItem({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "Unassigned"}</dd>
    </div>
  );
}

function targetLogoText(target?: TargetConfig | null) {
  if (!target) {
    return "OUT";
  }
  if (target.name.toLowerCase().includes("lift")) {
    return "LIFT";
  }
  return target.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function displayTimestamp(value?: string | null) {
  if (!value) {
    return "Not run";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function canonicalRegistryActionLabel(action: CanonicalRegistryChangeEntry["action"]) {
  switch (action) {
    case "custom_field_created":
      return "Created";
    case "custom_field_removed":
      return "Removed";
    case "custom_field_renamed":
      return "Renamed";
    case "field_metadata_updated":
    default:
      return "Updated";
  }
}

function canonicalImpactTitle(action: CanonicalImpactAction) {
  switch (action) {
    case "rename":
      return "Review Path Rename";
    case "remove":
      return "Review Draft Removal";
    case "metadata":
    default:
      return "Review Field Edit";
  }
}

function canonicalImpactRiskLabel(review: CanonicalImpactReview) {
  const usageTotal = review.field.usage?.total ?? 0;
  if (review.action === "metadata") {
    return review.field.status !== "Active" ? "Lifecycle change" : "Metadata-only";
  }
  if (review.action === "rename") {
    return usageTotal ? "Migration-safe" : "No saved references";
  }
  return usageTotal ? "Potentially breaking" : "Draft only";
}

function canonicalImpactSummary(review: CanonicalImpactReview) {
  if (review.action === "metadata") {
    return "This updates label, aliases, description, or status. Field ID and path remain stable.";
  }
  if (review.action === "rename") {
    return "Pathfinder will migrate saved mappings, output template mappings, template tokens, and value rules to the new path.";
  }
  return "Only Draft custom fields can be removed. Active fields should be deprecated instead of deleted.";
}

function displayJobId(jobId: string) {
  const digits = jobId.replace(/\D/g, "").slice(-6);
  return digits ? `JOB-${digits}` : jobId;
}

function isFailureState(state: ProcessingState) {
  return state === "Failed" || state === "Submit Failed" || state === "Cancelled";
}

function jobExtId(job: ProcessingJobPreview) {
  return job.lift_payload.order.ext_id;
}

function jobOrderCount(job: ProcessingJobPreview) {
  return job.lift_payload.lines.length;
}

function upsertJob(jobs: ProcessingJobPreview[], job: ProcessingJobPreview) {
  return [job, ...jobs.filter((candidate) => candidate.job_id !== job.job_id)];
}

function sortAndFilterJobs(
  jobs: ProcessingJobPreview[],
  archiveFilter: JobArchiveFilter,
  intakeFilter: JobIntakeFilter,
  sortField: JobSortField,
  sortDirection: JobSortDirection
) {
  const visibleJobs = jobs.filter((job) => {
    const archiveMatches =
      archiveFilter === "All" || (archiveFilter === "Archived" ? Boolean(job.archived_at) : !job.archived_at);
    const isCustomerDropbox = job.public_intake?.channel === "customer_dropbox";
    const intakeMatches =
      intakeFilter === "All" ||
      (intakeFilter === "Customer Dropbox" ? isCustomerDropbox : !isCustomerDropbox);
    return archiveMatches && intakeMatches;
  });
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...visibleJobs].sort((first, second) => {
    if (sortField === "state") {
      const comparison = first.state.localeCompare(second.state);
      return comparison === 0
        ? Date.parse(second.updated_at) - Date.parse(first.updated_at)
        : comparison * direction;
    }
    return (Date.parse(first[sortField]) - Date.parse(second[sortField])) * direction;
  });
}

function JobListControls({
  archiveFilter,
  intakeFilter,
  sortField,
  sortDirection,
  selectedCount,
  onArchiveFilterChange,
  onIntakeFilterChange,
  onSortFieldChange,
  onSortDirectionChange,
  onBulkAction
}: {
  archiveFilter: JobArchiveFilter;
  intakeFilter: JobIntakeFilter;
  sortField: JobSortField;
  sortDirection: JobSortDirection;
  selectedCount: number;
  onArchiveFilterChange: (filter: JobArchiveFilter) => void;
  onIntakeFilterChange: (filter: JobIntakeFilter) => void;
  onSortFieldChange: (field: JobSortField) => void;
  onSortDirectionChange: (direction: JobSortDirection) => void;
  onBulkAction: () => void;
}) {
  const restoring = archiveFilter === "Archived";
  return (
    <div className="job-list-controls">
      <div className="job-list-filters">
        <label>
          <span>Show</span>
          <select value={archiveFilter} onChange={(event) => onArchiveFilterChange(event.target.value as JobArchiveFilter)}>
            <option value="Active">Active jobs</option>
            <option value="Archived">Archived jobs</option>
            <option value="All">All jobs</option>
          </select>
        </label>
        <label>
          <span>Intake</span>
          <select value={intakeFilter} onChange={(event) => onIntakeFilterChange(event.target.value as JobIntakeFilter)}>
            <option value="All">All intake</option>
            <option value="Customer Dropbox">Customer dropbox</option>
            <option value="Operator">Operator workspace</option>
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select value={sortField} onChange={(event) => onSortFieldChange(event.target.value as JobSortField)}>
            <option value="updated_at">Updated</option>
            <option value="created_at">Created</option>
            <option value="state">State</option>
          </select>
        </label>
        <label>
          <span>Order</span>
          <select
            value={sortDirection}
            onChange={(event) => onSortDirectionChange(event.target.value as JobSortDirection)}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
      </div>
      <button className="secondary-button" onClick={onBulkAction} disabled={!selectedCount}>
        <Archive size={16} />
        {restoring ? "Restore" : "Archive"} selected{selectedCount ? ` (${selectedCount})` : ""}
      </button>
    </div>
  );
}

function JobListTable({
  jobs,
  includeCustomer,
  selectedJobIds,
  onToggleJob,
  onToggleAll,
  onOpenJob,
  onArchiveJob
}: {
  jobs: ProcessingJobPreview[];
  includeCustomer?: boolean;
  selectedJobIds: string[];
  onToggleJob: (jobId: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onOpenJob: (job: ProcessingJobPreview) => void;
  onArchiveJob: (job: ProcessingJobPreview) => void;
}) {
  const allSelected = Boolean(jobs.length) && jobs.every((job) => selectedJobIds.includes(job.job_id));
  return (
    <div className="job-list-table-wrap">
      <table className="job-list-table">
        <thead>
          <tr>
            <th className="selection-cell">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onToggleAll(event.target.checked)}
                aria-label="Select all visible jobs"
              />
            </th>
            <th>Job</th>
            {includeCustomer ? <th>Customer</th> : null}
            <th>Source</th>
            <th>Intake</th>
            <th>Ext ID</th>
            <th>Lift Order</th>
            <th>State</th>
            <th>Created</th>
            <th>Updated</th>
            <th className="job-row-action-heading">Action</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job_id}>
              <td className="selection-cell">
                <input
                  type="checkbox"
                  checked={selectedJobIds.includes(job.job_id)}
                  onChange={(event) => onToggleJob(job.job_id, event.target.checked)}
                  aria-label={`Select ${displayJobId(job.job_id)}`}
                />
              </td>
              <td>
                <button className="link-button" onClick={() => onOpenJob(job)}>
                  {displayJobId(job.job_id)}
                </button>
              </td>
              {includeCustomer ? <td>{job.customer_name}</td> : null}
              <td>{job.import_method_name}</td>
              <td>
                {job.public_intake?.channel === "customer_dropbox" ? (
                  <span className="job-intake-cell">
                    <span className="job-intake-pill">Customer dropbox</span>
                    <small>{job.public_intake.submitted_by_email || "Customer submission"}</small>
                  </span>
                ) : (
                  <span className="job-intake-pill job-intake-pill-operator">Operator</span>
                )}
              </td>
              <td>{jobExtId(job)}</td>
              <td>{job.target_order_number ?? "—"}</td>
              <td>
                <StatePill state={job.state} />
              </td>
              <td>{displayTimestamp(job.created_at)}</td>
              <td>{displayTimestamp(job.updated_at)}</td>
              <td className="job-row-action-cell">
                <button className="table-icon-button" onClick={() => onArchiveJob(job)} title={job.archived_at ? "Restore job" : "Archive job"}>
                  {job.archived_at ? <RefreshCw size={15} /> : <Archive size={15} />}
                  <span className="sr-only">{job.archived_at ? "Restore" : "Archive"} {displayJobId(job.job_id)}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function methodLastRun(method: ImportMethod) {
  return displayTimestamp(method.last_run_at);
}

function outputRouteForMethod(method: ImportMethod, routes: OutputRoute[]) {
  return (
    routes.find((route) => route.output_route_id === method.output_route_id) ??
    routes.find((route) => route.target_id === method.target_id && route.output_template === method.target_template) ??
    defaultOutputRoute
  );
}

function methodTargetLabel(method: ImportMethod, routes: OutputRoute[] = [defaultOutputRoute]) {
  const route = outputRouteForMethod(method, routes);
  return route.name;
}

function submitProfileForRoute(route: OutputRoute, profileId?: string | null) {
  const enabledProfiles = route.submit_profiles.filter((profile) => profile.enabled);
  return (
    enabledProfiles.find((profile) => profile.profile_id === profileId) ??
    enabledProfiles.find((profile) => profile.mode === "sandbox_customer") ??
    enabledProfiles.find((profile) => profile.mode === "live_customer") ??
    route.submit_profiles[0] ??
    defaultOutputRoute.submit_profiles[0]
  );
}

function submitCustomerForProfile(customer: LiftCustomer, profile: SubmitProfile) {
  if (profile.mode === "sandbox_customer" && profile.customer_override) {
    return {
      lift_customer_id: profile.customer_override.lift_customer_id,
      customer_name: profile.customer_override.customer_name
    };
  }

  return {
    lift_customer_id: customer.lift_customer_id,
    customer_name: customer.customer_name
  };
}

function environmentRoleKey(environmentName: string, role?: string): LiftTargetConfig["active_environment"] {
  const normalized = `${role ?? ""} ${environmentName}`.toUpperCase();
  return normalized.includes("PROD") ? "PROD" : "QA1";
}

function isProtectedTargetEnvironment(environment: TargetEnvironment) {
  return environment.environment_id === "env-lift-qa1" || environment.environment_id === "env-lift-prod";
}

function liftConfigForRoute(target: TargetConfig | null | undefined, route: OutputRoute): LiftTargetConfig | undefined {
  if (!target) {
    return undefined;
  }

  const environment =
    target.environments.find((candidate) => candidate.environment_id === route.environment_id) ??
    target.environments.find((candidate) => candidate.name === target.lift.active_environment) ??
    target.environments[0];
  const activeEnvironment = environment
    ? environmentRoleKey(environment.name, environment.role)
    : target.lift.active_environment;
  const endpointUrl = environment?.endpoint_url ?? target.lift.environments[activeEnvironment].endpoint_url;
  const companyId = route.company_id ?? environment?.headers.Company ?? target.lift.headers.Company;

  return {
    ...target.lift,
    active_environment: activeEnvironment,
    environments: {
      ...target.lift.environments,
      [activeEnvironment]: {
        endpoint_url: endpointUrl
      }
    },
    headers: {
      ...target.lift.headers,
      Company: companyId
    },
    credentials: {
      User: environment?.credentials.User ?? target.lift.credentials.User,
      Password: environment?.credentials.Password ?? target.lift.credentials.Password
    }
  };
}

function submitCertificationItem(
  item_id: string,
  label: string,
  passed: boolean,
  blockedMessage: string,
  passedMessage: string,
  suggested_action?: string,
  action_key?: SubmitCertificationActionKey
): SubmitCertificationItem {
  return {
    item_id,
    label,
    status: passed ? "Passed" : "Blocked",
    blocking: !passed,
    message: passed ? passedMessage : blockedMessage,
    suggested_action: passed ? undefined : suggested_action,
    action_key: passed ? undefined : action_key
  };
}

function buildLocalSubmitCertification(args: {
  state: ProcessingState;
  canonicalValidation: ValidationMessage[];
  liftValidation: ValidationMessage[];
  request: LiftSubmitRequest;
  payload: LiftOrderPayload;
  profile: SubmitProfile;
  route: OutputRoute;
  unresolvedProductCount: number;
  runtime: SubmitRuntimeStatus | null;
}): SubmitCertification {
  const canonicalFailures = args.canonicalValidation.filter((message) => message.severity === "FAIL");
  const liftFailures = args.liftValidation.filter((message) => message.severity === "FAIL");
  const previewStateCanSubmit = args.state === "Ready" || args.state === "Submit Failed";
  const items: SubmitCertificationItem[] = [
    submitCertificationItem(
      "preview-state",
      "Preview state",
      previewStateCanSubmit,
      `Preview is ${args.state}, not Ready.`,
      args.state === "Submit Failed"
        ? "The persisted preview remains eligible for an intentional retry."
        : "Preview job is Ready.",
      "Generate a Ready preview before external submit.",
      args.unresolvedProductCount ? "product-map" : "manual-import"
    ),
    submitCertificationItem(
      "canonical-validation",
      "Canonical Order validation",
      canonicalFailures.length === 0,
      `${canonicalFailures.length} Canonical Order failure${canonicalFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Canonical Order has no blocking failures.",
      canonicalFailures[0]?.suggested_action,
      "field-mapping"
    ),
    submitCertificationItem(
      "lift-validation",
      "Lift payload validation",
      liftFailures.length === 0,
      `${liftFailures.length} Lift payload failure${liftFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Lift payload has no blocking failures.",
      liftFailures[0]?.suggested_action,
      liftFailures.some((message) => message.code === "LIFT-UNIT") ? "product-map" : "manual-import"
    ),
    submitCertificationItem(
      "product-resolution",
      "Product resolution",
      args.unresolvedProductCount === 0,
      `${args.unresolvedProductCount} product key${args.unresolvedProductCount === 1 ? "" : "s"} need mapping.`,
      "Every order line has an approved product identifier.",
      "Approve unresolved product keys in Output Product Map.",
      "product-map"
    ),
    submitCertificationItem(
      "route-status",
      "Output route status",
      args.route.status === "Active",
      `Output route is ${args.route.status}.`,
      "Output route is Active.",
      "Set the route status to Active before submitting.",
      "target-output-routes"
    ),
    submitCertificationItem(
      "endpoint",
      "Endpoint configured",
      Boolean(args.request.endpoint_url?.trim()),
      "Selected route environment has no endpoint URL.",
      `Endpoint is ${args.request.endpoint_url}.`,
      "Configure the selected Target Environment endpoint.",
      "target-environments"
    ),
    submitCertificationItem(
      "ext-id",
      "Ext_ID equality",
      args.request.headers.Ext_ID === args.payload.order.ext_id && Boolean(args.payload.order.ext_id?.trim()),
      "Header Ext_ID must match body.order.ext_id.",
      "Header Ext_ID matches body.order.ext_id.",
      "Map both values to the same canonical order id.",
      "target-output-templates"
    ),
    submitCertificationItem(
      "company",
      "Company header",
      Boolean(args.request.headers.Company?.trim()),
      "Company header is missing.",
      `Company header is ${args.request.headers.Company}.`,
      "Set the route Company ID or environment Company header.",
      "target-output-routes"
    ),
    submitCertificationItem(
      "credentials",
      "Lift credentials",
      configuredSecret(args.request.headers.User) && configuredSecret(args.request.headers.Password),
      "Lift import credentials are missing or still use setup placeholders.",
      "Lift import credentials are configured or saved securely.",
      "Enter the Lift import username and password in Target Environment settings.",
      "target-environments"
    ),
    {
      item_id: "submit-profile",
      label: "Submit profile",
      status: args.profile.mode === "sandbox_customer" ? "Passed" : "Blocked",
      blocking: args.profile.mode !== "sandbox_customer",
      message:
        args.profile.mode === "sandbox_customer"
          ? `Sandbox profile selected: ${args.profile.customer_override?.customer_name ?? args.profile.name}.`
          : `Live customer profile selected: ${args.profile.name}. Sandbox submit is required by default.`,
      suggested_action:
        args.profile.mode === "sandbox_customer"
          ? "This is the preferred profile for first production-endpoint tests."
          : "Use Sandbox · LTL Demo for non-customer-facing tests.",
      action_key: args.profile.mode === "sandbox_customer" ? undefined : "manual-import"
    },
    submitCertificationItem(
      "submit-profile-enabled",
      "Submit profile enabled",
      args.profile.enabled,
      `Submit profile ${args.profile.name} is disabled on this output route.`,
      `Submit profile ${args.profile.name} is enabled.`,
      "Enable this submit profile on the Output Route or choose another profile.",
      "target-output-routes"
    ),
    {
      item_id: "lift-transport-mode",
      label: "Lift transport mode",
      status: args.runtime?.live_transport_enabled ? "Passed" : "Blocked",
      blocking: !args.runtime?.live_transport_enabled,
      message: args.runtime
        ? args.runtime.transport_mode === "live"
          ? "Lift transport mode is live; Pathfinder will make the external POST when all other gates pass."
          : args.runtime.transport_mode === "mock"
            ? "Lift transport mode is mock; Pathfinder will simulate the configured Lift response."
            : "Lift transport mode is dry_run; Pathfinder will record a dry run instead of calling Lift."
        : "Checking the Pathfinder API Lift transport configuration.",
      suggested_action: args.runtime
        ? args.runtime.live_transport_enabled
          ? undefined
          : "Set PATHFINDER_LIFT_TRANSPORT_MODE=live for the certified sandbox lane."
        : "Wait for the runtime check, then generate a fresh preview.",
      action_key: args.runtime?.live_transport_enabled ? undefined : "target-health"
    },
    {
      item_id: "external-submit-gate",
      label: "External submit feature gate",
      status: args.runtime?.external_submit_enabled ? "Passed" : "Blocked",
      blocking: !args.runtime?.external_submit_enabled,
      message: args.runtime?.external_submit_enabled
        ? "External Lift submit is enabled for certified previews in this environment."
        : args.runtime
          ? "External Lift submit is disabled in Pathfinder."
          : "Checking the Pathfinder API external submit gate.",
      suggested_action: args.runtime
        ? args.runtime.external_submit_enabled
          ? undefined
          : "Enable the deployment-controlled external submit gate."
        : "Wait for the runtime check, then generate a fresh preview.",
      action_key: args.runtime?.external_submit_enabled ? undefined : "target-health"
    }
  ];
  const blockingCount = items.filter((item) => item.blocking).length;

  return {
    can_submit: blockingCount === 0,
    external_submit_enabled: args.runtime?.external_submit_enabled ?? false,
    live_transport_enabled: args.runtime?.live_transport_enabled ?? false,
    live_customer_submit_allowed: args.runtime?.live_customer_submit_allowed ?? false,
    summary: `${blockingCount} submit certification item${blockingCount === 1 ? "" : "s"} blocking external submit.`,
    items
  };
}

function outputIdentifierPlaceholder(route: OutputRoute) {
  if (route.product_identifier_type === "lift_product_id") {
    return "Lift product_id";
  }
  if (route.product_identifier_type === "sku") {
    return "SKU";
  }
  if (route.product_identifier_type === "variant_id") {
    return "Variant ID";
  }
  if (route.product_identifier_type === "catalog_item_id") {
    return "Catalog item ID";
  }
  if (route.product_identifier_type === "custom") {
    return route.product_identifier_label;
  }
  return "Lift unit_number";
}

function outputIdentifierLabel(type: OutputProductIdentifierType) {
  if (type === "lift_product_id") {
    return "Lift product_id";
  }
  if (type === "lift_unit_number") {
    return "Lift unit_number";
  }
  if (type === "sku") {
    return "SKU";
  }
  if (type === "variant_id") {
    return "Variant ID";
  }
  if (type === "catalog_item_id") {
    return "Catalog item ID";
  }
  return "Custom product identifier";
}

function productMappingIdentifierForRoute(mapping: CustomerProductMapping, route: OutputRoute) {
  if (route.product_identifier_type === "lift_product_id") {
    return (
      mapping.lift_product_id ??
      (mapping.product_identifier_type === "lift_product_id" ? mapping.product_identifier_value : null) ??
      null
    );
  }
  if (route.product_identifier_type === "lift_unit_number") {
    return (
      mapping.lift_unit_number ??
      (mapping.product_identifier_type === "lift_unit_number" ? mapping.product_identifier_value : null) ??
      null
    );
  }
  return mapping.product_identifier_type === route.product_identifier_type
    ? mapping.product_identifier_value ?? null
    : null;
}

function productMappingStatusForRoute(mapping: CustomerProductMapping, route: OutputRoute): ProductMappingStatus {
  return mapping.status === "Mapped" && !productMappingIdentifierForRoute(mapping, route) ? "Unmapped" : mapping.status;
}

function productMappingHasIdentifierForRoute(mapping: CustomerProductMapping, route: OutputRoute) {
  return Boolean(productMappingIdentifierForRoute(mapping, route)?.trim());
}

function applyProductResolutionToCanonicalOrder(
  order: CanonicalOrder,
  results: ProductResolutionResult[],
  route: OutputRoute
): CanonicalOrder {
  return {
    ...order,
    lines: order.lines.map((line, index) => {
      const result = results[index];
      const resolvedIdentifier = result?.resolved_product_identifier ?? null;

      return {
        ...line,
        unit_number:
          route.product_identifier_type === "lift_unit_number"
            ? resolvedIdentifier ?? ""
            : line.unit_number ?? "",
        product_id:
          route.product_identifier_type === "lift_product_id"
            ? resolvedIdentifier ?? line.product_id ?? null
            : line.product_id ?? null,
        product_name: result?.product_name ?? line.product_name,
        customer_sku: result?.customer_product_key ?? line.customer_sku
      };
    })
  };
}

function sourceTypeLabel(source: ImportMethodSource) {
  return source;
}

function productResolverCopy(strategy: ProductResolverStrategy) {
  if (strategy === "direct_lift_unit_number") {
    return {
      title: "Use a product identifier already in the file",
      body:
        "Choose this when the incoming sheet or source already provides the exact identifier the selected output route expects."
    };
  }
  if (strategy === "composite_key") {
    return {
      title: "Build a product key from several columns",
      body:
        "Choose this when one field is not reliable enough. Pathfinder joins the selected columns into a customer product key, then maps that key to the selected route's product identifier."
    };
  }
  return {
    title: "Create a product key from one source column",
    body:
      "Choose this when a field like SIGN TYPE identifies the product. Prefixes and suffixes can make the key unique before it maps to the selected route's product identifier."
  };
}

function resolutionModeCopy(mode: ProductResolutionMode) {
  if (mode === "send_derived_unit") {
    return {
      title: "Use the generated key as the submitted product identifier",
      body:
        "Only use this when the generated key is intentionally formatted to match the identifier required by the selected output route. Pathfinder will skip the product mapping lookup."
    };
  }
  return {
    title: "Look up the generated key in this route's output product map",
    body:
      "Recommended. The destination system remains the product source of truth; Pathfinder stores only the customer and route-specific crosswalk from generated keys to approved product identifiers."
  };
}

function valueAsString(value: unknown, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim();
  return normalized.length ? normalized : fallback;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzySubsequenceScore(haystack: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let haystackIndex = 0;
  let firstMatch = -1;
  let previousMatch = -1;
  let contiguousMatches = 0;

  for (const character of needle) {
    const foundIndex = haystack.indexOf(character, haystackIndex);
    if (foundIndex === -1) {
      return 0;
    }
    if (firstMatch === -1) {
      firstMatch = foundIndex;
    }
    if (previousMatch >= 0 && foundIndex === previousMatch + 1) {
      contiguousMatches += 1;
    }
    previousMatch = foundIndex;
    haystackIndex = foundIndex + 1;
  }

  const compactness = needle.length / Math.max(haystack.length, 1);
  const startBonus = firstMatch === 0 ? 20 : Math.max(0, 12 - firstMatch);
  return 40 + contiguousMatches * 3 + compactness * 80 + startBonus;
}

function liftCatalogSearchText(item: LiftUnitCatalogItem) {
  const rawValues =
    item.raw_payload && typeof item.raw_payload === "object"
      ? Object.values(item.raw_payload)
          .filter((value) => ["string", "number", "boolean"].includes(typeof value))
          .map(String)
      : [];

  return normalizeSearchText(
    [
      item.unit_number,
      ...(item.unit_numbers ?? []),
      item.product_id ?? "",
      item.product_name,
      item.catalog_id ?? "",
      item.catalog_name ?? "",
      item.accounting_item_code ?? "",
      item.product_type ?? "",
      item.category ?? "",
      item.description ?? "",
      item.parent_product_id ?? "",
      ...rawValues
    ].join(" ")
  );
}

function liftCatalogSearchScore(item: LiftUnitCatalogItem, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 1;
  }

  const searchable = liftCatalogSearchText(item);
  const compactSearchable = searchable.replace(/\s+/g, "");
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const terms = normalizedQuery.split(" ").filter(Boolean);
  const productName = normalizeSearchText(item.product_name);
  const unitNumber = normalizeSearchText(item.unit_number ?? "");
  const productId = normalizeSearchText(item.product_id ?? "");
  const accountingCode = normalizeSearchText(item.accounting_item_code ?? "");

  if ([productId, unitNumber, accountingCode].some((value) => value && value === normalizedQuery)) {
    return 1000;
  }

  let score = 0;
  if (productName === normalizedQuery) {
    score += 900;
  }
  if (searchable.includes(normalizedQuery)) {
    score += 650;
  }
  if (compactSearchable.includes(compactQuery)) {
    score += 520;
  }

  const matchedTerms = terms.filter((term) => searchable.includes(term));
  if (matchedTerms.length) {
    score += matchedTerms.length * 120;
    if (matchedTerms.length === terms.length) {
      score += 220;
    }
  }

  score += Math.max(
    fuzzySubsequenceScore(productName, compactQuery),
    fuzzySubsequenceScore(compactSearchable, compactQuery) * 0.7
  );

  return score;
}

function compareLiftCatalogItems(first: LiftUnitCatalogItem, second: LiftUnitCatalogItem) {
  return (
    first.product_name.localeCompare(second.product_name) ||
    (first.unit_number ?? "").localeCompare(second.unit_number ?? "") ||
    (first.product_id ?? "").localeCompare(second.product_id ?? "")
  );
}

function normalizeProductKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

function buildCompositeProductKey(row: SourceGrid["rows"][number] | undefined, columns: string[]) {
  if (!row) {
    return "";
  }
  return normalizeProductKey(columns.map((column) => valueAsString(row[column])).filter(Boolean).join("__"));
}

function findProductExampleRow(config: ProductResolutionConfig, rows: SourceGrid["rows"]) {
  const sourceColumn =
    config.strategy === "direct_lift_unit_number"
      ? config.direct_unit_number_column ?? config.source_column
      : config.source_column;
  return (
    rows.find((row) => {
      if (config.strategy === "composite_key") {
        return config.composite_columns.some((column) => valueAsString(row[column]));
      }
      return valueAsString(row[sourceColumn]);
    }) ?? rows[0]
  );
}

function buildProductResolutionExample(
  config: ProductResolutionConfig,
  rows: SourceGrid["rows"],
  productMappings: CustomerProductMapping[],
  testValue: string
) {
  const testColumn =
    config.strategy === "direct_lift_unit_number"
      ? config.direct_unit_number_column ?? config.source_column
      : config.source_column;
  const trimmedTestValue = testValue.trim();
  const sourceRow = findProductExampleRow(config, rows);
  const row =
    trimmedTestValue && config.strategy !== "composite_key"
      ? { ...(sourceRow ?? {}), [testColumn]: trimmedTestValue }
      : sourceRow;
  if (!row) {
    return {
      sourceParts: [] as Array<{ label: string; value: string }>,
      customerProductKey: "Upload or paste source rows to see an example.",
      submittedIdentifier: "Waiting for source data",
      resolutionStatus: "No source row"
    };
  }

  const directColumn = config.direct_unit_number_column ?? config.source_column;
  const sourceParts =
    config.strategy === "composite_key"
      ? config.composite_columns.map((column) => ({ label: column, value: valueAsString(row[column], "Blank") }))
      : [
          {
            label: config.strategy === "direct_lift_unit_number" ? directColumn : config.source_column,
            value: valueAsString(row[config.strategy === "direct_lift_unit_number" ? directColumn : config.source_column], "Blank")
          }
        ];
  const derivedSourceKey = normalizeProductKey(valueAsString(row[config.source_column]));
  const generatedKey =
    config.strategy === "direct_lift_unit_number"
      ? valueAsString(row[directColumn])
      : config.strategy === "composite_key"
        ? buildCompositeProductKey(row, config.composite_columns)
        : derivedSourceKey
          ? `${config.prefix ?? ""}${derivedSourceKey}${config.suffix ?? ""}`
          : "";
  const mappedProduct = productMappings.find(
    (mapping) => mapping.customer_product_key === generatedKey && mapping.status === "Mapped"
  );
  const liftUnitNumber =
    config.strategy === "direct_lift_unit_number" || config.mode === "send_derived_unit"
      ? generatedKey || "No product identifier generated"
      : mappedProduct?.product_identifier_value ??
        mappedProduct?.lift_unit_number ??
        mappedProduct?.lift_product_id ??
        "Needs approved output product mapping";

  return {
    sourceParts,
    customerProductKey: generatedKey || "No product key generated from this row",
    submittedIdentifier: liftUnitNumber,
    resolutionStatus:
      config.strategy === "direct_lift_unit_number"
        ? generatedKey
          ? "Ready from source"
          : "Missing product identifier"
        : config.mode === "send_derived_unit"
          ? "Generated key will be submitted directly"
            : mappedProduct?.product_identifier_value ?? mappedProduct?.lift_unit_number ?? mappedProduct?.lift_product_id
              ? "Mapped"
              : "Needs mapping"
  };
}

function productResolutionExampleCards(
  config: ProductResolutionConfig,
  example: ReturnType<typeof buildProductResolutionExample>,
  productIdentifierLabel: string
) {
  if (config.strategy === "direct_lift_unit_number") {
    return [
      {
        label: `Source ${productIdentifierLabel}`,
        value: example.sourceParts.map((part) => `${part.label}: ${part.value}`).join(" · ") || "No source sample"
      },
      {
        label: `Submitted ${productIdentifierLabel}`,
        value: example.submittedIdentifier
      }
    ];
  }

  if (config.mode === "send_derived_unit") {
    return [
      {
        label: "Generated key",
        value: example.customerProductKey
      },
      {
        label: `Submitted ${productIdentifierLabel}`,
        value: example.submittedIdentifier
      }
    ];
  }

  return [
    {
      label: "Generated customer key",
      value: example.customerProductKey
    },
    {
        label: "Output product map",
      value: example.resolutionStatus
    },
    {
      label: `Submitted ${productIdentifierLabel}`,
      value: example.submittedIdentifier
    }
  ];
}

function sourceTypeToMethodType(source: ImportMethodSource): ImportMethod["type"] {
  if (source === "REST API") {
    return "API import";
  }
  if (source === "Clipboard") {
    return "Manual paste";
  }
  if (source === "SFTP" || source === "Google Sheet" || source === "Wrike") {
    return "Scheduled";
  }
  return "Manual upload";
}

function sampleParsedRows(sourceGrid: SourceGrid): ParsedSourceRow[] {
  return sourceGrid.rows.map((values, index) => ({
    sheet_name: "Sample",
    row_number: index + 2,
    row_type: "order",
    values
  }));
}

function sampleSourceSheets(sourceGrid: SourceGrid): ParsedWorkbookSheet[] {
  return [
    {
      sheet_name: "Sample",
      columns: sourceGrid.columns,
      order_row_count: sourceGrid.rows.length,
      reference_row_count: 0,
      parsed_rows: sampleParsedRows(sourceGrid)
    }
  ];
}

function mappingIdFromKey(key: string) {
  return `product_${key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unmapped"}`;
}

function productMappingDraftKey(outputRouteId: string, customerProductKey: string) {
  return `${outputRouteId}::${customerProductKey}`;
}

function sampleValuesForColumn(rows: SourceGrid["rows"], column: string) {
  return Array.from(
    new Set(
      rows
        .map((row) => row[column])
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
        .map((value) => String(value).trim())
    )
  )
    .slice(0, 3)
    .join(" · ");
}

function sourceParserConfigFromMethod(sourceConfig: ImportMethod["source_config"]): DetectedSourceParserConfig {
  const sheetHeaderOverrides = Object.fromEntries(
    Object.entries(sourceConfig.sheet_header_overrides ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sheetName, override]) => [
        sheetName,
        {
          header_row: override.header_row ?? null,
          header_row_count: override.header_row_count ?? 1
        }
      ])
  );

  return {
    header_row: sourceConfig.header_row ?? null,
    header_row_count: sourceConfig.header_row_count ?? 1,
    quantity_column: sourceConfig.quantity_column ?? null,
    ignore_repeated_headers: sourceConfig.ignore_repeated_headers ?? true,
    reference_rows_mode: sourceConfig.reference_rows_mode ?? "rows_without_quantity",
    sheet_header_overrides: sheetHeaderOverrides
  };
}

function workbookSheetHeaderOverrides(parserConfig: DetectedSourceParserConfig) {
  return Object.fromEntries(
    Object.entries(parserConfig.sheet_header_overrides).map(([sheetName, override]) => [
      sheetName,
      {
        headerRow: override.header_row,
        headerRowCount: override.header_row_count
      }
    ])
  );
}

function sourceSchemaIsStale(schema: DetectedSourceSchema | null, sourceConfig: ImportMethod["source_config"]) {
  if (!schema) {
    return false;
  }
  if (!schema.parser_config) {
    return true;
  }

  const current = sourceParserConfigFromMethod(sourceConfig);
  return (
    schema.parser_config.header_row !== current.header_row ||
    schema.parser_config.header_row_count !== current.header_row_count ||
    schema.parser_config.quantity_column !== current.quantity_column ||
    schema.parser_config.ignore_repeated_headers !== current.ignore_repeated_headers ||
    schema.parser_config.reference_rows_mode !== current.reference_rows_mode ||
    JSON.stringify(schema.parser_config.sheet_header_overrides ?? {}) !== JSON.stringify(current.sheet_header_overrides)
  );
}

function detectedSourceSchemaFromWorkbook(
  fileName: string,
  parsed: ParsedWorkbook,
  parserConfig: DetectedSourceParserConfig
): DetectedSourceSchema {
  return {
    source_file_name: fileName,
    selected_sheet_name: parsed.sheetName,
    columns: parsed.columns,
    sheets: parsed.source_sheets.map((sheet) => ({
      sheet_name: sheet.sheet_name,
      columns: sheet.columns,
      order_row_count: sheet.order_row_count,
      reference_row_count: sheet.reference_row_count,
      header_row: sheet.header_row ?? null,
      header_row_count: sheet.header_row_count ?? parserConfig.header_row_count,
      ignored_header_rows: sheet.ignored_header_rows ?? []
    })),
    detected_at: new Date().toISOString(),
    parser_config: parserConfig
  };
}

function sourceSchemaComparison(current: DetectedSourceSchema, previous: DetectedSourceSchema) {
  const currentColumns = new Set(current.columns);
  const previousColumns = new Set(previous.columns);
  const currentSheets = new globalThis.Map(current.sheets.map((sheet) => [sheet.sheet_name, sheet]));
  const previousSheets = new globalThis.Map(previous.sheets.map((sheet) => [sheet.sheet_name, sheet]));
  const addedColumns = current.columns.filter((column) => !previousColumns.has(column));
  const removedColumns = previous.columns.filter((column) => !currentColumns.has(column));
  const addedSheets = current.sheets.map((sheet) => sheet.sheet_name).filter((sheetName) => !previousSheets.has(sheetName));
  const removedSheets = previous.sheets.map((sheet) => sheet.sheet_name).filter((sheetName) => !currentSheets.has(sheetName));
  const changedSheets = current.sheets.flatMap((sheet) => {
    const previousSheet = previousSheets.get(sheet.sheet_name);
    if (!previousSheet) {
      return [];
    }
    const changed =
      JSON.stringify(sheet.columns) !== JSON.stringify(previousSheet.columns) ||
      (sheet.header_row ?? null) !== (previousSheet.header_row ?? null) ||
      (sheet.header_row_count ?? 1) !== (previousSheet.header_row_count ?? 1) ||
      JSON.stringify(sheet.ignored_header_rows ?? []) !== JSON.stringify(previousSheet.ignored_header_rows ?? []);
    return changed ? [sheet.sheet_name] : [];
  });

  return {
    addedColumns,
    removedColumns,
    addedSheets,
    removedSheets,
    changedSheets,
    columnOrderChanged:
      addedColumns.length === 0 &&
      removedColumns.length === 0 &&
      JSON.stringify(current.columns) !== JSON.stringify(previous.columns),
    parserSettingsChanged: JSON.stringify(current.parser_config ?? null) !== JSON.stringify(previous.parser_config ?? null)
  };
}

function mappingsForSourceColumns(columns: string[], currentMappings: FieldMapping[]) {
  const currentByColumn = new globalThis.Map(currentMappings.map((mapping) => [mapping.sourceColumn, mapping]));
  const defaultsByColumn = new globalThis.Map(buildDefaultMappings(columns).map((mapping) => [mapping.sourceColumn, mapping]));

  return columns.flatMap((column) => {
    const mapping = currentByColumn.get(column) ?? defaultsByColumn.get(column);
    return mapping ? [mapping] : [];
  });
}

function productMappingSeenCount(mapping: CustomerProductMapping) {
  return mapping.last_seen_examples.length;
}

function productMappingLastSeen(mapping: CustomerProductMapping) {
  const lastExample = mapping.last_seen_examples[0];
  return lastExample ? `${lastExample.sheet_name} · Row ${lastExample.row_number}` : "Not seen in preview yet";
}

function productMappingStatusClass(status: ProductMappingStatus) {
  if (status === "Mapped") {
    return "mini-pill mini-pill-success";
  }
  if (status === "Ambiguous") {
    return "mini-pill mini-pill-warning";
  }
  if (status === "Inactive") {
    return "mini-pill mini-pill-neutral";
  }
  return "mini-pill mini-pill-danger";
}

interface ProductMapPreloadRow {
  row_id: string;
  row_number: number;
  source_value: string;
  customer_product_key: string;
  display_label: string;
  product_identifier_value: string;
  product_name: string;
  final_width: string;
  final_height: string;
  source_columns: string[];
  status: ProductMappingStatus;
  action: "New" | "Update" | "Duplicate" | "Missing key";
  existing_mapping?: CustomerProductMapping;
  values: Record<string, string>;
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"" && inQuotes && nextCharacter === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }

    if (character === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === delimiter && !inQuotes) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const candidates = ["\t", ",", ";", "|"];
  return candidates
    .map((delimiter) => ({ delimiter, count: splitDelimitedLine(firstLine, delimiter).length }))
    .sort((first, second) => second.count - first.count)[0]?.delimiter ?? "\t";
}

function parseDelimitedProductList(text: string): SourceGrid {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { columns: [], rows: [] };
  }

  const delimiter = detectDelimiter(text);
  const columns = splitDelimitedLine(lines[0], delimiter).map((column, index) => column || `Column ${index + 1}`);
  const rows = lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
  });

  return { columns, rows };
}

function productKeyFromCatalogRow(
  row: Record<string, string>,
  config: ProductResolutionConfig,
  sourceColumn: string,
  compositeColumns: string[]
) {
  if (config.strategy === "direct_lift_unit_number") {
    return valueAsString(row[sourceColumn]);
  }

  if (config.strategy === "composite_key") {
    return normalizeProductKey(compositeColumns.map((column) => valueAsString(row[column])).filter(Boolean).join("__"));
  }

  const sourceKey = normalizeProductKey(valueAsString(row[sourceColumn]));
  return sourceKey ? `${config.prefix ?? ""}${sourceKey}${config.suffix ?? ""}` : "";
}

function preloadDimensionValue(row: Record<string, unknown>, dimension: "width" | "height") {
  const columns =
    dimension === "width"
      ? ["Final Size Width", "Final Width", "Width"]
      : ["Final Size Height", "Final Size Length", "Final Height", "Height", "Length"];

  return columns.map((column) => valueAsString(row[column])).find(Boolean) ?? "";
}

function findPreloadDimensionColumn(columns: string[], dimension: "width" | "height") {
  const candidates =
    dimension === "width"
      ? ["Final Size Width", "Final Width", "Width"]
      : ["Final Size Height", "Final Size Length", "Final Height", "Height", "Length"];

  return (
    candidates
      .map((candidate) => columns.find((column) => column.trim().toLowerCase() === candidate.toLowerCase()))
      .find(Boolean) ?? ""
  );
}

function productMappingSourceLabel(mapping: CustomerProductMapping) {
  return mapping.mapping_source ?? (mapping.last_seen_examples.length ? "Observed order" : "Manual entry");
}

function productMappingFinalWidth(mapping: CustomerProductMapping) {
  return mapping.last_seen_examples.find((example) => example.final_width)?.final_width ?? "—";
}

function productMappingFinalHeight(mapping: CustomerProductMapping) {
  return mapping.last_seen_examples.find((example) => example.final_height)?.final_height ?? "—";
}

export function App({ authSession }: { authSession: PathfinderAuthSession | null }) {
  useEffect(() => {
    configurePathfinderApiAuth({
      apiBaseUrl,
      token: authSession?.token ?? null,
      getToken: authSession?.getIdToken ?? null,
      onSessionExpired: authSession?.expireSession ?? null
    });

    return () => {
      configurePathfinderApiAuth({ apiBaseUrl, token: null });
    };
  }, [authSession]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const methodTemplateInputRef = useRef<HTMLInputElement>(null);
  const methodTemplateFileRef = useRef<File | null>(null);
  const productPreloadFileRef = useRef<HTMLInputElement>(null);
  const [activeGlobalView, setActiveGlobalView] = useState<GlobalView>("Customers");
  const [activeCustomerView, setActiveCustomerView] = useState<CustomerView>("Overview");
  const [sourceGrid, setSourceGrid] = useState<SourceGrid>({ columns: [], rows: [] });
  const [sourceSheets, setSourceSheets] = useState<ParsedWorkbookSheet[]>([]);
  const [parsedOrderRows, setParsedOrderRows] = useState<ParsedSourceRow[]>([]);
  const [referenceRows, setReferenceRows] = useState<ParsedSourceRow[]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [sourceSchemaState, setSourceSchemaState] = useState<"idle" | "detecting" | "error">("idle");
  const [sourceSchemaMessage, setSourceSchemaMessage] = useState<string | null>(null);
  const [selectedSourceSchemaSheetName, setSelectedSourceSchemaSheetName] = useState("");
  const [selectedSourceSchemaHistoryDetectedAt, setSelectedSourceSchemaHistoryDetectedAt] = useState("");
  const [customers, setCustomers] = useState<LiftCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [customerDirectory, setCustomerDirectory] = useState<Omit<LiftCustomerDirectory, "customers">>({
    source: "local-seed",
    endpoint_url: "",
    status_endpoint_url: "",
    loaded_at: "",
    warning: undefined
  });
  const [customerImportState, setCustomerImportState] = useState<"idle" | "loading">("loading");
  const [workspace, setWorkspace] = useState<PathfinderCustomerWorkspace | null>(null);
  const [targets, setTargets] = useState<TargetConfig[]>([]);
  const [targetsAndJobsState, setTargetsAndJobsState] = useState<"loading" | "idle" | "error">("loading");
  const [canonicalRegistry, setCanonicalRegistry] = useState<CanonicalRegistryPayload | null>(null);
  const [canonicalRegistryState, setCanonicalRegistryState] = useState<"loading" | "idle" | "error">("loading");
  const [emailStatus, setEmailStatus] = useState<EmailStatusPayload | null>(null);
  const [emailStatusState, setEmailStatusState] = useState<"idle" | "loading" | "error">("idle");
  const [emailStatusMessage, setEmailStatusMessage] = useState<string | null>(null);
  const [sourceConnectorDefinitions, setSourceConnectorDefinitions] = useState<SourceConnectorDefinition[]>(
    SOURCE_CONNECTOR_DEFINITIONS
  );
  const [sourceConnections, setSourceConnections] = useState<CustomerSourceConnectionPayload[]>([]);
  const [selectedSourceConnectionId, setSelectedSourceConnectionId] = useState("");
  const [wrikeConnectionState, setWrikeConnectionState] = useState<"idle" | "loading" | "saving" | "authorizing" | "testing" | "error">("idle");
  const [wrikeConnectionMessage, setWrikeConnectionMessage] = useState<string | null>(null);
  const wrikeOAuthReturnMessageRef = useRef<string | null>(null);
  const wrikeOAuthReturnConnectionIdRef = useRef("");
  const [wrikeDiscoveryState, setWrikeDiscoveryState] = useState<"idle" | "loading" | "error">("idle");
  const [wrikeDiscoveryMessage, setWrikeDiscoveryMessage] = useState<string | null>(null);
  const [wrikeDiscoveryPreview, setWrikeDiscoveryPreview] = useState<WrikeTaskDiscoveryPreview | null>(null);
  const [wrikeConnectionDraft, setWrikeConnectionDraft] = useState({
    name: "",
    environment: "Production" as "Production" | "Sandbox",
    status: "Draft" as "Draft" | "Active" | "Inactive",
    client_id: "",
    client_secret: ""
  });
  const [submitRuntime, setSubmitRuntime] = useState<SubmitRuntimeStatus | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [activeTargetsView, setActiveTargetsView] = useState<TargetDetailView>("Environments");
  const [activeOutputTemplateId, setActiveOutputTemplateId] = useState<string | null>(null);
  const [globalJobs, setGlobalJobs] = useState<ProcessingJobPreview[]>([]);
  const [activeMethodId, setActiveMethodId] = useState("manual-xlsx");
  const [manualImportMethodId, setManualImportMethodId] = useState("manual-xlsx");
  const [isImportMethodDetailOpen, setIsImportMethodDetailOpen] = useState(false);
  const [dirtyImportMethodIds, setDirtyImportMethodIds] = useState<string[]>([]);
  const [localDraftImportMethodIds, setLocalDraftImportMethodIds] = useState<string[]>([]);
  const [dirtyTargetIds, setDirtyTargetIds] = useState<string[]>([]);
  const [localDraftTargetIds, setLocalDraftTargetIds] = useState<string[]>([]);
  const [dirtyOutputRouteIds, setDirtyOutputRouteIds] = useState<string[]>([]);
  const [routeStrategyChanges, setRouteStrategyChanges] = useState<Record<string, RouteStrategyChange>>({});
  const [leavePrompt, setLeavePrompt] = useState<{
    title: string;
    body: string;
    scope: "import-method" | "target";
  } | null>(null);
  const [destructiveConfirmation, setDestructiveConfirmation] = useState<DestructiveConfirmation | null>(null);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const [workspaceState, setWorkspaceState] = useState<"idle" | "loading" | "saving" | "error">("loading");
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const workspaceRequestIdRef = useRef(0);
  const [statusPolicyDraft, setStatusPolicyDraft] = useState<StatusAccessPolicy | null>(null);
  const [newStatusDomain, setNewStatusDomain] = useState("");
  const [newStatusDomainStatus, setNewStatusDomainStatus] = useState<StatusAccessDomainStatus>("Approved");
  const [canonicalRegistrySearch, setCanonicalRegistrySearch] = useState("");
  const [canonicalRegistrySectionFilter, setCanonicalRegistrySectionFilter] = useState("All");
  const [editingCanonicalFieldId, setEditingCanonicalFieldId] = useState<string | null>(null);
  const [isCreatingCanonicalField, setIsCreatingCanonicalField] = useState(false);
  const [canonicalImpactReview, setCanonicalImpactReview] = useState<CanonicalImpactReview | null>(null);
  const [selectedCanonicalSnapshot, setSelectedCanonicalSnapshot] = useState<CanonicalRegistrySnapshotDetail | null>(null);
  const [canonicalSnapshotCompare, setCanonicalSnapshotCompare] = useState<CanonicalRegistrySnapshotCompare | null>(null);
  const [canonicalSnapshotState, setCanonicalSnapshotState] = useState<"idle" | "loading" | "error">("idle");
  const [canonicalFieldDraft, setCanonicalFieldDraft] = useState<{
    path: string;
    label: string;
    description: string;
    aliases: string;
    status: CanonicalFieldDefinition["status"];
  }>({
    path: "",
    label: "",
    description: "",
    aliases: "",
    status: "Active"
  });
  const [newCanonicalFieldDraft, setNewCanonicalFieldDraft] = useState<{
    path: string;
    section: CanonicalFieldDefinition["section"];
    label: string;
    data_type: CanonicalFieldDefinition["data_type"];
    description: string;
    aliases: string;
    required: boolean;
    repeatable: boolean;
  }>({
    path: "",
    section: "order",
    label: "",
    data_type: "string",
    description: "",
    aliases: "",
    required: false,
    repeatable: false
  });
  const [lastPreviewJob, setLastPreviewJob] = useState<ProcessingJobPreview | null>(null);
  const [lastSubmitAttempt, setLastSubmitAttempt] = useState<SubmitAttempt | null>(null);
  const [selectedJobDetail, setSelectedJobDetail] = useState<ProcessingJobPreview | null>(null);
  const [selectedJobAttempts, setSelectedJobAttempts] = useState<SubmitAttempt[]>([]);
  const [jobDetailState, setJobDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [orderLookupState, setOrderLookupState] = useState<"idle" | "loading" | "error">("idle");
  const [orderLookupResult, setOrderLookupResult] = useState<LiftOrderLookupResult | null>(null);
  const [proofReportState, setProofReportState] = useState<"idle" | "loading" | "error">("idle");
  const [proofReportResult, setProofReportResult] = useState<LiftProofReportResult | null>(null);
  const [packageDetailsState, setPackageDetailsState] = useState<"idle" | "loading" | "error">("idle");
  const [packageDetailsResult, setPackageDetailsResult] = useState<LiftPackageDetailsResult | null>(null);
  const [orderSnapshotState, setOrderSnapshotState] = useState<"idle" | "loading" | "error">("idle");
  const [orderSnapshotResult, setOrderSnapshotResult] = useState<PathfinderOrderSnapshot | null>(null);
  const [statusLinkState, setStatusLinkState] = useState<"idle" | "loading" | "error">("idle");
  const [statusLinkResult, setStatusLinkResult] = useState<PublicStatusLinkResult | null>(null);
  const [internalOrderLookupNumber, setInternalOrderLookupNumber] = useState("");
  const [internalOrderLookupState, setInternalOrderLookupState] = useState<"idle" | "loading" | "error">("idle");
  const [internalOrderLookupResult, setInternalOrderLookupResult] = useState<InternalOrderStatusLookupResult | null>(null);
  const [certificationRefreshState, setCertificationRefreshState] = useState<"idle" | "loading" | "error">("idle");
  const certificationRefreshKeyRef = useRef("");
  const [selectedSubmitProfileId, setSelectedSubmitProfileId] = useState("sandbox-ltl-demo-1249");
  const [confirmedProdSandboxSubmitKey, setConfirmedProdSandboxSubmitKey] = useState<string | null>(null);
  const [productMappingDrafts, setProductMappingDrafts] = useState<Record<string, { unit: string; product: string }>>({});
  const [compositeColumnToAdd, setCompositeColumnToAdd] = useState("");
  const [orderNameComponentToAdd, setOrderNameComponentToAdd] = useState("");
  const [orderNameTextToAdd, setOrderNameTextToAdd] = useState("");
  const [productExampleTestValue, setProductExampleTestValue] = useState("");
  const [unitMapSearch, setUnitMapSearch] = useState("");
  const [unitMapStatusFilter, setUnitMapStatusFilter] = useState<ProductMappingStatus | "All">("All");
  const [outputMapRouteFilter, setOutputMapRouteFilter] = useState("All");
  const [migrationQueueRouteId, setMigrationQueueRouteId] = useState<string | null>(null);
  const [selectedUnitMapIds, setSelectedUnitMapIds] = useState<string[]>([]);
  const [bulkUnitNumber, setBulkUnitNumber] = useState("");
  const [bulkProductName, setBulkProductName] = useState("");
  const [bulkProductMappingReview, setBulkProductMappingReview] = useState<BulkProductMappingReview | null>(null);
  const [preloadText, setPreloadText] = useState("");
  const [preloadSourceName, setPreloadSourceName] = useState("Customer product list");
  const [preloadGrid, setPreloadGrid] = useState<SourceGrid>({ columns: [], rows: [] });
  const [preloadSourceColumn, setPreloadSourceColumn] = useState("");
  const [preloadProductNameColumn, setPreloadProductNameColumn] = useState("");
  const [preloadUnitColumn, setPreloadUnitColumn] = useState("");
  const [preloadFinalWidthColumn, setPreloadFinalWidthColumn] = useState("");
  const [preloadFinalHeightColumn, setPreloadFinalHeightColumn] = useState("");
  const [preloadDefaultUnit, setPreloadDefaultUnit] = useState("");
  const [preloadSelectedIds, setPreloadSelectedIds] = useState<string[]>([]);
  const [liftUnitCatalog, setLiftUnitCatalog] = useState<LiftUnitCatalogItem[]>([]);
  const [unitCatalogSearch, setUnitCatalogSearch] = useState("");
  const [unitCatalogStatusFilter, setUnitCatalogStatusFilter] = useState<"Active" | "Inactive" | "All">("Active");
  const [unitCatalogProductTypeFilter, setUnitCatalogProductTypeFilter] = useState("All");
  const [unitCatalogCatalogFilter, setUnitCatalogCatalogFilter] = useState("All");
  const [unitCatalogApiFilterParam, setUnitCatalogApiFilterParam] = useState("catalog_id");
  const [unitCatalogApiFilterValue, setUnitCatalogApiFilterValue] = useState("");
  const [catalogPresetId, setCatalogPresetId] = useState("");
  const [selectedCatalogUnitNumbers, setSelectedCatalogUnitNumbers] = useState<Record<string, string>>({});
  const [activeCatalogMappingId, setActiveCatalogMappingId] = useState<string | null>(null);
  const [selectedCatalogDetailId, setSelectedCatalogDetailId] = useState<string | null>(null);
  const [unitCatalogState, setUnitCatalogState] = useState<"idle" | "loading" | "error">("idle");
  const [openTopbarMenu, setOpenTopbarMenu] = useState<"environment" | "notifications" | "actions" | null>(null);
  const [jobActionMenuOpen, setJobActionMenuOpen] = useState(false);
  const [jobArchiveFilter, setJobArchiveFilter] = useState<JobArchiveFilter>("Active");
  const [jobIntakeFilter, setJobIntakeFilter] = useState<JobIntakeFilter>("All");
  const [jobSortField, setJobSortField] = useState<JobSortField>("updated_at");
  const [jobSortDirection, setJobSortDirection] = useState<JobSortDirection>("desc");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [openProductMapTool, setOpenProductMapTool] = useState<"preload" | "unit-library" | null>(null);

  async function loadCustomers(refresh = false) {
    setCustomerImportState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/lift/customers${refresh ? "?refresh=1" : ""}`);
      const directory = await readJsonResponse<LiftCustomerDirectory>(response);
      if (directory.customers.length === 0) {
        throw new Error("Lift returned no customers for this workspace.");
      }
      setCustomers(directory.customers);
      setCustomerDirectory({
        source: directory.source,
        endpoint_url: directory.endpoint_url,
        status_endpoint_url: directory.status_endpoint_url,
        loaded_at: directory.loaded_at,
        warning: directory.warning
      });
      setSelectedCustomerId((current) => {
        if (directory.customers.some((customer) => customer.lift_customer_id === current)) {
          return current;
        }
        const momentara = directory.customers.find((customer) =>
          customer.customer_name.toLowerCase().includes("momentara")
        );
        return momentara?.lift_customer_id ?? directory.customers[0]?.lift_customer_id ?? "";
      });
    } catch (error) {
      setCustomerDirectory((current) => ({
        ...current,
        warning: error instanceof Error ? error.message : "Customer import failed."
      }));
    } finally {
      setCustomerImportState("idle");
    }
  }

  async function loadWorkspace(liftCustomerId: string) {
    const requestId = workspaceRequestIdRef.current + 1;
    workspaceRequestIdRef.current = requestId;
    setWorkspace(null);
    setLastPreviewJob(null);
    setLastSubmitAttempt(null);
    setStatusPolicyDraft(null);
    setWorkspaceState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${liftCustomerId}/workspace`);
      const loadedWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      if (workspaceRequestIdRef.current !== requestId) {
        return;
      }
      setWorkspace(loadedWorkspace);
      await loadSourceConnections(liftCustomerId, wrikeOAuthReturnConnectionIdRef.current);
      wrikeOAuthReturnConnectionIdRef.current = "";
      setDirtyImportMethodIds([]);
      setLocalDraftImportMethodIds([]);
      setDirtyOutputRouteIds([]);
      setRouteStrategyChanges({});
      setMigrationQueueRouteId(null);
      setLastSubmitAttempt(loadedWorkspace.submit_attempts?.[0] ?? null);
      setActiveMethodId(
        loadedWorkspace.import_methods.find((method) => method.status !== "Archived")?.import_method_id ?? "manual-xlsx"
      );
      setManualImportMethodId(
        loadedWorkspace.import_methods.find((method) => method.status === "Active")?.import_method_id ?? "ad-hoc"
      );
      setWorkspaceMessage(null);
    } catch (error) {
      if (workspaceRequestIdRef.current !== requestId) {
        return;
      }
      setWorkspaceMessage(error instanceof Error ? error.message : "Workspace load failed.");
      setWorkspaceState("error");
      return;
    }
    setWorkspaceState("idle");
  }

  function updateStatusPolicyDraft(patch: Partial<StatusAccessPolicy>) {
    setStatusPolicyDraft((current) => ({
      ...(current ?? createStatusAccessPolicyFallback(selectedCustomer)),
      ...patch
    }));
  }

  function updateStatusDomainDraft(domain: string, patch: Partial<StatusAccessDomain>) {
    setStatusPolicyDraft((current) => {
      const policy = current ?? createStatusAccessPolicyFallback(selectedCustomer);
      const timestamp = new Date().toISOString();
      return {
        ...policy,
        approved_email_domains: policy.approved_email_domains.map((entry) =>
          entry.domain === domain
            ? {
                ...entry,
                ...patch,
                updated_at: timestamp
              }
            : entry
        )
      };
    });
  }

  function addStatusDomainDraft() {
    const domain = normalizeStatusDomainInput(newStatusDomain);
    if (!domain) {
      setWorkspaceMessage("Enter a customer email domain before adding it.");
      return;
    }
    if (publicEmailDomains.has(domain)) {
      setWorkspaceMessage("Public email domains are not eligible for customer status access.");
      return;
    }

    setStatusPolicyDraft((current) => {
      const policy = current ?? createStatusAccessPolicyFallback(selectedCustomer);
      const timestamp = new Date().toISOString();
      const existing = policy.approved_email_domains.find((entry) => entry.domain === domain);
      if (existing) {
        return {
          ...policy,
          approved_email_domains: policy.approved_email_domains.map((entry) =>
            entry.domain === domain
              ? {
                  ...entry,
                  status: newStatusDomainStatus,
                  source: entry.source === "Admin" ? "Admin" : entry.source,
                  updated_at: timestamp
                }
              : entry
          )
        };
      }
      return {
        ...policy,
        approved_email_domains: [
          ...policy.approved_email_domains,
          {
            domain,
            status: newStatusDomainStatus,
            source: "Admin",
            created_at: timestamp,
            updated_at: timestamp
          }
        ]
      };
    });
    setNewStatusDomain("");
    setNewStatusDomainStatus("Approved");
    setWorkspaceMessage(null);
  }

  function removeStatusDomainDraft(domain: string) {
    setStatusPolicyDraft((current) => {
      const policy = current ?? createStatusAccessPolicyFallback(selectedCustomer);
      return {
        ...policy,
        approved_email_domains: policy.approved_email_domains.filter((entry) => entry.domain !== domain)
      };
    });
  }

  async function saveStatusAccessPolicy() {
    const policy = statusPolicyDraft ?? createStatusAccessPolicyFallback(selectedCustomer);
    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/status-access-policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy)
      });
      const updatedWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      setWorkspace(updatedWorkspace);
      setStatusPolicyDraft(updatedWorkspace.status_access_policy);
      setWorkspaceMessage("Public status access policy saved.");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Status access policy save failed.");
      setWorkspaceState("error");
      return;
    }
    setWorkspaceState("idle");
  }

  async function loadTargetsAndJobs() {
    setTargetsAndJobsState("loading");
    try {
      const [targetsResponse, jobsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/targets`),
        fetch(`${apiBaseUrl}/api/jobs`)
      ]);
      const targetsPayload = await readJsonResponse<{ targets: TargetConfig[] }>(targetsResponse);
      const jobsPayload = await readJsonResponse<{ jobs: ProcessingJobPreview[] }>(jobsResponse);
      setTargets(targetsPayload.targets);
      setLocalDraftTargetIds([]);
      setGlobalJobs(jobsPayload.jobs);
      setTargetsAndJobsState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Target/job load failed.");
      setTargetsAndJobsState("error");
    }
  }

  async function loadCanonicalRegistry() {
    setCanonicalRegistryState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/canonical-registry`);
      const registry = await readJsonResponse<CanonicalRegistryPayload>(response);
      setCanonicalRegistry(registry);
      setCanonicalRegistryState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Canonical registry load failed.");
      setCanonicalRegistryState("error");
    }
  }

  async function loadEmailStatus() {
    setEmailStatusState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/email/status`);
      const payload = await readJsonResponse<EmailStatusPayload>(response);
      setEmailStatus(payload);
      setEmailStatusMessage(null);
      setEmailStatusState("idle");
    } catch (error) {
      setEmailStatusMessage(error instanceof Error ? error.message : "Email status load failed.");
      setEmailStatusState("error");
    }
  }

  function updateSourceConnectionPayload(payload: CustomerSourceConnectionPayload) {
    setSourceConnections((current) =>
      current.some((connection) => connection.connection_id === payload.connection_id)
        ? current.map((connection) => connection.connection_id === payload.connection_id ? payload : connection)
        : [...current, payload]
    );
    setSelectedSourceConnectionId(payload.connection_id);
    setWrikeConnectionDraft({
      name: payload.name,
      environment: payload.environment,
      status: payload.status,
      client_id: "",
      client_secret: ""
    });
  }

  function selectSourceConnection(connection: CustomerSourceConnectionPayload) {
    setSelectedSourceConnectionId(connection.connection_id);
    setWrikeConnectionDraft({
      name: connection.name,
      environment: connection.environment,
      status: connection.status,
      client_id: "",
      client_secret: ""
    });
    setWrikeConnectionMessage(null);
    setWrikeConnectionState("idle");
  }

  async function loadSourceConnections(liftCustomerId = selectedCustomerId, preferredConnectionId = "") {
    if (!liftCustomerId) {
      return;
    }
    setWrikeConnectionState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${encodeURIComponent(liftCustomerId)}/source-connections`);
      const payload = await readJsonResponse<SourceConnectionsPayload>(response);
      setSourceConnectorDefinitions(payload.definitions);
      setSourceConnections(payload.connections);
      const selected = payload.connections.find((connection) => connection.connection_id === preferredConnectionId)
        ?? payload.connections.find((connection) => connection.connection_id === selectedSourceConnectionId)
        ?? payload.connections.find((connection) => connection.provider === "wrike")
        ?? payload.connections[0]
        ?? null;
      setSelectedSourceConnectionId(selected?.connection_id ?? "");
      setWrikeConnectionDraft({
        name: selected?.name ?? "",
        environment: selected?.environment ?? "Production",
        status: selected?.status ?? "Draft",
        client_id: "",
        client_secret: ""
      });
      if (wrikeOAuthReturnMessageRef.current) {
        setWrikeConnectionMessage(wrikeOAuthReturnMessageRef.current);
        wrikeOAuthReturnMessageRef.current = null;
      } else {
        setWrikeConnectionMessage(null);
      }
      setWrikeConnectionState("idle");
    } catch (error) {
      setWrikeConnectionMessage(error instanceof Error ? error.message : "Customer source connections could not be loaded.");
      setWrikeConnectionState("error");
    }
  }

  async function createSourceConnection(provider: SourceConnectorProvider) {
    if (!selectedCustomerId) {
      return;
    }
    setWrikeConnectionState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${encodeURIComponent(selectedCustomerId)}/source-connections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, environment: "Production" })
        }
      );
      const payload = await readJsonResponse<CustomerSourceConnectionPayload>(response);
      updateSourceConnectionPayload(payload);
      const definition = sourceConnectorDefinitions.find((candidate) => candidate.provider === provider);
      setWrikeConnectionMessage(
        `${definition?.name ?? "Source"} connection created for this customer. Save its credentials to continue.`
      );
      setWrikeConnectionState("idle");
    } catch (error) {
      setWrikeConnectionMessage(error instanceof Error ? error.message : "Source connection could not be created.");
      setWrikeConnectionState("error");
    }
  }

  async function saveWrikeConnection() {
    if (!selectedCustomerId || !selectedSourceConnectionId) {
      return;
    }
    setWrikeConnectionState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${encodeURIComponent(selectedCustomerId)}/source-connections/${encodeURIComponent(selectedSourceConnectionId)}`,
        {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wrikeConnectionDraft)
        }
      );
      const payload = await readJsonResponse<CustomerSourceConnectionPayload>(response);
      updateSourceConnectionPayload(payload);
      setWrikeConnectionDraft({
        name: payload.name,
        environment: payload.environment,
        status: payload.status,
        client_id: "",
        client_secret: ""
      });
      setWrikeConnectionMessage(
        payload.provider_status?.oauth_connect_ready
          ? "Wrike app credentials are saved securely. Continue with Wrike to authorize read-only access."
          : "Wrike app credentials were not complete."
      );
      setWrikeConnectionState("idle");
    } catch (error) {
      setWrikeConnectionMessage(error instanceof Error ? error.message : "Wrike OAuth connection save failed.");
      setWrikeConnectionState("error");
    }
  }

  async function startWrikeOAuthConnection() {
    if (!selectedCustomerId || !selectedSourceConnectionId) {
      return;
    }
    setWrikeConnectionState("authorizing");
    setWrikeConnectionMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${encodeURIComponent(selectedCustomerId)}/source-connections/${encodeURIComponent(selectedSourceConnectionId)}/wrike/oauth/start`,
        { method: "POST" }
      );
      const payload = await readJsonResponse<{
        authorization_url: string;
        expires_at: string;
        redirect_uri: string;
        requested_scope: "wsReadOnly";
      }>(response);
      const authorizationUrl = new URL(payload.authorization_url);
      if (authorizationUrl.origin !== "https://login.wrike.com") {
        throw new Error("Pathfinder received an unexpected Wrike authorization destination.");
      }
      window.location.assign(authorizationUrl.toString());
    } catch (error) {
      setWrikeConnectionMessage(error instanceof Error ? error.message : "Wrike authorization could not be started.");
      setWrikeConnectionState("error");
    }
  }

  async function testWrikeConnection() {
    if (!selectedCustomerId || !selectedSourceConnectionId) {
      return;
    }
    setWrikeConnectionState("testing");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${encodeURIComponent(selectedCustomerId)}/source-connections/${encodeURIComponent(selectedSourceConnectionId)}/wrike/test`,
        { method: "POST" }
      );
      const payload = await readJsonResponse<CustomerSourceConnectionPayload>(response);
      updateSourceConnectionPayload(payload);
      setWrikeConnectionMessage("Wrike OAuth refresh and read-only identity check passed.");
      setWrikeConnectionState("idle");
    } catch (error) {
      setWrikeConnectionMessage(error instanceof Error ? error.message : "Wrike read-only connection test failed.");
      setWrikeConnectionState("error");
    }
  }

  async function previewWrikeDiscovery() {
    if (!selectedCustomerId || !activeImportMethod) {
      return;
    }
    setWrikeDiscoveryState("loading");
    setWrikeDiscoveryMessage(null);
    setWrikeDiscoveryPreview(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${encodeURIComponent(selectedCustomerId)}/import-methods/${encodeURIComponent(activeImportMethod.import_method_id)}/wrike/discovery-preview`,
        { method: "POST" }
      );
      const payload = await readJsonResponse<WrikeTaskDiscoveryPreview>(response);
      setWrikeDiscoveryPreview(payload);
      setWrikeDiscoveryMessage(
        payload.status === "Confirmed"
          ? "The approved Wrike task and saved workbook rule were confirmed. No file was downloaded and no job was created."
          : "Wrike returned the approved task, but one or more saved-scope checks need operator review."
      );
      setWrikeDiscoveryState("idle");
    } catch (error) {
      setWrikeDiscoveryMessage(error instanceof Error ? error.message : "Wrike discovery preview failed.");
      setWrikeDiscoveryState("error");
    }
  }

  async function loadSubmitRuntime() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/submit-runtime`);
      setSubmitRuntime(await readJsonResponse<SubmitRuntimeStatus>(response));
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift submit runtime check failed.");
    }
  }

  function downloadCanonicalRegistry(format: "json" | "csv") {
    window.open(`${apiBaseUrl}/api/canonical-registry/export?format=${format}`, "_blank", "noopener,noreferrer");
  }

  function downloadCanonicalSnapshot(snapshotId: string, format: "json" | "csv") {
    window.open(
      `${apiBaseUrl}/api/canonical-registry/snapshots/${snapshotId}/export?format=${format}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function openCanonicalSnapshot(snapshotId: string) {
    setCanonicalSnapshotState("loading");
    setSelectedCanonicalSnapshot(null);
    setCanonicalSnapshotCompare(null);
    try {
      const [snapshotResponse, compareResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/canonical-registry/snapshots/${snapshotId}`),
        fetch(`${apiBaseUrl}/api/canonical-registry/snapshots/${snapshotId}/compare`)
      ]);
      const snapshotPayload = await readJsonResponse<{ snapshot: CanonicalRegistrySnapshotDetail }>(snapshotResponse);
      const comparePayload = await readJsonResponse<CanonicalRegistrySnapshotCompare>(compareResponse);
      setSelectedCanonicalSnapshot(snapshotPayload.snapshot);
      setCanonicalSnapshotCompare(comparePayload);
      setCanonicalSnapshotState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Canonical snapshot load failed.");
      setCanonicalSnapshotState("error");
    }
  }

  async function loadLiftUnitCatalog(route: OutputRoute) {
    setUnitCatalogState("loading");
    try {
      const params = new URLSearchParams({
        target_id: route.target_id,
        output_route_id: route.output_route_id,
        customer_id: selectedCustomer.lift_customer_id
      });
      if (route.environment_id) {
        params.set("environment_id", route.environment_id);
      }
      if (route.company_id) {
        params.set("company_id", route.company_id);
      }
      if (unitCatalogStatusFilter === "All") {
        params.set("include_inactive", "true");
      } else {
        params.set("status", unitCatalogStatusFilter);
      }
      if (unitCatalogProductTypeFilter !== "All") {
        params.set("product_type", unitCatalogProductTypeFilter);
      }
      if (unitCatalogCatalogFilter !== "All") {
        params.set("catalog_id", unitCatalogCatalogFilter);
      }
      if (unitCatalogApiFilterValue.trim()) {
        params.set(unitCatalogApiFilterParam, unitCatalogApiFilterValue.trim());
      }
      const response = await fetch(`${apiBaseUrl}/api/lift/product-catalog?${params.toString()}`);
      const payload = await readJsonResponse<{ products: LiftUnitCatalogItem[] }>(response);
      setLiftUnitCatalog(payload.products);
      setUnitCatalogState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift product catalog load failed.");
      setUnitCatalogState("error");
    }
  }

  async function refreshLiftProductCatalog(route: OutputRoute) {
    setUnitCatalogState("loading");
    try {
      const params = new URLSearchParams({
        target_id: route.target_id,
        output_route_id: route.output_route_id,
        customer_id: selectedCustomer.lift_customer_id,
        refresh: "1"
      });
      if (route.environment_id) {
        params.set("environment_id", route.environment_id);
      }
      if (route.company_id) {
        params.set("company_id", route.company_id);
      }
      if (unitCatalogStatusFilter === "All") {
        params.set("include_inactive", "true");
      } else {
        params.set("status", unitCatalogStatusFilter);
      }
      if (unitCatalogProductTypeFilter !== "All") {
        params.set("product_type", unitCatalogProductTypeFilter);
      }
      if (unitCatalogCatalogFilter !== "All") {
        params.set("catalog_id", unitCatalogCatalogFilter);
      }
      if (unitCatalogApiFilterValue.trim()) {
        params.set(unitCatalogApiFilterParam, unitCatalogApiFilterValue.trim());
      }
      const response = await fetch(`${apiBaseUrl}/api/lift/product-catalog?${params.toString()}`);
      const payload = await readJsonResponse<{
        products: LiftUnitCatalogItem[];
        refreshed_count: number;
        refresh_error?: string | null;
        source: string;
      }>(response);
      setLiftUnitCatalog(payload.products);
      setWorkspaceMessage(
        payload.refresh_error
          ? `${payload.refresh_error}${
              payload.refresh_error.includes("401")
                ? " Check the selected Target Environment Basic Auth credentials; Postman is using PATHFINDER for this endpoint."
                : ""
            } Showing cached Lift products.`
          : `Lift product catalog refreshed. ${payload.refreshed_count} product${payload.refreshed_count === 1 ? "" : "s"} received.`
      );
      setUnitCatalogState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift product catalog refresh failed.");
      setUnitCatalogState("error");
    }
  }

  async function openJobDetail(job: ProcessingJobPreview) {
    if (activeGlobalView === "Customers") {
      setActiveCustomerView("Jobs");
    } else {
      setActiveGlobalView("Jobs");
    }
    setJobActionMenuOpen(false);
    setSelectedJobDetail(job);
    setSelectedJobAttempts([]);
    setOrderLookupResult(null);
    setOrderLookupState("idle");
    setProofReportResult(null);
    setProofReportState("idle");
    setPackageDetailsResult(null);
    setPackageDetailsState("idle");
    setOrderSnapshotResult(null);
    setOrderSnapshotState("idle");
    setStatusLinkResult(null);
    setStatusLinkState("idle");
    setJobDetailState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${job.customer_id}/jobs/${job.job_id}`);
      const payload = await readJsonResponse<{ job: ProcessingJobPreview; submit_attempts: SubmitAttempt[] }>(response);
      setSelectedJobDetail(payload.job);
      setSelectedJobAttempts(payload.submit_attempts);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Job detail load failed.");
      setJobDetailState("error");
      return;
    }
    setJobDetailState("idle");
  }

  function closeJobDetail() {
    setSelectedJobDetail(null);
    setSelectedJobAttempts([]);
    setJobActionMenuOpen(false);
    setOrderLookupResult(null);
    setOrderLookupState("idle");
    setProofReportResult(null);
    setProofReportState("idle");
    setPackageDetailsResult(null);
    setPackageDetailsState("idle");
    setOrderSnapshotResult(null);
    setOrderSnapshotState("idle");
    setStatusLinkResult(null);
    setStatusLinkState("idle");
  }

  function requestJobsArchive(jobs: ProcessingJobPreview[], archived: boolean) {
    if (!jobs.length) {
      setWorkspaceMessage("Choose at least one job.");
      return;
    }
    setDestructiveConfirmation({ kind: "jobs", jobs, archived });
  }

  async function updateJobsArchived(jobs: ProcessingJobPreview[], archived: boolean) {
    const jobsByCustomer = new globalThis.Map<string, ProcessingJobPreview[]>();
    for (const job of jobs) {
      jobsByCustomer.set(job.customer_id, [...(jobsByCustomer.get(job.customer_id) ?? []), job]);
    }

    setWorkspaceState("saving");
    try {
      const updatedJobs: ProcessingJobPreview[] = [];
      for (const [customerId, customerJobsToUpdate] of jobsByCustomer) {
        const response = await fetch(`${apiBaseUrl}/api/customers/${customerId}/jobs/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_ids: customerJobsToUpdate.map((job) => job.job_id),
            archived
          })
        });
        const payload = await readJsonResponse<{ updated_jobs: ProcessingJobPreview[] }>(response);
        updatedJobs.push(...payload.updated_jobs);
      }

      const updatedById = new globalThis.Map(updatedJobs.map((job) => [job.job_id, job]));
      setGlobalJobs((current) => current.map((job) => updatedById.get(job.job_id) ?? job));
      setWorkspace((current) =>
        current
          ? {
              ...current,
              jobs: current.jobs.map((job) => updatedById.get(job.job_id) ?? job)
            }
          : current
      );
      setSelectedJobDetail((current) => (current ? updatedById.get(current.job_id) ?? current : current));
      setSelectedJobIds([]);
      if (archived && selectedJobDetail && updatedById.has(selectedJobDetail.job_id)) {
        closeJobDetail();
      }
      setWorkspaceMessage(
        `${updatedJobs.length} job${updatedJobs.length === 1 ? "" : "s"} ${archived ? "archived" : "restored"}.`
      );
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Job archive update failed.");
      setWorkspaceState("error");
    }
  }

  async function lookupLiftOrder(job: ProcessingJobPreview) {
    setOrderLookupState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${job.customer_id}/jobs/${job.job_id}/order-lookup`);
      const payload = await readJsonResponse<{ lookup: LiftOrderLookupResult }>(response);
      setOrderLookupResult(payload.lookup);
      setWorkspaceMessage(`Lift order lookup loaded for ${payload.lookup.order_number}.`);
      setOrderLookupState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift order lookup failed.");
      setOrderLookupState("error");
    }
  }

  async function lookupLiftProofs(job: ProcessingJobPreview) {
    setProofReportState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${job.customer_id}/jobs/${job.job_id}/proof-report`);
      const payload = await readJsonResponse<{ proof_report: LiftProofReportResult }>(response);
      setProofReportResult(payload.proof_report);
      setWorkspaceMessage(`Lift proof report loaded for ${payload.proof_report.order_number}.`);
      setProofReportState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift proof report lookup failed.");
      setProofReportState("error");
    }
  }

  async function lookupLiftPackages(job: ProcessingJobPreview) {
    setPackageDetailsState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${job.customer_id}/jobs/${job.job_id}/package-details`);
      const payload = await readJsonResponse<{ package_details: LiftPackageDetailsResult }>(response);
      setPackageDetailsResult(payload.package_details);
      setWorkspaceMessage(`Lift package details loaded for ${payload.package_details.order_number}.`);
      setPackageDetailsState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift package details lookup failed.");
      setPackageDetailsState("error");
    }
  }

  async function loadOrderSnapshot(job: ProcessingJobPreview) {
    setOrderSnapshotState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${job.customer_id}/jobs/${job.job_id}/order-snapshot`);
      const payload = await readJsonResponse<{
        snapshot: PathfinderOrderSnapshot;
        refresh?: OrderSnapshotRefreshMetadata;
      }>(response);
      setOrderSnapshotResult(payload.snapshot);
      setWorkspaceMessage(
        payload.refresh?.source === "recent_snapshot"
          ? `Recent order snapshot reused for ${payload.snapshot.order_number}; another Lift check will be available shortly.`
          : `Order refreshed from Lift for ${payload.snapshot.order_number}.`
      );
      setOrderSnapshotState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Pathfinder order snapshot failed.");
      setOrderSnapshotState("error");
    }
  }

  async function createStatusLink(job: ProcessingJobPreview) {
    setStatusLinkState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${job.customer_id}/jobs/${job.job_id}/status-link`, {
        method: "POST"
      });
      const payload = await readJsonResponse<PublicStatusLinkResult>(response);
      setStatusLinkResult(payload);
      setWorkspaceMessage(`Public status link created for ${payload.snapshot.order_number}.`);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload.status_url);
        setWorkspaceMessage(`Public status link copied for ${payload.snapshot.order_number}.`);
      }
      setStatusLinkState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Public status link creation failed.");
      setStatusLinkState("error");
    }
  }

  async function lookupInternalOrderStatus() {
    const orderNumber = internalOrderLookupNumber.trim();

    if (!orderNumber) {
      setWorkspaceMessage("Enter a Lift or source order number to look up.");
      setInternalOrderLookupState("error");
      return;
    }

    setInternalOrderLookupState("loading");
    setInternalOrderLookupResult(null);
    try {
      const params = new URLSearchParams({ order_number: orderNumber });
      const response = await fetch(`${apiBaseUrl}/api/order-status/lookup?${params.toString()}`);
      const payload = await readJsonResponse<InternalOrderStatusLookupResult>(response);
      const matchedJob = allJobs.find(
        (job) => job.customer_id === payload.match.customer_id && job.job_id === payload.match.job_id
      );

      if (matchedJob) {
        await openJobDetail(matchedJob);
      }

      setOrderSnapshotResult(payload.snapshot);
      setOrderSnapshotState("idle");
      setInternalOrderLookupResult(payload);
      setWorkspaceMessage(`Order status loaded for ${payload.snapshot.order_number}.`);
      setInternalOrderLookupState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Internal order lookup failed.");
      setInternalOrderLookupState("error");
    }
  }

  function startCanonicalFieldEdit(field: CanonicalFieldDefinition) {
    setEditingCanonicalFieldId(field.field_id);
    setCanonicalFieldDraft({
      path: field.path,
      label: field.label,
      description: field.description ?? "",
      aliases: field.aliases.join(", "),
      status: field.status
    });
  }

  function openCanonicalImpactReview(action: CanonicalImpactAction, field: CanonicalRegistryField, nextPath?: string) {
    setCanonicalImpactReview({ action, field, nextPath });
  }

  async function confirmCanonicalImpactReview() {
    const review = canonicalImpactReview;
    if (!review) {
      return;
    }

    setCanonicalImpactReview(null);
    if (review.action === "metadata") {
      await performCanonicalFieldEdit(review.field);
    } else if (review.action === "rename" && review.nextPath) {
      await performCanonicalRegistryFieldPathRename(review.field, review.nextPath);
    } else if (review.action === "remove") {
      await performCanonicalRegistryFieldDelete(review.field);
    }
  }

  function saveCanonicalFieldEdit(field: CanonicalRegistryField) {
    openCanonicalImpactReview("metadata", field);
  }

  async function performCanonicalFieldEdit(field: CanonicalFieldDefinition) {
    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/canonical-registry/fields/${field.field_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: canonicalFieldDraft.label,
          description: canonicalFieldDraft.description,
          aliases: canonicalFieldDraft.aliases,
          status: canonicalFieldDraft.status
        })
      });
      const registry = await readJsonResponse<CanonicalRegistryPayload>(response);
      setCanonicalRegistry(registry);
      setEditingCanonicalFieldId(null);
      setWorkspaceMessage(`Canonical field saved: ${canonicalFieldDraft.label.trim() || field.label}.`);
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Canonical field save failed.");
      setWorkspaceState("error");
    }
  }

  async function createCanonicalRegistryField() {
    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/canonical-registry/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newCanonicalFieldDraft,
          status: "Draft"
        })
      });
      const registry = await readJsonResponse<CanonicalRegistryPayload>(response);
      setCanonicalRegistry(registry);
      setCanonicalRegistrySectionFilter(newCanonicalFieldDraft.section);
      setCanonicalRegistrySearch(newCanonicalFieldDraft.path);
      setNewCanonicalFieldDraft({
        path: "",
        section: "order",
        label: "",
        data_type: "string",
        description: "",
        aliases: "",
        required: false,
        repeatable: false
      });
      setIsCreatingCanonicalField(false);
      setWorkspaceMessage("Draft canonical field created.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Canonical field creation failed.");
      setWorkspaceState("error");
    }
  }

  function deleteCanonicalRegistryField(field: CanonicalRegistryField) {
    if (field.origin !== "custom" || field.status !== "Draft") {
      setWorkspaceMessage("Only Draft custom canonical fields can be removed.");
      return;
    }
    openCanonicalImpactReview("remove", field);
  }

  async function performCanonicalRegistryFieldDelete(field: CanonicalRegistryField) {
    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/canonical-registry/fields/${field.field_id}`, {
        method: "DELETE"
      });
      const registry = await readJsonResponse<CanonicalRegistryPayload>(response);
      setCanonicalRegistry(registry);
      setEditingCanonicalFieldId(null);
      setWorkspaceMessage(`Draft canonical field removed: ${field.label}.`);
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Canonical field removal failed.");
      setWorkspaceState("error");
    }
  }

  function renameCanonicalRegistryFieldPath(field: CanonicalRegistryField) {
    const nextPath = canonicalFieldDraft.path.trim();
    if (field.origin !== "custom") {
      setWorkspaceMessage("Only custom canonical fields can be renamed.");
      return;
    }
    if (!nextPath || nextPath === field.path) {
      return;
    }
    openCanonicalImpactReview("rename", field, nextPath);
  }

  async function performCanonicalRegistryFieldPathRename(field: CanonicalRegistryField, nextPath: string) {
    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/canonical-registry/fields/${field.field_id}/path`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: nextPath })
      });
      const registry = await readJsonResponse<CanonicalRegistryPayload & { migration?: { usage?: CanonicalRegistryField["usage"] } }>(
        response
      );
      setCanonicalRegistry(registry);
      setEditingCanonicalFieldId(null);
      setCanonicalRegistrySearch(nextPath);
      setWorkspaceMessage(`Canonical path renamed to ${nextPath}. ${registry.migration?.usage?.total ?? 0} saved references migrated.`);
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Canonical path rename failed.");
      setWorkspaceState("error");
    }
  }

  async function saveImportMethod(method: ImportMethod, nextMappings = mappings) {
    const normalizedName = method.name.trim();
    if (!normalizedName) {
      setWorkspaceMessage("Enter a method name before saving.");
      return false;
    }

    if (!outputRoutes.some((route) => route.output_route_id === method.output_route_id)) {
      setWorkspaceMessage("Choose a valid output route before saving.");
      return false;
    }

    if (sourceSchemaIsStale(method.source_config.detected_schema ?? null, method.source_config)) {
      setWorkspaceMessage("Re-detect the source schema after parser changes before saving this method.");
      return false;
    }

    if (
      method.order_name_resolution_config.enabled &&
      method.order_name_resolution_config.strategy !== "provided" &&
      method.order_name_resolution_config.components.length === 0
    ) {
      setWorkspaceMessage("Add at least one canonical component before saving this Order Name Resolution strategy.");
      return false;
    }

    const isLocalDraft = localDraftImportMethodIds.includes(method.import_method_id);
    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/import-methods/${method.import_method_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...method, name: normalizedName, mappings: nextMappings })
        }
      );
      const nextWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      const savedMethod = nextWorkspace.import_methods.find(
        (candidate) => candidate.import_method_id === method.import_method_id
      );
      setWorkspace(nextWorkspace);
      setMappings(savedMethod?.mappings ?? nextMappings);
      setDirtyImportMethodIds((current) => current.filter((methodId) => methodId !== method.import_method_id));
      setLocalDraftImportMethodIds((current) => current.filter((methodId) => methodId !== method.import_method_id));
      setWorkspaceMessage(isLocalDraft ? "Import method created." : "Import method saved.");
      setWorkspaceState("idle");
      return true;
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Import method save failed.");
      setWorkspaceState("error");
      return false;
    }
  }

  async function createPreviewJob() {
    const method = manualImportMethod;
    const isAdHoc = manualImportMethodId === "ad-hoc";
    if (!method && !isAdHoc) {
      setWorkspaceMessage("Choose an Import Method or use ad-hoc manual mapping before generating a preview job.");
      return;
    }
    if (!sourceGrid.rows.length || !parsedOrderRows.length) {
      setWorkspaceMessage("Upload an order workbook with at least one valid quantity row before generating a preview job.");
      return;
    }
    if (method && method.status !== "Active") {
      setWorkspaceMessage("Activate this import method before generating a preview job.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/jobs/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_method_id: method?.import_method_id ?? "ad-hoc",
          output_route_id: activeOutputRoute.output_route_id,
          source_file_name: sourceName,
          sheet_name: sheetName,
          source_grid: sourceGrid,
          source_sheets: sourceSheets,
          parsed_order_rows: parsedOrderRows,
          reference_rows: referenceRows,
          mappings,
          submit_profile_id: selectedSubmitProfile.profile_id,
          product_resolution_config: method?.product_resolution_config ?? defaultProductResolutionConfig,
          order_name_resolution_config: method?.order_name_resolution_config ?? defaultOrderNameResolutionConfig,
          ext_id_strategy: method?.ext_id_strategy ?? "pathfinder_generated"
        })
      });
      const payload = await readJsonResponse<{ job: ProcessingJobPreview; workspace: PathfinderCustomerWorkspace }>(response);
      setLastPreviewJob(payload.job);
      setLastSubmitAttempt(null);
      setWorkspace(payload.workspace);
      setWorkspaceMessage(
        payload.job.state === "Ready"
          ? "Preview job created and ready for Lift submit review."
          : payload.job.state === "Needs Mapping"
            ? "Preview job created. Resolve product mappings before Lift submit review."
            : "Preview job created with blocking validation failures."
      );
      await loadTargetsAndJobs();
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Preview job failed.");
      setWorkspaceState("error");
    }
  }

  async function refreshSubmitCertification(job: ProcessingJobPreview, showMessage = false) {
    setCertificationRefreshState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${job.customer_id}/jobs/${job.job_id}/certification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const payload = await readJsonResponse<{ job: ProcessingJobPreview }>(response);
      setLastPreviewJob((current) => (current?.job_id === payload.job.job_id ? payload.job : current));
      setSelectedJobDetail((current) => (current?.job_id === payload.job.job_id ? payload.job : current));
      setWorkspace((current) => (current ? { ...current, jobs: upsertJob(current.jobs, payload.job) } : current));
      setGlobalJobs((current) => upsertJob(current, payload.job));
      if (showMessage) {
        const blockingCount = payload.job.submit_certification?.items.filter((item) => item.blocking).length ?? 0;
        setWorkspaceMessage(
          blockingCount
            ? `Submit certification refreshed. ${blockingCount} item${blockingCount === 1 ? "" : "s"} still blocking.`
            : "Submit certification refreshed. This preview is certified for submit."
        );
      }
      setCertificationRefreshState("idle");
    } catch (error) {
      if (showMessage) {
        setWorkspaceMessage(error instanceof Error ? error.message : "Submit certification refresh failed.");
      }
      setCertificationRefreshState("error");
    }
  }

  async function persistOutputRoute(route: OutputRoute) {
    const response = await fetch(
      `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/output-routes/${route.output_route_id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(route)
      }
    );
    return readJsonResponse<PathfinderCustomerWorkspace>(response);
  }

  async function saveTarget(target: TargetConfig) {
    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/targets/${target.target_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target)
      });
      const savedTarget = await readJsonResponse<TargetConfig>(response);
      setTargets((current) => [savedTarget, ...current.filter((candidate) => candidate.target_id !== savedTarget.target_id)]);
      const savedActiveEnvironment = savedTarget.environments.find(
        (environment) =>
          environment.name === savedTarget.lift.active_environment ||
          environmentRoleKey(environment.name, environment.role) === savedTarget.lift.active_environment
      );
      let nextWorkspace =
        workspace && workspace.primary_target?.target_id === savedTarget.target_id
          ? { ...workspace, primary_target: savedTarget }
          : workspace;

      if (savedActiveEnvironment && nextWorkspace) {
        const routesToSync = nextWorkspace.output_routes.filter(
          (route) => route.target_id === savedTarget.target_id && route.environment_id !== savedActiveEnvironment.environment_id
        );
        for (const route of routesToSync) {
          nextWorkspace = await persistOutputRoute({
            ...route,
            environment_id: savedActiveEnvironment.environment_id
          });
        }
      }

      if (nextWorkspace) {
        const dirtyRoutesToPersist = nextWorkspace.output_routes.filter(
          (route) => route.target_id === savedTarget.target_id && dirtyOutputRouteIds.includes(route.output_route_id)
        );
        for (const route of dirtyRoutesToPersist) {
          nextWorkspace = await persistOutputRoute(route);
        }
      }

      setWorkspace((current) => {
        if (!current) {
          return current;
        }
        return nextWorkspace ? { ...nextWorkspace, primary_target: savedTarget } : { ...current, primary_target: savedTarget };
      });
      setDirtyTargetIds((current) => current.filter((targetId) => targetId !== savedTarget.target_id));
      setLocalDraftTargetIds((current) => current.filter((targetId) => targetId !== savedTarget.target_id));
      setDirtyOutputRouteIds((current) => {
        const savedRouteIds = new Set(
          (nextWorkspace?.output_routes ?? workspace?.output_routes ?? [])
            .filter((route) => route.target_id === savedTarget.target_id)
            .map((route) => route.output_route_id)
        );
        return current.filter((routeId) => !savedRouteIds.has(routeId));
      });
      setRouteStrategyChanges((current) => {
        const next = { ...current };
        (nextWorkspace?.output_routes ?? workspace?.output_routes ?? [])
          .filter((route) => route.target_id === savedTarget.target_id)
          .forEach((route) => delete next[route.output_route_id]);
        return next;
      });
      setWorkspaceMessage(
        savedActiveEnvironment
          ? `Target settings saved. Current workspace routes now use ${savedActiveEnvironment.name}.`
          : "Target settings saved."
      );
      setWorkspaceState("idle");
      return true;
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Target save failed.");
      setWorkspaceState("error");
      return false;
    }
  }

  function applyCatalogPreset(preset: LiftCatalogPreset) {
    setUnitCatalogCatalogFilter("All");
    setUnitCatalogApiFilterParam("catalog_id");
    setUnitCatalogApiFilterValue(preset.catalog_id);
    setCatalogPresetId(preset.catalog_id);
    setWorkspaceMessage(`Catalog preset selected: ${preset.catalog_name} / ${preset.catalog_id}.`);
  }

  async function saveCatalogPreset() {
    if (!workspace) {
      return;
    }
    const catalogId =
      catalogPresetId.trim() ||
      (unitCatalogApiFilterParam === "catalog_id" ? unitCatalogApiFilterValue.trim() : unitCatalogCatalogFilter !== "All" ? unitCatalogCatalogFilter : "");
    const catalogName =
      liftUnitCatalog.find((item) => item.catalog_id === catalogId)?.catalog_name ||
      unitCatalogCatalogOptions.find(([candidateId]) => candidateId === catalogId)?.[1] ||
      routeCatalogPresets.find((preset) => preset.catalog_id === catalogId)?.catalog_name ||
      (unitCatalogApiFilterParam === "catalog_name" ? unitCatalogApiFilterValue.trim() : "") ||
      `Lift catalog ${catalogId}`;

    if (!catalogId) {
      setWorkspaceMessage("Enter a catalog ID before saving a catalog preset.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const presetId = `catalog-preset-${selectedCustomer.lift_customer_id}-${selectedOutputMapRoute.output_route_id}-${slugify(catalogId)}`;
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/catalog-presets/${presetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset_id: presetId,
          output_route_id: selectedOutputMapRoute.output_route_id,
          target_id: selectedOutputMapRoute.target_id,
          catalog_id: catalogId,
          catalog_name: catalogName,
          status: "Active"
        })
      });
      const payload = await readJsonResponse<{ catalog_presets: LiftCatalogPreset[] }>(response);
      setWorkspace((current) => (current ? { ...current, catalog_presets: payload.catalog_presets } : current));
      setCatalogPresetId(catalogId);
      setWorkspaceMessage(`Catalog preset saved: ${catalogName} / ${catalogId}.`);
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Catalog preset save failed.");
      setWorkspaceState("error");
    }
  }

  async function deleteCatalogPreset(preset: LiftCatalogPreset) {
    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/catalog-presets/${preset.preset_id}`,
        { method: "DELETE" }
      );
      const payload = await readJsonResponse<{ catalog_presets: LiftCatalogPreset[] }>(response);
      setWorkspace((current) => (current ? { ...current, catalog_presets: payload.catalog_presets } : current));
      setWorkspaceMessage(`Catalog preset removed: ${preset.catalog_name}.`);
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Catalog preset delete failed.");
      setWorkspaceState("error");
    }
  }

  useEffect(() => {
    void loadCustomers();
  }, []);

  useEffect(() => {
    void loadTargetsAndJobs();
  }, []);

  useEffect(() => {
    void loadCanonicalRegistry();
  }, []);

  useEffect(() => {
    void loadEmailStatus();
  }, []);

  useEffect(() => {
    void loadSubmitRuntime();
  }, []);

  useEffect(() => {
    function dismissButtonMenus(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-button-menu-root]")) {
        return;
      }
      setOpenTopbarMenu(null);
      setJobActionMenuOpen(false);
    }

    function dismissButtonMenusOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenTopbarMenu(null);
        setJobActionMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", dismissButtonMenus);
    document.addEventListener("keydown", dismissButtonMenusOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissButtonMenus);
      document.removeEventListener("keydown", dismissButtonMenusOnEscape);
    };
  }, []);

  useEffect(() => {
    setSelectedJobIds([]);
  }, [activeGlobalView, activeCustomerView, selectedCustomerId, jobArchiveFilter, jobIntakeFilter]);

  useEffect(() => {
    const isJobViewActive =
      activeGlobalView === "Jobs" ||
      (activeGlobalView === "Customers" && activeCustomerView === "Jobs");
    const isDifferentCustomer =
      activeGlobalView === "Customers" && selectedJobDetail?.customer_id !== selectedCustomerId;
    if (selectedJobDetail && (!isJobViewActive || isDifferentCustomer)) {
      closeJobDetail();
    }
  }, [activeGlobalView, activeCustomerView, selectedCustomerId]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const oauthResult = currentUrl.searchParams.get("wrike_oauth");
    if (oauthResult !== "connected" && oauthResult !== "error") {
      return;
    }

    const reason = currentUrl.searchParams.get("reason");
    const customerId = currentUrl.searchParams.get("wrike_customer_id") ?? "";
    const connectionId = currentUrl.searchParams.get("wrike_connection_id") ?? "";
    const errorMessages: Record<string, string> = {
      invalid_state: "Wrike authorization could not be verified. Start a new connection attempt.",
      expired: "The Wrike authorization window expired. Start a new connection attempt.",
      denied: "Wrike authorization was cancelled or denied.",
      incomplete: "Wrike did not return a complete authorization response.",
      exchange: "Wrike authorization could not be completed. Start a new connection attempt."
    };
    wrikeOAuthReturnMessageRef.current = oauthResult === "connected"
      ? "Wrike is connected with read-only OAuth access. No task, attachment, job, webhook, or Lift action was performed."
      : errorMessages[reason ?? ""] ?? "Wrike authorization could not be completed.";
    setWrikeConnectionMessage(wrikeOAuthReturnMessageRef.current);
    setWrikeConnectionState(oauthResult === "connected" ? "idle" : "error");
    wrikeOAuthReturnConnectionIdRef.current = connectionId;
    if (customerId) {
      setSelectedCustomerId(customerId);
    }
    if (connectionId) {
      setSelectedSourceConnectionId(connectionId);
    }
    setActiveGlobalView("Customers");
    setActiveCustomerView("Settings");

    currentUrl.searchParams.delete("wrike_oauth");
    currentUrl.searchParams.delete("reason");
    currentUrl.searchParams.delete("wrike_customer_id");
    currentUrl.searchParams.delete("wrike_connection_id");
    window.history.replaceState({}, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
  }, []);

  useEffect(() => {
    if (activeGlobalView === "Settings") {
      void loadEmailStatus();
    }
  }, [activeGlobalView]);

  const selectedCustomer =
    customers.find((customer) => customer.lift_customer_id === selectedCustomerId) ?? fallbackCustomer;
  const statusAccessPolicy = statusPolicyDraft ?? workspace?.status_access_policy ?? createStatusAccessPolicyFallback(selectedCustomer);
  const statusAccessDomains = statusAccessPolicy.approved_email_domains ?? [];
  const approvedStatusDomainCount = statusAccessDomains.filter((domain) => domain.status === "Approved").length;
  const suggestedStatusDomainCount = statusAccessDomains.filter((domain) => domain.status === "Suggested").length;
  const blockedStatusDomainCount = statusAccessDomains.filter((domain) => domain.status === "Blocked").length;
  useEffect(() => {
    if (selectedCustomerId) {
      void loadWorkspace(selectedCustomerId);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    setStatusPolicyDraft(workspace?.status_access_policy ?? createStatusAccessPolicyFallback(selectedCustomer));
    setNewStatusDomain("");
    setNewStatusDomainStatus("Approved");
  }, [selectedCustomer, workspace?.status_access_policy]);

  useEffect(() => {
    if (!lastPreviewJob || activeGlobalView !== "Customers" || activeCustomerView !== "Manual Import") {
      return;
    }

    const refreshKey = `${lastPreviewJob.job_id}:${activeGlobalView}:${activeCustomerView}`;
    if (certificationRefreshKeyRef.current === refreshKey) {
      return;
    }

    certificationRefreshKeyRef.current = refreshKey;
    void refreshSubmitCertification(lastPreviewJob);
  }, [activeCustomerView, activeGlobalView, lastPreviewJob?.job_id]);

  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) {
      return customers;
    }
    return customers.filter(
      (customer) =>
        customer.customer_name.toLowerCase().includes(query) ||
        customer.lift_customer_id.includes(query) ||
        (customer.customer_number ?? "").includes(query) ||
        (customer.crm_id ?? "").toLowerCase().includes(query) ||
        (customer.terms ?? "").toLowerCase().includes(query) ||
        (customer.terms_status ?? "").toLowerCase().includes(query)
    );
  }, [customerSearch, customers]);
  const customerSelectOptions = useMemo(() => {
    if (filteredCustomers.some((customer) => customer.lift_customer_id === selectedCustomer.lift_customer_id)) {
      return filteredCustomers;
    }
    return [selectedCustomer, ...filteredCustomers];
  }, [filteredCustomers, selectedCustomer]);
  const visibleCustomerOptions = customerSelectOptions.slice(0, 8);
  const customerComboboxValue = isCustomerPickerOpen
    ? customerSearch
    : `${selectedCustomer.customer_name} · ${selectedCustomer.lift_customer_id}`;
  const allImportMethods = workspace?.import_methods ?? [];
  const importMethods = useMemo(
    () => allImportMethods.filter((method) => method.status !== "Archived"),
    [allImportMethods]
  );
  const activeImportMethod =
    importMethods.find((method) => method.import_method_id === activeMethodId) ?? importMethods[0] ?? allImportMethods[0];
  const activeManualImportMethods = useMemo(
    () => importMethods.filter((method) => method.status === "Active"),
    [importMethods]
  );
  const manualImportMethod =
    manualImportMethodId === "ad-hoc"
      ? null
      : activeManualImportMethods.find((method) => method.import_method_id === manualImportMethodId) ??
        activeManualImportMethods[0] ??
        null;
  const workflowImportMethod =
    activeGlobalView === "Customers" && activeCustomerView === "Manual Import"
      ? manualImportMethod
      : activeImportMethod;
  const activeImportMethodHasUnsavedChanges = activeImportMethod
    ? dirtyImportMethodIds.includes(activeImportMethod.import_method_id)
    : false;
  const activeWrikeConfig = normalizeWrikeSourceConfig(
    activeImportMethod?.source_config.wrike ?? createDefaultWrikeSourceConfig()
  );
  const selectedSourceConnection =
    sourceConnections.find((connection) => connection.connection_id === selectedSourceConnectionId) ?? null;
  const selectedWrikeConnection = selectedSourceConnection?.provider === "wrike" ? selectedSourceConnection : null;
  const selectedWrikeConnectionStatus = selectedWrikeConnection?.provider_status ?? null;
  const activeWrikeConnection =
    sourceConnections.find(
      (connection) =>
        connection.connection_id === activeWrikeConfig.connection_id && connection.provider === "wrike"
    ) ?? null;
  const activeWrikeConnectionStatus = activeWrikeConnection?.provider_status ?? null;
  const activeWrikeReadiness = getWrikeContractReadiness(activeWrikeConfig);
  const activeWrikeQaReadiness = evaluateWrikeReadOnlyQaReadiness({
    config: activeWrikeConfig,
    method_saved: Boolean(activeImportMethod) && !activeImportMethodHasUnsavedChanges,
    connection_configured: Boolean(activeWrikeConnectionStatus?.configured),
    connection_test_enabled: Boolean(activeWrikeConnectionStatus?.connection_test_enabled),
    discovery_preview_enabled: Boolean(activeWrikeConnectionStatus?.discovery_preview_enabled),
    identity_confirmed: Boolean(activeWrikeConnectionStatus?.health.identity_confirmed)
  });
  useEffect(() => {
    setWrikeDiscoveryPreview(null);
    setWrikeDiscoveryMessage(null);
    setWrikeDiscoveryState("idle");
    if (isImportMethodDetailOpen && activeImportMethod?.source === "Wrike" && selectedCustomerId) {
      void loadSourceConnections(selectedCustomerId, activeWrikeConfig.connection_id);
    }
  }, [activeImportMethod?.import_method_id, activeImportMethod?.source, isImportMethodDetailOpen, selectedCustomerId]);
  const activeProductConfig = workflowImportMethod?.product_resolution_config ?? defaultProductResolutionConfig;
  const activeOrderNameConfig =
    workflowImportMethod?.order_name_resolution_config ?? defaultOrderNameResolutionConfig;
  const activeOrderNameStrategyCopy =
    !activeOrderNameConfig.enabled
      ? {
          title: "Legacy pass-through is active",
          body: "Pathfinder leaves the mapped order.order_title unchanged. Enable resolution when this Import Method is ready to enforce a provided or composite name."
        }
      : activeOrderNameConfig.strategy === "provided"
      ? {
          title: "Use the customer's mapped order title",
          body: "Pathfinder preserves the mapped order.order_title value. A missing value blocks the preview instead of inventing a name."
        }
      : activeOrderNameConfig.strategy === "composite"
        ? {
            title: "Always build a deterministic composite",
            body: "Pathfinder combines the ordered canonical components below and ignores a provided title."
          }
        : {
            title: "Prefer the customer title, then fall back safely",
            body: "Pathfinder uses a mapped order.order_title when present, otherwise it builds the configured deterministic composite."
          };
  const activeResolverCopy = productResolverCopy(activeProductConfig.strategy);
  const activeResolutionModeCopy = resolutionModeCopy(activeProductConfig.mode);
  const activeResolverSummary =
    activeProductConfig.strategy === "direct_lift_unit_number"
      ? `Direct from ${activeProductConfig.direct_unit_number_column ?? activeProductConfig.source_column}`
      : activeProductConfig.strategy === "composite_key"
        ? `Composite key from ${activeProductConfig.composite_columns.length} columns`
        : `Derived key from ${activeProductConfig.source_column}`;
  const productExampleTestColumn =
    activeProductConfig.strategy === "direct_lift_unit_number"
      ? activeProductConfig.direct_unit_number_column ?? activeProductConfig.source_column
      : activeProductConfig.source_column;
  const availableInputColumns = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...sourceGrid.columns,
            activeProductConfig.source_column,
            activeProductConfig.direct_unit_number_column,
            ...activeProductConfig.composite_columns
          ].filter((column): column is string => Boolean(column))
        )
      ),
    [activeProductConfig, sourceGrid.columns]
  );
  const sourceConfig = workflowImportMethod?.source_config ?? {};
  const detectedSourceSchema = sourceConfig.detected_schema ?? null;
  const detectedSourceSchemaHistory = sourceConfig.detected_schema_history ?? [];
  const selectedSourceSchemaHistory =
    detectedSourceSchemaHistory.find((schema) => schema.detected_at === selectedSourceSchemaHistoryDetectedAt) ??
    detectedSourceSchemaHistory[0] ??
    null;
  const selectedSourceSchemaComparison =
    detectedSourceSchema && selectedSourceSchemaHistory
      ? sourceSchemaComparison(detectedSourceSchema, selectedSourceSchemaHistory)
      : null;
  const sourceHeaderRow = sourceConfig.header_row ?? null;
  const sourceHeaderRowCount = sourceConfig.header_row_count ?? 1;
  const sourceQuantityColumn =
    sourceConfig.quantity_column ??
    sourceGrid.columns.find((column) => normalizeSearchText(column) === "print qty") ??
    sourceGrid.columns.find((column) => ["qty", "quantity"].includes(normalizeSearchText(column))) ??
    "";
  const sourceIgnoresRepeatedHeaders = sourceConfig.ignore_repeated_headers ?? true;
  const sourceReferenceRowsMode = sourceConfig.reference_rows_mode ?? "rows_without_quantity";
  const detectedSelectedSheet = detectedSourceSchema?.sheets.find(
    (sheet) => sheet.sheet_name === detectedSourceSchema.selected_sheet_name
  );
  const configuredSourceSchemaSheet =
    detectedSourceSchema?.sheets.find((sheet) => sheet.sheet_name === selectedSourceSchemaSheetName) ??
    detectedSelectedSheet ??
    detectedSourceSchema?.sheets[0];
  const selectedSourceSheetOverride = configuredSourceSchemaSheet
    ? sourceConfig.sheet_header_overrides?.[configuredSourceSchemaSheet.sheet_name]
    : undefined;
  const sourceHeaderDisplay = sourceHeaderRow
    ? `Row ${sourceHeaderRow}`
    : detectedSelectedSheet?.header_row
      ? `Auto · row ${detectedSelectedSheet.header_row}`
      : "Auto-detect";
  const detectedSourceSchemaIsStale = sourceSchemaIsStale(detectedSourceSchema, sourceConfig);
  const detectedOrderRowCount = detectedSourceSchema?.sheets.reduce((total, sheet) => total + sheet.order_row_count, 0) ?? 0;
  const detectedReferenceRowCount =
    detectedSourceSchema?.sheets.reduce((total, sheet) => total + sheet.reference_row_count, 0) ?? 0;
  const sourceOrderRowCount = detectedSourceSchema
    ? detectedOrderRowCount
    : parsedOrderRows.length || sourceGrid.rows.length;
  const sourceReferenceRowCount = detectedSourceSchema ? detectedReferenceRowCount : referenceRows.length;
  const isUsingSampleSource = !detectedSourceSchema && sourceName === "Sample workbook";
  const hasSourceContext = sourceGrid.columns.length > 0;
  const sourceColumnOrigin = detectedSourceSchema
    ? "Detected workbook schema"
    : isUsingSampleSource
      ? "Sample/demo columns"
      : hasSourceContext
        ? "Loaded workbook columns"
        : "No source loaded";
  const sourceColumnOriginDetail = detectedSourceSchema
    ? `${detectedSourceSchema.source_file_name} · ${detectedSourceSchema.columns.length} columns · detected ${displayTimestamp(detectedSourceSchema.detected_at)}`
    : isUsingSampleSource
      ? "Detect a customer template here to replace these clearly labeled starter columns."
      : hasSourceContext
        ? `${sourceName || "Current source"} · ${sourceGrid.columns.length} columns`
        : "Upload a customer template or explicitly choose the sample columns to begin mapping.";
  const addableCompositeColumns = availableInputColumns.filter(
    (column) => !activeProductConfig.composite_columns.includes(column)
  );
  const customerJobsUnfiltered = workspace?.jobs ?? [];
  const customerJobs = sortAndFilterJobs(
    customerJobsUnfiltered,
    jobArchiveFilter,
    jobIntakeFilter,
    jobSortField,
    jobSortDirection
  );
  const overviewJobs = customerJobsUnfiltered.filter((job) => !job.archived_at).slice(0, 5);
  const allJobsUnfiltered = globalJobs.length ? globalJobs : customerJobsUnfiltered;
  const allJobs = sortAndFilterJobs(
    allJobsUnfiltered,
    jobArchiveFilter,
    jobIntakeFilter,
    jobSortField,
    jobSortDirection
  );
  const currentJobList = activeGlobalView === "Jobs" ? allJobs : customerJobs;
  const selectedJobs = currentJobList.filter((job) => selectedJobIds.includes(job.job_id));
  const visibleJobDetailAttempts = selectedJobAttempts.length
    ? selectedJobAttempts
    : (workspace?.submit_attempts ?? []).filter((attempt) => attempt.job_id === selectedJobDetail?.job_id);
  const latestJobAttempt = visibleJobDetailAttempts[0] ?? null;
  const canRetrySelectedJob =
    selectedJobDetail?.state === "Ready" || selectedJobDetail?.state === "Submit Failed";
  const selectedJobMissingOrderTitle = Boolean(
    canRetrySelectedJob && !selectedJobDetail?.lift_payload.order.order_title?.trim()
  );
  const primaryTarget = workspace?.primary_target ?? targets[0];
  const targetRows = targets.length ? targets : primaryTarget ? [primaryTarget] : [];
  const outputRoutes = workspace?.output_routes?.length ? workspace.output_routes : [defaultOutputRoute];
  const primaryOutputRoute =
    outputRoutes.find((route) => route.output_route_id === workspace?.primary_output_route_id) ??
    outputRoutes[0] ??
    defaultOutputRoute;
  const primaryRouteTarget =
    targetRows.find((target) => target.target_id === primaryOutputRoute.target_id) ?? primaryTarget ?? null;
  const primaryRouteEnvironment =
    primaryRouteTarget?.environments.find((environment) => environment.environment_id === primaryOutputRoute.environment_id) ??
    primaryRouteTarget?.environments.find((environment) => environment.name === primaryRouteTarget.lift.active_environment) ??
    null;
  const primaryRouteTemplate =
    primaryRouteTarget?.output_templates.find((template) => template.output_template_id === primaryOutputRoute.output_template_id) ??
    primaryRouteTarget?.output_templates.find((template) => template.name === primaryOutputRoute.output_template) ??
    null;
  const primaryRouteCompanyId =
    primaryOutputRoute.company_id ?? primaryRouteEnvironment?.headers.Company ?? primaryRouteTarget?.lift.headers.Company;
  const primaryRouteAuth =
    primaryRouteEnvironment?.auth_method && primaryRouteEnvironment.auth_method !== "None"
      ? primaryRouteEnvironment.auth_method
      : primaryRouteEnvironment?.credentials.User || primaryRouteEnvironment?.credentials.Password
        ? "Header credentials"
        : "None";
  const primaryRouteDiagnostics = buildRouteDiagnostics({
    target: primaryRouteTarget,
    route: primaryOutputRoute,
    environment: primaryRouteEnvironment,
    template: primaryRouteTemplate
  });
  const selectedTarget = selectedTargetId
    ? targetRows.find((target) => target.target_id === selectedTargetId) ?? null
    : null;
  const targetEnvironments = selectedTarget?.environments ?? [];
  const targetOutputTemplates = selectedTarget?.output_templates ?? [];
  const selectedTargetRoutes = selectedTarget
    ? outputRoutes.filter((route) => route.target_id === selectedTarget.target_id)
    : [];
  const selectedTargetHasUnsavedChanges = selectedTarget
    ? dirtyTargetIds.includes(selectedTarget.target_id) ||
      selectedTargetRoutes.some((route) => dirtyOutputRouteIds.includes(route.output_route_id))
    : false;
  const selectedTargetTestRoute = selectedTargetRoutes[0] ?? null;
  const selectedTargetTestEnvironment =
    selectedTarget && selectedTargetTestRoute
      ? selectedTarget.environments.find((environment) => environment.environment_id === selectedTargetTestRoute.environment_id) ??
        selectedTarget.environments.find((environment) => environment.name === selectedTarget.lift.active_environment) ??
        null
      : null;
  const selectedTargetTestTemplate =
    selectedTarget && selectedTargetTestRoute
      ? selectedTarget.output_templates.find((template) => template.output_template_id === selectedTargetTestRoute.output_template_id) ??
        selectedTarget.output_templates.find((template) => template.name === selectedTargetTestRoute.output_template) ??
        selectedTarget.output_templates[0] ??
        null
      : null;
  const selectedOutputTemplate =
    targetOutputTemplates.find((template) => template.output_template_id === activeOutputTemplateId) ??
    targetOutputTemplates[0] ??
    null;
  const destructiveConfirmationCopy = destructiveConfirmation
    ? destructiveConfirmation.kind === "import-method"
      ? localDraftImportMethodIds.includes(destructiveConfirmation.method.import_method_id)
        ? {
            eyebrow: "Import Method",
            title: "Discard this Import Method draft?",
            item: destructiveConfirmation.method.name,
            body: "This draft has not been saved. Discarding it removes the local setup and cannot be undone.",
            confirmLabel: "Discard Draft"
          }
        : {
            eyebrow: "Import Method",
            title: "Archive this Import Method?",
            item: destructiveConfirmation.method.name,
            body: dirtyImportMethodIds.includes(destructiveConfirmation.method.import_method_id)
              ? "The method will no longer be available for new imports, and the unsaved changes in this view will be discarded. Existing jobs and audit history remain intact."
              : "The method will no longer be available for new imports. Existing jobs and audit history remain intact.",
            confirmLabel: "Archive Method"
          }
      : destructiveConfirmation.kind === "target"
        ? localDraftTargetIds.includes(destructiveConfirmation.target.target_id)
          ? {
              eyebrow: "Target",
              title: "Discard this Target draft?",
              item: destructiveConfirmation.target.name,
              body: "This draft has not been saved. Discarding it removes the local target setup and cannot be undone.",
              confirmLabel: "Discard Draft"
            }
          : {
              eyebrow: "Target",
              title: "Delete this Target?",
              item: destructiveConfirmation.target.name,
              body: dirtyTargetIds.includes(destructiveConfirmation.target.target_id)
                ? "This permanently removes the reusable Target, its environments, and its output templates, including unsaved changes in this view. Pathfinder will block deletion if any customer workspace still references it."
                : "This permanently removes the reusable Target, its environments, and its output templates. Pathfinder will block deletion if any customer workspace still references it.",
              confirmLabel: "Delete Target"
            }
        : destructiveConfirmation.kind === "jobs"
          ? {
              eyebrow: destructiveConfirmation.archived ? "Archive Jobs" : "Restore Jobs",
              title: `${destructiveConfirmation.archived ? "Archive" : "Restore"} ${destructiveConfirmation.jobs.length} job${destructiveConfirmation.jobs.length === 1 ? "" : "s"}?`,
              item:
                destructiveConfirmation.jobs.length === 1
                  ? displayJobId(destructiveConfirmation.jobs[0].job_id)
                  : `${destructiveConfirmation.jobs.length} selected jobs`,
              body: destructiveConfirmation.archived
                ? "Archived jobs are hidden from the active list, but their Lift orders, submit attempts, audit history, and status links remain intact."
                : "Restored jobs return to the active job list with their existing state and history unchanged.",
              confirmLabel: destructiveConfirmation.archived ? "Archive Jobs" : "Restore Jobs"
            }
          : destructiveConfirmation.kind === "public-intake-link"
            ? destructiveConfirmation.action === "rotate"
              ? {
                  eyebrow: "Customer Order Dropbox",
                  title: "Rotate this private link?",
                  item: destructiveConfirmation.method.name,
                  body: "The current customer URL will stop working immediately. Pathfinder will generate a new private URL and keep the dropbox published.",
                  confirmLabel: "Rotate Link"
                }
              : {
                  eyebrow: "Customer Order Dropbox",
                  title: "Revoke this private link?",
                  item: destructiveConfirmation.method.name,
                  body: "The current customer URL will stop working immediately and the dropbox will be unpublished. Publishing it again later will generate a fresh private URL.",
                  confirmLabel: "Revoke Link"
                }
            : {
                eyebrow: "Target Environment",
                title: "Remove this environment?",
                item: `${destructiveConfirmation.target_name} · ${destructiveConfirmation.environment_name}`,
                body: "The environment will be removed from the Target draft. The change is not persisted until you save the Target.",
                confirmLabel: "Remove Environment"
              }
    : null;
  const selectedOutputTemplateStats = selectedOutputTemplate ? templateMappingStats(selectedOutputTemplate) : null;
  const targetRowIds = targetRows.map((target) => target.target_id).join("|");
  const targetTemplateIds = targetOutputTemplates.map((template) => template.output_template_id).join("|");

  useEffect(() => {
    if (selectedTargetId && !targetRows.some((target) => target.target_id === selectedTargetId)) {
      setSelectedTargetId(null);
    }
  }, [selectedTargetId, targetRowIds]);

  useEffect(() => {
    if (!selectedTarget) {
      setActiveOutputTemplateId(null);
      return;
    }
    if (targetOutputTemplates.length && !targetOutputTemplates.some((template) => template.output_template_id === activeOutputTemplateId)) {
      setActiveOutputTemplateId(targetOutputTemplates[0].output_template_id);
    }
  }, [selectedTarget?.target_id, activeOutputTemplateId, targetTemplateIds]);

  const activeOutputRoute =
    workflowImportMethod
      ? outputRouteForMethod(workflowImportMethod, outputRoutes)
      : primaryOutputRoute;
  const activeRouteTarget =
    targetRows.find((target) => target.target_id === activeOutputRoute.target_id) ?? primaryRouteTarget ?? null;
  const activeRouteEnvironment =
    activeRouteTarget?.environments.find((environment) => environment.environment_id === activeOutputRoute.environment_id) ??
    activeRouteTarget?.environments.find((environment) => environment.name === activeRouteTarget.lift.active_environment) ??
    null;
  const activeRouteTemplate =
    activeRouteTarget?.output_templates.find((template) => template.output_template_id === activeOutputRoute.output_template_id) ??
    activeRouteTarget?.output_templates.find((template) => template.name === activeOutputRoute.output_template) ??
    null;
  const activeOrderNameTemplateMapping = activeRouteTemplate?.canonical_mappings.find(
    (mapping) => mapping.targetField === "order.order_title"
  );
  const activeOrderNameLiftPath =
    activeOrderNameTemplateMapping?.sourceColumn.replace(/^body:/, "") || "order.order_title";
  const activeRouteCompanyId =
    activeOutputRoute.company_id ?? activeRouteEnvironment?.headers.Company ?? activeRouteTarget?.lift.headers.Company;
  const activeRouteEnvironmentLabel =
    activeRouteEnvironment?.name ?? (activeRouteTarget ? activeRouteTarget.lift.active_environment : "Not configured");
  const activeRouteDiagnostics = buildRouteDiagnostics({
    target: activeRouteTarget,
    route: activeOutputRoute,
    environment: activeRouteEnvironment,
    template: activeRouteTemplate
  });
  const selectedSubmitProfile = submitProfileForRoute(activeOutputRoute, selectedSubmitProfileId);
  const submitCustomer = submitCustomerForProfile(selectedCustomer, selectedSubmitProfile);
  const canonicalRegistryFields = canonicalRegistry?.fields ?? [];
  const orderNameComponentOptions = Array.from(
    new Set([
      ...activeOrderNameConfig.components.flatMap((component) =>
        component.kind === "text" ? [] : [component.field]
      ),
      ...canonicalRegistryFields
        .filter(
          (field) =>
            !field.repeatable &&
            field.path !== activeOrderNameConfig.provided_field &&
            !field.path.startsWith("lines[].") &&
            !field.path.startsWith("contacts[].")
        )
        .map((field) => field.path),
      "customer.destination_customer_id",
      "order.external_order_id",
      "order.ship_date"
    ])
  ).sort();
  const addableOrderNameComponentOptions = orderNameComponentOptions.filter(
    (path) => !activeOrderNameConfig.components.some((component) => component.kind !== "text" && component.field === path)
  );
  const canonicalRegistrySections = canonicalRegistry?.sections ?? [];
  const canonicalRegistryPaths = new Set(canonicalRegistryFields.map((field) => field.path));
  const canonicalCompatibilityOptions = canonicalOrderOptions.filter(
    (option) => !canonicalRegistryPaths.has(option) && !generatedTemplateOptions.includes(option)
  );
  const canonicalRequiredCount = canonicalRegistryFields.filter((field) => field.required).length;
  const canonicalRepeatableCount = canonicalRegistryFields.filter((field) => field.repeatable).length;
  const canonicalRegistryHistory = canonicalRegistry?.history ?? [];
  const canonicalRegistrySnapshots = canonicalRegistry?.snapshots ?? [];
  const latestCanonicalSnapshot = canonicalRegistrySnapshots[0] ?? null;
  const canonicalRegistrySectionCounts = canonicalRegistryFields.reduce<Record<string, number>>((counts, field) => {
    counts[field.section] = (counts[field.section] ?? 0) + 1;
    return counts;
  }, {});
  const filteredCanonicalRegistryFields = canonicalRegistryFields.filter((field) => {
    const query = canonicalRegistrySearch.trim().toLowerCase();
    const matchesSection = canonicalRegistrySectionFilter === "All" || field.section === canonicalRegistrySectionFilter;
    const matchesQuery =
      !query ||
      [field.path, field.label, field.data_type, field.aliases.join(" "), field.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query);
    return matchesSection && matchesQuery;
  });

  useEffect(() => {
    if (!activeOutputRoute.submit_profiles.some((profile) => profile.profile_id === selectedSubmitProfileId && profile.enabled)) {
      setSelectedSubmitProfileId(submitProfileForRoute(activeOutputRoute).profile_id);
    }
  }, [activeOutputRoute.output_route_id, selectedSubmitProfileId]);

  useEffect(() => {
    if (
      manualImportMethodId !== "ad-hoc" &&
      !activeManualImportMethods.some((method) => method.import_method_id === manualImportMethodId)
    ) {
      setManualImportMethodId(activeManualImportMethods[0]?.import_method_id ?? "ad-hoc");
    }
  }, [activeManualImportMethods, manualImportMethodId]);

  const selectedOutputMapRouteId =
    outputMapRouteFilter === "All" ? activeOutputRoute.output_route_id : outputMapRouteFilter;
  const selectedOutputMapRoute =
    outputRoutes.find((route) => route.output_route_id === selectedOutputMapRouteId) ?? activeOutputRoute;

  useEffect(() => {
    void loadLiftUnitCatalog(selectedOutputMapRoute);
  }, [
    selectedOutputMapRoute.output_route_id,
    selectedOutputMapRoute.company_id,
    selectedOutputMapRoute.target_id,
    unitCatalogStatusFilter,
    unitCatalogProductTypeFilter,
    unitCatalogCatalogFilter,
    unitCatalogApiFilterParam,
    unitCatalogApiFilterValue
  ]);

  const selectedOutputMapTarget =
    targetRows.find((target) => target.target_id === selectedOutputMapRoute.target_id) ?? primaryTarget ?? null;
  const selectedOutputMapEnvironment =
    selectedOutputMapTarget?.environments.find(
      (environment) => environment.environment_id === selectedOutputMapRoute.environment_id
    ) ??
    selectedOutputMapTarget?.environments.find((environment) => environment.name === selectedOutputMapTarget.lift.active_environment) ??
    null;
  const selectedCatalogDetailItem =
    liftUnitCatalog.find((item) => item.catalog_item_id === selectedCatalogDetailId) ?? null;
  const filteredLiftUnitCatalog = useMemo(() => {
    const query = unitCatalogSearch.trim();
    if (!query) {
      return [...liftUnitCatalog].sort(compareLiftCatalogItems);
    }

    return liftUnitCatalog
      .map((item) => ({ item, score: liftCatalogSearchScore(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((first, second) => second.score - first.score || compareLiftCatalogItems(first.item, second.item))
      .map((entry) => entry.item);
  }, [liftUnitCatalog, unitCatalogSearch]);
  const selectedOutputMapTemplate =
    selectedOutputMapTarget?.output_templates.find(
      (template) => template.output_template_id === selectedOutputMapRoute.output_template_id
    ) ??
    selectedOutputMapTarget?.output_templates.find((template) => template.name === selectedOutputMapRoute.output_template) ??
    null;
  const selectedOutputMapDiagnostics = buildRouteDiagnostics({
    target: selectedOutputMapTarget,
    route: selectedOutputMapRoute,
    environment: selectedOutputMapEnvironment,
    template: selectedOutputMapTemplate
  });
  const selectedOutputMapMethod =
    importMethods.find((method) => method.output_route_id === selectedOutputMapRouteId && method.status !== "Archived") ??
    activeImportMethod;
  const selectedOutputMapProductConfig =
    selectedOutputMapMethod?.product_resolution_config ?? activeProductConfig;
  const productMappings = workspace?.product_mappings ?? [];
  const catalogPresets = workspace?.catalog_presets ?? [];
  const isMigrationQueueActive = migrationQueueRouteId === selectedOutputMapRouteId;
  const selectedRouteMigrationQueue = productMappings.filter(
    (mapping) =>
      mapping.output_route_id === selectedOutputMapRouteId &&
      mapping.status !== "Inactive" &&
      !productMappingHasIdentifierForRoute(mapping, selectedOutputMapRoute)
  );
  const filteredProductMappings = useMemo(() => {
    const query = unitMapSearch.trim().toLowerCase();
    return productMappings
      .filter((mapping) => mapping.output_route_id === selectedOutputMapRouteId)
      .filter(
        (mapping) =>
          !isMigrationQueueActive ||
          (mapping.status !== "Inactive" && !productMappingHasIdentifierForRoute(mapping, selectedOutputMapRoute))
      )
      .filter(
        (mapping) =>
          unitMapStatusFilter === "All" || productMappingStatusForRoute(mapping, selectedOutputMapRoute) === unitMapStatusFilter
      )
      .filter((mapping) => {
        if (!query) {
          return true;
        }
        return [
          mapping.customer_product_key,
          mapping.display_label,
          mapping.product_identifier_value ?? "",
          mapping.lift_unit_number ?? "",
          mapping.lift_product_id ?? "",
          mapping.product_name ?? "",
          productMappingSourceLabel(mapping),
          mapping.source_file_name ?? "",
          mapping.source_columns.join(" ")
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((first, second) => {
        const statusWeight: Record<ProductMappingStatus, number> = {
          Unmapped: 0,
          Ambiguous: 1,
          Mapped: 2,
          Inactive: 3
        };
        return (
          statusWeight[productMappingStatusForRoute(first, selectedOutputMapRoute)] -
            statusWeight[productMappingStatusForRoute(second, selectedOutputMapRoute)] ||
          second.updated_at.localeCompare(first.updated_at)
        );
      });
  }, [
    isMigrationQueueActive,
    productMappings,
    selectedOutputMapRoute,
    selectedOutputMapRouteId,
    unitMapSearch,
    unitMapStatusFilter
  ]);
  const selectedUnitMappings = productMappings.filter(
    (mapping) => mapping.output_route_id === selectedOutputMapRouteId && selectedUnitMapIds.includes(mapping.mapping_id)
  );
  const activeCatalogMapping =
    productMappings.find(
      (mapping) => mapping.output_route_id === selectedOutputMapRouteId && mapping.mapping_id === activeCatalogMappingId
    ) ?? null;
  const unitCatalogProductTypeOptions = Array.from(
    new Set(liftUnitCatalog.map((item) => item.product_type).filter((value): value is string => Boolean(value)))
  ).sort();
  const unitCatalogCatalogsById = liftUnitCatalog.reduce<Record<string, string>>((catalogs, item) => {
    if (item.catalog_id) {
      catalogs[item.catalog_id] = item.catalog_name ?? item.catalog_id;
    }
    return catalogs;
  }, {});
  const unitCatalogCatalogOptions = Object.entries(unitCatalogCatalogsById).sort((first, second) =>
    first[1].localeCompare(second[1])
  );
  const routeProductMappings = productMappings.filter((mapping) => mapping.output_route_id === selectedOutputMapRouteId);
  const routeCatalogPresets = catalogPresets
    .filter((preset) => preset.output_route_id === selectedOutputMapRouteId && preset.status === "Active")
    .reduce<LiftCatalogPreset[]>((uniquePresets, preset) => {
      if (!uniquePresets.some((candidate) => candidate.catalog_id === preset.catalog_id)) {
        uniquePresets.push(preset);
      }
      return uniquePresets;
    }, [])
    .sort((first, second) => first.catalog_name.localeCompare(second.catalog_name));
  const activeCatalogScopeId =
    unitCatalogApiFilterParam === "catalog_id"
      ? unitCatalogApiFilterValue.trim()
      : unitCatalogCatalogFilter !== "All"
        ? unitCatalogCatalogFilter
        : catalogPresetId.trim();
  const activeCatalogScopePreset =
    routeCatalogPresets.find((preset) => preset.catalog_id === activeCatalogScopeId) ?? null;
  const activeCatalogScopeProduct =
    liftUnitCatalog.find((item) => item.catalog_id === activeCatalogScopeId && item.catalog_name) ?? null;
  const activeCatalogScopeName =
    activeCatalogScopeProduct?.catalog_name ??
    activeCatalogScopePreset?.catalog_name ??
    (activeCatalogScopeId ? "Catalog name loads from Lift" : "Choose a catalog");
  const routeMappedCount = routeProductMappings.filter(
    (mapping) => productMappingStatusForRoute(mapping, selectedOutputMapRoute) === "Mapped"
  ).length;
  const routeUnmappedCount = routeProductMappings.filter(
    (mapping) => productMappingStatusForRoute(mapping, selectedOutputMapRoute) === "Unmapped"
  ).length;
  const routeBlockingCount = routeProductMappings.filter(
    (mapping) => {
      const routeStatus = productMappingStatusForRoute(mapping, selectedOutputMapRoute);
      return routeStatus === "Unmapped" || routeStatus === "Ambiguous";
    }
  ).length;
  const routeSeenExampleCount = routeProductMappings.reduce((total, mapping) => total + productMappingSeenCount(mapping), 0);
  const routePreloadedCount = routeProductMappings.filter((mapping) => productMappingSourceLabel(mapping) === "Preloaded catalog").length;
  const preloadColumns = preloadGrid.columns;
  const preloadSourceColumnOptions = preloadColumns.length ? preloadColumns : sourceGrid.columns;
  const effectivePreloadSourceColumn =
    preloadSourceColumn ||
    (preloadSourceColumnOptions.includes(selectedOutputMapProductConfig.source_column)
      ? selectedOutputMapProductConfig.source_column
      : preloadSourceColumnOptions[0] ?? "");
  const effectivePreloadCompositeColumns = selectedOutputMapProductConfig.composite_columns.filter((column) =>
    preloadSourceColumnOptions.includes(column)
  );
  const preloadPreviewRows = useMemo<ProductMapPreloadRow[]>(() => {
    const seenKeys = new Set<string>();
    return preloadGrid.rows.map((row, index) => {
      const key = productKeyFromCatalogRow(
        row as Record<string, string>,
        selectedOutputMapProductConfig,
        effectivePreloadSourceColumn,
        effectivePreloadCompositeColumns.length ? effectivePreloadCompositeColumns : selectedOutputMapProductConfig.composite_columns
      );
      const existing = routeProductMappings.find((mapping) => mapping.customer_product_key === key);
      const duplicate = key ? seenKeys.has(key) : false;
      if (key) {
        seenKeys.add(key);
      }
      const unitValue = valueAsString(row[preloadUnitColumn]) || preloadDefaultUnit.trim();
      const productName =
        valueAsString(row[preloadProductNameColumn]) ||
        valueAsString(row.DESCRIPTION) ||
        valueAsString(row.Description) ||
        valueAsString(row["Product Name"]) ||
        valueAsString(row[effectivePreloadSourceColumn]);
      const status: ProductMappingStatus = unitValue ? "Mapped" : "Unmapped";
      const finalWidth = valueAsString(row[preloadFinalWidthColumn]) || preloadDimensionValue(row, "width");
      const finalHeight = valueAsString(row[preloadFinalHeightColumn]) || preloadDimensionValue(row, "height");

      return {
        row_id: `${index + 2}-${key || "missing"}`,
        row_number: index + 2,
        source_value:
          selectedOutputMapProductConfig.strategy === "composite_key"
            ? selectedOutputMapProductConfig.composite_columns.map((column) => valueAsString(row[column])).filter(Boolean).join(" / ")
            : valueAsString(row[effectivePreloadSourceColumn]),
        customer_product_key: key,
        display_label: productName || key || `Catalog row ${index + 2}`,
        product_identifier_value: unitValue,
        product_name: productName,
        final_width: finalWidth,
        final_height: finalHeight,
        source_columns:
          selectedOutputMapProductConfig.strategy === "composite_key"
            ? selectedOutputMapProductConfig.composite_columns
            : [effectivePreloadSourceColumn].filter(Boolean),
        status,
        action: !key ? "Missing key" : duplicate ? "Duplicate" : existing ? "Update" : "New",
        existing_mapping: existing,
        values: row as Record<string, string>
      };
    });
  }, [
    effectivePreloadCompositeColumns,
    effectivePreloadSourceColumn,
    preloadDefaultUnit,
    preloadFinalHeightColumn,
    preloadFinalWidthColumn,
    preloadGrid.rows,
    preloadProductNameColumn,
    preloadUnitColumn,
    routeProductMappings,
    selectedOutputMapProductConfig
  ]);
  const validPreloadRows = preloadPreviewRows.filter((row) => row.customer_product_key && row.action !== "Duplicate");
  const selectedPreloadRows = preloadPreviewRows.filter((row) => preloadSelectedIds.includes(row.row_id));
  const preloadMappedCount = preloadPreviewRows.filter((row) => row.status === "Mapped").length;
  const preloadDuplicateCount = preloadPreviewRows.filter((row) => row.action === "Duplicate").length;
  const preloadMissingCount = preloadPreviewRows.filter((row) => row.action === "Missing key").length;
  const productResolutionExample = buildProductResolutionExample(
    activeProductConfig,
    sourceGrid.rows,
    routeProductMappings,
    productExampleTestValue
  );
  const productResolutionCards = productResolutionExampleCards(
    activeProductConfig,
    productResolutionExample,
    activeOutputRoute.product_identifier_label
  );
  const unmappedProductCount = routeProductMappings.filter((mapping) => mapping.status !== "Mapped").length;
  const productResolutionRows = lastPreviewJob?.product_resolution_results ?? [];
  const manualPrePreviewProductResolutionRows = useMemo<ProductResolutionResult[]>(
    () =>
      parsedOrderRows.slice(0, 8).map((row, index) => {
        const sourceColumn =
          activeProductConfig.strategy === "direct_lift_unit_number"
            ? activeProductConfig.direct_unit_number_column ?? activeProductConfig.source_column
            : activeProductConfig.source_column;
        const customerProductKey = productKeyFromCatalogRow(
          row.values as Record<string, string>,
          activeProductConfig,
          sourceColumn,
          activeProductConfig.composite_columns
        );
        const savedMapping = productMappings.find(
          (mapping) =>
            mapping.output_route_id === activeOutputRoute.output_route_id &&
            mapping.customer_product_key === customerProductKey
        );
        const savedIdentifier = savedMapping
          ? productMappingIdentifierForRoute(savedMapping, activeOutputRoute)
          : null;
        const resolvedIdentifier =
          activeProductConfig.strategy === "direct_lift_unit_number" ||
          activeProductConfig.mode === "send_derived_unit"
            ? customerProductKey || null
            : savedIdentifier;
        const status =
          activeProductConfig.strategy === "direct_lift_unit_number" ||
          activeProductConfig.mode === "send_derived_unit"
            ? resolvedIdentifier
              ? "Mapped"
              : "Unmapped"
            : savedMapping
              ? productMappingStatusForRoute(savedMapping, activeOutputRoute)
              : "Unmapped";
        const displayLabel = String(
          row.values.DESCRIPTION ?? row.values["SIGN TYPE"] ?? savedMapping?.display_label ?? `Row ${row.row_number}`
        );

        return {
          source_sheet_name: row.sheet_name,
          source_row_number: row.row_number,
          output_route_id: activeOutputRoute.output_route_id,
          line_number: index + 1,
          strategy: activeProductConfig.strategy,
          mode: activeProductConfig.mode,
          customer_product_key: customerProductKey,
          display_label: savedMapping?.display_label ?? displayLabel,
          source_columns:
            activeProductConfig.strategy === "composite_key"
              ? activeProductConfig.composite_columns
              : [sourceColumn].filter(Boolean),
          resolved_product_identifier: resolvedIdentifier,
          resolved_unit_number:
            activeOutputRoute.product_identifier_type === "lift_unit_number"
              ? resolvedIdentifier
              : savedMapping?.lift_unit_number ?? null,
          resolved_product_id:
            activeOutputRoute.product_identifier_type === "lift_product_id"
              ? resolvedIdentifier
              : savedMapping?.lift_product_id ?? null,
          product_name: savedMapping?.product_name ?? displayLabel,
          status,
          message: resolvedIdentifier
            ? `Resolved from the saved ${activeOutputRoute.product_identifier_label} mapping. Generate a preview to persist validation.`
            : `No saved ${activeOutputRoute.product_identifier_label} mapping matches this generated key.`
        };
      }),
    [activeOutputRoute, activeProductConfig, parsedOrderRows, productMappings]
  );
  const displayedProductResolutionRows = productResolutionRows.length
    ? productResolutionRows
    : manualPrePreviewProductResolutionRows;
  const currentOrderProductBlockingCount = displayedProductResolutionRows.filter(
    (result) => result.status !== "Mapped" || !result.resolved_product_identifier
  ).length;
  const currentOrderProductMapKnown = displayedProductResolutionRows.length > 0;
  const referenceRowCount = sourceSheets.reduce((total, sheet) => total + sheet.reference_row_count, 0);
  const foundInputElements = useMemo(
    () =>
      sourceGrid.columns.map((column) => ({
        column,
        sample: sampleValuesForColumn(sourceGrid.rows, column)
      })),
    [sourceGrid.columns, sourceGrid.rows]
  );

  useEffect(() => {
    if (activeCustomerView === "Manual Import") {
      return;
    }
    if (activeImportMethod) {
      setMappings(activeImportMethod.mappings);
    }
  }, [activeCustomerView, activeImportMethod?.import_method_id, activeImportMethod?.mappings]);

  useEffect(() => {
    if (activeCustomerView !== "Manual Import") {
      return;
    }
    setMappings(
      manualImportMethod
        ? mappingsForSourceColumns(sourceGrid.columns, manualImportMethod.mappings)
        : buildDefaultMappings(sourceGrid.columns)
    );
  }, [activeCustomerView, manualImportMethodId]);

  useEffect(() => {
    if (dirtyImportMethodIds.length === 0) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyImportMethodIds.length]);

  useEffect(() => {
    setSelectedUnitMapIds([]);
  }, [selectedOutputMapRouteId]);

  const mappedCanonicalOrder = useMemo(
    () =>
      mapSourceRowsToCanonicalOrder(sourceGrid.rows, mappings, {
        customerId: `lift:${selectedCustomer.lift_customer_id}`,
        customerName: submitCustomer.customer_name,
        customerCrmId: selectedCustomer.crm_id ?? null,
        destinationCustomerId: submitCustomer.lift_customer_id,
        sourceSystem: sourceName === "Sample workbook" ? "Manual Upload" : "XLSX Upload",
        sourceCustomer: selectedCustomer.customer_name,
        sourceTemplate: sourceName,
        targetSystem: activeOutputRoute.target_system
      }),
    [
      activeOutputRoute.target_system,
      mappings,
      selectedCustomer,
      selectedCustomer.crm_id,
      sourceGrid.rows,
      sourceName,
      submitCustomer.customer_name,
      submitCustomer.lift_customer_id
    ]
  );

  const orderNameResolution = useMemo(
    () => applyOrderNameResolution(mappedCanonicalOrder, activeOrderNameConfig),
    [activeOrderNameConfig, mappedCanonicalOrder]
  );
  const canonicalOrder = useMemo(
    () =>
      applyProductResolutionToCanonicalOrder(
        orderNameResolution.canonical_order,
        manualPrePreviewProductResolutionRows,
        activeOutputRoute
      ),
    [activeOutputRoute, manualPrePreviewProductResolutionRows, orderNameResolution.canonical_order]
  );

  const canonicalMessages = [
    ...validateCanonicalOrder(canonicalOrder, {
      product_identifier_type: activeOutputRoute.product_identifier_type
    }),
    ...validateOrderNameResolution(orderNameResolution.result, activeOrderNameConfig)
  ];
  const rawLiftPayload = generateLiftPayload(canonicalOrder, {
    jobId: "job_preview",
    canonicalOrderId: "co_preview",
    pathfinderOrderId: pendingPathfinderOrderNumber,
    extIdStrategy: workflowImportMethod?.ext_id_strategy ?? "pathfinder_generated"
  });
  const normalizedLift = applyValueNormalizationToLiftPayload(rawLiftPayload, activeOutputRoute.value_normalization_rules ?? []);
  const liftPayload = normalizedLift.payload;
  const baseLiftMessages = validateLiftPayload(liftPayload, {
    product_identifier_type: activeOutputRoute.product_identifier_type,
    product_identifier_label: activeOutputRoute.product_identifier_label
  });
  const liftMessages = [
    ...(normalizedLift.validation.length
      ? baseLiftMessages.filter((message) => message.severity !== "PASS")
      : baseLiftMessages),
    ...normalizedLift.validation
  ];
  const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload, liftConfigForRoute(activeRouteTarget, activeOutputRoute)));
  const displayedCanonicalOrder = lastPreviewJob?.canonical_order ?? canonicalOrder;
  const displayedLiftPayload = lastPreviewJob?.lift_payload ?? liftPayload;
  const displayedSubmitRequest = lastPreviewJob?.submit_request_masked ?? submitRequest;
  const allMessages = lastPreviewJob
    ? [...lastPreviewJob.canonical_validation, ...lastPreviewJob.lift_validation]
    : [...canonicalMessages, ...liftMessages];
  const hasBlockingFailure = allMessages.some((message) => message.severity === "FAIL");
  const localCertificationState: ProcessingState =
    lastPreviewJob?.state ??
    (hasBlockingFailure ? "Failed" : currentOrderProductBlockingCount ? "Needs Mapping" : "Validated");
  const submitCertification =
    lastPreviewJob?.submit_certification ??
    buildLocalSubmitCertification({
      state: localCertificationState,
      canonicalValidation: lastPreviewJob?.canonical_validation ?? canonicalMessages,
      liftValidation: lastPreviewJob?.lift_validation ?? liftMessages,
      request: displayedSubmitRequest,
      payload: displayedLiftPayload,
      profile: selectedSubmitProfile,
      route: activeOutputRoute,
      unresolvedProductCount: lastPreviewJob?.unresolved_products.length ?? currentOrderProductBlockingCount,
      runtime: submitRuntime
    });
  const submitCertificationBlockingCount = submitCertification.items.filter((item) => item.blocking).length;
  const manualSourceReady = sourceGrid.rows.length > 0;
  const manualPreviewReady = Boolean(lastPreviewJob);
  const manualFixesNeeded = submitCertificationBlockingCount > 0 || currentOrderProductBlockingCount > 0;
  const activeRouteIsProd =
    activeRouteEnvironment?.role === "PROD" || activeRouteEnvironmentLabel.toUpperCase().includes("PROD");
  const prodSandboxConfirmationRequired = activeRouteIsProd && selectedSubmitProfile.mode === "sandbox_customer";
  const prodSandboxConfirmationKey = [
    activeOutputRoute.output_route_id,
    activeRouteEnvironment?.environment_id ?? activeRouteEnvironmentLabel,
    selectedSubmitProfile.profile_id
  ].join(":");
  const prodSandboxSubmitConfirmed =
    !prodSandboxConfirmationRequired || confirmedProdSandboxSubmitKey === prodSandboxConfirmationKey;
  const manualSubmitReady = Boolean(
    lastPreviewJob &&
      submitCertification.can_submit &&
      submitCertification.external_submit_enabled &&
      prodSandboxSubmitConfirmed
  );
  const activeRouteAttentionItem =
    activeRouteDiagnostics.items.find((item) => item.status === "Blocked") ??
    activeRouteDiagnostics.items.find((item) => item.status === "Warning") ??
    null;
  const transportGateItem = submitCertification.items.find((item) => item.item_id === "lift-transport-mode");
  const externalGateItem = submitCertification.items.find((item) => item.item_id === "external-submit-gate");
  const productResolutionItem = submitCertification.items.find((item) => item.item_id === "product-resolution");
  const submitReadinessCards: Array<{
    label: string;
    value: string;
    detail: string;
    status: "Passed" | "Warning" | "Blocked";
    actionLabel?: string;
    action?: () => void;
  }> = [
    {
      label: "Source",
      value: manualSourceReady ? `${sourceGrid.rows.length} rows loaded` : "No order source",
      detail: manualSourceReady ? `${sourceName} · ${sheetName}` : "Upload the Momentara workbook or use the sample before preview.",
      status: manualSourceReady ? "Passed" : "Blocked",
      actionLabel: manualSourceReady ? undefined : "Load source",
      action: manualSourceReady ? undefined : () => fileInputRef.current?.click()
    },
    {
      label: "Route",
      value: activeRouteDiagnostics.status,
      detail: activeRouteAttentionItem?.message ?? `${activeOutputRoute.name} is configured for ${activeRouteEnvironmentLabel}.`,
      status: activeRouteDiagnostics.blocking_count
        ? "Blocked"
        : activeRouteDiagnostics.warning_count
          ? "Warning"
          : "Passed",
      actionLabel: activeRouteAttentionItem?.action_key ? "Fix route" : undefined,
      action: activeRouteAttentionItem?.action_key
        ? () => handleRouteDiagnosticAction(activeOutputRoute, activeRouteAttentionItem.action_key)
        : undefined
    },
    {
      label: "Product Map",
      value: currentOrderProductMapKnown
        ? currentOrderProductBlockingCount
          ? `${currentOrderProductBlockingCount} gap${currentOrderProductBlockingCount === 1 ? "" : "s"}`
          : "Mapped"
        : "Load source",
      detail: currentOrderProductMapKnown
        ? productResolutionItem?.message ?? `Every imported line has a ${activeOutputRoute.product_identifier_label}.`
        : "Upload an order to evaluate only the product keys used by that order.",
      status: currentOrderProductMapKnown ? (currentOrderProductBlockingCount ? "Blocked" : "Passed") : "Warning",
      actionLabel: currentOrderProductBlockingCount ? "Open map" : undefined,
      action: currentOrderProductBlockingCount
        ? () => {
            setActiveGlobalView("Customers");
            setOutputMapRouteFilter(activeOutputRoute.output_route_id);
            setActiveCustomerView("Output Product Map");
          }
        : undefined
    },
    {
      label: "Certification",
      value: submitCertification.can_submit ? "Certified" : `${submitCertificationBlockingCount} blocking`,
      detail: submitCertification.summary,
      status: submitCertification.can_submit ? "Passed" : "Blocked",
      actionLabel: lastPreviewJob ? "Recheck" : "Preview first",
      action: lastPreviewJob ? () => void refreshSubmitCertification(lastPreviewJob, true) : () => void createPreviewJob()
    },
    {
      label: "Submit Gate",
      value:
        transportGateItem?.status === "Passed" && externalGateItem?.status === "Passed"
          ? "Enabled"
          : externalGateItem?.status === "Blocked"
            ? "Gate locked"
            : "Transport gated",
      detail:
        externalGateItem?.status === "Blocked"
          ? externalGateItem.message
          : transportGateItem?.message ?? "Transport mode will be recorded on the submit attempt.",
      status:
        transportGateItem?.status === "Passed" && externalGateItem?.status === "Passed"
          ? "Passed"
          : "Blocked",
      actionLabel: transportGateItem?.action_key || externalGateItem?.action_key ? "Open health" : undefined,
      action:
        transportGateItem?.action_key || externalGateItem?.action_key
          ? () => handleCertificationAction(transportGateItem?.action_key ?? externalGateItem?.action_key)
          : undefined
    },
    {
      label: "Last Attempt",
      value: lastSubmitAttempt ? lastSubmitAttempt.state : "None",
      detail: lastSubmitAttempt
        ? `${lastSubmitAttempt.transport_mode ?? "unknown"} · ${lastSubmitAttempt.response.message}`
        : "No submit attempt has been recorded for this preview yet.",
      status: lastSubmitAttempt
        ? lastSubmitAttempt.state === "Submitted"
          ? "Passed"
          : lastSubmitAttempt.state === "Failed" || lastSubmitAttempt.state === "Blocked"
            ? "Blocked"
            : "Warning"
        : "Warning"
    }
  ];
  const activeRoutePasswordSaved = Boolean(activeRouteEnvironment?.credentials.Password);
  const activeRouteUserSaved = Boolean(activeRouteEnvironment?.credentials.User);
  const extIdMatches = displayedSubmitRequest.headers.Ext_ID === displayedLiftPayload.order.ext_id;
  const valueRuleFailures = normalizedLift.validation.filter((message) => message.severity === "FAIL");
  const submitPreflightItems: Array<{
    label: string;
    value: string;
    detail: string;
    status: "Passed" | "Warning" | "Blocked";
  }> = [
    {
      label: "Environment",
      value: activeRouteEnvironmentLabel,
      detail: activeRouteIsProd
        ? prodSandboxConfirmationRequired
          ? prodSandboxSubmitConfirmed
            ? "PROD sandbox lane has been confirmed for this submit preview."
            : "PROD is selected. Confirm this is intentional for the sandbox submit lane."
          : "PROD is selected. Confirm this is intentional before live customer submit."
        : "Not PROD. Switch the route environment if today’s Lift test should hit production.",
      status: activeRouteIsProd ? (prodSandboxSubmitConfirmed ? "Passed" : "Warning") : "Blocked"
    },
    {
      label: "Credentials",
      value: activeRouteUserSaved && activeRoutePasswordSaved ? "Present" : "Missing",
      detail: activeRouteUserSaved && activeRoutePasswordSaved
        ? "Import user and saved secret are available for this environment."
        : "Enter and save the Lift import user and password on the selected Target Environment.",
      status: activeRouteUserSaved && activeRoutePasswordSaved ? "Passed" : "Blocked"
    },
    {
      label: "Submit Customer",
      value: `${submitCustomer.customer_name} / ${submitCustomer.lift_customer_id}`,
      detail:
        selectedSubmitProfile.mode === "sandbox_customer" && submitCustomer.lift_customer_id === "1249"
          ? "Sandbox profile is routing this customer order through LTL Demo."
          : "Expected sandbox submit profile to use LTL Demo / 1249 for the first production-path test.",
      status:
        selectedSubmitProfile.mode === "sandbox_customer" && submitCustomer.lift_customer_id === "1249"
          ? "Passed"
          : "Blocked"
    },
    {
      label: "Product Map",
      value: currentOrderProductMapKnown
        ? currentOrderProductBlockingCount
          ? `${currentOrderProductBlockingCount} unresolved`
          : "Complete"
        : "Waiting",
      detail: currentOrderProductMapKnown
        ? currentOrderProductBlockingCount
          ? "Resolve every generated product key used by this order before submit."
          : `All imported lines have an approved ${activeOutputRoute.product_identifier_label}.`
        : "Upload an order source before checking product mappings.",
      status: currentOrderProductMapKnown ? (currentOrderProductBlockingCount ? "Blocked" : "Passed") : "Blocked"
    },
    {
      label: "Ext_ID",
      value:
        !lastPreviewJob && workflowImportMethod?.ext_id_strategy === "pathfinder_generated"
          ? "Reserved on preview generation"
          : extIdMatches
            ? displayedLiftPayload.order.ext_id
            : "Mismatch",
      detail:
        !lastPreviewJob && workflowImportMethod?.ext_id_strategy === "pathfinder_generated"
          ? "Pathfinder will reserve one unique order number and use it for both header Ext_ID and body order.ext_id."
          : extIdMatches
            ? "Header Ext_ID matches body order.ext_id."
        : "Lift requires header Ext_ID and body order.ext_id to be identical.",
      status: extIdMatches ? "Passed" : "Blocked"
    },
    {
      label: "Value Rules",
      value: valueRuleFailures.length ? `${valueRuleFailures.length} failure${valueRuleFailures.length === 1 ? "" : "s"}` : "Clear",
      detail: valueRuleFailures[0]?.message ?? "Controlled output values pass route-specific normalization checks.",
      status: valueRuleFailures.length ? "Blocked" : "Passed"
    },
    {
      label: "Transport",
      value: submitCertification.live_transport_enabled ? "Live" : "Gated",
      detail: submitCertification.live_transport_enabled
        ? "Pathfinder API reports live Lift transport enabled."
        : "Start the API with PATHFINDER_ENABLE_LIFT_SUBMIT=true and PATHFINDER_LIFT_TRANSPORT_MODE=live for the actual submit.",
      status: submitCertification.live_transport_enabled ? "Passed" : "Blocked"
    },
    {
      label: "Certification",
      value: submitCertification.can_submit ? "Certified" : `${submitCertificationBlockingCount} blocking`,
      detail: submitCertification.summary,
      status: submitCertification.can_submit ? "Passed" : "Blocked"
    }
  ];
  const submitPreflightBlockedCount = submitPreflightItems.filter((item) => item.status === "Blocked").length;
  const submitPreflightWarningCount = submitPreflightItems.filter((item) => item.status === "Warning").length;
  const submitPacketFileName = `pathfinder-submit-packet-${slugForFilename(
    displayedLiftPayload.order.ext_id || lastPreviewJob?.job_id || "preview"
  ) || "preview"}.json`;
  const mappedColumnCount = sourceGrid.columns.filter((column) =>
    mappings.some((mapping) => mapping.sourceColumn === column)
  ).length;
  const customerOrderCount = customerJobs.reduce((total, job) => total + jobOrderCount(job), 0);
  const readyJobCount = customerJobs.filter((job) => job.state === "Ready" || job.state === "Completed").length;
  const failedJobCount = customerJobs.filter((job) => isFailureState(job.state)).length;
  const validationRate = customerJobs.length ? Math.round((readyJobCount / customerJobs.length) * 1000) / 10 : 0;
  const notificationItems = [
    ...(routeBlockingCount
      ? [
          {
            title: `${routeBlockingCount} product mapping gap${routeBlockingCount === 1 ? "" : "s"}`,
            detail: `Resolve ${activeOutputRoute.product_identifier_label} mappings before submit.`,
            action: () => {
              setActiveCustomerView("Output Product Map");
              setOpenTopbarMenu(null);
            }
          }
        ]
      : []),
    ...(failedJobCount
      ? [
          {
            title: `${failedJobCount} job${failedJobCount === 1 ? "" : "s"} need review`,
            detail: "Open customer jobs to inspect validation or submit failures.",
            action: () => {
              setActiveCustomerView("Jobs");
              setOpenTopbarMenu(null);
            }
          }
        ]
      : []),
    ...(submitCertificationBlockingCount
      ? [
          {
            title: `${submitCertificationBlockingCount} submit gate${submitCertificationBlockingCount === 1 ? "" : "s"} blocked`,
            detail: submitCertification.summary,
            action: () => {
              setActiveCustomerView(lastPreviewJob ? "Manual Import" : "Output Product Map");
              setOpenTopbarMenu(null);
            }
          }
        ]
      : []),
    ...(!primaryRouteEnvironment?.endpoint_url
      ? [
          {
            title: "Primary environment endpoint missing",
            detail: "Configure the target environment before external submit.",
            action: () => {
              setActiveGlobalView("Targets");
              setSelectedTargetId(primaryOutputRoute.target_id);
              setActiveTargetsView("Environments");
              setOpenTopbarMenu(null);
            }
          }
        ]
      : []),
    ...(workspaceMessage
      ? [
          {
            title: workspaceState === "error" ? "Workspace error" : "Workspace note",
            detail: workspaceMessage,
            action: () => setOpenTopbarMenu(null)
          }
        ]
      : [])
  ];
  const notificationCount = notificationItems.length;
  const activeTargetCount = targetRows.filter((target) => target.status === "Ready" || target.status === "Configured").length;
  const scheduledMethodCount = importMethods.filter(
    (method) => method.type === "Scheduled" || method.source === "REST API" || method.source === "SFTP" || method.source === "Google Sheet"
  ).length;
  const dashboardJobs = [...allJobs].sort((first, second) => {
    const firstDate = new Date(first.updated_at).getTime();
    const secondDate = new Date(second.updated_at).getTime();
    return (Number.isFinite(secondDate) ? secondDate : 0) - (Number.isFinite(firstDate) ? firstDate : 0);
  });
  const dashboardRecentJobs = dashboardJobs.slice(0, 8);
  const dashboardFailedJobs = dashboardJobs.filter((job) => isFailureState(job.state));
  const dashboardNeedsMappingJobs = dashboardJobs.filter((job) => job.state === "Needs Mapping");
  const dashboardReadyJobs = dashboardJobs.filter((job) => job.state === "Ready");
  const dashboardSubmittedJobs = dashboardJobs.filter(
    (job) =>
      job.state === "Submitted" ||
      job.state === "Order Confirmed" ||
      job.state === "Completed" ||
      Boolean(job.target_order_number)
  );
  const dashboardOrderCount = dashboardJobs.length;
  const dashboardLineCount = dashboardJobs.reduce((total, job) => total + jobOrderCount(job), 0);
  const dashboardSuccessRate = dashboardJobs.length
    ? Math.round((dashboardSubmittedJobs.length / dashboardJobs.length) * 100)
    : 0;
  const dashboardTargetIssueCount = targetRows.filter(
    (target) => target.status === "Draft" || target.health_status === "Error" || target.health_status === "Warning"
  ).length;
  const dashboardActiveEnvironmentCount = targetRows.reduce(
    (total, target) => total + target.environments.filter((environment) => environment.status === "Active").length,
    0
  );
  const dashboardCredentialReady =
    selectedOutputMapEnvironment?.auth_method === "None" ||
    (configuredSecret(selectedOutputMapEnvironment?.credentials.User) &&
      configuredSecret(selectedOutputMapEnvironment?.credentials.Password)) ||
    Boolean(selectedOutputMapEnvironment?.credentials.token || selectedOutputMapEnvironment?.credentials.api_key);
  const dashboardRouteReady = selectedOutputMapDiagnostics.blocking_count === 0;
  const dashboardWorkItems: Array<{
    id: string;
    priority: string;
    title: string;
    detail: string;
    status: ProcessingState | "Open" | "Ready";
    owner: string;
    actionLabel: string;
    action: () => void;
  }> = [];
  if (routeBlockingCount) {
    dashboardWorkItems.push({
      id: "product-map-gaps",
      priority: "P1",
      title: `${routeBlockingCount} product mapping gap${routeBlockingCount === 1 ? "" : "s"}`,
      detail: `${selectedOutputMapRoute.name} needs ${selectedOutputMapRoute.product_identifier_label} assignments before submit.`,
      status: "Needs Mapping",
      owner: selectedCustomer.customer_name,
      actionLabel: "Resolve map",
      action: () => {
        setActiveGlobalView("Customers");
        setActiveCustomerView("Output Product Map");
      }
    });
  }
  if (dashboardFailedJobs.length) {
    const failedJob = dashboardFailedJobs[0];
    dashboardWorkItems.push({
      id: `failed-${failedJob.job_id}`,
      priority: "P1",
      title: `${displayJobId(failedJob.job_id)} needs review`,
      detail: `${failedJob.import_method_name} failed for ${failedJob.customer_name}.`,
      status: failedJob.state,
      owner: failedJob.customer_name,
      actionLabel: "Open job",
      action: () => void openJobDetail(failedJob)
    });
  }
  if (dashboardNeedsMappingJobs.length) {
    const mappingJob = dashboardNeedsMappingJobs[0];
    dashboardWorkItems.push({
      id: `mapping-${mappingJob.job_id}`,
      priority: "P2",
      title: `${displayJobId(mappingJob.job_id)} is waiting on product resolution`,
      detail: `${jobOrderCount(mappingJob)} order line${jobOrderCount(mappingJob) === 1 ? "" : "s"} in ${mappingJob.output_route_name}.`,
      status: mappingJob.state,
      owner: mappingJob.customer_name,
      actionLabel: "Review mappings",
      action: () => {
        setActiveGlobalView("Customers");
        setActiveCustomerView("Output Product Map");
      }
    });
  }
  if (dashboardReadyJobs.length) {
    const readyJob = dashboardReadyJobs[0];
    dashboardWorkItems.push({
      id: `ready-${readyJob.job_id}`,
      priority: "P3",
      title: `${displayJobId(readyJob.job_id)} is ready for submit review`,
      detail: `${readyJob.output_route_name} has passed preview checks.`,
      status: readyJob.state,
      owner: readyJob.customer_name,
      actionLabel: "Open manual import",
      action: () => {
        setActiveGlobalView("Customers");
        setActiveCustomerView("Manual Import");
      }
    });
  }
  if (!dashboardRouteReady || dashboardTargetIssueCount) {
    const firstRouteIssue = selectedOutputMapDiagnostics.items.find((item) => item.status === "Blocked");
    dashboardWorkItems.push({
      id: "target-health",
      priority: "P2",
      title: dashboardRouteReady ? `${dashboardTargetIssueCount} target setup item${dashboardTargetIssueCount === 1 ? "" : "s"}` : "Primary output route is not submit-ready",
      detail: firstRouteIssue?.message ?? `${selectedOutputMapRoute.name} is configured, but target health needs attention.`,
      status: "Open",
      owner: selectedOutputMapTarget?.name ?? "Targets",
      actionLabel: "Open target",
      action: () => {
        setActiveGlobalView("Targets");
        setSelectedTargetId(selectedOutputMapRoute.target_id);
        setActiveTargetsView(firstRouteIssue?.action_key === "target-output-templates" ? "Output Templates" : firstRouteIssue?.action_key === "target-output-routes" ? "Output Routes" : "Environments");
      }
    });
  }
  const dashboardHealthRows = [
    {
      label: "Selected route",
      value: selectedOutputMapRoute.name,
      detail: selectedOutputMapDiagnostics.summary,
      status: selectedOutputMapDiagnostics.blocking_count ? "Error" : selectedOutputMapDiagnostics.warning_count ? "Warning" : "Healthy"
    },
    {
      label: "Active environment",
      value: selectedOutputMapEnvironment?.name ?? "Not configured",
      detail: selectedOutputMapEnvironment?.endpoint_url ? selectedOutputMapEnvironment.endpoint_url : "Endpoint missing",
      status: selectedOutputMapEnvironment?.endpoint_url ? "Healthy" : "Error"
    },
    {
      label: "Credentials",
      value: dashboardCredentialReady ? "Configured" : "Missing",
      detail: selectedOutputMapEnvironment?.auth_method ?? primaryRouteAuth,
      status: dashboardCredentialReady ? "Healthy" : "Error"
    },
    {
      label: "Product map",
      value: routeBlockingCount ? `${routeBlockingCount} open` : "Ready",
      detail: `${routeMappedCount}/${routeProductMappings.length} keys mapped for selected route`,
      status: routeBlockingCount ? "Warning" : "Healthy"
    }
  ];

  async function changePrimaryRouteEnvironment(environmentId: string) {
    const environment = primaryRouteTarget?.environments.find((candidate) => candidate.environment_id === environmentId);
    if (!environment || !primaryRouteTarget) {
      setWorkspaceMessage("Choose a valid target environment.");
      setWorkspaceState("error");
      return;
    }

    const nextRoute = {
      ...primaryOutputRoute,
      environment_id: environment.environment_id
    };
    const nextTarget: TargetConfig = {
      ...primaryRouteTarget,
      lift: {
        ...primaryRouteTarget.lift,
        active_environment: environmentRoleKey(environment.name, environment.role)
      }
    };
    setOpenTopbarMenu(null);
    updateOutputRouteDraft(nextRoute.output_route_id, { environment_id: environment.environment_id });
    await saveTarget(nextTarget);
    setDirtyOutputRouteIds((current) => current.filter((routeId) => routeId !== nextRoute.output_route_id));
    setWorkspaceMessage(`Primary route and target active environment set to ${environment.name}. Regenerate preview jobs to apply it.`);
  }

  function runHeaderAction(action: "manual-import" | "preview" | "product-map" | "import-methods" | "jobs" | "target") {
    requestGuardedNavigation(() => {
      setOpenTopbarMenu(null);
      setActiveGlobalView("Customers");

      if (action === "manual-import") {
        setActiveCustomerView("Manual Import");
        return;
      }
      if (action === "preview") {
        setActiveCustomerView("Manual Import");
        void createPreviewJob();
        return;
      }
      if (action === "product-map") {
        setActiveCustomerView("Output Product Map");
        return;
      }
      if (action === "import-methods") {
        setActiveCustomerView("Import Methods");
        setIsImportMethodDetailOpen(false);
        return;
      }
      if (action === "jobs") {
        setActiveCustomerView("Jobs");
        return;
      }

      setActiveGlobalView("Targets");
      setSelectedTargetId(primaryOutputRoute.target_id);
      setActiveTargetsView("Output Routes");
    });
  }

  function requestGuardedNavigation(action: () => void) {
    if (
      activeGlobalView === "Customers" &&
      activeCustomerView === "Import Methods" &&
      isImportMethodDetailOpen &&
      activeImportMethodHasUnsavedChanges
    ) {
      pendingNavigationRef.current = action;
      setLeavePrompt({
        scope: "import-method",
        title: "Unsaved import method changes",
        body: "Save this import method before leaving, or continue without saving and reload the last saved version."
      });
      return;
    }

    if (activeGlobalView === "Targets" && selectedTarget && selectedTargetHasUnsavedChanges) {
      pendingNavigationRef.current = action;
      setLeavePrompt({
        scope: "target",
        title: "Unsaved target changes",
        body: "Save target, environment, output template, route, and value-rule changes before leaving, or continue without saving."
      });
      return;
    }

    action();
  }

  async function savePromptChangesAndContinue() {
    if (!leavePrompt) {
      return;
    }

    const action = pendingNavigationRef.current;
    const scope = leavePrompt.scope;
    setLeavePrompt(null);
    pendingNavigationRef.current = null;

    const saved =
      scope === "import-method" && activeImportMethod
        ? await saveImportMethod(activeImportMethod, mappings)
        : scope === "target" && selectedTarget
          ? await saveTarget(selectedTarget)
          : true;

    if (saved) {
      action?.();
    }
  }

  async function discardPromptChangesAndContinue() {
    if (!leavePrompt) {
      return;
    }

    const action = pendingNavigationRef.current;
    const scope = leavePrompt.scope;
    const targetId = selectedTarget?.target_id ?? null;
    setLeavePrompt(null);
    pendingNavigationRef.current = null;

    if (scope === "import-method") {
      await loadWorkspace(selectedCustomer.lift_customer_id);
    }

    if (scope === "target") {
      if (targetId) {
        setDirtyTargetIds((current) => current.filter((candidate) => candidate !== targetId));
        setDirtyOutputRouteIds((current) => {
          const routeIdsForTarget = new Set(
            outputRoutes.filter((route) => route.target_id === targetId).map((route) => route.output_route_id)
          );
          return current.filter((routeId) => !routeIdsForTarget.has(routeId));
        });
      }
      await loadTargetsAndJobs();
      await loadWorkspace(selectedCustomer.lift_customer_id);
    }

    action?.();
  }

  function cancelLeavePrompt() {
    setLeavePrompt(null);
    pendingNavigationRef.current = null;
  }

  function applyImportMethodSourceContext(method: ImportMethod) {
    const schema = method.source_config.detected_schema;
    methodTemplateFileRef.current = null;
    setSourceSchemaState("idle");
    setSourceSchemaMessage(null);

    if (schema?.columns.length) {
      setSourceGrid({ columns: schema.columns, rows: [] });
      setSourceSheets(
        schema.sheets.map((sheet) => ({
          ...sheet,
          parsed_rows: []
        }))
      );
      setParsedOrderRows([]);
      setReferenceRows([]);
      setSourceName(schema.source_file_name);
      setSheetName(schema.selected_sheet_name || schema.sheets[0]?.sheet_name || "Detected schema");
      setSelectedSourceSchemaSheetName(schema.selected_sheet_name || schema.sheets[0]?.sheet_name || "");
      return;
    }

    setSourceGrid({ columns: [], rows: [] });
    setSourceSheets([]);
    setParsedOrderRows([]);
    setReferenceRows([]);
    setSourceName("");
    setSheetName("");
    setSelectedSourceSchemaSheetName("");
  }

  async function detectImportMethodSourceSchema(file: File) {
    if (!activeImportMethod) {
      setSourceSchemaState("error");
      setSourceSchemaMessage("Choose an import method before detecting a source schema.");
      return;
    }

    setSourceSchemaState("detecting");
    setSourceSchemaMessage(null);

    try {
      const parserConfig = sourceParserConfigFromMethod(activeImportMethod.source_config);
      const parsed = await parseWorkbookArrayBuffer(await file.arrayBuffer(), {
        headerRow: parserConfig.header_row,
        headerRowCount: parserConfig.header_row_count,
        quantityColumn: parserConfig.quantity_column,
        ignoreRepeatedHeaders: parserConfig.ignore_repeated_headers,
        referenceRowsMode: parserConfig.reference_rows_mode,
        sheetHeaderOverrides: workbookSheetHeaderOverrides(parserConfig)
      });

      if (parsed.columns.length === 0) {
        throw new Error("No source columns were detected. Check the header row and upload the template again.");
      }

      const detectedSchema = detectedSourceSchemaFromWorkbook(file.name, parsed, parserConfig);
      const nextMappings = mappingsForSourceColumns(parsed.columns, activeImportMethod.mappings);

      setSourceGrid({ columns: parsed.columns, rows: parsed.rows });
      setSourceSheets(parsed.source_sheets);
      setParsedOrderRows(parsed.parsed_order_rows);
      setReferenceRows(parsed.reference_rows);
      setSourceName(file.name);
      setSheetName(parsed.sheetName);
      setSelectedSourceSchemaSheetName((current) =>
        parsed.sheetNames.includes(current) ? current : parsed.sheetName
      );
      setMappings(nextMappings);
      methodTemplateFileRef.current = file;
      setLastPreviewJob(null);
      setLastSubmitAttempt(null);
      updateActiveMethodDraft({
        mappings: nextMappings,
        source_config: {
          ...activeImportMethod.source_config,
          sample_template_name: file.name,
          detected_schema: detectedSchema
        }
      });
      setSourceSchemaState("idle");
      setSourceSchemaMessage(
        `${parsed.columns.length} columns detected across ${parsed.source_sheets.length} sheet${parsed.source_sheets.length === 1 ? "" : "s"}. Save Method to persist this schema.`
      );
    } catch (error) {
      setSourceSchemaState("error");
      setSourceSchemaMessage(error instanceof Error ? error.message : "Source schema detection failed.");
    }
  }

  function handleMethodTemplateChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    if (file) {
      void detectImportMethodSourceSchema(file);
    }
    event.target.value = "";
  }

  function updateSourceSheetHeaderOverride(sheetName: string, override: SourceSheetHeaderOverride | null) {
    if (!activeImportMethod) {
      return;
    }

    const nextOverrides = { ...(activeImportMethod.source_config.sheet_header_overrides ?? {}) };
    if (override) {
      nextOverrides[sheetName] = override;
    } else {
      delete nextOverrides[sheetName];
    }

    updateActiveMethodDraft({
      source_config: {
        ...activeImportMethod.source_config,
        sheet_header_overrides: nextOverrides
      }
    });
  }

  function useSampleSourceColumns() {
    if (!activeImportMethod) {
      return;
    }

    const nextMappings = mappingsForSourceColumns(sampleSourceGrid.columns, activeImportMethod.mappings);
    setSourceGrid(sampleSourceGrid);
    setSourceSheets(sampleSourceSheets(sampleSourceGrid));
    setParsedOrderRows(sampleParsedRows(sampleSourceGrid));
    setReferenceRows([]);
    setSourceName("Sample workbook");
    setSheetName("Sample");
    setSelectedSourceSchemaSheetName("");
    setMappings(nextMappings);
    methodTemplateFileRef.current = null;
    updateActiveMethodDraft({
      mappings: nextMappings,
      source_config: {
        ...activeImportMethod.source_config,
        sample_template_name: null,
        detected_schema: null
      }
    });
    setSourceSchemaState("idle");
    setSourceSchemaMessage("Sample columns restored. Save Method to keep this source setup.");
  }

  async function importWorkbook(file: File) {
    try {
      const parserConfig = sourceParserConfigFromMethod(manualImportMethod?.source_config ?? {});
      const parsed = await parseWorkbookArrayBuffer(await file.arrayBuffer(), {
        headerRow: parserConfig.header_row,
        headerRowCount: parserConfig.header_row_count,
        quantityColumn: parserConfig.quantity_column,
        ignoreRepeatedHeaders: parserConfig.ignore_repeated_headers,
        referenceRowsMode: parserConfig.reference_rows_mode,
        sheetHeaderOverrides: workbookSheetHeaderOverrides(parserConfig)
      });
      setSourceGrid({ columns: parsed.columns, rows: parsed.rows });
      setSourceSheets(parsed.source_sheets);
      setParsedOrderRows(parsed.parsed_order_rows);
      setReferenceRows(parsed.reference_rows);
      setMappings(
        manualImportMethod
          ? mappingsForSourceColumns(parsed.columns, manualImportMethod.mappings)
          : buildDefaultMappings(parsed.columns)
      );
      setSourceName(file.name);
      setSheetName(parsed.sheetName);
      setLastPreviewJob(null);
      setLastSubmitAttempt(null);
      setImportError(null);
      setActiveGlobalView("Customers");
      setActiveCustomerView("Manual Import");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Workbook import failed.");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    if (file) {
      void importWorkbook(file);
    }
    event.target.value = "";
  }

  function resetSample() {
    setSourceGrid(sampleSourceGrid);
    setSourceSheets(sampleSourceSheets(sampleSourceGrid));
    setParsedOrderRows(sampleParsedRows(sampleSourceGrid));
    setReferenceRows([]);
    setMappings(
      manualImportMethod
        ? mappingsForSourceColumns(sampleSourceGrid.columns, manualImportMethod.mappings)
        : buildDefaultMappings(sampleSourceGrid.columns)
    );
    setSourceName("Sample workbook");
    setSheetName("Sample");
    setLastPreviewJob(null);
    setLastSubmitAttempt(null);
    setImportError(null);
  }

  function changeManualImportBasis(nextMethodId: string) {
    const nextMethod = activeManualImportMethods.find((method) => method.import_method_id === nextMethodId) ?? null;
    setManualImportMethodId(nextMethod ? nextMethod.import_method_id : "ad-hoc");
    setMappings(
      nextMethod
        ? mappingsForSourceColumns(sourceGrid.columns, nextMethod.mappings)
        : buildDefaultMappings(sourceGrid.columns)
    );
    setLastPreviewJob(null);
    setLastSubmitAttempt(null);
    setImportError(null);
    setWorkspaceMessage(
      nextMethod
        ? `${nextMethod.name} is now the basis for parser settings, mappings, product resolution, order naming, and output routing.`
        : "Ad-hoc manual mapping is active. This upload will use the primary output route without changing a saved Import Method."
    );
  }

  function updateActiveMethodDraft(patch: Partial<ImportMethod>) {
    const methodId = activeImportMethod?.import_method_id;
    setWorkspace((current) => {
      if (!current || !activeImportMethod) {
        return current;
      }

      return {
        ...current,
        import_methods: current.import_methods.map((method) =>
          method.import_method_id === activeImportMethod.import_method_id ? { ...method, ...patch } : method
        )
      };
    });
    if (methodId) {
      setDirtyImportMethodIds((current) => (current.includes(methodId) ? current : [...current, methodId]));
    }
  }

  function updateActiveWrikeConfig(patch: Partial<WrikeSourceConfig>) {
    if (!activeImportMethod) {
      return;
    }
    setWrikeDiscoveryPreview(null);
    setWrikeDiscoveryMessage(null);
    setWrikeDiscoveryState("idle");
    updateActiveMethodDraft({
      source_config: {
        ...activeImportMethod.source_config,
        wrike: { ...activeWrikeConfig, ...patch }
      }
    });
  }

  function updateOutputRouteDraft(routeId: string, patch: Partial<OutputRoute>) {
    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        output_routes: current.output_routes.map((route) =>
          route.output_route_id === routeId ? { ...route, ...patch } : route
        )
      };
    });
    setDirtyOutputRouteIds((current) => (current.includes(routeId) ? current : [...current, routeId]));
  }

  function updateOutputRouteStrategyDraft(route: OutputRoute, nextType: OutputProductIdentifierType) {
    if (nextType === route.product_identifier_type) {
      return;
    }

    setRouteStrategyChanges((current) => {
      const originalType = current[route.output_route_id]?.from ?? route.product_identifier_type;
      const next = { ...current };
      if (nextType === originalType) {
        delete next[route.output_route_id];
      } else {
        next[route.output_route_id] = { from: originalType, to: nextType };
      }
      return next;
    });
    updateOutputRouteDraft(route.output_route_id, {
      product_identifier_type: nextType,
      product_identifier_label: outputIdentifierLabel(nextType)
    });
  }

  async function reviewRouteRemapQueue(route: OutputRoute) {
    if (selectedTarget && selectedTargetHasUnsavedChanges) {
      const saved = await saveTarget(selectedTarget);
      if (!saved) {
        return;
      }
    }

    setActiveGlobalView("Customers");
    setActiveCustomerView("Output Product Map");
    setOutputMapRouteFilter(route.output_route_id);
    setMigrationQueueRouteId(route.output_route_id);
    setUnitMapStatusFilter("All");
    setUnitMapSearch("");
    setSelectedUnitMapIds([]);
    setActiveCatalogMappingId(null);
    setOpenProductMapTool(null);
  }

  function updateTargetActiveEnvironmentDraft(targetId: string, environmentName: string) {
    const target = targetRows.find((candidate) => candidate.target_id === targetId);
    const environment = target?.environments.find((candidate) => candidate.name === environmentName);

    updateTargetDraft(targetId, (current) => ({
      ...current,
      lift: { ...current.lift, active_environment: environmentName as "QA1" | "PROD" }
    }));

    if (!environment) {
      return;
    }

    setWorkspace((current) =>
      current
        ? {
            ...current,
            output_routes: current.output_routes.map((route) =>
              route.target_id === targetId ? { ...route, environment_id: environment.environment_id } : route
            )
          }
        : current
    );
    setDirtyOutputRouteIds((current) => {
      const routeIdsForTarget = outputRoutes
        .filter((route) => route.target_id === targetId)
        .map((route) => route.output_route_id);
      return Array.from(new Set([...current, ...routeIdsForTarget]));
    });
  }

  function updateValueRuleDraft(routeId: string, ruleId: string, patch: Partial<ValueNormalizationRule>) {
    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        output_routes: current.output_routes.map((route) =>
          route.output_route_id === routeId
            ? {
                ...route,
                value_normalization_rules: (route.value_normalization_rules ?? []).map((rule) =>
                  rule.value_rule_id === ruleId ? { ...rule, ...patch } : rule
                )
              }
            : route
        )
      };
    });
    setDirtyOutputRouteIds((current) => (current.includes(routeId) ? current : [...current, routeId]));
  }

  function addValueRuleDraft(route: OutputRoute) {
    const timestamp = Date.now();
    updateOutputRouteDraft(route.output_route_id, {
      value_normalization_rules: [
        ...(route.value_normalization_rules ?? []),
        {
          value_rule_id: `value-rule-${timestamp}`,
          canonical_field: "order.shipping.method",
          output_field: "order.shipping.method",
          match_mode: "case_insensitive",
          input_value: "",
          normalized_value: "",
          fallback_behavior: "block_submit",
          status: "Draft",
          notes: ""
        }
      ]
    });
  }

  function removeValueRuleDraft(routeId: string, ruleId: string) {
    const route = outputRoutes.find((candidate) => candidate.output_route_id === routeId);
    if (!route) {
      return;
    }
    updateOutputRouteDraft(routeId, {
      value_normalization_rules: (route.value_normalization_rules ?? []).filter((rule) => rule.value_rule_id !== ruleId)
    });
  }

  async function saveOutputRoute(route: OutputRoute) {
    setWorkspaceState("saving");
    try {
      const nextWorkspace = await persistOutputRoute(route);
      setWorkspace(nextWorkspace);
      setDirtyOutputRouteIds((current) => current.filter((routeId) => routeId !== route.output_route_id));
      setRouteStrategyChanges((current) => {
        const next = { ...current };
        delete next[route.output_route_id];
        return next;
      });
      setWorkspaceMessage("Output route saved.");
      setWorkspaceState("idle");
      return true;
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Output route save failed.");
      setWorkspaceState("error");
      return false;
    }
  }

  async function saveProductMapping(mapping: CustomerProductMapping | ProductResolutionResult) {
    const customerProductKey = mapping.customer_product_key;
    const mappingId = "mapping_id" in mapping ? mapping.mapping_id : mappingIdFromKey(customerProductKey);
    const routeId = "output_route_id" in mapping ? mapping.output_route_id : selectedOutputMapRouteId;
    const mappingRoute =
      outputRoutes.find((route) => route.output_route_id === routeId) ??
      outputRoutes.find((route) => route.output_route_id === selectedOutputMapRouteId) ??
      activeOutputRoute;
    const draft = productMappingDrafts[productMappingDraftKey(mappingRoute.output_route_id, customerProductKey)];
    const currentUnit =
      draft?.unit ??
      ("mapping_id" in mapping
        ? productMappingIdentifierForRoute(mapping, mappingRoute)
        : mapping.resolved_product_identifier ?? mapping.resolved_unit_number ?? mapping.resolved_product_id) ??
      "";
    const currentProduct = draft?.product ?? mapping.product_name ?? mapping.display_label;

    if (!currentUnit.trim()) {
      setWorkspaceMessage(`Enter a ${mappingRoute.product_identifier_label} before approving the product mapping.`);
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/product-mappings/${mappingId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            output_route_id: mappingRoute.output_route_id,
            target_id: mappingRoute.target_id,
            target_template: mappingRoute.output_template,
            customer_product_key: customerProductKey,
            display_label: mapping.display_label,
            source_columns: mapping.source_columns,
            product_identifier_type: mappingRoute.product_identifier_type,
            product_identifier_value: currentUnit.trim(),
            lift_unit_number: mappingRoute.product_identifier_type === "lift_unit_number" ? currentUnit.trim() : null,
            lift_product_id: mappingRoute.product_identifier_type === "lift_product_id" ? currentUnit.trim() : null,
            product_name: currentProduct.trim() || mapping.display_label,
            status: "Mapped",
            mapping_source: "mapping_id" in mapping ? mapping.mapping_source ?? "Manual entry" : "Observed order",
            source_file_name: "mapping_id" in mapping ? mapping.source_file_name ?? null : sourceName,
            last_seen_examples:
              "mapping_id" in mapping
                ? mapping.last_seen_examples
                : [
                    {
                      sheet_name: mapping.source_sheet_name,
                      row_number: mapping.source_row_number,
                      description: mapping.display_label,
                      sign_type: mapping.customer_product_key,
                      media_type: null
                    }
                  ]
          })
        }
      );
      const payload = await readJsonResponse<{ product_mappings: CustomerProductMapping[] }>(response);
      setWorkspace((current) => (current ? { ...current, product_mappings: payload.product_mappings } : current));
      setWorkspaceMessage("Output product mapping approved. Regenerate preview to apply it.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Product mapping save failed.");
      setWorkspaceState("error");
    }
  }

  function handleCertificationAction(actionKey?: SubmitCertificationActionKey) {
    if (!actionKey) {
      return;
    }

    if (actionKey.startsWith("target-")) {
      setActiveGlobalView("Targets");
      setSelectedTargetId(activeOutputRoute.target_id);
      if (actionKey === "target-environments") {
        setActiveTargetsView("Environments");
      } else if (actionKey === "target-output-routes") {
        setActiveTargetsView("Output Routes");
      } else if (actionKey === "target-output-templates") {
        setActiveTargetsView("Output Templates");
        setActiveOutputTemplateId(activeOutputRoute.output_template_id);
      } else {
        setActiveTargetsView("Test & Health");
      }
      return;
    }

    setActiveGlobalView("Customers");
    if (actionKey === "product-map") {
      setOutputMapRouteFilter(activeOutputRoute.output_route_id);
      setActiveCustomerView("Output Product Map");
    } else if (actionKey === "field-mapping" || actionKey === "manual-import") {
      setActiveCustomerView("Manual Import");
    } else {
      setActiveCustomerView("Import Methods");
      setIsImportMethodDetailOpen(false);
    }
  }

  function handleRouteDiagnosticAction(route: OutputRoute, actionKey?: SubmitCertificationActionKey) {
    if (!actionKey) {
      return;
    }

    if (actionKey.startsWith("target-")) {
      setActiveGlobalView("Targets");
      setSelectedTargetId(route.target_id);
      if (actionKey === "target-environments") {
        setActiveTargetsView("Environments");
      } else if (actionKey === "target-output-routes") {
        setActiveTargetsView("Output Routes");
      } else if (actionKey === "target-output-templates") {
        setActiveTargetsView("Output Templates");
        setActiveOutputTemplateId(route.output_template_id);
      } else {
        setActiveTargetsView("Test & Health");
      }
      return;
    }

    handleCertificationAction(actionKey);
  }

  function downloadSubmitPacket() {
    downloadJsonFile(submitPacketFileName, {
      exported_at: new Date().toISOString(),
      export_context: {
        app: "Pathfinder",
        purpose: "Pre-submit Lift review packet",
        note: "Headers are masked as shown in Pathfinder. Secrets are not exported."
      },
      customer: {
        source_customer_id: selectedCustomer.lift_customer_id,
        source_customer_name: selectedCustomer.customer_name,
        submit_customer_id: submitCustomer.lift_customer_id,
        submit_customer_name: submitCustomer.customer_name,
        submit_profile_id: selectedSubmitProfile.profile_id,
        submit_profile_name: selectedSubmitProfile.name,
        submit_mode: selectedSubmitProfile.mode,
        sandbox: selectedSubmitProfile.mode === "sandbox_customer"
      },
      route: {
        output_route_id: activeOutputRoute.output_route_id,
        name: activeOutputRoute.name,
        status: activeOutputRoute.status,
        target_id: activeOutputRoute.target_id,
        target_system: activeOutputRoute.target_system,
        destination_account_name: activeOutputRoute.destination_account_name,
        destination_account_id: activeOutputRoute.destination_account_id,
        company_id: activeRouteCompanyId,
        product_identifier_type: activeOutputRoute.product_identifier_type,
        product_identifier_label: activeOutputRoute.product_identifier_label
      },
      target: {
        target_id: activeRouteTarget?.target_id ?? null,
        name: activeRouteTarget?.name ?? null,
        type: activeRouteTarget?.target_type ?? null,
        adapter: activeRouteTarget?.adapter ?? null,
        health_status: activeRouteTarget?.health_status ?? null
      },
      environment: {
        environment_id: activeRouteEnvironment?.environment_id ?? null,
        name: activeRouteEnvironment?.name ?? activeRouteEnvironmentLabel,
        role: activeRouteEnvironment?.role ?? null,
        status: activeRouteEnvironment?.status ?? null,
        endpoint_url: displayedSubmitRequest.endpoint_url,
        auth_method: activeRouteEnvironment?.auth_method ?? null,
        company_id: activeRouteCompanyId,
        credentials_present: {
          user: activeRouteUserSaved,
          password: activeRoutePasswordSaved
        }
      },
      output_template: {
        output_template_id: activeRouteTemplate?.output_template_id ?? activeOutputRoute.output_template_id,
        name: activeRouteTemplate?.name ?? activeOutputRoute.output_template,
        destination_method: activeRouteTemplate?.destination_method ?? null,
        output_format: activeRouteTemplate?.output_format ?? null,
        status: activeRouteTemplate?.status ?? null
      },
      job: lastPreviewJob
        ? {
            job_id: lastPreviewJob.job_id,
            state: lastPreviewJob.state,
            source_file_name: lastPreviewJob.source_file_name,
            created_at: lastPreviewJob.created_at,
            updated_at: lastPreviewJob.updated_at
          }
        : {
            job_id: null,
            state: "Not persisted",
            source_file_name: sourceName,
            created_at: null,
            updated_at: null
          },
      preflight: {
        blocked_count: submitPreflightBlockedCount,
        warning_count: submitPreflightWarningCount,
        items: submitPreflightItems
      },
      certification: submitCertification,
      validation: {
        canonical: lastPreviewJob?.canonical_validation ?? canonicalMessages,
        lift: lastPreviewJob?.lift_validation ?? liftMessages
      },
      product_resolution: {
        unresolved_products: lastPreviewJob?.unresolved_products ?? [],
        results: lastPreviewJob?.product_resolution_results ?? productResolutionRows
      },
      submit_request_masked: displayedSubmitRequest,
      canonical_order: displayedCanonicalOrder,
      lift_payload: displayedLiftPayload,
      last_submit_attempt: lastSubmitAttempt
    });
    setWorkspaceMessage(`Submit packet exported: ${submitPacketFileName}.`);
  }

  async function requestLiftSubmit(jobOverride?: ProcessingJobPreview, forceNewAttempt = false) {
    const submitJob = jobOverride ?? lastPreviewJob;
    if (!submitJob) {
      setWorkspaceMessage("Generate a persisted preview job before requesting Lift submit.");
      return;
    }
    if (prodSandboxConfirmationRequired && !prodSandboxSubmitConfirmed) {
      setWorkspaceMessage("Confirm the PROD sandbox submit lane in Lift Submit Preflight before requesting Lift submit.");
      setWorkspaceState("error");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${submitJob.customer_id}/jobs/${submitJob.job_id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            forceNewAttempt
              ? {
                  idempotency_key: `retry:${submitJob.job_id}:${Date.now()}`
                }
              : {}
          )
        }
      );
      const payload = (await response.json()) as {
        error?: string;
        attempt?: SubmitAttempt;
        job?: ProcessingJobPreview;
        reused?: boolean;
        message?: string;
        certification?: SubmitCertification;
        submit_request_masked?: ProcessingJobPreview["submit_request_masked"];
      };
      if (!payload.job && payload.certification) {
        const refreshedSubmitJob = {
          ...submitJob,
          submit_certification: payload.certification,
          submit_request_masked: payload.submit_request_masked ?? submitJob.submit_request_masked,
          updated_at: new Date().toISOString()
        };
        if (lastPreviewJob?.job_id === refreshedSubmitJob.job_id || submitJob.job_id === lastPreviewJob?.job_id) {
          setLastPreviewJob(refreshedSubmitJob);
        }
        if (selectedJobDetail?.job_id === refreshedSubmitJob.job_id || submitJob.job_id === selectedJobDetail?.job_id) {
          setSelectedJobDetail(refreshedSubmitJob);
        }
        setWorkspace((current) => (current ? { ...current, jobs: upsertJob(current.jobs, refreshedSubmitJob) } : current));
        setGlobalJobs((current) => upsertJob(current, refreshedSubmitJob));
      }
      if (payload.attempt) {
        const submitAttempt = payload.attempt;
        setLastSubmitAttempt(submitAttempt);
        if ((selectedJobDetail?.job_id ?? submitJob.job_id) === submitAttempt.job_id) {
          setSelectedJobAttempts((current) => [
            submitAttempt,
            ...current.filter((attempt) => attempt.attempt_id !== submitAttempt.attempt_id)
          ]);
        }
      }
      if (payload.job) {
        const submittedJob = payload.job;
        const submitAttempt = payload.attempt;
        if (lastPreviewJob?.job_id === submittedJob.job_id || submitJob.job_id === lastPreviewJob?.job_id) {
          setLastPreviewJob(submittedJob);
        }
        if (selectedJobDetail?.job_id === submittedJob.job_id || submitJob.job_id === selectedJobDetail?.job_id) {
          setSelectedJobDetail(submittedJob);
          if (submitAttempt) {
            setSelectedJobAttempts((current) => [
              submitAttempt,
              ...current.filter((attempt) => attempt.attempt_id !== submitAttempt.attempt_id)
            ]);
          }
        }
        setWorkspace((current) =>
          current
            ? {
                ...current,
                jobs: upsertJob(current.jobs, submittedJob),
                submit_attempts: submitAttempt
                  ? [submitAttempt, ...(current.submit_attempts ?? []).filter((attempt) => attempt.attempt_id !== submitAttempt.attempt_id)]
                  : current.submit_attempts
              }
            : current
        );
        setGlobalJobs((current) => upsertJob(current, submittedJob));
      }
      setWorkspaceMessage(payload.error ?? payload.message ?? "Lift submit request accepted.");
      setWorkspaceState(response.ok ? "idle" : "error");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift submit request failed.");
      setWorkspaceState("error");
    }
  }

  function toggleUnitMapping(mappingId: string) {
    setSelectedUnitMapIds((current) =>
      current.includes(mappingId) ? current.filter((id) => id !== mappingId) : [...current, mappingId]
    );
  }

  function toggleAllVisibleUnitMappings() {
    const visibleIds = filteredProductMappings.map((mapping) => mapping.mapping_id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedUnitMapIds.includes(id));
    setSelectedUnitMapIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds]))
    );
  }

  async function bulkUpdateProductMappings(
    patch: Partial<CustomerProductMapping>,
    successMessage: string,
    mappingsToUpdate = selectedUnitMappings
  ) {
    if (mappingsToUpdate.length === 0) {
      setWorkspaceMessage("Select one or more customer keys before applying a bulk action.");
      return false;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/product-mappings/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_mappings: mappingsToUpdate.map((mapping) => ({
            ...mapping,
            ...patch,
            status:
              patch.status ??
              (patch.product_identifier_value ||
              patch.lift_unit_number ||
              patch.lift_product_id ||
              mapping.product_identifier_value ||
              mapping.lift_unit_number ||
              mapping.lift_product_id
                ? "Mapped"
                : mapping.status)
          }))
        })
      });
      const payload = await readJsonResponse<{ product_mappings: CustomerProductMapping[] }>(response);
      setWorkspace((current) => (current ? { ...current, product_mappings: payload.product_mappings } : current));
      setSelectedUnitMapIds([]);
      setBulkUnitNumber("");
      setBulkProductName("");
      setWorkspaceMessage(successMessage);
      setWorkspaceState("idle");
      return true;
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Bulk product mapping save failed.");
      setWorkspaceState("error");
      return false;
    }
  }

  function openBulkProductMappingReview(args: {
    identifier: string;
    liftUnitNumber: string | null;
    liftProductId: string | null;
    productName: string | null;
    catalogScope: string;
    source: "manual" | "catalog";
  }) {
    if (selectedUnitMappings.length < 2) {
      setWorkspaceMessage("Select at least two Pathfinder rows for bulk mapping, or use Map Product on a single row.");
      return;
    }

    setBulkProductMappingReview({
      mappings: selectedUnitMappings.map((mapping) => ({
        mapping_id: mapping.mapping_id,
        customer_product_key: mapping.customer_product_key,
        display_label: mapping.display_label || mapping.customer_product_key,
        current_identifier: productMappingIdentifierForRoute(mapping, selectedOutputMapRoute) || null
      })),
      route_id: selectedOutputMapRoute.output_route_id,
      route_name: selectedOutputMapRoute.name,
      identifier_type: selectedOutputMapRoute.product_identifier_type,
      identifier_label: selectedOutputMapRoute.product_identifier_label,
      identifier: args.identifier,
      lift_unit_number: args.liftUnitNumber,
      lift_product_id: args.liftProductId,
      product_name: args.productName,
      catalog_scope: args.catalogScope,
      source: args.source
    });
  }

  function bulkAssignUnitNumber() {
    if (!bulkUnitNumber.trim()) {
      setWorkspaceMessage(`Enter a ${selectedOutputMapRoute.product_identifier_label} before assigning selected customer keys.`);
      return;
    }
    openBulkProductMappingReview({
      identifier: bulkUnitNumber.trim(),
      liftUnitNumber: selectedOutputMapRoute.product_identifier_type === "lift_unit_number" ? bulkUnitNumber.trim() : null,
      liftProductId: selectedOutputMapRoute.product_identifier_type === "lift_product_id" ? bulkUnitNumber.trim() : null,
      productName: bulkProductName.trim() || selectedUnitMappings[0]?.product_name || null,
      catalogScope: activeCatalogScopeId ? `${activeCatalogScopeName} / ${activeCatalogScopeId}` : "Manual identifier entry",
      source: "manual"
    });
  }

  async function confirmBulkProductMappingReview() {
    if (!bulkProductMappingReview) {
      return;
    }

    const review = bulkProductMappingReview;
    const reviewRoute = outputRoutes.find((route) => route.output_route_id === review.route_id);
    if (!reviewRoute || reviewRoute.product_identifier_type !== review.identifier_type) {
      setWorkspaceMessage("The output route strategy changed before confirmation. Review the bulk mapping again.");
      setBulkProductMappingReview(null);
      return;
    }
    if (
      (review.identifier_type === "lift_product_id" && !review.lift_product_id) ||
      (review.identifier_type === "lift_unit_number" && !review.lift_unit_number)
    ) {
      setWorkspaceMessage(`The selected product does not provide the ${review.identifier_label} required by this route.`);
      setBulkProductMappingReview(null);
      return;
    }
    const mappingsToUpdate = productMappings.filter(
      (mapping) => mapping.output_route_id === review.route_id && review.mappings.some((item) => item.mapping_id === mapping.mapping_id)
    );
    if (mappingsToUpdate.length !== review.mappings.length) {
      setWorkspaceMessage("One or more selected Pathfinder rows changed before confirmation. Review the bulk mapping again.");
      setBulkProductMappingReview(null);
      return;
    }

    const saved = await bulkUpdateProductMappings(
      {
        output_route_id: review.route_id,
        target_id: reviewRoute.target_id,
        target_template: reviewRoute.output_template,
        product_identifier_type: review.identifier_type,
        product_identifier_value: review.identifier,
        lift_unit_number: review.lift_unit_number,
        lift_product_id: review.lift_product_id,
        product_name: review.product_name,
        status: "Mapped"
      },
      `${review.mappings.length} customer keys mapped to ${review.identifier}.`,
      mappingsToUpdate
    );
    if (!saved) {
      return;
    }

    setBulkProductMappingReview(null);
    if (review.source === "catalog") {
      setOpenProductMapTool(null);
      setSelectedCatalogDetailId(null);
    }
  }

  function catalogUnitNumbers(item: LiftUnitCatalogItem) {
    return Array.from(new Set([...(item.unit_number ? [item.unit_number] : []), ...(item.unit_numbers ?? [])].filter(Boolean)));
  }

  function selectedCatalogUnitNumber(item: LiftUnitCatalogItem) {
    const unitNumbers = catalogUnitNumbers(item);
    return selectedCatalogUnitNumbers[item.catalog_item_id] || item.unit_number || unitNumbers[0] || null;
  }

  function catalogIdentifierForRoute(item: LiftUnitCatalogItem, route: OutputRoute) {
    const primaryUnitNumber = selectedCatalogUnitNumber(item) ?? "";
    if (route.product_identifier_type === "lift_product_id") {
      return item.product_id ?? "";
    }
    if (route.product_identifier_type === "lift_unit_number") {
      return primaryUnitNumber;
    }
    return primaryUnitNumber || item.product_id || "";
  }

  function catalogIdentifierLabel(item: LiftUnitCatalogItem, route: OutputRoute) {
    if (route.product_identifier_type === "lift_product_id") {
      return item.product_id ? `Product ID ${item.product_id}` : "Product ID unavailable";
    }

    const unitNumbers = catalogUnitNumbers(item);
    const selectedUnitNumber = selectedCatalogUnitNumber(item);
    if (unitNumbers.length > 1) {
      return `${selectedUnitNumber ?? unitNumbers[0]} + ${unitNumbers.length - 1} more`;
    }
    if (route.product_identifier_type === "lift_unit_number") {
      return selectedUnitNumber ?? "Unit number unavailable";
    }
    return selectedUnitNumber ?? (item.product_id ? `Product ID ${item.product_id}` : "No route product identifier");
  }

  function formatCatalogValue(value: unknown): string {
    if (value === null || value === undefined || value === "") {
      return "-";
    }
    if (Array.isArray(value)) {
      return value.length ? value.map((entry) => formatCatalogValue(entry)).join(", ") : "-";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  function catalogDetailRows(item: LiftUnitCatalogItem) {
    const rawEntries = Object.entries(item.raw_payload ?? {}).map(([field, value]) => ({
      field,
      value: formatCatalogValue(value)
    }));
    if (rawEntries.length) {
      return rawEntries.sort((first, second) => first.field.localeCompare(second.field));
    }

    const normalizedEntries = [
      ["product_id", item.product_id],
      ["unit_number", item.unit_number],
      ["product_name", item.product_name],
      ["catalog_id", item.catalog_id],
      ["catalog_name", item.catalog_name],
      ["accounting_item_code", item.accounting_item_code],
      ["product_type", item.product_type],
      ["parent_product_id", item.parent_product_id],
      ["status", item.status],
      ["attribute_1", item.attribute_1],
      ["attribute_2", item.attribute_2],
      ["material_id", item.material_id],
      ["storage_type_id", item.storage_type_id],
      ["warehouse_location_id", item.warehouse_location_id],
      ["description", item.description],
      ["source", item.source]
    ].map(([field, value]) => ({ field: String(field), value: formatCatalogValue(value) }));

    return normalizedEntries;
  }

  function setBulkValueFromCatalog(item: LiftUnitCatalogItem) {
    const identifier = catalogIdentifierForRoute(item, selectedOutputMapRoute);
    if (!identifier) {
      setWorkspaceMessage(
        `This Lift product does not provide the ${selectedOutputMapRoute.product_identifier_label} required by this route.`
      );
      return;
    }
    setBulkUnitNumber(identifier);
    setBulkProductName(item.product_name);
    setWorkspaceMessage(`${identifier || item.product_name} selected for bulk assignment.`);
  }

  function openCatalogForMapping(mapping: CustomerProductMapping) {
    setSelectedUnitMapIds([mapping.mapping_id]);
    setActiveCatalogMappingId(mapping.mapping_id);
    setSelectedCatalogDetailId(null);
    setUnitCatalogSearch(mapping.product_name ?? mapping.display_label ?? mapping.customer_product_key);
    setOpenProductMapTool("unit-library");
  }

  async function assignCatalogItemToMapping(mapping: CustomerProductMapping, item: LiftUnitCatalogItem) {
    const identifier = catalogIdentifierForRoute(item, selectedOutputMapRoute);
    if (!identifier) {
      setWorkspaceMessage(
        `This Lift product cannot be mapped because it does not provide the ${selectedOutputMapRoute.product_identifier_label} required by this route.`
      );
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/product-mappings/${mapping.mapping_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...mapping,
            output_route_id: selectedOutputMapRoute.output_route_id,
            target_id: selectedOutputMapRoute.target_id,
            target_template: selectedOutputMapRoute.output_template,
            product_identifier_type: selectedOutputMapRoute.product_identifier_type,
            product_identifier_value: identifier,
            lift_unit_number: selectedCatalogUnitNumber(item),
            lift_product_id: item.product_id,
            product_name: item.product_name,
            status: "Mapped"
          })
        }
      );
      const payload = await readJsonResponse<{ product_mappings: CustomerProductMapping[] }>(response);
      setWorkspace((current) => (current ? { ...current, product_mappings: payload.product_mappings } : current));
      setSelectedUnitMapIds([]);
      setActiveCatalogMappingId(null);
      setSelectedCatalogDetailId(null);
      setOpenProductMapTool(null);
      setWorkspaceMessage(
        `${mapping.customer_product_key} mapped to route product identifier ${identifier}. Regenerate preview to apply it.`
      );
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Product mapping save failed.");
      setWorkspaceState("error");
    }
  }

  async function assignCatalogItemToSelectedMappings(item: LiftUnitCatalogItem) {
    if (activeCatalogMapping) {
      await assignCatalogItemToMapping(activeCatalogMapping, item);
      return;
    }

    if (selectedUnitMappings.length < 2) {
      setWorkspaceMessage("Select at least two Pathfinder rows for bulk mapping, or use Map Product on a single row.");
      return;
    }

    const identifier = catalogIdentifierForRoute(item, selectedOutputMapRoute);
    if (!identifier) {
      setWorkspaceMessage(
        `This Lift product cannot be mapped because it does not provide the ${selectedOutputMapRoute.product_identifier_label} required by this route.`
      );
      return;
    }

    openBulkProductMappingReview({
      identifier,
      liftUnitNumber: selectedCatalogUnitNumber(item),
      liftProductId: item.product_id,
      productName: item.product_name,
      catalogScope:
        item.catalog_name ??
        item.catalog_id ??
        (activeCatalogScopeId ? `${activeCatalogScopeName} / ${activeCatalogScopeId}` : "Current Lift result set"),
      source: "catalog"
    });
  }

  function setPreloadDefaultFromCatalog(item: LiftUnitCatalogItem) {
    setPreloadDefaultUnit(catalogIdentifierForRoute(item, selectedOutputMapRoute));
    if (!preloadSourceName.trim()) {
      setPreloadSourceName("Customer product list");
    }
    setWorkspaceMessage(`${catalogIdentifierForRoute(item, selectedOutputMapRoute) || item.product_name} selected as the preload default identifier.`);
  }

  function parsePreloadProductList() {
    const parsed = parseDelimitedProductList(preloadText);
    if (!parsed.columns.length || !parsed.rows.length) {
      setWorkspaceMessage("Paste a product list with a header row and at least one product row.");
      return;
    }

    const defaultSourceColumn = parsed.columns.includes(selectedOutputMapProductConfig.source_column)
      ? selectedOutputMapProductConfig.source_column
      : parsed.columns[0];
    const guessedProductColumn =
      parsed.columns.find((column) => /product|description|label|name/i.test(column)) ?? "";
    const guessedUnitColumn =
      parsed.columns.find((column) => /unit|lift|sku|identifier/i.test(column)) ?? "";
    const guessedFinalWidthColumn = findPreloadDimensionColumn(parsed.columns, "width");
    const guessedFinalHeightColumn = findPreloadDimensionColumn(parsed.columns, "height");

    setPreloadGrid(parsed);
    setPreloadSourceColumn(defaultSourceColumn);
    setPreloadProductNameColumn(guessedProductColumn);
    setPreloadUnitColumn(guessedUnitColumn === defaultSourceColumn ? "" : guessedUnitColumn);
    setPreloadFinalWidthColumn(guessedFinalWidthColumn);
    setPreloadFinalHeightColumn(guessedFinalHeightColumn);
    setPreloadSelectedIds([]);
    setWorkspaceMessage(`${parsed.rows.length} customer product row${parsed.rows.length === 1 ? "" : "s"} parsed for review.`);
  }

  async function importPreloadCatalogFile(file: File) {
    try {
      const parsed = await parseWorkbookArrayBuffer(await file.arrayBuffer());
      const grid = { columns: parsed.columns, rows: parsed.rows };
      const defaultSourceColumn = grid.columns.includes(selectedOutputMapProductConfig.source_column)
        ? selectedOutputMapProductConfig.source_column
        : grid.columns[0] ?? "";
      const guessedProductColumn =
        grid.columns.find((column) => /product|description|label|name/i.test(column)) ?? "";
      const guessedUnitColumn =
        grid.columns.find((column) => /unit|lift|sku|identifier/i.test(column)) ?? "";
      const guessedFinalWidthColumn = findPreloadDimensionColumn(grid.columns, "width");
      const guessedFinalHeightColumn = findPreloadDimensionColumn(grid.columns, "height");

      setPreloadGrid(grid);
      setPreloadSourceName(file.name);
      setPreloadSourceColumn(defaultSourceColumn);
      setPreloadProductNameColumn(guessedProductColumn);
      setPreloadUnitColumn(guessedUnitColumn === defaultSourceColumn ? "" : guessedUnitColumn);
      setPreloadFinalWidthColumn(guessedFinalWidthColumn);
      setPreloadFinalHeightColumn(guessedFinalHeightColumn);
      setPreloadSelectedIds([]);
      setWorkspaceMessage(`${grid.rows.length} product row${grid.rows.length === 1 ? "" : "s"} loaded from ${file.name}.`);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Product list upload failed.");
    }
  }

  function togglePreloadRow(rowId: string) {
    setPreloadSelectedIds((current) =>
      current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId]
    );
  }

  function toggleAllPreloadRows() {
    const validIds = validPreloadRows.map((row) => row.row_id);
    const allSelected = validIds.length > 0 && validIds.every((id) => preloadSelectedIds.includes(id));
    setPreloadSelectedIds((current) =>
      allSelected ? current.filter((id) => !validIds.includes(id)) : Array.from(new Set([...current, ...validIds]))
    );
  }

  async function savePreloadedProductMappings(scope: "selected" | "all") {
    const rowsToSave = scope === "selected" ? selectedPreloadRows : validPreloadRows;
    const saveableRows = rowsToSave.filter((row) => row.customer_product_key && row.action !== "Duplicate");

    if (!saveableRows.length) {
      setWorkspaceMessage("No valid preloaded product rows are ready to save.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/product-mappings/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_mappings: saveableRows.map((row) => {
            const productIdentifierValue =
              row.product_identifier_value || row.existing_mapping?.product_identifier_value || null;
            const liftUnitNumber =
              selectedOutputMapRoute.product_identifier_type === "lift_unit_number"
                ? row.product_identifier_value || row.existing_mapping?.lift_unit_number || null
                : row.existing_mapping?.lift_unit_number ?? null;
            const liftProductId =
              selectedOutputMapRoute.product_identifier_type === "lift_product_id"
                ? row.product_identifier_value || row.existing_mapping?.lift_product_id || null
                : row.existing_mapping?.lift_product_id ?? null;
            const productName = row.product_name || row.existing_mapping?.product_name || row.display_label;

            return {
              ...(row.existing_mapping ?? {}),
              mapping_id: row.existing_mapping?.mapping_id ?? mappingIdFromKey(row.customer_product_key),
              output_route_id: selectedOutputMapRoute.output_route_id,
              target_id: selectedOutputMapRoute.target_id,
              target_template: selectedOutputMapRoute.output_template,
              customer_product_key: row.customer_product_key,
              display_label: row.display_label,
              source_columns: row.source_columns,
              product_identifier_type: selectedOutputMapRoute.product_identifier_type,
              product_identifier_value: productIdentifierValue,
              lift_unit_number: liftUnitNumber,
              lift_product_id: liftProductId,
              product_name: productName,
              status: productIdentifierValue || liftUnitNumber || liftProductId ? "Mapped" : "Unmapped",
              mapping_source: "Preloaded catalog",
              source_file_name: preloadSourceName.trim() || "Customer product list",
              last_seen_examples: [
                {
                  sheet_name: preloadSourceName.trim() || "Preloaded catalog",
                  row_number: row.row_number,
                  description: row.product_name || row.display_label,
                  sign_type: row.source_value || null,
                  media_type: null,
                  final_width: row.final_width || null,
                  final_height: row.final_height || null
                },
                ...(row.existing_mapping?.last_seen_examples ?? []).filter(
                  (example) =>
                    example.sheet_name !== (preloadSourceName.trim() || "Preloaded catalog") ||
                    example.row_number !== row.row_number
                )
              ].slice(0, 8)
            };
          })
        })
      });
      const payload = await readJsonResponse<{ product_mappings: CustomerProductMapping[] }>(response);
      setWorkspace((current) => (current ? { ...current, product_mappings: payload.product_mappings } : current));
      setPreloadSelectedIds([]);
      setWorkspaceMessage(
        `${saveableRows.length} preloaded product key${saveableRows.length === 1 ? "" : "s"} saved to ${selectedOutputMapRoute.name}.`
      );
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Preloaded product map save failed.");
      setWorkspaceState("error");
    }
  }

  function openImportMethodDetail(method: ImportMethod) {
    setActiveMethodId(method.import_method_id);
    setMappings(method.mappings);
    applyImportMethodSourceContext(method);
    setProductExampleTestValue("");
    setIsImportMethodDetailOpen(true);
  }

  function createDraftImportMethod() {
    if (!workspace) {
      setWorkspaceMessage("Workspace is still loading. Try again in a moment.");
      return;
    }

    const timestamp = new Date().toISOString();
    const method: ImportMethod = {
      import_method_id: `method-${Date.now()}`,
      name: "New Import Method",
      type: "Manual upload",
      source: "XLSX",
      status: "Draft",
      output_route_id: activeOutputRoute.output_route_id,
      target_id: activeOutputRoute.target_id,
      target_template: activeOutputRoute.output_template,
      template_id: `template-${Date.now()}`,
      mappings: [],
      source_config: {},
      workbook_sheet_policy: "rows_with_quantity",
      product_resolution_config: defaultProductResolutionConfig,
      order_name_resolution_config: defaultOrderNameResolutionConfig,
      ext_id_strategy: "pathfinder_generated",
      public_intake: { ...defaultPublicIntakeConfig },
      last_run_at: null,
      success_rate: null,
      created_at: timestamp,
      updated_at: timestamp
    };

    setWorkspace({
      ...workspace,
      import_methods: [method, ...workspace.import_methods]
    });
    setActiveMethodId(method.import_method_id);
    setMappings(method.mappings);
    applyImportMethodSourceContext(method);
    setIsImportMethodDetailOpen(true);
    setActiveCustomerView("Import Methods");
    setLocalDraftImportMethodIds((current) =>
      current.includes(method.import_method_id) ? current : [...current, method.import_method_id]
    );
    setDirtyImportMethodIds((current) =>
      current.includes(method.import_method_id) ? current : [...current, method.import_method_id]
    );
    setWorkspaceMessage("New import method is a local draft. Review it, then save when ready.");
  }

  function duplicateImportMethod(method: ImportMethod) {
    if (!workspace) {
      return;
    }

    const timestamp = new Date().toISOString();
    const methodId = `method-${Date.now()}`;
    const duplicate: ImportMethod = {
      ...method,
      import_method_id: methodId,
      name: `${method.name} Copy`,
      status: "Draft",
      template_id: `template-${Date.now()}`,
      last_run_at: null,
      success_rate: null,
      created_at: timestamp,
      updated_at: timestamp
    };

    setWorkspace({
      ...workspace,
      import_methods: [duplicate, ...workspace.import_methods]
    });
    setActiveMethodId(methodId);
    setMappings(duplicate.mappings);
    applyImportMethodSourceContext(duplicate);
    setIsImportMethodDetailOpen(true);
    setActiveCustomerView("Import Methods");
    setLocalDraftImportMethodIds((current) =>
      current.includes(methodId) ? current : [...current, methodId]
    );
    setDirtyImportMethodIds((current) => (current.includes(methodId) ? current : [...current, methodId]));
    setWorkspaceMessage("Duplicated import method is a local draft. Review it, then save when ready.");
  }

  function requestImportMethodDelete(method: ImportMethod) {
    if (!workspace || importMethods.length <= 1) {
      setWorkspaceMessage("Keep at least one import method for this customer.");
      return;
    }

    setDestructiveConfirmation({ kind: "import-method", method });
  }

  async function performImportMethodDelete(method: ImportMethod) {
    if (!workspace) {
      return;
    }

    if (localDraftImportMethodIds.includes(method.import_method_id)) {
      const remainingMethods = workspace.import_methods.filter(
        (candidate) => candidate.import_method_id !== method.import_method_id
      );
      const nextMethod = remainingMethods.find((candidate) => candidate.status !== "Archived");
      setWorkspace({ ...workspace, import_methods: remainingMethods });
      setDirtyImportMethodIds((current) => current.filter((methodId) => methodId !== method.import_method_id));
      setLocalDraftImportMethodIds((current) => current.filter((methodId) => methodId !== method.import_method_id));
      setActiveMethodId(nextMethod?.import_method_id ?? "manual-xlsx");
      setIsImportMethodDetailOpen(false);
      setWorkspaceMessage("Local import method draft discarded.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/import-methods/${method.import_method_id}`,
        { method: "DELETE" }
      );
      const nextWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      const nextMethod = nextWorkspace.import_methods.find((candidate) => candidate.status !== "Archived");
      setWorkspace(nextWorkspace);
      setDirtyImportMethodIds((current) => current.filter((methodId) => methodId !== method.import_method_id));
      setLocalDraftImportMethodIds((current) => current.filter((methodId) => methodId !== method.import_method_id));
      setActiveMethodId(nextMethod?.import_method_id ?? "manual-xlsx");
      if (method.import_method_id === activeMethodId) {
        setIsImportMethodDetailOpen(false);
      }
      setWorkspaceMessage("Import method archived.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Import method delete failed.");
      setWorkspaceState("error");
    }
  }

  async function performPublicIntakeLinkLifecycle(method: ImportMethod, action: "rotate" | "revoke") {
    if (!workspace) {
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/import-methods/${method.import_method_id}/public-intake/${action}`,
        { method: "POST" }
      );
      const nextWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      setWorkspace(nextWorkspace);
      setDirtyImportMethodIds((current) => current.filter((methodId) => methodId !== method.import_method_id));
      setWorkspaceMessage(
        action === "rotate"
          ? "Customer Order Dropbox link rotated. The previous URL no longer works."
          : "Customer Order Dropbox link revoked and unpublished."
      );
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : `Customer Order Dropbox link ${action} failed.`);
      setWorkspaceState("error");
    }
  }

  function requestTargetDelete(target: TargetConfig) {
    const currentRouteCount = outputRoutes.filter((route) => route.target_id === target.target_id).length;
    if (currentRouteCount > 0) {
      setWorkspaceMessage(
        `${target.name} is used by ${currentRouteCount} output route${currentRouteCount === 1 ? "" : "s"}. Reassign or remove those routes before deleting the target.`
      );
      return;
    }
    setDestructiveConfirmation({ kind: "target", target });
  }

  async function performTargetDelete(target: TargetConfig) {
    if (localDraftTargetIds.includes(target.target_id)) {
      setTargets((current) => current.filter((candidate) => candidate.target_id !== target.target_id));
      setDirtyTargetIds((current) => current.filter((targetId) => targetId !== target.target_id));
      setLocalDraftTargetIds((current) => current.filter((targetId) => targetId !== target.target_id));
      setSelectedTargetId((current) => (current === target.target_id ? null : current));
      setWorkspaceMessage("Local target draft discarded.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/targets/${target.target_id}`, { method: "DELETE" });
      const payload = await readJsonResponse<{ targets: TargetConfig[] }>(response);
      setTargets(payload.targets);
      setDirtyTargetIds((current) => current.filter((targetId) => targetId !== target.target_id));
      setLocalDraftTargetIds((current) => current.filter((targetId) => targetId !== target.target_id));
      setSelectedTargetId((current) => (current === target.target_id ? null : current));
      setWorkspaceMessage(`${target.name} deleted.`);
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Target delete failed.");
      setWorkspaceState("error");
    }
  }

  async function confirmDestructiveAction() {
    const confirmation = destructiveConfirmation;
    if (!confirmation) {
      return;
    }

    setDestructiveConfirmation(null);
    if (confirmation.kind === "import-method") {
      await performImportMethodDelete(confirmation.method);
    } else if (confirmation.kind === "public-intake-link") {
      await performPublicIntakeLinkLifecycle(confirmation.method, confirmation.action);
    } else if (confirmation.kind === "target") {
      await performTargetDelete(confirmation.target);
    } else if (confirmation.kind === "jobs") {
      await updateJobsArchived(confirmation.jobs, confirmation.archived);
    } else {
      removeTargetEnvironmentDraft(confirmation.target_id, confirmation.environment_id);
    }
  }

  function updateTargetDraft(targetId: string, updater: (target: TargetConfig) => TargetConfig) {
    setTargets((current) => current.map((target) => (target.target_id === targetId ? updater(target) : target)));
    setWorkspace((current) =>
      current?.primary_target?.target_id === targetId
        ? { ...current, primary_target: updater(current.primary_target) }
        : current
    );
    setDirtyTargetIds((current) => (current.includes(targetId) ? current : [...current, targetId]));
  }

  function updateTargetEnvironmentDraft(
    targetId: string,
    environmentId: string,
    updater: (environment: TargetEnvironment) => TargetEnvironment
  ) {
    updateTargetDraft(targetId, (target) => {
      const nextEnvironments = target.environments.map((environment) =>
        environment.environment_id === environmentId ? updater(environment) : environment
      );
      const qaEnvironment = nextEnvironments.find((environment) => environment.name === "QA1");
      const prodEnvironment = nextEnvironments.find((environment) => environment.name === "PROD");
      const activeEnvironment = nextEnvironments.find((environment) => environment.name === target.lift.active_environment);

      return {
        ...target,
        environments: nextEnvironments,
        lift: {
          ...target.lift,
          environments: {
            QA1: { endpoint_url: qaEnvironment?.endpoint_url ?? target.lift.environments.QA1.endpoint_url },
            PROD: { endpoint_url: prodEnvironment?.endpoint_url ?? target.lift.environments.PROD.endpoint_url }
          },
          credentials: {
            ...target.lift.credentials,
            ...(activeEnvironment?.credentials ?? {})
          },
          headers: {
            ...target.lift.headers,
            Company: activeEnvironment?.headers.Company ?? target.lift.headers.Company
          }
        }
      };
    });
  }

  function addTargetEnvironmentDraft(targetId: string) {
    updateTargetDraft(targetId, (target) => {
      const timestamp = Date.now();
      const nextEnvironment: TargetEnvironment = {
        environment_id: `env-${target.target_id}-${timestamp}`,
        name: `ENV ${target.environments.length + 1}`,
        role: "Custom",
        endpoint_url: "",
        auth_method: "Header credentials",
        headers: {
          "Content-Type": "application/json",
          Company: target.lift.headers.Company,
          Ext_ID: "body.order.ext_id"
        },
        credentials: {
          User: target.lift.credentials.User,
          Password: target.lift.credentials.Password
        },
        status: "Draft",
        last_test_at: null,
        last_test_status: "Not tested"
      };

      return {
        ...target,
        environments: [...target.environments, nextEnvironment]
      };
    });
  }

  function removeTargetEnvironmentDraft(targetId: string, environmentId: string) {
    updateTargetDraft(targetId, (target) => {
      if (target.environments.length <= 1) {
        setWorkspaceMessage("A target needs at least one environment.");
        setWorkspaceState("error");
        return target;
      }

      const environment = target.environments.find((candidate) => candidate.environment_id === environmentId);
      if (environment?.name === target.lift.active_environment) {
        setWorkspaceMessage("Choose a different active environment before removing this one.");
        setWorkspaceState("error");
        return target;
      }
      if (environment && isProtectedTargetEnvironment(environment)) {
        setWorkspaceMessage("Seeded Lift environments can be marked inactive, but not removed.");
        setWorkspaceState("error");
        return target;
      }

      const nextEnvironments = target.environments.filter((candidate) => candidate.environment_id !== environmentId);
      const fallbackEnvironmentId = nextEnvironments[0]?.environment_id;
      const affectedRouteIds = (workspace?.output_routes ?? [])
        .filter((route) => route.target_id === targetId && route.environment_id === environmentId)
        .map((route) => route.output_route_id);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              output_routes: current.output_routes.map((route) =>
                route.target_id === targetId && route.environment_id === environmentId && fallbackEnvironmentId
                  ? { ...route, environment_id: fallbackEnvironmentId }
                  : route
              )
            }
          : current
      );
      setDirtyOutputRouteIds((current) => Array.from(new Set([...current, ...affectedRouteIds])));
      setWorkspaceMessage(`${environment?.name ?? "Environment"} removed from draft target setup. Save Target to persist.`);
      setWorkspaceState("idle");

      return {
        ...target,
        environments: nextEnvironments
      };
    });
  }

  function updateOutputTemplateDraft(
    targetId: string,
    templateId: string,
    updater: (template: OutputTemplate) => OutputTemplate
  ) {
    updateTargetDraft(targetId, (target) => ({
      ...target,
      output_templates: target.output_templates.map((template) =>
        template.output_template_id === templateId ? updater(template) : template
      )
    }));
  }

  function createDraftEnvironment(targetSlug: string): TargetEnvironment {
    return {
      environment_id: `env-${targetSlug}-qa1`,
      name: "QA1",
      role: "DEV",
      endpoint_url: "",
      auth_method: "None",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: {},
      status: "Draft",
      last_test_at: null,
      last_test_status: "Not tested"
    };
  }

  function createDraftOutputTemplate(targetSlug: string): OutputTemplate {
    const timestamp = new Date().toISOString();
    return {
      output_template_id: `template-${targetSlug}-${Date.now()}`,
      name: "New Output Template",
      destination_method: "HTTP POST",
      output_format: "JSON",
      body_template: JSON.stringify(
        {
          order_id: "example-order-id",
          customer_name: "Example Customer",
          lines: [
            {
              unit_number: "EXAMPLE-UNIT",
              quantity: 1
            }
          ]
        },
        null,
        2
      ),
      header_template: JSON.stringify(
        {
          "Content-Type": "application/json",
          Ext_ID: "example-order-id"
        },
        null,
        2
      ),
      canonical_mappings: [],
      filename_format: "orders-%y-%m-%d-%h-%i-%s.json",
      status: "Draft",
      updated_at: timestamp
    };
  }

  function addTargetDraft() {
    const timestamp = new Date().toISOString();
    const targetSlug = `new-target-${Date.now()}`;
    const template = createDraftOutputTemplate(targetSlug);
    const target: TargetConfig = {
      target_id: targetSlug,
      name: "New Target",
      target_type: "Custom",
      adapter: "lift-standard-graphics",
      format: "JSON",
      template: template.name,
      status: "Draft",
      health_status: "Untested",
      environments: [createDraftEnvironment(targetSlug)],
      output_templates: [template],
      lift: {
        destination_adapter: "lift-standard-graphics",
        active_environment: "QA1",
        environments: {
          QA1: { endpoint_url: "" },
          PROD: { endpoint_url: "" }
        },
        headers: {
          "Content-Type": "application/json",
          Company: "",
          Ext_ID: {
            strategy: "field",
            field: "order.ext_id",
            body_field: "order.ext_id",
            must_match_body: true,
            default_source_field: "canonical.order.external_order_id",
            fallback_fields: []
          }
        },
        credentials: {
          User: "",
          Password: ""
        }
      },
      last_test_at: null,
      updated_at: timestamp
    };

    setTargets((current) => [target, ...current]);
    setSelectedTargetId(target.target_id);
    setActiveTargetsView("Environments");
    setActiveOutputTemplateId(template.output_template_id);
    setDirtyTargetIds((current) => (current.includes(target.target_id) ? current : [...current, target.target_id]));
    setLocalDraftTargetIds((current) => (current.includes(target.target_id) ? current : [...current, target.target_id]));
    setWorkspaceMessage("Draft target created. Save target details when ready.");
  }

  function selectTargetForEdit(target: TargetConfig) {
    setSelectedTargetId(target.target_id);
    setActiveTargetsView("Environments");
    setActiveOutputTemplateId(target.output_templates[0]?.output_template_id ?? null);
  }

  function addOutputTemplateDraft(target: TargetConfig) {
    const targetSlug = slugify(target.name) || target.target_id;
    const template = createDraftOutputTemplate(targetSlug);
    updateTargetDraft(target.target_id, (current) => ({
      ...current,
      output_templates: [template, ...current.output_templates],
      template: current.output_templates.length ? current.template : template.name,
      updated_at: new Date().toISOString()
    }));
    setActiveOutputTemplateId(template.output_template_id);
  }

  function resetOutputTemplateToLiftSample(targetId: string, templateId: string) {
    updateOutputTemplateDraft(targetId, templateId, (template) => ({
      ...template,
      name: template.name || "Lift Standard Graphics Order",
      destination_method: "HTTP POST",
      output_format: "JSON",
      body_template: liftStandardGraphicsBodyTemplateText,
      header_template: liftStandardGraphicsHeaderTemplateText,
      canonical_mappings: liftStandardGraphicsTemplateMappings(),
      filename_format: template.filename_format || "orders-%y-%m-%d-%h-%i-%s.json",
      updated_at: new Date().toISOString()
    }));
    setWorkspaceMessage("Lift Standard Graphics sample template restored.");
  }

  function updateOutputTemplateMapping(targetId: string, templateId: string, field: TemplateFieldReference, targetField: string) {
    updateOutputTemplateDraft(targetId, templateId, (template) => {
      const existing = template.canonical_mappings.filter(
        (mapping) =>
          mapping.sourceColumn !== field.key &&
          mapping.sourceColumn !== field.path &&
          (field.token ? mapping.sourceColumn !== field.token : true)
      );
      const body_template =
        field.section === "body" ? applyTemplateMappingToJson(template.body_template, field.path, targetField) : template.body_template;
      const header_template =
        field.section === "header" ? applyTemplateMappingToJson(template.header_template, field.path, targetField) : template.header_template;
      return {
        ...template,
        body_template,
        header_template,
        canonical_mappings: targetField
          ? [...existing, { sourceColumn: field.key, targetField, required: field.section === "body" && field.path === "order.ext_id" }]
          : existing,
        updated_at: new Date().toISOString()
      };
    });
  }

  const workspaceMatchesSelectedCustomer = Boolean(
    selectedCustomerId && workspace?.customer.lift_customer_id === selectedCustomerId
  );
  const initialLoadError =
    customers.length === 0 && customerImportState === "idle"
      ? customerDirectory.warning ?? "Pathfinder could not load the customer directory."
      : selectedCustomerId && !workspaceMatchesSelectedCustomer && workspaceState === "error"
        ? workspaceMessage ?? "Pathfinder could not load the selected customer workspace."
        : null;
  const isInitialWorkspaceLoading =
    !initialLoadError &&
    ((customers.length === 0 && customerImportState === "loading") ||
      (Boolean(selectedCustomerId) && !workspaceMatchesSelectedCustomer) ||
      (targets.length === 0 && targetsAndJobsState === "loading") ||
      (!canonicalRegistry && canonicalRegistryState === "loading"));

  if (initialLoadError || isInitialWorkspaceLoading) {
    return (
      <WorkspaceLoading
        error={initialLoadError}
        onRetry={() => {
          setWorkspaceMessage(null);
          if (customers.length === 0) {
            void loadCustomers();
          } else if (selectedCustomerId) {
            void loadWorkspace(selectedCustomerId);
          }
          if (targetsAndJobsState === "error") {
            void loadTargetsAndJobs();
          }
          if (canonicalRegistryState === "error") {
            void loadCanonicalRegistry();
          }
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img className="vornan-wordmark" src="/brand/vornan-wordmark.png" alt="Vornan" />
          <img
            className="pathfinder-product-lockup"
            src="/brand/pathfinder-lockup-zinnia.svg"
            alt="Pathfinder"
          />
        </div>

        <nav className="nav-list" aria-label="Primary">
          {globalNavItems.map((item) => (
            <button
              className={activeGlobalView === item.label ? "nav-item nav-item-active" : "nav-item"}
              key={item.label}
              onClick={() => requestGuardedNavigation(() => setActiveGlobalView(item.label))}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="sidebar-context" aria-label="Selected customer">
          <div className="sidebar-section-row">
            <div className="sidebar-section-title">Selected Customer</div>
            <button
              className="sidebar-icon-button"
              disabled={customerImportState === "loading"}
              onClick={() => void loadCustomers(true)}
              title="Refresh Lift customers"
            >
              <RefreshCw size={15} />
            </button>
          </div>
          <div className="customer-combobox">
            <label className="sidebar-field">
              <span>Customer</span>
              <div className="combobox-input-wrap">
                <Search size={16} />
                <input
                  value={customerComboboxValue}
                  onBlur={() => window.setTimeout(() => setIsCustomerPickerOpen(false), 120)}
                  onChange={(event) => {
                    setCustomerSearch(event.target.value);
                    setIsCustomerPickerOpen(true);
                  }}
                  onFocus={() => {
                    setCustomerSearch("");
                    setIsCustomerPickerOpen(true);
                  }}
                  placeholder="Search customers"
                />
              </div>
            </label>
            {isCustomerPickerOpen ? (
              <div className="customer-options" role="listbox">
                {visibleCustomerOptions.map((customer) => (
                  <button
                    className={
                      customer.lift_customer_id === selectedCustomer.lift_customer_id
                        ? "customer-option customer-option-active"
                        : "customer-option"
                    }
                    key={customer.lift_customer_id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      requestGuardedNavigation(() => {
                        setSelectedCustomerId(customer.lift_customer_id);
                        setCustomerSearch("");
                        setIsCustomerPickerOpen(false);
                        setActiveGlobalView("Customers");
                        setActiveCustomerView("Overview");
                        setIsImportMethodDetailOpen(false);
                      })
                    }
                    role="option"
                    aria-selected={customer.lift_customer_id === selectedCustomer.lift_customer_id}
                  >
                    <strong>{customer.customer_name}</strong>
                    <span>{customer.lift_customer_id} · {customer.customer_number ?? "No number"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <nav className="customer-nav" aria-label="Customer workspace">
            {customerNavItems.map((item) => (
              <button
                className={activeCustomerView === item.label ? "customer-nav-item customer-nav-item-active" : "customer-nav-item"}
                key={item.label}
                onClick={() =>
                  requestGuardedNavigation(() => {
                    setActiveGlobalView("Customers");
                    setActiveCustomerView(item.label);
                    if (item.label === "Import Methods") {
                      setIsImportMethodDetailOpen(false);
                    }
                  })
                }
              >
                <item.icon size={17} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </section>

        {authSession ? (
          <div className="sidebar-user-card">
            <div className="sidebar-user-avatar" aria-hidden="true">
              {authSession.photoURL ? <img src={authSession.photoURL} alt="" /> : <span>{getAuthInitials(authSession)}</span>}
            </div>
            <div className="sidebar-user-copy">
              <strong>{authSession.displayName || "Signed in"}</strong>
              <span>{authSession.email || authSession.domain || "Google account"}</span>
            </div>
            <button className="sidebar-user-signout" onClick={() => void authSession.signOut()} type="button" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        ) : null}

        <div className="sidebar-status">
          <img src="/brand/scout.png" alt="" />
          <div>
            <strong>Faster forward.</strong>
            <span>Customer context controls import setup.</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        {activeGlobalView === "Customers" ? (
          <>
            <header className="topbar">
              <div className="title-block">
                <div className="headline-row">
                  <h1>{selectedCustomer.customer_name}</h1>
                  <span className="active-tag">{selectedCustomer.customer_status ?? "Active"}</span>
                </div>
                <p className="meta-line">
                  Lift CustomerID: {selectedCustomer.lift_customer_id}
                  <span>•</span>
                  Customer Number: {selectedCustomer.customer_number ?? "Unassigned"}
                </p>
              </div>
              <div className="topbar-actions">
                <div className="topbar-menu-wrap" data-button-menu-root>
                  <button
                    className="environment-select"
                    onClick={() => setOpenTopbarMenu(openTopbarMenu === "environment" ? null : "environment")}
                    aria-expanded={openTopbarMenu === "environment"}
                  >
                    <span>Environment</span>
                    <strong>{primaryRouteEnvironment?.name ?? primaryRouteTarget?.lift.active_environment ?? "QA1"}</strong>
                    <ChevronDown size={16} />
                  </button>
                  {openTopbarMenu === "environment" ? (
                    <div className="topbar-popover environment-popover">
                      <strong>Primary Route Environment</strong>
                      <p>{primaryOutputRoute.name}</p>
                      <div className="topbar-menu-list">
                        {(primaryRouteTarget?.environments ?? []).map((environment) => (
                          <button
                            key={environment.environment_id}
                            className={environment.environment_id === primaryOutputRoute.environment_id ? "topbar-menu-item topbar-menu-item-active" : "topbar-menu-item"}
                            onClick={() => void changePrimaryRouteEnvironment(environment.environment_id)}
                          >
                            <span>
                              <strong>{environment.name}</strong>
                              <small>{environment.role} · {environment.status}</small>
                            </span>
                            {environment.environment_id === primaryOutputRoute.environment_id ? <Check size={16} /> : null}
                          </button>
                        ))}
                      </div>
                      <button
                        className="topbar-popover-link"
                        onClick={() =>
                          requestGuardedNavigation(() => {
                            setOpenTopbarMenu(null);
                            setActiveGlobalView("Targets");
                            setSelectedTargetId(primaryOutputRoute.target_id);
                            setActiveTargetsView("Environments");
                          })
                        }
                      >
                        Manage environments
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="topbar-menu-wrap" data-button-menu-root>
                  <button
                    className="notification-button"
                    aria-label="Notifications"
                    onClick={() => setOpenTopbarMenu(openTopbarMenu === "notifications" ? null : "notifications")}
                    aria-expanded={openTopbarMenu === "notifications"}
                  >
                    <Bell size={20} />
                    {notificationCount ? <span>{notificationCount}</span> : null}
                  </button>
                  {openTopbarMenu === "notifications" ? (
                    <div className="topbar-popover notifications-popover">
                      <strong>Workspace Notifications</strong>
                      {notificationItems.length ? (
                        <div className="topbar-menu-list">
                          {notificationItems.map((item) => (
                            <button className="topbar-menu-item" key={`${item.title}-${item.detail}`} onClick={item.action}>
                              <span>
                                <strong>{item.title}</strong>
                                <small>{item.detail}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p>No blocking workspace notifications.</p>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="topbar-menu-wrap" data-button-menu-root>
                  <button
                    className="primary-button actions-button"
                    onClick={() => setOpenTopbarMenu(openTopbarMenu === "actions" ? null : "actions")}
                    aria-expanded={openTopbarMenu === "actions"}
                  >
                    Actions
                    <ChevronDown size={16} />
                  </button>
                  {openTopbarMenu === "actions" ? (
                    <div className="topbar-popover actions-popover">
                      <strong>Customer Actions</strong>
                      <div className="topbar-menu-list">
                        <button className="topbar-menu-item" onClick={() => runHeaderAction("manual-import")}>
                          <span><strong>Open Manual Import</strong><small>Upload, validate, and preview an order.</small></span>
                        </button>
                        <button className="topbar-menu-item" onClick={() => runHeaderAction("preview")}>
                          <span><strong>Generate Preview Job</strong><small>Use the current manual import grid and mappings.</small></span>
                        </button>
                        <button className="topbar-menu-item" onClick={() => runHeaderAction("product-map")}>
                          <span><strong>Resolve Product Map</strong><small>Assign customer keys to route product identifiers.</small></span>
                        </button>
                        <button className="topbar-menu-item" onClick={() => runHeaderAction("import-methods")}>
                          <span><strong>Edit Import Methods</strong><small>Source, mapping, product resolution, and route.</small></span>
                        </button>
                        <button className="topbar-menu-item" onClick={() => runHeaderAction("jobs")}>
                          <span><strong>View Customer Jobs</strong><small>Open persisted previews and submit attempts.</small></span>
                        </button>
                        <button className="topbar-menu-item" onClick={() => runHeaderAction("target")}>
                          <span><strong>Manage Output Route</strong><small>Target, environment, template, and submit profiles.</small></span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>

            {activeCustomerView === "Overview" ? (
              <>
                <section className="customer-overview">
                  <div className="panel customer-panel">
                    <PanelHeader icon={Users} title="Customer Details" detail={customerDirectory.source === "lift-endpoint" ? "Lift endpoint" : "Local seed"} />
                    <dl className="customer-detail-grid">
                      <DetailItem label="Customer Name" value={selectedCustomer.customer_name} />
                      <DetailItem label="Status" value={selectedCustomer.customer_status} />
                      <DetailItem label="CustomerID" value={selectedCustomer.lift_customer_id} />
                      <DetailItem label="Sales Rep" value={selectedCustomer.sales_rep} />
                      <DetailItem label="Customer Number" value={selectedCustomer.customer_number} />
                      <DetailItem label="Default Invoice Email" value={selectedCustomer.default_invoice_email_address} />
                      <DetailItem label="CRM ID" value={selectedCustomer.crm_id} />
                    </dl>
                    <details className="account-status-details">
                      <summary>
                        <span>Account Status</span>
                        <span>{selectedCustomer.credit_hold ?? selectedCustomer.terms_status ?? "No account flags"}</span>
                      </summary>
                      <dl className="account-status-grid">
                        <DetailItem label="Terms" value={selectedCustomer.terms} />
                        <DetailItem label="Terms Status" value={selectedCustomer.terms_status} />
                        <DetailItem label="Credit Hold" value={selectedCustomer.credit_hold} />
                        <DetailItem label="Credit Limit" value={displayCurrency(selectedCustomer.credit_limit)} />
                        <DetailItem label="Available Credit" value={displayCurrency(selectedCustomer.available_credit)} />
                        <DetailItem label="Unpaid Total" value={displayCurrency(selectedCustomer.unpaid_total)} />
                      </dl>
                    </details>
                    {customerDirectory.warning ? <p className="import-warning">{customerDirectory.warning}</p> : null}
                    {workspaceMessage ? <p className={workspaceState === "error" ? "import-error" : "import-warning"}>{workspaceMessage}</p> : null}
                  </div>

                  <div className="panel target-summary-panel">
                    <PanelHeader icon={Database} title="Primary Target" detail={primaryOutputRoute.name} />
                    <div className="primary-target-body">
                      <div className="target-identity">
                        <div className="target-logo">{targetLogoText(primaryRouteTarget)}</div>
                        <div>
                          <strong>{primaryRouteTarget?.name ?? primaryOutputRoute.target_system}</strong>
                          <span>{primaryRouteTemplate?.name ?? primaryOutputRoute.output_template}</span>
                        </div>
                        <span className="target-env">{primaryRouteEnvironment?.name ?? "No environment"}</span>
                      </div>
                      <dl className="target-summary">
                        <DetailItem label="Endpoint" value={primaryRouteEnvironment?.endpoint_url ?? submitRequest.endpoint_url} />
                        <DetailItem label="Company ID" value={primaryRouteCompanyId} />
                        <DetailItem label="Auth" value={primaryRouteAuth} />
                        <DetailItem label="Destination" value={`${primaryOutputRoute.destination_account_name}${primaryOutputRoute.destination_account_id ? ` / ${primaryOutputRoute.destination_account_id}` : ""}`} />
                        <DetailItem label="Format" value={`${primaryRouteTemplate?.destination_method ?? "HTTP POST"} · ${primaryRouteTemplate?.output_format ?? "JSON"}`} />
                        <DetailItem label="Product Mapping Strategy" value={primaryOutputRoute.product_identifier_label} />
                        <DetailItem label="Product Key Resolver" value={activeResolverSummary} />
                        <DetailItem
                          label="Route Readiness"
                          value={`${primaryRouteDiagnostics.status} · ${primaryRouteDiagnostics.blocking_count} blocking / ${primaryRouteDiagnostics.warning_count} warning`}
                        />
                      </dl>
                    </div>
                  </div>
                </section>

                <section className="metric-strip" aria-label="Customer KPIs">
                  {[
                    { value: String(customerOrderCount), label: "Previewed Orders", trend: customerJobs.length ? "Persisted locally" : "No jobs yet", intent: "good", icon: FileText },
                    { value: `${validationRate}%`, label: "Validation Pass Rate", trend: `Ready previews: ${readyJobCount}`, intent: "good", icon: Check },
                    { value: String(readyJobCount), label: "Ready For Submit", trend: `${primaryRouteEnvironment?.name ?? "Selected"} submit gated`, intent: "good", icon: Send },
                    { value: workspaceState === "loading" ? "Syncing" : "Local", label: "Workspace State", trend: workspace?.updated_at ? displayTimestamp(workspace.updated_at) : "Seeded defaults", intent: "good", icon: Clock3 },
                    { value: String(unmappedProductCount), label: "Product Mapping Gaps", trend: unmappedProductCount ? `Needs ${activeOutputRoute.product_identifier_label}` : "No unresolved products", intent: unmappedProductCount ? "bad" : "good", icon: AlertTriangle }
                  ].map(({ value, label, trend, intent, icon: Icon }) => (
                    <div className="metric-card" key={label}>
                      <div className="metric-icon">
                        <Icon size={20} />
                      </div>
                      <div>
                        <strong>{value}</strong>
                        <span>{label}</span>
                        <small className={intent === "bad" ? "trend-bad" : "trend-good"}>{trend}</small>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="overview-grid overview-grid-two">
                  <div className="panel method-panel">
                    <div className="table-panel-header">
                      <PanelHeader icon={Workflow} title="Active Import Methods" detail="" />
                      <button className="primary-button table-header-action" onClick={createDraftImportMethod}>
                        <Plus size={15} />
                        New Import Method
                      </button>
                    </div>
                    <table className="methods-table">
                      <thead>
                        <tr>
                          <th>Method Name</th>
                          <th>Type</th>
                          <th>Source</th>
                          <th>Product Maps</th>
                          <th>Status</th>
                          <th>Last Run</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importMethods.map((method) => {
                          const methodUnmappedCount = productMappings.filter(
                            (mapping) => mapping.output_route_id === method.output_route_id && mapping.status !== "Mapped"
                          ).length;
                          return (
                            <tr
                              key={method.import_method_id}
                              onClick={() => {
                                setActiveCustomerView("Import Methods");
                                setIsImportMethodDetailOpen(false);
                              }}
                            >
                              <td>{method.name}</td>
                              <td>{method.type}</td>
                              <td>{method.source}</td>
                              <td>{methodUnmappedCount ? `${methodUnmappedCount} unmapped` : "Clean"}</td>
                              <td>
                                <span className={method.status === "Active" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                                  {method.status}
                                </span>
                              </td>
                              <td>{methodLastRun(method)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <button
                      className="table-footer-link"
                      onClick={() => {
                        setActiveCustomerView("Import Methods");
                        setIsImportMethodDetailOpen(false);
                      }}
                    >
                      View all import methods
                      <ArrowGlyph />
                    </button>
                  </div>

                  <div className="panel jobs-panel">
                    <div className="table-panel-header">
                      <PanelHeader icon={Archive} title="Recent Jobs" detail="" />
                      <button
                        className="table-header-link"
                        onClick={() => {
                          setActiveGlobalView("Customers");
                          setActiveCustomerView("Jobs");
                        }}
                      >
                        View all jobs
                        <ArrowGlyph />
                      </button>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Job</th>
                          <th>Method</th>
                          <th>Status</th>
                          <th>Orders</th>
                          <th>Started</th>
                          <th>Route</th>
                        </tr>
                      </thead>
                      <tbody>
                    {overviewJobs.map((job) => (
                      <tr key={job.job_id}>
                        <td>
                          <button className="link-button" onClick={() => void openJobDetail(job)}>
                            {displayJobId(job.job_id)}
                          </button>
                        </td>
                        <td>{job.import_method_name}</td>
                            <td>
                              <StatePill state={job.state} />
                            </td>
                            <td>{jobOrderCount(job)}</td>
                            <td>{displayTimestamp(job.created_at)}</td>
                            <td>{job.output_route_name ?? activeOutputRoute.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {overviewJobs.length === 0 ? <p className="empty-state">No persisted preview jobs yet.</p> : null}
                    <div className="jobs-summary-footer">
                      <div>
                        <span>Total Jobs</span>
                        <strong>{customerJobs.length}</strong>
                      </div>
                      <div>
                        <span>Success Rate</span>
                        <strong>{validationRate}%</strong>
                      </div>
                      <svg viewBox="0 0 180 36" role="img" aria-label="Success trend">
                        <polyline
                          points="0,24 12,23 24,24 36,22 48,23 60,21 72,22 84,20 96,18 108,20 120,15 132,12 144,14 156,10 168,12 180,8"
                        />
                      </svg>
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            {activeCustomerView === "Import Methods" ? (
              <>
                {!isImportMethodDetailOpen ? (
                <section className="panel method-panel">
                  <div className="table-panel-header">
                    <PanelHeader icon={Workflow} title="Import Methods" detail="Source intake definitions" />
                    <button className="primary-button table-header-action" onClick={createDraftImportMethod}>
                      <Plus size={15} />
                      New Import Method
                    </button>
                  </div>
                  <div className="method-table">
                    <div className="method-table-header" aria-hidden="true">
                      <span>Method</span>
                      <span>Output Route</span>
                      <span>Source</span>
                      <span>Status</span>
                      <span>Last Run</span>
                      <span>Actions</span>
                    </div>
                    {importMethods.map((method) => (
                      <div
                        className={activeMethodId === method.import_method_id ? "method-row method-row-active" : "method-row"}
                        key={method.import_method_id}
                      >
                        <button
                          className="method-select-area"
                          onClick={() => openImportMethodDetail(method)}
                          aria-label={`Edit ${method.name}`}
                        >
                          <div>
                            <strong>{method.name}</strong>
                            <span>{method.type}</span>
                          </div>
                          <span>{methodTargetLabel(method, outputRoutes)}</span>
                          <span>{sourceTypeLabel(method.source)}</span>
                          <MethodStatusPill status={method.status} />
                          <span>{methodLastRun(method)}</span>
                        </button>
                        <div className="method-row-actions">
                          <button
                            title={`Edit ${method.name}`}
                            aria-label={`Edit ${method.name}`}
                            onClick={() => openImportMethodDetail(method)}
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            title={`Duplicate ${method.name}`}
                            aria-label={`Duplicate ${method.name}`}
                            onClick={() => duplicateImportMethod(method)}
                          >
                            <Copy size={15} />
                          </button>
                          <button
                            title={localDraftImportMethodIds.includes(method.import_method_id) ? `Discard ${method.name}` : `Archive ${method.name}`}
                            aria-label={localDraftImportMethodIds.includes(method.import_method_id) ? `Discard ${method.name}` : `Archive ${method.name}`}
                            onClick={() => requestImportMethodDelete(method)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                ) : null}
                {isImportMethodDetailOpen && activeImportMethod ? (
                  <section className="panel method-workspace-panel">
                    <div className="table-panel-header">
                      <PanelHeader icon={FileSpreadsheet} title={activeImportMethod.name} detail="One save for source, resolution, and mappings" />
                      <div className="method-detail-actions">
                        <span
                          className={`method-save-state ${
                            activeImportMethodHasUnsavedChanges ? "method-save-state-dirty" : "method-save-state-clean"
                          }`}
                        >
                          {localDraftImportMethodIds.includes(activeImportMethod.import_method_id) ? (
                            "Not saved yet"
                          ) : detectedSourceSchemaIsStale ? (
                            "Schema refresh required"
                          ) : activeImportMethodHasUnsavedChanges ? (
                            "Unsaved changes"
                          ) : (
                            <>
                              <Check size={13} />
                              Saved
                            </>
                          )}
                        </span>
                        <button
                          className="secondary-button table-header-action"
                          onClick={() => requestGuardedNavigation(() => setIsImportMethodDetailOpen(false))}
                        >
                          <ArrowLeft size={15} />
                          All Import Methods
                        </button>
                        <button
                          className="secondary-button table-header-action destructive-secondary-button"
                          onClick={() => requestImportMethodDelete(activeImportMethod)}
                          disabled={workspaceState === "saving"}
                        >
                          <Trash2 size={15} />
                          {localDraftImportMethodIds.includes(activeImportMethod.import_method_id) ? "Discard Draft" : "Archive Method"}
                        </button>
                        <button
                          className="primary-button table-header-action"
                          disabled={
                            !activeImportMethodHasUnsavedChanges ||
                            detectedSourceSchemaIsStale ||
                            workspaceState === "saving"
                          }
                          title={detectedSourceSchemaIsStale ? "Re-detect the source schema before saving." : undefined}
                          onClick={() => void saveImportMethod(activeImportMethod, mappings)}
                        >
                          Save Method
                        </button>
                      </div>
                    </div>
                    <div className="method-step-strip">
                      <span>1 Source setup</span>
                      <span>2 Product resolution</span>
                      <span>3 Order name resolution</span>
                      <span>4 Field mapping</span>
                      <span>5 Review &amp; save</span>
                    </div>
                  </section>
                ) : null}
                {isImportMethodDetailOpen && activeImportMethod ? (
                  <section className="panel setup-panel">
                    <PanelHeader icon={SlidersHorizontal} title="Method Setup" detail={activeImportMethod.import_method_id} />
                    <div className="setup-grid">
                      <label className="setup-control">
                        <span>Name</span>
                        <input
                          value={activeImportMethod.name}
                          aria-invalid={!activeImportMethod.name.trim()}
                          onChange={(event) => updateActiveMethodDraft({ name: event.target.value })}
                        />
                      </label>
                      <label className="setup-control">
                        <span>Type</span>
                        <select
                          value={activeImportMethod.type}
                          onChange={(event) => updateActiveMethodDraft({ type: event.target.value as ImportMethod["type"] })}
                        >
                          <option>Manual upload</option>
                          <option>API import</option>
                          <option>Manual paste</option>
                          <option>Scheduled</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Source</span>
                        <select
                          value={activeImportMethod.source}
                          onChange={(event) => {
                            const source = event.target.value as ImportMethodSource;
                            updateActiveMethodDraft({
                              source,
                              type: sourceTypeToMethodType(source),
                              source_config:
                                source === "Wrike"
                                  ? {
                                      ...activeImportMethod.source_config,
                                      wrike:
                                        activeImportMethod.source_config.wrike ?? createDefaultWrikeSourceConfig()
                                    }
                                  : activeImportMethod.source_config
                            });
                          }}
                        >
                          {importMethodSourceOptions.map((source) => (
                            <option key={source}>{source}</option>
                          ))}
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Status</span>
                        <select
                          value={activeImportMethod.status}
                          onChange={(event) => updateActiveMethodDraft({ status: event.target.value as ImportMethodStatus })}
                        >
                          {importMethodStatusOptions.map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                      </label>
                      <label className="setup-control setup-control-wide">
                        <span>Output Route</span>
                        <select
                          value={activeImportMethod.output_route_id}
                          onChange={(event) => {
                            const route =
                              outputRoutes.find((candidate) => candidate.output_route_id === event.target.value) ??
                              defaultOutputRoute;
                            updateActiveMethodDraft({
                              output_route_id: route.output_route_id,
                              target_id: route.target_id,
                              target_template: route.output_template
                            });
                            setOutputMapRouteFilter(route.output_route_id);
                          }}
                        >
                          {outputRoutes.map((route) => (
                            <option key={route.output_route_id} value={route.output_route_id}>
                              {route.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="source-note setup-control-wide">
                        {activeOutputRoute.target_system} sends to {activeOutputRoute.destination_account_name}
                        {activeOutputRoute.company_id ? ` / Company ${activeOutputRoute.company_id}` : ""} using {activeOutputRoute.output_template}.
                      </div>
                      {activeImportMethod.source === "Google Sheet" ? (
                        <>
                          <label className="setup-control setup-control-wide">
                            <span>Google Sheet URL</span>
                            <input
                              value={activeImportMethod.source_config.google_sheet_url ?? ""}
                              placeholder="https://docs.google.com/spreadsheets/d/..."
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  source_config: {
                                    ...activeImportMethod.source_config,
                                    google_sheet_url: event.target.value
                                  }
                                })
                              }
                            />
                          </label>
                          <label className="setup-control">
                            <span>Tab Name</span>
                            <input
                              value={activeImportMethod.source_config.google_sheet_tab ?? ""}
                              placeholder="Order Form"
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  source_config: {
                                    ...activeImportMethod.source_config,
                                    google_sheet_tab: event.target.value
                                  }
                                })
                              }
                            />
                          </label>
                          <label className="setup-control">
                            <span>Range</span>
                            <input
                              value={activeImportMethod.source_config.google_sheet_range ?? ""}
                              placeholder="A:Q"
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  source_config: {
                                    ...activeImportMethod.source_config,
                                    google_sheet_range: event.target.value
                                  }
                                })
                              }
                            />
                          </label>
                        </>
                      ) : null}
                      {activeImportMethod.source === "PDF PO" ? (
                        <>
                          <label className="setup-control">
                            <span>PDF Review Mode</span>
                            <select
                              value={activeImportMethod.source_config.pdf_review_mode ?? "manual_review"}
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  source_config: {
                                    ...activeImportMethod.source_config,
                                    pdf_review_mode: event.target.value as "manual_review" | "assisted_extract"
                                  }
                                })
                              }
                            >
                              <option value="manual_review">Manual review</option>
                              <option value="assisted_extract">Assisted extract</option>
                            </select>
                          </label>
                          <div className="source-note setup-control-wide">
                            PDF POs will enter a review grid first. Parsed fields can be corrected before canonical validation.
                          </div>
                        </>
                      ) : null}
                      {activeImportMethod.source === "REST API" ? (
                        <label className="setup-control setup-control-wide">
                          <span>Source Endpoint</span>
                          <input
                            value={activeImportMethod.source_config.api_endpoint_url ?? ""}
                            placeholder="https://example.com/orders"
                            onChange={(event) =>
                              updateActiveMethodDraft({
                                source_config: {
                                  ...activeImportMethod.source_config,
                                  api_endpoint_url: event.target.value
                                }
                              })
                            }
                          />
                        </label>
                      ) : null}
                      {activeImportMethod.source === "SFTP" ? (
                        <label className="setup-control setup-control-wide">
                          <span>SFTP Path</span>
                          <input
                            value={activeImportMethod.source_config.sftp_path ?? ""}
                            placeholder="/inbound/orders/*.csv"
                            onChange={(event) =>
                              updateActiveMethodDraft({
                                source_config: {
                                  ...activeImportMethod.source_config,
                                  sftp_path: event.target.value
                                }
                              })
                            }
                          />
                        </label>
                      ) : null}
                      {activeImportMethod.source === "Wrike" ? (
                        <div className="wrike-source-contract setup-control-wide">
                          <div className="wrike-contract-heading">
                            <div>
                              <span className="section-eyebrow">Wrike order intake</span>
                              <strong>Bind one Wrike workflow to this Import Method</strong>
                              <small>
                                Save the durable task, trigger, and workbook rules now. API credentials remain outside the Import Method.
                              </small>
                            </div>
                            <span
                              className={
                                activeWrikeReadiness.status === "Configured"
                                  ? "mini-pill mini-pill-success"
                                  : "mini-pill mini-pill-warning"
                              }
                            >
                              {activeWrikeReadiness.status === "Configured" ? "Contract configured" : "Needs Wrike IDs"}
                            </span>
                          </div>

                          <div className="wrike-contract-grid">
                            <label className="setup-control setup-control-wide">
                              <span>Customer Wrike connection</span>
                              <select
                                value={activeWrikeConfig.connection_id}
                                onChange={(event) => updateActiveWrikeConfig({ connection_id: event.target.value })}
                              >
                                <option value="">Choose a customer connection</option>
                                {sourceConnections
                                  .filter((connection) => connection.provider === "wrike")
                                  .map((connection) => (
                                    <option key={connection.connection_id} value={connection.connection_id}>
                                      {connection.name} · {connection.environment} · {connection.status}
                                    </option>
                                  ))}
                              </select>
                              <small>
                                Credentials are managed in Customer Settings. This Import Method stores only the connection reference.
                              </small>
                            </label>
                            <label className="setup-control">
                              <span>Folder or project ID</span>
                              <input
                                value={activeWrikeConfig.folder_id}
                                placeholder="Wrike API ID"
                                onChange={(event) => updateActiveWrikeConfig({ folder_id: event.target.value })}
                              />
                            </label>
                            <label className="setup-control">
                              <span>Approved discovery task ID</span>
                              <input
                                value={activeWrikeConfig.approved_discovery_task_id}
                                placeholder="One operator-approved Wrike task"
                                onChange={(event) =>
                                  updateActiveWrikeConfig({ approved_discovery_task_id: event.target.value })
                                }
                              />
                            </label>
                            <label className="setup-control">
                              <span>Trigger strategy</span>
                              <select
                                value={activeWrikeConfig.trigger_mode}
                                onChange={(event) =>
                                  updateActiveWrikeConfig({ trigger_mode: event.target.value as WrikeTriggerMode })
                                }
                              >
                                <option value="scheduled_polling">Scheduled polling</option>
                                <option value="webhook_with_reconciliation">Webhook + reconciliation</option>
                              </select>
                            </label>
                            <label className="setup-control">
                              <span>Intake-ready status ID</span>
                              <input
                                value={activeWrikeConfig.trigger_status_id}
                                placeholder="Custom workflow status API ID"
                                onChange={(event) => updateActiveWrikeConfig({ trigger_status_id: event.target.value })}
                              />
                            </label>
                            <label className="setup-control">
                              <span>Status label</span>
                              <input
                                value={activeWrikeConfig.trigger_status_label}
                                placeholder="Sent to Print - LTL"
                                onChange={(event) => updateActiveWrikeConfig({ trigger_status_label: event.target.value })}
                              />
                            </label>
                            <label className="setup-control setup-control-wide">
                              <span>Artwork folder custom field ID</span>
                              <input
                                value={activeWrikeConfig.artwork_folder_custom_field_id}
                                placeholder="Wrike API ID for LTL Artwork Folder URL"
                                onChange={(event) =>
                                  updateActiveWrikeConfig({ artwork_folder_custom_field_id: event.target.value })
                                }
                              />
                              <small>
                                Optional. A valid HTTPS value maps to canonical Artwork Folder URL and then to
                                Lift order header field FLEX_FIELD9.
                              </small>
                            </label>
                            <label className="setup-control">
                              <span>Additional workbook name filter</span>
                              <input
                                value={activeWrikeConfig.attachment_filename_contains}
                                placeholder="Optional; naming contract is automatic"
                                onChange={(event) =>
                                  updateActiveWrikeConfig({ attachment_filename_contains: event.target.value })
                                }
                              />
                            </label>
                            <label className="setup-control">
                              <span>Reconciliation interval</span>
                              <select
                                value={activeWrikeConfig.poll_interval_minutes}
                                onChange={(event) =>
                                  updateActiveWrikeConfig({ poll_interval_minutes: Number(event.target.value) })
                                }
                              >
                                {[5, 10, 15, 30, 60].map((minutes) => (
                                  <option value={minutes} key={minutes}>
                                    Every {minutes} minutes
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div className="wrike-extension-row">
                            <span>Accepted workbooks</span>
                            <div>
                              {(["xlsx", "xls", "csv"] as WrikeWorkbookExtension[]).map((extension) => (
                                <label className="switch-field" key={extension}>
                                  <input
                                    type="checkbox"
                                    checked={activeWrikeConfig.attachment_extensions.includes(extension)}
                                    onChange={(event) => {
                                      const attachmentExtensions = event.target.checked
                                        ? Array.from(new Set([...activeWrikeConfig.attachment_extensions, extension]))
                                        : activeWrikeConfig.attachment_extensions.filter((candidate) => candidate !== extension);
                                      updateActiveWrikeConfig({ attachment_extensions: attachmentExtensions });
                                    }}
                                  />
                                  <span className="switch-field-track" aria-hidden="true" />
                                  <span>.{extension}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <p className="wrike-contract-note">
                            Task and workbook names must match C###### - Order Name - OOH Order. Each matching
                            workbook becomes a separate order candidate.
                          </p>

                          <div className="wrike-discovery-preview">
                            {activeWrikeConnectionStatus ? (
                              <div className="wrike-qa-readiness">
                                <div className="wrike-qa-readiness-heading">
                                  <div>
                                    <span className="section-eyebrow">Bounded QA readiness</span>
                                    <strong>{activeWrikeQaReadiness.summary}</strong>
                                    <small>{activeWrikeQaReadiness.next_action}</small>
                                  </div>
                                  <span
                                    className={
                                      activeWrikeQaReadiness.status === "ready_for_approved_task_preview"
                                        ? "mini-pill mini-pill-success"
                                        : "mini-pill mini-pill-warning"
                                    }
                                  >
                                    {activeWrikeQaReadiness.status === "needs_setup"
                                      ? "Setup required"
                                      : activeWrikeQaReadiness.status === "ready_for_explicit_qa_window"
                                        ? "Approval required"
                                        : activeWrikeQaReadiness.status === "run_identity_check"
                                          ? "Identity check next"
                                          : "Preview ready"}
                                  </span>
                                </div>
                                <div className="wrike-qa-readiness-grid">
                                  {activeWrikeQaReadiness.items.map((item) => (
                                    <div key={item.item_id}>
                                      <RouteDiagnosticPill
                                        status={
                                          item.status === "Passed"
                                            ? "Passed"
                                            : item.status === "Blocked"
                                              ? "Blocked"
                                              : "Warning"
                                        }
                                      />
                                      <span>
                                        <strong>{item.label}</strong>
                                        <small>{item.message}</small>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                <p className="wrike-contract-note">
                                  Readiness never authorizes attachment download, preview-job creation, polling, webhooks, Wrike writes, or Lift actions.
                                </p>
                              </div>
                            ) : (
                              <div className="wrike-qa-readiness wrike-qa-readiness-loading" aria-live="polite">
                                <AlertTriangle size={16} />
                                <span>
                                  {activeWrikeConfig.connection_id
                                    ? "The selected customer connection is unavailable."
                                    : "Choose a customer Wrike connection before running discovery checks."}
                                </span>
                              </div>
                            )}
                            <div className="wrike-discovery-heading">
                              <div>
                                <span className="section-eyebrow">Read-only discovery preview</span>
                                <strong>Confirm one intake-ready Wrike task before automation work begins</strong>
                                <small>
                                  Pathfinder returns provider IDs and counts only. Task copy, filenames, URLs, file contents, and customer data are not shown or persisted.
                                </small>
                              </div>
                              <div className="wrike-discovery-actions">
                                <span
                                  className={
                                    activeWrikeConnectionStatus?.discovery_preview_enabled
                                      ? "mini-pill mini-pill-success"
                                      : "mini-pill mini-pill-warning"
                                  }
                                >
                                  {activeWrikeConnectionStatus?.discovery_preview_enabled ? "Preview gate on" : "Preview gate off"}
                                </span>
                                <button
                                  className="secondary-button table-inline-button"
                                  onClick={() => void previewWrikeDiscovery()}
                                  disabled={
                                    wrikeDiscoveryState === "loading" ||
                                    !activeWrikeConnectionStatus?.discovery_preview_enabled ||
                                    !activeWrikeConnectionStatus?.configured ||
                                    activeImportMethodHasUnsavedChanges ||
                                    activeWrikeReadiness.status !== "Configured" ||
                                    !activeWrikeConfig.approved_discovery_task_id
                                  }
                                  title={
                                    !activeWrikeConnectionStatus?.discovery_preview_enabled
                                      ? "The server discovery-preview gate is off."
                                      : activeImportMethodHasUnsavedChanges
                                        ? "Save this Import Method before previewing its approved scope."
                                        : activeWrikeReadiness.status !== "Configured" || !activeWrikeConfig.approved_discovery_task_id
                                          ? "Save the folder, status, workbook rule, and approved task ID first."
                                          : !activeWrikeConnectionStatus?.configured
                                            ? "Configure and authorize this customer's Wrike connection first."
                                            : undefined
                                  }
                                >
                                  <Search size={14} />
                                  {wrikeDiscoveryState === "loading" ? "Checking approved task" : "Run approved task preview"}
                                </button>
                              </div>
                            </div>

                            {wrikeDiscoveryPreview ? (
                              <>
                                <div className="wrike-discovery-summary">
                                  <div>
                                    <span>Task ID</span>
                                    <strong>{wrikeDiscoveryPreview.observed.task_id}</strong>
                                  </div>
                                  <div>
                                    <span>Folder scope</span>
                                    <strong>
                                      {wrikeDiscoveryPreview.checks.find((check) => check.check_id === "folder_scope")?.status === "Passed"
                                        ? "Matched"
                                        : "Needs review"}
                                    </strong>
                                  </div>
                                  <div>
                                    <span>Status ID</span>
                                    <strong>{wrikeDiscoveryPreview.observed.custom_status_id ?? "Not returned"}</strong>
                                  </div>
                                  <div>
                                    <span>Attachments</span>
                                    <strong>{wrikeDiscoveryPreview.observed.attachment_metadata_count ?? "Not read"}</strong>
                                  </div>
                                  <div>
                                    <span>Workbook candidates</span>
                                    <strong>{wrikeDiscoveryPreview.observed.workbook_candidate_count ?? "Not evaluated"}</strong>
                                  </div>
                                  <div>
                                    <span>Ignored attachments</span>
                                    <strong>{wrikeDiscoveryPreview.observed.ignored_attachment_count ?? "Not evaluated"}</strong>
                                  </div>
                                  <div>
                                    <span>Artwork folder</span>
                                    <strong>
                                      {wrikeDiscoveryPreview.observed.artwork_folder_status === "ready"
                                        ? "HTTPS link ready"
                                        : wrikeDiscoveryPreview.observed.artwork_folder_status === "missing"
                                          ? "Field is empty"
                                          : wrikeDiscoveryPreview.observed.artwork_folder_status === "invalid"
                                            ? "Invalid URL"
                                            : wrikeDiscoveryPreview.observed.artwork_folder_status === "not_configured"
                                              ? "Not configured"
                                              : "Not evaluated"}
                                    </strong>
                                  </div>
                                </div>
                                <div className="wrike-discovery-checks">
                                  {wrikeDiscoveryPreview.checks.map((check) => (
                                    <div key={check.check_id}>
                                      <RouteDiagnosticPill status={check.status} />
                                      <span>{check.message}</span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : null}

                            {wrikeDiscoveryMessage ? (
                              <div className={wrikeDiscoveryState === "error" ? "email-health-error" : "wrike-discovery-message"}>
                                {wrikeDiscoveryState === "error" ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
                                <span>{wrikeDiscoveryMessage}</span>
                              </div>
                            ) : null}
                            <p className="wrike-contract-note">
                              This preview cannot download an attachment, create a Pathfinder job, enable polling or webhooks, write to Wrike, or act in Lift.
                            </p>
                          </div>

                          <div className="wrike-contract-flow" aria-label="Wrike ingestion safety boundary">
                            <span>1 Qualify intake-ready task</span>
                            <span>2 Keep each matching workbook</span>
                            <span>3 Apply this Import Method</span>
                            <span>4 Create preview job</span>
                          </div>
                          <div className="wrike-contract-safeguard">
                            <ShieldCheck size={18} />
                            <span>
                              <strong>Operator review remains required.</strong> Duplicate protection uses Wrike account, task, attachment, and version IDs. This contract cannot submit to Lift.
                            </span>
                          </div>
                          <p className="wrike-contract-note">
                            Each matching current workbook remains a separate order candidate. Reference files, unrelated contracts, attachment download, polling, webhooks, and activation remain outside this preview.
                          </p>
                        </div>
                      ) : null}
                      <div className="setup-actions">
                        <span className="method-panel-save-note">Method setup saves with the selected import method.</span>
                        <button
                          className="secondary-button"
                          onClick={() => requestGuardedNavigation(() => setActiveCustomerView("Manual Import"))}
                        >
                          Open Manual Import
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}
                {isImportMethodDetailOpen && activeImportMethod ? (
                  <section className="panel setup-panel public-intake-setup">
                    <PanelHeader icon={Send} title="Customer Order Dropbox" detail="Published intake page" />
                    <div className="public-intake-heading">
                      <div>
                        <strong>Give this customer a focused order-upload page</strong>
                        <span>The saved parser, field mappings, product rules, order-name rules, route, and submit profile stay controlled in Pathfinder.</span>
                      </div>
                      <label className="switch-field public-intake-publish-switch">
                        <input
                          type="checkbox"
                          aria-label="Publish customer order dropbox"
                          checked={activeImportMethod.public_intake.enabled}
                          disabled={activeImportMethod.status !== "Active"}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                enabled: event.target.checked
                              }
                            })
                          }
                        />
                        <span className="switch-field-track" aria-hidden="true" />
                        <span>Publish dropbox</span>
                      </label>
                    </div>
                    <div className="setup-grid public-intake-grid">
                      <label className="setup-control setup-control-wide">
                        <span>Page headline</span>
                        <input
                          value={activeImportMethod.public_intake.headline}
                          maxLength={100}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                headline: event.target.value
                              }
                            })
                          }
                        />
                      </label>
                      <label className="setup-control setup-control-wide">
                        <span>Customer instructions</span>
                        <textarea
                          value={activeImportMethod.public_intake.instructions}
                          maxLength={600}
                          rows={3}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                instructions: event.target.value
                              }
                            })
                          }
                        />
                      </label>
                      <label className="setup-control">
                        <span>Allowed email domains</span>
                        <input
                          value={activeImportMethod.public_intake.allowed_email_domains.join(", ")}
                          placeholder="customer.com"
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                allowed_email_domains: event.target.value
                                  .split(",")
                                  .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
                                  .filter(Boolean)
                              }
                            })
                          }
                        />
                      </label>
                      <label className="setup-control">
                        <span>Submit profile</span>
                        <select
                          value={activeImportMethod.public_intake.submit_profile_id ?? ""}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                submit_profile_id: event.target.value || null
                              }
                            })
                          }
                        >
                          <option value="">Live customer when available</option>
                          {activeOutputRoute.submit_profiles
                            .filter((profile) => profile.enabled)
                            .map((profile) => (
                              <option key={profile.profile_id} value={profile.profile_id}>
                                {profile.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Maximum order rows</span>
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          value={activeImportMethod.public_intake.max_order_rows}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                max_order_rows: Math.min(1000, Math.max(1, Number.parseInt(event.target.value, 10) || 1))
                              }
                            })
                          }
                        />
                      </label>
                      <label className="switch-field public-intake-email-check">
                        <input
                          type="checkbox"
                          aria-label="Require a valid work email"
                          checked={activeImportMethod.public_intake.require_email}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                require_email: event.target.checked
                              }
                            })
                          }
                        />
                        <span className="switch-field-track" aria-hidden="true" />
                        <span>Require a valid work email</span>
                      </label>
                      <label
                        className="switch-field public-intake-email-check"
                        title={
                          emailStatus?.public_intake_email_verification.available
                            ? undefined
                            : "Available after the one-time verification server gate and SES delivery are enabled."
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label="Verify work email with a one-time code"
                          checked={activeImportMethod.public_intake.require_email_verification}
                          disabled={
                            !emailStatus?.public_intake_email_verification.available &&
                            !activeImportMethod.public_intake.require_email_verification
                          }
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              public_intake: {
                                ...activeImportMethod.public_intake,
                                require_email: event.target.checked
                                  ? true
                                  : activeImportMethod.public_intake.require_email,
                                require_email_verification: event.target.checked
                              }
                            })
                          }
                        />
                        <span className="switch-field-track" aria-hidden="true" />
                        <span>Verify email with a one-time code</span>
                      </label>
                    </div>
                    {!emailStatus?.public_intake_email_verification.available ? (
                      <div className="public-intake-runtime-note" role="status">
                        <ShieldCheck size={16} />
                        <span>
                          One-time email verification is safely unavailable until SES delivery and the server gate are enabled.
                        </span>
                      </div>
                    ) : null}
                    <div className="public-intake-link-row">
                      <div>
                        <span>Customer page</span>
                        <strong>
                          {activeImportMethod.public_intake.public_key
                            ? `${publicStatusBaseUrl.replace(/\/$/, "")}/intake/${activeImportMethod.public_intake.public_key}`
                            : activeImportMethod.public_intake.enabled
                              ? "Save Method to generate the private page address."
                              : "Publish the dropbox when this method is ready."}
                        </strong>
                      </div>
                      {activeImportMethod.public_intake.public_key ? (
                        <div className="public-intake-link-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              const url = `${publicStatusBaseUrl.replace(/\/$/, "")}/intake/${activeImportMethod.public_intake.public_key}`;
                              void navigator.clipboard.writeText(url).then(() => setWorkspaceMessage("Customer order page copied."));
                            }}
                          >
                            <Copy size={15} />
                            Copy page
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={dirtyImportMethodIds.includes(activeImportMethod.import_method_id)}
                            title={
                              dirtyImportMethodIds.includes(activeImportMethod.import_method_id)
                                ? "Save this Import Method before rotating its private link."
                                : undefined
                            }
                            onClick={() =>
                              setDestructiveConfirmation({
                                kind: "public-intake-link",
                                action: "rotate",
                                method: activeImportMethod
                              })
                            }
                          >
                            <RefreshCw size={15} />
                            Rotate link
                          </button>
                          <button
                            type="button"
                            className="secondary-button destructive-secondary-button"
                            disabled={dirtyImportMethodIds.includes(activeImportMethod.import_method_id)}
                            title={
                              dirtyImportMethodIds.includes(activeImportMethod.import_method_id)
                                ? "Save this Import Method before revoking its private link."
                                : undefined
                            }
                            onClick={() =>
                              setDestructiveConfirmation({
                                kind: "public-intake-link",
                                action: "revoke",
                                method: activeImportMethod
                              })
                            }
                          >
                            <Trash2 size={15} />
                            Revoke link
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="public-intake-safety-note">
                      <ShieldCheck size={18} />
                      <div>
                        <strong>Operator review remains in control.</strong>
                        <span>Customer submission creates a Pathfinder preview job only. This page cannot submit an order to Lift.</span>
                      </div>
                    </div>
                  </section>
                ) : null}
                {isImportMethodDetailOpen && activeImportMethod ? (
                  <section className="panel setup-panel source-setup-panel">
                    <PanelHeader icon={Upload} title="Source Setup" detail={sourceColumnOrigin} />
                    <div className="source-schema-setup">
                      <label
                        className={sourceSchemaState === "detecting" ? "source-schema-drop-zone source-schema-drop-zone-busy" : "source-schema-drop-zone"}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const [file] = Array.from(event.dataTransfer.files);
                          if (file && sourceSchemaState !== "detecting") {
                            void detectImportMethodSourceSchema(file);
                          }
                        }}
                      >
                        <FileSpreadsheet size={26} />
                        <div>
                          <strong>
                            {sourceSchemaState === "detecting"
                              ? "Detecting workbook schema..."
                              : detectedSourceSchema
                                ? "Replace detected source template"
                                : "Detect source template"}
                          </strong>
                          <span>
                            Drop or browse for XLSX, XLS, or CSV. Pathfinder retains sheet and column metadata only—not workbook rows or cell values.
                          </span>
                        </div>
                        <input
                          ref={methodTemplateInputRef}
                          className="file-input"
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          disabled={sourceSchemaState === "detecting"}
                          onChange={handleMethodTemplateChange}
                        />
                      </label>
                      <div className="source-schema-toolbar">
                        <div>
                          <span>Schema State</span>
                          <strong>
                            {detectedSourceSchema
                              ? detectedSourceSchemaIsStale
                                ? "Refresh required"
                                : activeImportMethodHasUnsavedChanges
                                ? "Included in method draft"
                                : "Saved with method"
                              : isUsingSampleSource
                                ? "Using sample columns"
                                : "No schema loaded"}
                          </strong>
                        </div>
                        <div className="source-schema-toolbar-actions">
                          {detectedSourceSchemaIsStale ? (
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={sourceSchemaState === "detecting"}
                              onClick={() => {
                                const file = methodTemplateFileRef.current;
                                if (file) {
                                  void detectImportMethodSourceSchema(file);
                                  return;
                                }
                                methodTemplateInputRef.current?.click();
                              }}
                            >
                              {methodTemplateFileRef.current ? "Re-detect Schema" : "Upload Template Again"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={isUsingSampleSource || sourceSchemaState === "detecting"}
                            onClick={useSampleSourceColumns}
                          >
                            Use Sample Columns
                          </button>
                        </div>
                      </div>
                      {detectedSourceSchemaIsStale ? (
                        <p className="source-schema-message source-schema-message-warning">
                          Parser settings have changed since this schema was detected. Re-detect before saving so columns and row classification stay in sync.
                        </p>
                      ) : sourceSchemaMessage ? (
                        <p className={sourceSchemaState === "error" ? "source-schema-message source-schema-message-error" : "source-schema-message"}>
                          {sourceSchemaMessage}
                        </p>
                      ) : null}
                      {detectedSourceSchema ? (
                        <div className="source-schema-sheet-list" aria-label="Detected source sheets">
                          {detectedSourceSchema.sheets.map((sheet) => (
                            <div key={sheet.sheet_name}>
                              <strong>{sheet.sheet_name}</strong>
                              <span>
                                {sheet.columns.length} columns · {sheet.order_row_count} order rows · {sheet.reference_row_count} reference rows
                              </span>
                              <span>
                                Header {sheet.header_row ? `row ${sheet.header_row}` : "auto"}
                                {sheet.header_row_count === 2 ? " · two-row header" : ""}
                                {sheet.ignored_header_rows?.length
                                  ? ` · ${sheet.ignored_header_rows.length} secondary/repeated header row${sheet.ignored_header_rows.length === 1 ? "" : "s"} ignored`
                                  : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {detectedSourceSchemaHistory.length ? (
                        <div className="source-schema-history-panel">
                          <div className="source-schema-history-heading">
                            <div>
                              <strong>Schema History</strong>
                              <span>
                                {detectedSourceSchemaHistory.length} previous structural version
                                {detectedSourceSchemaHistory.length === 1 ? "" : "s"} retained with this method.
                              </span>
                            </div>
                            <span>Latest 5</span>
                          </div>
                          <label className="setup-control source-schema-history-select">
                            <span>Compare With</span>
                            <select
                              value={selectedSourceSchemaHistory?.detected_at ?? ""}
                              onChange={(event) => setSelectedSourceSchemaHistoryDetectedAt(event.target.value)}
                            >
                              {detectedSourceSchemaHistory.map((schema) => (
                                <option key={`${schema.detected_at}-${schema.source_file_name}`} value={schema.detected_at}>
                                  {schema.source_file_name} · {displayTimestamp(schema.detected_at)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {detectedSourceSchema && selectedSourceSchemaHistory && selectedSourceSchemaComparison ? (
                            <div className="source-schema-history-comparison">
                              <div className="source-schema-history-context">
                                <span>Current</span>
                                <strong>{detectedSourceSchema.source_file_name}</strong>
                                <span>Previous</span>
                                <strong>{selectedSourceSchemaHistory.source_file_name}</strong>
                              </div>
                              <div className="source-schema-history-diff-grid">
                                <div>
                                  <span>Added Columns</span>
                                  <strong>
                                    {selectedSourceSchemaComparison.addedColumns.length
                                      ? selectedSourceSchemaComparison.addedColumns.join(", ")
                                      : "None"}
                                  </strong>
                                </div>
                                <div>
                                  <span>Removed Columns</span>
                                  <strong>
                                    {selectedSourceSchemaComparison.removedColumns.length
                                      ? selectedSourceSchemaComparison.removedColumns.join(", ")
                                      : "None"}
                                  </strong>
                                </div>
                                <div>
                                  <span>Sheet Changes</span>
                                  <strong>
                                    {[
                                      ...selectedSourceSchemaComparison.addedSheets.map((sheet) => `${sheet} added`),
                                      ...selectedSourceSchemaComparison.removedSheets.map((sheet) => `${sheet} removed`),
                                      ...selectedSourceSchemaComparison.changedSheets.map((sheet) => `${sheet} layout changed`)
                                    ].join(", ") || "None"}
                                  </strong>
                                </div>
                                <div>
                                  <span>Parser / Order</span>
                                  <strong>
                                    {[
                                      selectedSourceSchemaComparison.parserSettingsChanged ? "Parser settings changed" : "",
                                      selectedSourceSchemaComparison.columnOrderChanged ? "Column order changed" : ""
                                    ].filter(Boolean).join(", ") || "No change"}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p>Detect and save a new source template to compare it with this retained version.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <div className="source-setup-summary">
                      <div>
                        <span>Column Source</span>
                        <strong>{sourceName || "No order file loaded"}</strong>
                        <p>{sourceColumnOriginDetail}</p>
                      </div>
                      <div>
                        <span>Sheets Detected</span>
                        <strong>{detectedSourceSchema?.sheets.length || sourceSheets.length || 1}</strong>
                        <p>{sheetName}</p>
                      </div>
                      <div>
                        <span>Order Rows</span>
                        <strong>{sourceOrderRowCount}</strong>
                        <p>Rows with a valid quantity</p>
                      </div>
                      <div>
                        <span>Reference Rows</span>
                        <strong>{sourceReferenceRowCount}</strong>
                        <p>No-quantity rows stay out of submit</p>
                      </div>
                    </div>
                    <div className="setup-grid source-parser-grid">
                      <label className="setup-control">
                        <span>Header Row</span>
                        <input
                          type="number"
                          min={1}
                          value={sourceHeaderRow ?? ""}
                          placeholder="Auto-detect"
                          onChange={(event) => {
                            const value = event.target.value.trim();
                            updateActiveMethodDraft({
                              source_config: {
                                ...activeImportMethod.source_config,
                                header_row: value ? Number.parseInt(value, 10) || 1 : null
                              }
                            });
                          }}
                        />
                      </label>
                      <label className="setup-control">
                        <span>Header Rows</span>
                        <select
                          value={sourceHeaderRowCount}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              source_config: {
                                ...activeImportMethod.source_config,
                                header_row_count: Number.parseInt(event.target.value, 10) === 2 ? 2 : 1
                              }
                            })
                          }
                        >
                          <option value={1}>Single header row</option>
                          <option value={2}>Two-row grouped header</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Quantity Column</span>
                        <select
                          value={sourceQuantityColumn}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              source_config: {
                                ...activeImportMethod.source_config,
                                quantity_column: event.target.value || null
                              }
                            })
                          }
                        >
                          <option value="">Auto-detect quantity column</option>
                          {sourceQuantityColumn && !availableInputColumns.includes(sourceQuantityColumn) ? (
                            <option value={sourceQuantityColumn}>{sourceQuantityColumn}</option>
                          ) : null}
                          {availableInputColumns.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Embedded Headers</span>
                        <select
                          value={sourceIgnoresRepeatedHeaders ? "ignore" : "keep"}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              source_config: {
                                ...activeImportMethod.source_config,
                                ignore_repeated_headers: event.target.value === "ignore"
                              }
                            })
                          }
                        >
                          <option value="ignore">Ignore repeated/header-like rows</option>
                          <option value="keep">Keep every nonblank row</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>No-Quantity Rows</span>
                        <select
                          value={sourceReferenceRowsMode}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              source_config: {
                                ...activeImportMethod.source_config,
                                reference_rows_mode: event.target.value as "rows_without_quantity" | "ignore"
                              }
                            })
                          }
                        >
                          <option value="rows_without_quantity">Keep as reference/catalog rows</option>
                          <option value="ignore">Ignore no-quantity rows</option>
                        </select>
                      </label>
                    </div>
                    {detectedSourceSchema && configuredSourceSchemaSheet ? (
                      <div className="source-sheet-override-panel">
                        <div className="source-sheet-override-heading">
                          <div>
                            <strong>Per-Sheet Header Override</strong>
                            <span>Use this when workbook tabs do not share the global header layout.</span>
                          </div>
                          <span>
                            {Object.keys(sourceConfig.sheet_header_overrides ?? {}).length} active override
                            {Object.keys(sourceConfig.sheet_header_overrides ?? {}).length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="setup-grid source-sheet-override-grid">
                          <label className="setup-control">
                            <span>Workbook Sheet</span>
                            <select
                              value={configuredSourceSchemaSheet.sheet_name}
                              onChange={(event) => setSelectedSourceSchemaSheetName(event.target.value)}
                            >
                              {detectedSourceSchema.sheets.map((sheet) => (
                                <option key={sheet.sheet_name} value={sheet.sheet_name}>
                                  {sheet.sheet_name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="setup-control">
                            <span>Header Settings</span>
                            <select
                              value={selectedSourceSheetOverride ? "override" : "global"}
                              onChange={(event) => {
                                if (event.target.value === "global") {
                                  updateSourceSheetHeaderOverride(configuredSourceSchemaSheet.sheet_name, null);
                                  return;
                                }

                                updateSourceSheetHeaderOverride(configuredSourceSchemaSheet.sheet_name, {
                                  header_row: configuredSourceSchemaSheet.header_row ?? sourceHeaderRow,
                                  header_row_count:
                                    configuredSourceSchemaSheet.header_row_count ?? sourceHeaderRowCount
                                });
                              }}
                            >
                              <option value="global">Use global header settings</option>
                              <option value="override">Override this sheet</option>
                            </select>
                          </label>
                          {selectedSourceSheetOverride ? (
                            <>
                              <label className="setup-control">
                                <span>Sheet Header Row</span>
                                <input
                                  type="number"
                                  min={1}
                                  value={selectedSourceSheetOverride.header_row ?? ""}
                                  placeholder="Auto-detect"
                                  onChange={(event) => {
                                    const value = event.target.value.trim();
                                    updateSourceSheetHeaderOverride(configuredSourceSchemaSheet.sheet_name, {
                                      ...selectedSourceSheetOverride,
                                      header_row: value ? Number.parseInt(value, 10) || 1 : null
                                    });
                                  }}
                                />
                              </label>
                              <label className="setup-control">
                                <span>Sheet Header Rows</span>
                                <select
                                  value={selectedSourceSheetOverride.header_row_count}
                                  onChange={(event) =>
                                    updateSourceSheetHeaderOverride(configuredSourceSchemaSheet.sheet_name, {
                                      ...selectedSourceSheetOverride,
                                      header_row_count: Number.parseInt(event.target.value, 10) === 2 ? 2 : 1
                                    })
                                  }
                                >
                                  <option value={1}>Single header row</option>
                                  <option value={2}>Two-row grouped header</option>
                                </select>
                              </label>
                            </>
                          ) : null}
                        </div>
                        <p>
                          Quantity, repeated-header, and reference-row rules remain global. Header overrides take effect after re-detecting this schema.
                        </p>
                      </div>
                    ) : null}
                    <div className="source-setup-callout">
                      <strong>
                        {detectedSourceSchema
                          ? "Detected source columns are active for this method."
                          : isUsingSampleSource
                            ? "Sample columns are currently shown."
                            : "Loaded workbook columns are active."}
                      </strong>
                      <span>
                        {detectedSourceSchema
                          ? "Matching field mappings were preserved and recognized new columns were mapped automatically. Re-upload after changing parser settings, then save the method."
                          : isUsingSampleSource
                            ? "Detect the customer's workbook template here before finalizing product resolution and field mapping."
                            : "Column selectors below are based on the loaded workbook. Save this method when the parser behavior and mappings look right."}
                      </span>
                    </div>
                    <div className="panel-action-footer">
                      <span>Detected schema, parser settings, and field mappings save together with this import method.</span>
                      <div className="inline-action-row">
                        <button
                          className="secondary-button"
                          onClick={() => requestGuardedNavigation(() => setActiveCustomerView("Manual Import"))}
                        >
                          Open Manual Import
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}
                {isImportMethodDetailOpen && activeImportMethod ? (
                  <section className="panel setup-panel product-resolution-setup">
                    <PanelHeader icon={Database} title="Product Resolution" detail="Customer key to route product" />
                    <div className="method-source-context">
                      <div>
                        <span>Column Source</span>
                        <strong>{sourceColumnOrigin}</strong>
                      </div>
                      <div>
                        <span>Header Row</span>
                        <strong>
                          {sourceHeaderDisplay}
                          {sourceHeaderRowCount === 2 ? " · two rows" : ""}
                        </strong>
                      </div>
                      <div>
                        <span>Order Row Rule</span>
                        <strong>{sourceQuantityColumn || "Auto quantity"}</strong>
                      </div>
                      <div>
                        <span>Embedded Headers</span>
                        <strong>{sourceIgnoresRepeatedHeaders ? "Ignored" : "Kept"}</strong>
                      </div>
                    </div>
                    <div className="resolver-strategy-row">
                      <label className="setup-control resolver-strategy-control">
                        <span>Resolver Strategy</span>
                        <select
                          value={activeProductConfig.strategy}
                          onChange={(event) => {
                            setProductExampleTestValue("");
                            updateActiveMethodDraft({
                              product_resolution_config: {
                                ...activeProductConfig,
                                strategy: event.target.value as ProductResolverStrategy,
                                fallback_strategy: "none"
                              }
                            });
                          }}
                        >
                          <option value="derived_key">Derived key</option>
                          <option value="composite_key">Composite key</option>
                          <option value="direct_lift_unit_number">Direct product identifier</option>
                        </select>
                      </label>
                      <div className="resolver-explainer">
                        <strong>{activeResolverCopy.title}</strong>
                        <p>{activeResolverCopy.body}</p>
                      </div>
                    </div>
                    <div className="resolver-section-break" />
                    <div className="resolver-subsection-heading">
                      <h3>Configure Strategy Settings</h3>
                      <span>
                        {activeProductConfig.strategy === "direct_lift_unit_number"
                          ? "Choose the source field that already contains the route product identifier."
                          : activeProductConfig.strategy === "composite_key"
                            ? "Choose the source fields Pathfinder should combine into one product key."
                            : "Choose the source field and optional text added around the generated key."}
                      </span>
                    </div>
                    <div className="setup-grid product-resolution-grid">
                      {activeProductConfig.strategy === "derived_key" ? (
                        <>
                          <label className="setup-control">
                            <span>Source Column</span>
                            <select
                              value={activeProductConfig.source_column}
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  product_resolution_config: {
                                    ...activeProductConfig,
                                    source_column: event.target.value
                                  }
                                })
                              }
                            >
                              {availableInputColumns.map((column) => (
                                <option key={column} value={column}>
                                  {column}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="setup-control">
                            <span>Prefix</span>
                            <input
                              value={activeProductConfig.prefix}
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  product_resolution_config: {
                                    ...activeProductConfig,
                                    prefix: event.target.value
                                  }
                                })
                              }
                            />
                          </label>
                          <label className="setup-control">
                            <span>Suffix</span>
                            <input
                              value={activeProductConfig.suffix}
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  product_resolution_config: {
                                    ...activeProductConfig,
                                    suffix: event.target.value
                                  }
                                })
                              }
                            />
                          </label>
                        </>
                      ) : null}
                      {activeProductConfig.strategy === "direct_lift_unit_number" ? (
                        <label className="setup-control setup-control-wide">
                          <span>{activeOutputRoute.product_identifier_label} Column</span>
                          <select
                            value={activeProductConfig.direct_unit_number_column ?? activeProductConfig.source_column}
                            onChange={(event) =>
                              updateActiveMethodDraft({
                                product_resolution_config: {
                                  ...activeProductConfig,
                                  direct_unit_number_column: event.target.value,
                                  source_column: event.target.value
                                }
                              })
                            }
                          >
                            {availableInputColumns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {activeProductConfig.strategy === "composite_key" ? (
                        <div className="setup-control setup-control-wide composite-builder">
                          <span>
                            Composite Columns
                          </span>
                          <div className="chip-list">
                            {activeProductConfig.composite_columns.map((column) => (
                              <button
                                type="button"
                                className="column-chip"
                                key={column}
                                onClick={() =>
                                  updateActiveMethodDraft({
                                    product_resolution_config: {
                                      ...activeProductConfig,
                                      composite_columns: activeProductConfig.composite_columns.filter(
                                        (candidate) => candidate !== column
                                      )
                                    }
                                  })
                                }
                                title={`Remove ${column}`}
                              >
                                {column}
                                <span>X</span>
                              </button>
                            ))}
                            {activeProductConfig.composite_columns.length === 0 ? (
                              <em>No columns selected</em>
                            ) : null}
                          </div>
                          <div className="chip-add-row">
                            <select
                              value={compositeColumnToAdd}
                              onChange={(event) => setCompositeColumnToAdd(event.target.value)}
                            >
                              <option value="">Choose column</option>
                              {addableCompositeColumns.map((column) => (
                                <option key={column} value={column}>
                                  {column}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={!compositeColumnToAdd}
                              onClick={() => {
                                if (!compositeColumnToAdd) {
                                  return;
                                }
                                updateActiveMethodDraft({
                                  product_resolution_config: {
                                    ...activeProductConfig,
                                    composite_columns: [...activeProductConfig.composite_columns, compositeColumnToAdd]
                                  }
                                });
                                setCompositeColumnToAdd("");
                              }}
                            >
                              <Plus size={14} />
                              Add
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    {activeProductConfig.strategy !== "direct_lift_unit_number" ? (
                      <>
                        <div className="resolver-section-break" />
                        <div className="resolver-mode-row">
                          <label className="setup-control">
                            <span>Resolution Mode</span>
                            <select
                              value={activeProductConfig.mode}
                              onChange={(event) =>
                                updateActiveMethodDraft({
                                  product_resolution_config: {
                                    ...activeProductConfig,
                                    mode: event.target.value as ProductResolutionMode
                                  }
                                })
                              }
                            >
                              <option value="map_to_lift_unit">Look up key in output product map</option>
                              <option value="send_derived_unit">Use generated key as submitted product identifier</option>
                            </select>
                          </label>
                          <div className="resolver-explainer resolver-mode-explainer">
                            <strong>{activeResolutionModeCopy.title}</strong>
                            <p>{activeResolutionModeCopy.body}</p>
                          </div>
                        </div>
                      </>
                    ) : null}
                    <div className="resolver-section-break" />
                    <div className="resolver-example">
                      <div className="resolver-subsection-heading resolver-example-heading">
                        <h3>Example Output</h3>
                        <span>Type a test value or use the current source sample.</span>
                      </div>
                      {activeProductConfig.strategy !== "composite_key" ? (
                        <label className="setup-control resolver-test-value">
                          <span>
                            Test {productExampleTestColumn}
                            {activeProductConfig.strategy === "direct_lift_unit_number" ? " product identifier" : " value"}
                          </span>
                          <input
                            value={productExampleTestValue}
                            placeholder={
                              activeProductConfig.strategy === "direct_lift_unit_number"
                                ? outputIdentifierPlaceholder(activeOutputRoute)
                                : "2 Sheet Poster"
                            }
                            onChange={(event) => setProductExampleTestValue(event.target.value)}
                          />
                        </label>
                      ) : (
                        <div className="resolver-example-note">
                          Composite examples use the current source sample values from the selected columns.
                        </div>
                      )}
                      <div className="resolver-example-grid">
                        {productResolutionCards.map((card) => (
                          <div key={card.label}>
                            <span>{card.label}</span>
                            <strong>{card.value}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                ) : null}
                {isImportMethodDetailOpen && activeImportMethod ? (
                  <section className="panel setup-panel order-name-resolution-setup">
                    <PanelHeader icon={ClipboardList} title="Order Identity" detail="Pathfinder number + readable Lift name" />
                    <div className="order-name-route-strip">
                      <div>
                        <span>Customer Input</span>
                        <strong>
                          {mappings.find((mapping) => mapping.targetField === "order.order_title")?.sourceColumn ||
                            "No title column mapped"}
                        </strong>
                      </div>
                      <div>
                        <span>Canonical Destination</span>
                        <strong>order.order_title</strong>
                      </div>
                      <div>
                        <span>Lift JSON Destination</span>
                        <strong>{activeOrderNameLiftPath}</strong>
                      </div>
                      <div>
                        <span>Output Template</span>
                        <strong>{activeRouteTemplate?.name || activeOutputRoute.output_template}</strong>
                      </div>
                      <div>
                        <span>Lift Ext_ID</span>
                        <strong>
                          {activeImportMethod.ext_id_strategy === "pathfinder_generated"
                            ? "Pathfinder Order Number"
                            : "Customer external order ID"}
                        </strong>
                      </div>
                    </div>
                    <div className="resolver-strategy-row order-identity-strategy-row">
                      <label className="setup-control resolver-strategy-control">
                        <span>Lift Order ID</span>
                        <select
                          value={activeImportMethod.ext_id_strategy}
                          onChange={(event) =>
                            updateActiveMethodDraft({ ext_id_strategy: event.target.value as LiftExtIdStrategy })
                          }
                        >
                          <option value="pathfinder_generated">Pathfinder Order Number (recommended)</option>
                          <option value="customer_order_id">Customer order ID (advanced)</option>
                        </select>
                      </label>
                      <div className="resolver-explainer">
                        <strong>
                          {activeImportMethod.ext_id_strategy === "pathfinder_generated"
                            ? "One globally unique number, handled by Pathfinder"
                            : "Use the customer's mapped external order ID"}
                        </strong>
                        <p>
                          {activeImportMethod.ext_id_strategy === "pathfinder_generated"
                            ? "Pathfinder reserves the number when the preview job is created, saves it with the job, and reuses it for retries. The same value is sent in the Lift Ext_ID header and order.ext_id field."
                            : "This legacy option is available when the customer's ID is already guaranteed unique in Lift. Customer order, PO, and contract values remain available as references either way."}
                        </p>
                      </div>
                    </div>
                    <details className="order-name-advanced-settings">
                      <summary>
                        <span>Advanced readable order name settings</span>
                        <small>Optional customer title, composite text, and formatting</small>
                      </summary>
                      <div className="order-name-advanced-content">
                    <div className="order-name-enable-row">
                      <div>
                        <strong>Resolve and validate a Lift order name for this Import Method</strong>
                        <span>
                          Existing methods stay in legacy pass-through until enabled. New resolution rules remain deterministic and preview-only until a job is created.
                        </span>
                      </div>
                      <label>
                        <input
                          type="checkbox"
                          checked={activeOrderNameConfig.enabled}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              order_name_resolution_config: {
                                ...activeOrderNameConfig,
                                enabled: event.target.checked
                              }
                            })
                          }
                        />
                        {activeOrderNameConfig.enabled ? "Enabled" : "Legacy pass-through"}
                      </label>
                    </div>
                    <div className="resolver-strategy-row">
                      <label className="setup-control resolver-strategy-control">
                        <span>Resolution Strategy</span>
                        <select
                          value={activeOrderNameConfig.strategy}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              order_name_resolution_config: {
                                ...activeOrderNameConfig,
                                strategy: event.target.value as OrderNameResolutionStrategy
                              }
                            })
                          }
                        >
                          <option value="provided">Customer-provided value</option>
                          <option value="composite">Composite value</option>
                          <option value="provided_then_composite">Customer value, then composite fallback</option>
                        </select>
                      </label>
                      <div className="resolver-explainer">
                        <strong>{activeOrderNameStrategyCopy.title}</strong>
                        <p>{activeOrderNameStrategyCopy.body}</p>
                      </div>
                    </div>
                    {activeOrderNameConfig.strategy !== "provided" ? (
                      <>
                        <div className="resolver-section-break" />
                        <div className="resolver-subsection-heading">
                          <h3>Composite Components</h3>
                          <span>Ordered canonical values keep the rule stable when customer headers change.</span>
                        </div>
                        <div className="order-name-component-list">
                          {activeOrderNameConfig.components.map((component, index) => {
                            const componentKey =
                              component.kind === "text" ? `text:${component.value ?? ""}` : component.field;
                            const componentPreview = orderNameResolution.result.component_values.find(
                              (item) => item.field === componentKey
                            )?.value;
                            return (
                            <div className="order-name-component-row" key={`${component.kind ?? "field"}-${index}`}>
                              <div className="order-name-component-order">
                                <span>{index + 1}</span>
                                <div>
                                  <button
                                    type="button"
                                    disabled={index === 0}
                                    onClick={() => {
                                      const components = [...activeOrderNameConfig.components];
                                      [components[index - 1], components[index]] = [components[index], components[index - 1]];
                                      updateActiveMethodDraft({
                                        order_name_resolution_config: { ...activeOrderNameConfig, components }
                                      });
                                    }}
                                  >
                                    Up
                                  </button>
                                  <button
                                    type="button"
                                    disabled={index === activeOrderNameConfig.components.length - 1}
                                    onClick={() => {
                                      const components = [...activeOrderNameConfig.components];
                                      [components[index], components[index + 1]] = [components[index + 1], components[index]];
                                      updateActiveMethodDraft({
                                        order_name_resolution_config: { ...activeOrderNameConfig, components }
                                      });
                                    }}
                                  >
                                    Down
                                  </button>
                                </div>
                              </div>
                              <div>
                                {component.kind === "text" ? (
                                  <input
                                    className="order-name-static-component-input"
                                    value={component.value ?? ""}
                                    maxLength={120}
                                    aria-label={`Fixed text component ${index + 1}`}
                                    onChange={(event) => {
                                      const components = activeOrderNameConfig.components.map((candidate, componentIndex) =>
                                        componentIndex === index ? { ...candidate, value: event.target.value } : candidate
                                      );
                                      updateActiveMethodDraft({
                                        order_name_resolution_config: { ...activeOrderNameConfig, components }
                                      });
                                    }}
                                  />
                                ) : (
                                  <strong>{component.field}</strong>
                                )}
                                <span>{component.kind === "text" ? "Fixed text" : componentPreview || "No sample value"}</span>
                              </div>
                              {component.kind === "text" ? (
                                <div className="order-name-static-component-label">Included exactly as entered</div>
                              ) : (
                              <label className="setup-control order-name-inline-control">
                                <span>Format</span>
                                <select
                                  value={component.format}
                                  onChange={(event) => {
                                    const components = activeOrderNameConfig.components.map((candidate, componentIndex) =>
                                      componentIndex === index
                                        ? { ...candidate, format: event.target.value as "none" | "yyyyMMdd" }
                                        : candidate
                                    );
                                    updateActiveMethodDraft({
                                      order_name_resolution_config: { ...activeOrderNameConfig, components }
                                    });
                                  }}
                                >
                                  <option value="none">As mapped</option>
                                  <option value="yyyyMMdd">Date · yyyyMMdd</option>
                                </select>
                              </label>
                              )}
                              {component.kind === "text" ? <span /> : (
                              <label className="order-name-optional-control">
                                <input
                                  type="checkbox"
                                  checked={component.optional}
                                  onChange={(event) => {
                                    const components = activeOrderNameConfig.components.map((candidate, componentIndex) =>
                                      componentIndex === index ? { ...candidate, optional: event.target.checked } : candidate
                                    );
                                    updateActiveMethodDraft({
                                      order_name_resolution_config: { ...activeOrderNameConfig, components }
                                    });
                                  }}
                                />
                                Optional
                              </label>
                              )}
                              <button
                                type="button"
                                className="order-name-remove-component"
                                onClick={() =>
                                  updateActiveMethodDraft({
                                    order_name_resolution_config: {
                                      ...activeOrderNameConfig,
                                      components: activeOrderNameConfig.components.filter(
                                        (_candidate, componentIndex) => componentIndex !== index
                                      )
                                    }
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          );})}
                          <div className="order-name-component-add">
                            <label className="setup-control order-name-component-field-control">
                              <span>Canonical Field</span>
                              <select
                                value={orderNameComponentToAdd}
                                onChange={(event) => setOrderNameComponentToAdd(event.target.value)}
                              >
                                <option value="">Choose canonical field</option>
                                {addableOrderNameComponentOptions.map((path) => (
                                  <option value={path} key={path}>
                                    {path}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={!orderNameComponentToAdd || activeOrderNameConfig.components.length >= 12}
                              onClick={() => {
                                if (!orderNameComponentToAdd) {
                                  return;
                                }
                                updateActiveMethodDraft({
                                  order_name_resolution_config: {
                                    ...activeOrderNameConfig,
                                    components: [
                                      ...activeOrderNameConfig.components,
                                      { field: orderNameComponentToAdd, format: "none", optional: true }
                                    ]
                                  }
                                });
                                setOrderNameComponentToAdd("");
                              }}
                            >
                              <Plus size={14} />
                              Add Component
                            </button>
                            <label className="setup-control order-name-component-text-control">
                              <span>Fixed Text</span>
                              <input
                                value={orderNameTextToAdd}
                                maxLength={120}
                                placeholder="e.g. Empirical Web Order"
                                onChange={(event) => setOrderNameTextToAdd(event.target.value)}
                              />
                            </label>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={!orderNameTextToAdd.trim() || activeOrderNameConfig.components.length >= 12}
                              onClick={() => {
                                const value = orderNameTextToAdd.trim();
                                if (!value) {
                                  return;
                                }
                                updateActiveMethodDraft({
                                  order_name_resolution_config: {
                                    ...activeOrderNameConfig,
                                    components: [
                                      ...activeOrderNameConfig.components,
                                      { kind: "text", field: "", value, format: "none", optional: false }
                                    ]
                                  }
                                });
                                setOrderNameTextToAdd("");
                              }}
                            >
                              <Plus size={14} />
                              Add Text
                            </button>
                          </div>
                        </div>
                      </>
                    ) : null}
                    <div className="resolver-section-break" />
                    <div className="resolver-subsection-heading">
                      <h3>Final Formatting</h3>
                      <span>Stable formatting applies to both provided and composite names.</span>
                    </div>
                    <div className="setup-grid order-name-format-grid">
                      <label className="setup-control">
                        <span>Prefix</span>
                        <input
                          value={activeOrderNameConfig.prefix}
                          placeholder="Optional, e.g. MOM"
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              order_name_resolution_config: { ...activeOrderNameConfig, prefix: event.target.value }
                            })
                          }
                        />
                      </label>
                      <label className="setup-control">
                        <span>Suffix</span>
                        <input
                          value={activeOrderNameConfig.suffix}
                          placeholder="Optional"
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              order_name_resolution_config: { ...activeOrderNameConfig, suffix: event.target.value }
                            })
                          }
                        />
                      </label>
                      <label className="setup-control">
                        <span>Separator</span>
                        <input
                          value={activeOrderNameConfig.separator}
                          maxLength={8}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              order_name_resolution_config: { ...activeOrderNameConfig, separator: event.target.value }
                            })
                          }
                        />
                      </label>
                      <label className="setup-control">
                        <span>Case</span>
                        <select
                          value={activeOrderNameConfig.case}
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              order_name_resolution_config: {
                                ...activeOrderNameConfig,
                                case: event.target.value as OrderNameResolutionCase
                              }
                            })
                          }
                        >
                          <option value="preserve">Preserve</option>
                          <option value="upper">UPPERCASE</option>
                          <option value="lower">lowercase</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Maximum Length</span>
                        <input
                          type="number"
                          min={1}
                          max={512}
                          value={activeOrderNameConfig.max_length ?? ""}
                          placeholder="Not confirmed"
                          onChange={(event) =>
                            updateActiveMethodDraft({
                              order_name_resolution_config: {
                                ...activeOrderNameConfig,
                                max_length: event.target.value ? Number(event.target.value) : null
                              }
                            })
                          }
                        />
                      </label>
                    </div>
                      </div>
                    </details>
                    <div className="resolver-section-break" />
                    <div className="resolver-example order-name-preview">
                      <div className="resolver-subsection-heading resolver-example-heading">
                        <h3>Live Resolution Preview</h3>
                        <span>Uses the current mapped sample and does not reserve or submit a Lift order.</span>
                      </div>
                      <div className="resolver-example-grid">
                        <div>
                          <span>Resolved Order Name</span>
                          <strong>
                            {canonicalOrder.order.order_title ||
                              (activeOrderNameConfig.enabled ? "Resolution blocked" : "No mapped title")}
                          </strong>
                        </div>
                        <div>
                          <span>Resolution Source</span>
                          <strong>
                            {!activeOrderNameConfig.enabled
                              ? "Legacy pass-through"
                              : orderNameResolution.result.source === "provided"
                              ? "Customer-provided title"
                              : orderNameResolution.result.source === "composite"
                                ? "Composite fallback"
                                : "Missing required value"}
                          </strong>
                        </div>
                        <div>
                          <span>Canonical Record</span>
                          <strong>order.order_title</strong>
                        </div>
                        <div>
                          <span>Lift JSON</span>
                          <strong>{activeOrderNameLiftPath}</strong>
                        </div>
                      </div>
                      <div
                        className={`order-name-validation-note ${
                          (activeOrderNameConfig.enabled && !orderNameResolution.result.value) ||
                          orderNameResolution.result.exceeds_max_length
                            ? "order-name-validation-blocked"
                            : ""
                        }`}
                      >
                        {(activeOrderNameConfig.enabled && !orderNameResolution.result.value) ||
                        orderNameResolution.result.exceeds_max_length ? (
                          <AlertTriangle size={18} />
                        ) : (
                          <ShieldCheck size={18} />
                        )}
                        <span>
                          {!activeOrderNameConfig.enabled
                            ? "Legacy pass-through preserves the existing mapped title and adds no new validation gate."
                            : !orderNameResolution.result.value
                            ? `Resolution needs attention${
                                orderNameResolution.result.missing_required_fields.length
                                  ? `: ${orderNameResolution.result.missing_required_fields.join(", ")}`
                                  : "."
                              }`
                            : orderNameResolution.result.exceeds_max_length
                              ? `The resolved name is ${orderNameResolution.result.value.length} characters and exceeds this method's maximum.`
                              : "The same mapped values will resolve to the same order name on retry. Duplicate blocking is enforced within each import batch."}
                        </span>
                      </div>
                    </div>
                  </section>
                ) : null}
                {isImportMethodDetailOpen && activeImportMethod ? (
                  <section className="panel mapping-panel">
                    <PanelHeader icon={Map} title="Field Mapping" detail="All found input elements can map to any canonical target" />
                    <div className="mapping-table-wrap">
                      <table className="mapping-table">
                        <thead>
                          <tr>
                            <th>Found Input Element</th>
                            <th>Sample Values</th>
                            <th>Canonical Target</th>
                          </tr>
                        </thead>
                        <tbody>
                          {foundInputElements.map(({ column, sample }) => {
                            const selected = mappings.find((mapping) => mapping.sourceColumn === column)?.targetField ?? "";
                            return (
                              <tr key={column}>
                                <td>
                                  <strong>{column}</strong>
                                  <span className="cell-meta">Source field</span>
                                </td>
                                <td>{sample || "No sample value found"}</td>
                                <td>
                                  <select
                                    value={selected}
                                    onChange={(event) => {
                                      const nextMappings = updateMapping(mappings, column, event.target.value);
                                      setMappings(nextMappings);
                                      updateActiveMethodDraft({ mappings: nextMappings });
                                    }}
                                  >
                                    <option value="">Ignore</option>
                                    <CanonicalFieldOptionGroups fields={canonicalRegistryFields} />
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="panel-action-footer">
                      <span>
                        {mappedColumnCount} of {sourceGrid.columns.length} source columns mapped. Field mappings save with this import method.
                      </span>
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}

            {activeCustomerView === "Output Product Map" ? (
              <>
                <section className="metric-strip unit-map-metrics" aria-label="Output product map metrics">
                  {[
                    {
                      value: selectedOutputMapRoute.status,
                      label: "Output Route",
                      trend: selectedOutputMapRoute.name,
                      intent: selectedOutputMapRoute.status === "Active" ? "good" : "bad",
                      icon: Workflow
                    },
                    {
                      value: selectedOutputMapTarget?.name ?? "Target",
                      label: selectedOutputMapTarget?.target_type ?? "Target",
                      trend: `${selectedOutputMapTarget?.health_status ?? "Untested"} · ${selectedOutputMapTarget?.adapter ?? selectedOutputMapRoute.target_system}`,
                      intent: selectedOutputMapTarget?.status === "Draft" ? "bad" : "good",
                      icon: Database
                    },
                    {
                      value: selectedOutputMapEnvironment?.name ?? "None",
                      label: selectedOutputMapEnvironment?.role ?? "Environment",
                      trend: selectedOutputMapEnvironment?.endpoint_url ? "Endpoint configured" : "Endpoint missing",
                      intent: selectedOutputMapEnvironment?.endpoint_url ? "good" : "bad",
                      icon: Gauge
                    },
                    {
                      value: selectedOutputMapTemplate?.output_format ?? "Template",
                      label: selectedOutputMapTemplate?.destination_method ?? "Output Template",
                      trend: selectedOutputMapTemplate?.name ?? selectedOutputMapRoute.output_template,
                      intent: selectedOutputMapTemplate?.status === "Active" ? "good" : "bad",
                      icon: Braces
                    },
                    {
                      value: `${routeMappedCount}/${routeProductMappings.length}`,
                      label: "Mapped Keys",
                      trend: routeBlockingCount
                        ? `${routeBlockingCount} need ${selectedOutputMapRoute.product_identifier_label}`
                        : `${routePreloadedCount} preloaded · ${routeSeenExampleCount} seen`,
                      intent: routeBlockingCount ? "bad" : "good",
                      icon: routeBlockingCount ? AlertTriangle : CheckCircle2
                    }
                  ].map(({ value, label, trend, intent, icon: Icon }) => (
                    <div className="metric-card" key={label}>
                      <div className="metric-icon">
                        <Icon size={20} />
                      </div>
                      <div>
                        <strong>{value}</strong>
                        <span>{label}</span>
                        <small className={intent === "bad" ? "trend-bad" : "trend-good"}>{trend}</small>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="panel unit-map-panel">
                  <div className="panel-header unit-map-panel-header">
                    <div className="panel-title">
                      <Database size={18} strokeWidth={2.2} />
                      <h2>Output Product Map</h2>
                    </div>
                    <div className="unit-map-header-actions">
                      <span>Customer keys resolved per output route</span>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setActiveCatalogMappingId(null);
                          setOpenProductMapTool("unit-library");
                        }}
                      >
                        <Database size={15} />
                        Lift Product Catalog
                      </button>
                      <button className="primary-button" onClick={() => setOpenProductMapTool("preload")}>
                        <Upload size={15} />
                        Preload List
                      </button>
                    </div>
                  </div>
                  <div className="unit-map-toolbar">
                    <label className="unit-map-search">
                      <Search size={16} />
                      <input
                        value={unitMapSearch}
                        placeholder="Search key, source value, route identifier, or product"
                        onChange={(event) => setUnitMapSearch(event.target.value)}
                      />
                    </label>
                    <label className="setup-control unit-map-filter">
                      <span>Output Route</span>
                      <select
                        value={outputMapRouteFilter}
                        onChange={(event) => {
                          setOutputMapRouteFilter(event.target.value);
                          setMigrationQueueRouteId(null);
                        }}
                      >
                        <option value="All">Active method route</option>
                        {outputRoutes.map((route) => (
                          <option key={route.output_route_id} value={route.output_route_id}>
                            {route.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="setup-control unit-map-filter">
                      <span>Status</span>
                      <select
                        value={unitMapStatusFilter}
                        onChange={(event) => setUnitMapStatusFilter(event.target.value as ProductMappingStatus | "All")}
                      >
                        <option value="All">All statuses</option>
                        <option value="Unmapped">Unmapped</option>
                        <option value="Mapped">Mapped</option>
                        <option value="Ambiguous">Ambiguous</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </label>
                  </div>
                  <div className="output-route-context">
                    <div>
                      <span>Route</span>
                      <strong>{selectedOutputMapRoute.name}</strong>
                    </div>
                    <div>
                      <span>Destination</span>
                      <strong>
                        {selectedOutputMapRoute.target_system} · {selectedOutputMapRoute.destination_account_name}
                        {selectedOutputMapRoute.company_id ? ` / ${selectedOutputMapRoute.company_id}` : ""}
                      </strong>
                    </div>
                    <div>
                      <span>Environment</span>
                      <strong>
                        {selectedOutputMapEnvironment?.name ?? "Not selected"}
                        {selectedOutputMapEnvironment?.role ? ` · ${selectedOutputMapEnvironment.role}` : ""}
                      </strong>
                    </div>
                    <div>
                      <span>Output Template</span>
                      <strong>{selectedOutputMapTemplate?.name ?? selectedOutputMapRoute.output_template}</strong>
                    </div>
                    <div>
                      <span>Product Identifier</span>
                      <strong>{selectedOutputMapRoute.product_identifier_label}</strong>
                    </div>
                  </div>

                  {isMigrationQueueActive ? (
                    <div
                      className={`migration-remap-queue ${
                        selectedRouteMigrationQueue.length ? "migration-remap-queue-warning" : "migration-remap-queue-ready"
                      }`}
                    >
                      <div>
                        <span>Focused remap queue</span>
                        <strong>
                          {selectedRouteMigrationQueue.length
                            ? `${selectedRouteMigrationQueue.length} mapping${
                                selectedRouteMigrationQueue.length === 1 ? "" : "s"
                              } need ${selectedOutputMapRoute.product_identifier_label}`
                            : `All mappings include ${selectedOutputMapRoute.product_identifier_label}`}
                        </strong>
                        <p>
                          {selectedRouteMigrationQueue.length
                            ? "Only active Pathfinder rows missing the current route product identifier are shown. Map each row from the Lift catalog; identifiers saved for the previous strategy remain stored."
                            : "The strategy migration queue is clear. No stored identifiers were rewritten."}
                        </p>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => setMigrationQueueRouteId(null)}>
                        Show All Mappings
                      </button>
                    </div>
                  ) : null}

                  <div className="catalog-preset-strip">
                    <div>
                      <span>Pinned Lift Catalogs</span>
                      <strong>
                        {routeCatalogPresets.length
                          ? `${routeCatalogPresets.length} saved for this route`
                          : "No saved catalog presets"}
                      </strong>
                    </div>
                    <label className="setup-control">
                      <span>Catalog Preset</span>
                      <select
                        value=""
                        onChange={(event) => {
                          const preset = routeCatalogPresets.find((candidate) => candidate.preset_id === event.target.value);
                          if (preset) {
                            applyCatalogPreset(preset);
                            setOpenProductMapTool("unit-library");
                          }
                        }}
                      >
                        <option value="">Choose catalog</option>
                        {routeCatalogPresets.map((preset) => (
                          <option key={preset.preset_id} value={preset.preset_id}>
                            {preset.catalog_name} / {preset.catalog_id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setActiveCatalogMappingId(null);
                        setOpenProductMapTool("unit-library");
                      }}
                    >
                      Manage Catalogs
                    </button>
                  </div>

                  {openProductMapTool === "preload" ? (
                    <div
                      className="product-map-modal-backdrop"
                      role="presentation"
                      onClick={() => {
                        setOpenProductMapTool(null);
                        setActiveCatalogMappingId(null);
                      }}
                    >
                      <section
                        className="product-preload-panel product-map-modal product-map-modal-wide"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Preload Customer Product List"
                        onClick={(event) => event.stopPropagation()}
                      >
                    <div className="product-preload-header">
                      <div>
                        <strong>Preload Customer Product List</strong>
                        <span>
                          Front-load expected customer values into this route's product map before an order arrives.
                        </span>
                      </div>
                      <div className="product-preload-stats">
                        <span>{preloadPreviewRows.length} parsed</span>
                        <span>{preloadMappedCount} with {selectedOutputMapRoute.product_identifier_label}</span>
                        <span>{preloadDuplicateCount + preloadMissingCount} need review</span>
                        <button className="modal-close-button" onClick={() => setOpenProductMapTool(null)} aria-label="Close preload product list">
                          <X size={17} />
                        </button>
                      </div>
                    </div>

                    <div className="product-preload-grid">
                      <label className="setup-control product-preload-source">
                        <span>Paste Product List</span>
                        <textarea
                          value={preloadText}
                          placeholder={
                            "DESCRIPTION\tSIGN TYPE\tFinal Size Width\tFinal Size Length\tLift product_id\nPump topper (Clip)\tPump Topper\t20.13\t12\t"
                          }
                          onChange={(event) => setPreloadText(event.target.value)}
                        />
                      </label>
                      <div className="product-preload-controls">
                        <label className="setup-control">
                          <span>Source Name</span>
                          <input
                            value={preloadSourceName}
                            onChange={(event) => setPreloadSourceName(event.target.value)}
                          />
                        </label>
                        <label className="setup-control">
                          <span>Key Source Column</span>
                          <select
                            value={effectivePreloadSourceColumn}
                            onChange={(event) => setPreloadSourceColumn(event.target.value)}
                          >
                            {preloadSourceColumnOptions.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Product Name Column</span>
                          <select
                            value={preloadProductNameColumn}
                            onChange={(event) => setPreloadProductNameColumn(event.target.value)}
                          >
                            <option value="">Use generated label</option>
                            {preloadColumns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Final Width Column</span>
                          <select
                            value={preloadFinalWidthColumn}
                            onChange={(event) => setPreloadFinalWidthColumn(event.target.value)}
                          >
                            <option value="">Auto-detect</option>
                            {preloadColumns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Final Height Column</span>
                          <select
                            value={preloadFinalHeightColumn}
                            onChange={(event) => setPreloadFinalHeightColumn(event.target.value)}
                          >
                            <option value="">Auto-detect</option>
                            {preloadColumns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>{selectedOutputMapRoute.product_identifier_label} Column</span>
                          <select
                            value={preloadUnitColumn}
                            onChange={(event) => setPreloadUnitColumn(event.target.value)}
                          >
                            <option value="">No column</option>
                            {preloadColumns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Default Identifier</span>
                          <input
                            value={preloadDefaultUnit}
                            placeholder="Optional bulk value"
                            onChange={(event) => setPreloadDefaultUnit(event.target.value)}
                          />
                        </label>
                        <div className="product-preload-actions">
                          <input
                            ref={productPreloadFileRef}
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            hidden
                            onChange={(event) => {
                              const [file] = Array.from(event.target.files ?? []);
                              if (file) {
                                void importPreloadCatalogFile(file);
                              }
                              event.target.value = "";
                            }}
                          />
                          <button className="secondary-button" onClick={() => productPreloadFileRef.current?.click()}>
                            <Upload size={15} />
                            Upload List
                          </button>
                          <button className="secondary-button" onClick={parsePreloadProductList}>
                            <FileSpreadsheet size={15} />
                            Preview List
                          </button>
                          <button
                            className="primary-button"
                            onClick={() => void savePreloadedProductMappings(preloadSelectedIds.length ? "selected" : "all")}
                            disabled={workspaceState === "saving" || validPreloadRows.length === 0}
                          >
                            <Upload size={15} />
                            Save {preloadSelectedIds.length ? `${preloadSelectedIds.length} Selected` : "Valid Rows"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {preloadPreviewRows.length ? (
                      <div className="product-preload-preview">
                        <table>
                          <thead>
                            <tr>
                              <th>
                                <input
                                  type="checkbox"
                                  checked={
                                    validPreloadRows.length > 0 &&
                                    validPreloadRows.every((row) => preloadSelectedIds.includes(row.row_id))
                                  }
                                  onChange={toggleAllPreloadRows}
                                  aria-label="Select all valid preloaded product rows"
                                />
                              </th>
                              <th>Action</th>
                              <th>Customer Value</th>
                              <th>Generated Key</th>
                              <th>Final Width</th>
                              <th>Final Height</th>
                              <th>{selectedOutputMapRoute.product_identifier_label}</th>
                              <th>Product</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preloadPreviewRows.slice(0, 12).map((row) => (
                              <tr key={row.row_id}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={preloadSelectedIds.includes(row.row_id)}
                                    disabled={!row.customer_product_key || row.action === "Duplicate"}
                                    onChange={() => togglePreloadRow(row.row_id)}
                                    aria-label={`Select preloaded row ${row.row_number}`}
                                  />
                                </td>
                                <td>
                                  <span
                                    className={
                                      row.action === "New"
                                        ? "mini-pill mini-pill-success"
                                        : row.action === "Update"
                                          ? "mini-pill mini-pill-neutral"
                                          : "mini-pill mini-pill-warning"
                                    }
                                  >
                                    {row.action}
                                  </span>
                                </td>
                                <td>
                                  <strong>{row.source_value || "Blank"}</strong>
                                  <span className="cell-meta">Row {row.row_number}</span>
                                </td>
                                <td>
                                  <strong>{row.customer_product_key || "No key generated"}</strong>
                                  <span className="cell-meta">{row.source_columns.join(", ") || "No source column"}</span>
                                </td>
                                <td>{row.final_width || "—"}</td>
                                <td>{row.final_height || "—"}</td>
                                <td>{row.product_identifier_value || "Needs mapping"}</td>
                                <td>{row.product_name || row.display_label}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {preloadPreviewRows.length > 12 ? (
                          <p className="empty-state">Showing first 12 rows. Saving applies to all valid rows unless specific rows are selected.</p>
                        ) : null}
                      </div>
                    ) : null}
                      </section>
                    </div>
                  ) : null}

                  {openProductMapTool === "unit-library" ? (
                    <aside
                      className="unit-catalog-panel unit-catalog-drawer"
                      role="dialog"
                      aria-modal="false"
                      aria-label="Lift Product Catalog"
                    >
                    <div className="unit-catalog-header">
                      <div>
                        <strong>
                          {activeCatalogMapping
                            ? "Map Lift Product"
                            : selectedUnitMappings.length
                              ? "Bulk Map Lift Product"
                              : "Browse Lift Product Catalog"}
                        </strong>
                        <span>
                          {activeCatalogMapping
                            ? "Choose the approved Lift product for this Pathfinder customer key."
                            : selectedUnitMappings.length
                              ? `Choose one Lift product and assign it to ${selectedUnitMappings.length} selected Pathfinder keys.`
                              : "Review Lift products by catalog. Use Map Product on a Pathfinder row for the guided mapping flow."}
                        </span>
                      </div>
                      <div className="unit-catalog-header-actions">
                        <button
                          className="modal-close-button"
                          onClick={() => {
                            setOpenProductMapTool(null);
                            setActiveCatalogMappingId(null);
                            setSelectedCatalogDetailId(null);
                          }}
                          aria-label="Close Lift product catalog"
                        >
                          <X size={17} />
                        </button>
                      </div>
                    </div>
                    <div
                      className={`unit-catalog-focus unit-catalog-mapping-scope${
                        activeCatalogMapping ? " is-single" : selectedUnitMappings.length ? " is-bulk" : " is-reference"
                      }`}
                    >
                      <div>
                        <span>{activeCatalogMapping ? "Pathfinder key" : selectedUnitMappings.length ? "Bulk scope" : "Catalog mode"}</span>
                        <strong>
                          {activeCatalogMapping
                            ? activeCatalogMapping.customer_product_key
                            : selectedUnitMappings.length
                              ? `${selectedUnitMappings.length} selected customer keys`
                              : "Reference browsing"}
                        </strong>
                      </div>
                      <div>
                        <span>Source value</span>
                        <strong>
                          {activeCatalogMapping
                            ? activeCatalogMapping.display_label || activeCatalogMapping.customer_product_key
                            : selectedUnitMappings.length
                              ? selectedUnitMappings
                                  .map((mapping) => mapping.display_label || mapping.customer_product_key)
                                  .slice(0, 2)
                                  .join(", ") + (selectedUnitMappings.length > 2 ? `, +${selectedUnitMappings.length - 2}` : "")
                              : "Open from a row to assign a mapping"}
                        </strong>
                      </div>
                      <div>
                        <span>Route product identifier</span>
                        <strong>
                          {activeCatalogMapping
                            ? `${selectedOutputMapRoute.product_identifier_label}: ${
                                productMappingIdentifierForRoute(activeCatalogMapping, selectedOutputMapRoute) || "Needs mapping"
                              }`
                            : selectedUnitMappings.length
                              ? `${selectedOutputMapRoute.product_identifier_label} assignment`
                              : selectedOutputMapRoute.product_identifier_label}
                        </strong>
                      </div>
                    </div>
                    <section className="unit-catalog-scope">
                      <div className="unit-catalog-scope-summary">
                        <div>
                          <strong>Active Lift catalog scope</strong>
                          <span>
                            {activeCatalogScopeId
                              ? `${activeCatalogScopeName} / ${activeCatalogScopeId}`
                              : "Choose a saved catalog or enter a catalog ID."}
                          </span>
                        </div>
                        <button
                          className="primary-button"
                          onClick={() => void refreshLiftProductCatalog(selectedOutputMapRoute)}
                          disabled={unitCatalogState === "loading" || !unitCatalogApiFilterValue.trim()}
                        >
                          <RefreshCw size={15} />
                          Refresh from Lift
                        </button>
                      </div>
                      <div className="unit-catalog-scope-row">
                        <label className="setup-control">
                          <span>Pinned catalog</span>
                          <select
                            value={activeCatalogScopePreset?.preset_id ?? ""}
                            onChange={(event) => {
                              const preset = routeCatalogPresets.find((candidate) => candidate.preset_id === event.target.value);
                              if (preset) {
                                applyCatalogPreset(preset);
                              }
                            }}
                          >
                            <option value="">Choose saved catalog</option>
                            {routeCatalogPresets.map((preset) => (
                              <option key={preset.preset_id} value={preset.preset_id}>
                                {preset.catalog_name} / {preset.catalog_id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Catalog ID</span>
                          <input
                            value={unitCatalogApiFilterParam === "catalog_id" ? unitCatalogApiFilterValue : catalogPresetId}
                            placeholder="8102"
                            onChange={(event) => {
                              setCatalogPresetId(event.target.value);
                              setUnitCatalogApiFilterParam("catalog_id");
                              setUnitCatalogApiFilterValue(event.target.value);
                              setUnitCatalogCatalogFilter("All");
                            }}
                          />
                        </label>
                        <button
                          className="secondary-button"
                          onClick={() => void saveCatalogPreset()}
                          disabled={workspaceState === "saving" || !activeCatalogScopeId}
                        >
                          Pin Catalog
                        </button>
                        {activeCatalogScopePreset ? (
                          <button
                            className="icon-button"
                            onClick={() => void deleteCatalogPreset(activeCatalogScopePreset)}
                            aria-label={`Remove ${activeCatalogScopePreset.catalog_name} catalog preset`}
                          >
                            <X size={15} />
                          </button>
                        ) : null}
                      </div>
                      <p className="unit-catalog-scope-note">
                        Catalog names are read from Lift after refresh. Search below filters the loaded products with fuzzy matching.
                      </p>
                      <details className="unit-catalog-advanced">
                        <summary>Advanced filters</summary>
                        <div className="unit-catalog-filters">
                          <label className="setup-control">
                            <span>Status</span>
                            <select
                              value={unitCatalogStatusFilter}
                              onChange={(event) => setUnitCatalogStatusFilter(event.target.value as "Active" | "Inactive" | "All")}
                            >
                              <option value="Active">Active products</option>
                              <option value="Inactive">Inactive products</option>
                              <option value="All">All products</option>
                            </select>
                          </label>
                          <label className="setup-control">
                            <span>Product Type</span>
                            <select
                              value={unitCatalogProductTypeFilter}
                              onChange={(event) => setUnitCatalogProductTypeFilter(event.target.value)}
                            >
                              <option value="All">All product types</option>
                              {unitCatalogProductTypeOptions.map((productType) => (
                                <option key={productType} value={productType}>
                                  {productType}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="setup-control">
                            <span>Cached Catalog</span>
                            <select
                              value={unitCatalogCatalogFilter}
                              onChange={(event) => setUnitCatalogCatalogFilter(event.target.value)}
                            >
                              <option value="All">All cached catalogs</option>
                              {unitCatalogCatalogOptions.map(([catalogId, catalogName]) => (
                                <option key={catalogId} value={catalogId}>
                                  {catalogName} / {catalogId}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="unit-catalog-api-filter">
                          <div>
                            <strong>Exact Lift API filter</strong>
                            <span>Use only when you need to fetch by a field other than catalog ID.</span>
                          </div>
                          <label className="setup-control">
                            <span>Parameter</span>
                            <select
                              value={unitCatalogApiFilterParam}
                              onChange={(event) => setUnitCatalogApiFilterParam(event.target.value)}
                            >
                              <option value="catalog_id">Catalog ID</option>
                              <option value="catalog_name">Catalog name</option>
                              <option value="product_name">Product name</option>
                              <option value="product_id">Product ID</option>
                              <option value="accounting_item_code">Accounting item code</option>
                              <option value="parent_product_id">Parent product ID</option>
                            </select>
                          </label>
                          <label className="setup-control">
                            <span>Value</span>
                            <input
                              value={unitCatalogApiFilterValue}
                              placeholder={unitCatalogApiFilterParam === "catalog_id" ? "8102" : "Enter exact Lift value"}
                              onChange={(event) => setUnitCatalogApiFilterValue(event.target.value)}
                            />
                          </label>
                        </div>
                      </details>
                    </section>
                    <div className="unit-catalog-results-header">
                      <div>
                        <strong>Lift product results</strong>
                        <span>
                          {filteredLiftUnitCatalog.length} of {liftUnitCatalog.length} loaded product{liftUnitCatalog.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <label className="unit-map-search unit-catalog-search">
                        <Search size={16} />
                        <input
                          value={unitCatalogSearch}
                          placeholder="Fuzzy search loaded products"
                          onChange={(event) => setUnitCatalogSearch(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className={selectedCatalogDetailItem ? "unit-catalog-workspace has-detail" : "unit-catalog-workspace"}>
                      <div className="unit-catalog-table-wrap">
                        <table className="unit-catalog-table">
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th>Product ID</th>
                              <th>Catalog</th>
                              <th>Type</th>
                              <th>Size</th>
                              <th>Route product identifier</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredLiftUnitCatalog.map((item) => (
                              <tr
                                key={item.catalog_item_id}
                                className={selectedCatalogDetailId === item.catalog_item_id ? "is-selected" : undefined}
                              >
                                <td>
                                  <strong>{item.product_name}</strong>
                                  <span>{item.accounting_item_code ?? item.description ?? item.source ?? "Lift product"}</span>
                                </td>
                                <td>{item.product_id ?? "-"}</td>
                                <td>
                                  <strong>{item.catalog_name ?? "Catalog pending"}</strong>
                                  <span>{item.catalog_id ?? "-"}</span>
                                </td>
                                <td>
                                  <strong>{item.product_type ?? "Product"}</strong>
                                  <span>{item.status}</span>
                                </td>
                                <td>
                                  <strong>
                                    {item.attribute_1 ?? "-"} x {item.attribute_2 ?? "-"}
                                  </strong>
                                  <span>Attributes 1/2</span>
                                </td>
                                <td>{catalogIdentifierLabel(item, selectedOutputMapRoute)}</td>
                                <td>
                                  <div className="unit-catalog-row-actions">
                                    <button className="secondary-button" onClick={() => setSelectedCatalogDetailId(item.catalog_item_id)}>
                                      Details
                                    </button>
                                    <button
                                      className="primary-button"
                                      onClick={() => void assignCatalogItemToSelectedMappings(item)}
                                      disabled={
                                        workspaceState === "saving" ||
                                        (!activeCatalogMapping && selectedUnitMappings.length < 2) ||
                                        !catalogIdentifierForRoute(item, selectedOutputMapRoute)
                                      }
                                      title={
                                        catalogIdentifierForRoute(item, selectedOutputMapRoute)
                                          ? activeCatalogMapping
                                            ? `Save ${selectedOutputMapRoute.product_identifier_label} to the active Pathfinder mapping row`
                                            : `Review assignment of this ${selectedOutputMapRoute.product_identifier_label} to the selected Pathfinder rows`
                                          : `This product has no ${selectedOutputMapRoute.product_identifier_label}`
                                      }
                                    >
                                      {activeCatalogMapping
                                        ? "Save Mapping"
                                        : selectedUnitMappings.length
                                          ? `Assign ${selectedUnitMappings.length}`
                                          : "Select Row"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {selectedCatalogDetailItem ? (
                        <section className="unit-catalog-detail-panel">
                          <div className="modal-section-header">
                            <div>
                              <h2>{selectedCatalogDetailItem.product_name}</h2>
                              <span>
                                Product ID {selectedCatalogDetailItem.product_id ?? "-"} · Catalog{" "}
                                {selectedCatalogDetailItem.catalog_name ?? selectedCatalogDetailItem.catalog_id ?? "-"}
                              </span>
                            </div>
                            <button
                              className="modal-close-button"
                              onClick={() => setSelectedCatalogDetailId(null)}
                              aria-label="Close product details"
                            >
                              <X size={17} />
                            </button>
                          </div>
                          {selectedOutputMapRoute.product_identifier_type === "lift_unit_number" &&
                          catalogUnitNumbers(selectedCatalogDetailItem).length > 1 ? (
                            <div className="unit-catalog-unit-picker">
                              <label className="setup-control">
                                <span>Unit number to map</span>
                                <select
                                  value={selectedCatalogUnitNumber(selectedCatalogDetailItem) ?? ""}
                                  onChange={(event) =>
                                    setSelectedCatalogUnitNumbers((current) => ({
                                      ...current,
                                      [selectedCatalogDetailItem.catalog_item_id]: event.target.value
                                    }))
                                  }
                                >
                                  {catalogUnitNumbers(selectedCatalogDetailItem).map((unitNumber) => (
                                    <option key={unitNumber} value={unitNumber}>
                                      {unitNumber}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div>
                                <span>Mapping output</span>
                                <strong>{catalogIdentifierForRoute(selectedCatalogDetailItem, selectedOutputMapRoute) || "No identifier"}</strong>
                              </div>
                            </div>
                          ) : null}
                          <div className="unit-catalog-detail-grid">
                            {catalogDetailRows(selectedCatalogDetailItem).map((entry) => (
                              <div key={entry.field}>
                                <dt>{entry.field}</dt>
                                <dd>{entry.value}</dd>
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </div>
                    {unitCatalogState === "loading" ? (
                      <p className="empty-state">Loading Lift product catalog...</p>
                    ) : null}
                    {unitCatalogState !== "loading" && filteredLiftUnitCatalog.length === 0 ? (
                      <p className="empty-state">
                        {liftUnitCatalog.length
                          ? "No products in the current Lift result set match that search."
                          : "No Lift products match this route and API scope. Refresh from Lift when credentials are configured."}
                      </p>
                    ) : null}
                    </aside>
                  ) : null}

                  <div className="unit-map-bulkbar">
                    <div className="unit-map-bulk-intro">
                      <strong>Bulk actions · {selectedUnitMappings.length} selected</strong>
                      <span>
                        {selectedUnitMappings.length < 2
                          ? "Select at least two rows here. Use Map Product on a row for individual mapping."
                          : "Review and confirm before one Lift product is assigned to all selected rows."}
                      </span>
                    </div>
                    <input
                      value={bulkUnitNumber}
                      placeholder={outputIdentifierPlaceholder(selectedOutputMapRoute)}
                      onChange={(event) => setBulkUnitNumber(event.target.value)}
                      disabled={selectedUnitMappings.length < 2}
                    />
                    <input
                      value={bulkProductName}
                      placeholder="Product name optional"
                      onChange={(event) => setBulkProductName(event.target.value)}
                      disabled={selectedUnitMappings.length < 2}
                    />
                    <button
                      className="primary-button"
                      onClick={bulkAssignUnitNumber}
                      disabled={workspaceState === "saving" || selectedUnitMappings.length < 2}
                    >
                      Review Assignment
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setActiveCatalogMappingId(null);
                        setUnitCatalogSearch(
                          selectedUnitMappings
                            .map((mapping) => mapping.product_name || mapping.display_label || mapping.customer_product_key)
                            .find(Boolean) ?? ""
                        );
                        setOpenProductMapTool("unit-library");
                      }}
                      disabled={selectedUnitMappings.length < 2}
                    >
                      Choose Lift Product
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void bulkUpdateProductMappings({ status: "Inactive" }, "Selected customer keys marked inactive.")}
                      disabled={workspaceState === "saving" || selectedUnitMappings.length === 0}
                    >
                      Mark Inactive
                    </button>
                    <div className="unit-map-bulk-selection" aria-label="Selected Pathfinder product-map rows">
                      <span>Selected rows</span>
                      <div>
                        {selectedUnitMappings.length ? (
                          selectedUnitMappings.map((mapping) => (
                            <button
                              type="button"
                              key={mapping.mapping_id}
                              onClick={() => toggleUnitMapping(mapping.mapping_id)}
                              aria-label={`Remove ${mapping.customer_product_key} from bulk selection`}
                            >
                              {mapping.customer_product_key}
                              <X size={12} />
                            </button>
                          ))
                        ) : (
                          <small>No rows selected.</small>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="unit-map-table-wrap">
                    <table className="unit-map-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              type="checkbox"
                              checked={
                                filteredProductMappings.length > 0 &&
                                filteredProductMappings.every((mapping) => selectedUnitMapIds.includes(mapping.mapping_id))
                              }
                              onChange={toggleAllVisibleUnitMappings}
                              aria-label="Select all visible unit mappings"
                            />
                          </th>
                          <th>Status</th>
                          <th>Source</th>
                          <th>Customer Value / Key</th>
                          <th>Final Width</th>
                          <th>Final Height</th>
                          <th>{selectedOutputMapRoute.product_identifier_label}</th>
                          <th>Product Name</th>
                          <th>Seen</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProductMappings.map((mapping) => {
                          const draftKey = productMappingDraftKey(mapping.output_route_id, mapping.customer_product_key);
                          const draft = productMappingDrafts[draftKey] ?? {
                            unit: productMappingIdentifierForRoute(mapping, selectedOutputMapRoute) ?? "",
                            product: mapping.product_name ?? ""
                          };
                          const routeMappingStatus = productMappingStatusForRoute(mapping, selectedOutputMapRoute);
                          return (
                            <tr
                              key={mapping.mapping_id}
                              className={activeCatalogMappingId === mapping.mapping_id ? "is-map-target" : undefined}
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedUnitMapIds.includes(mapping.mapping_id)}
                                  onChange={() => toggleUnitMapping(mapping.mapping_id)}
                                  aria-label={`Select ${mapping.customer_product_key}`}
                                />
                              </td>
                              <td>
                                <span className={productMappingStatusClass(routeMappingStatus)}>{routeMappingStatus}</span>
                              </td>
                              <td>
                                <strong>{productMappingSourceLabel(mapping)}</strong>
                                <span className="cell-meta">{mapping.source_file_name ?? "Product map"}</span>
                              </td>
                              <td>
                                <strong>{mapping.customer_product_key}</strong>
                                <span className="cell-meta">{mapping.display_label}</span>
                                <span className="cell-meta">Source: {mapping.source_columns.join(", ") || "Detected key"}</span>
                              </td>
                              <td>{productMappingFinalWidth(mapping)}</td>
                              <td>{productMappingFinalHeight(mapping)}</td>
                              <td>
                                <input
                                  className="table-input"
                                  value={draft.unit}
                                  placeholder={outputIdentifierPlaceholder(selectedOutputMapRoute)}
                                  onChange={(event) =>
                                    setProductMappingDrafts((current) => ({
                                      ...current,
                                      [draftKey]: {
                                        unit: event.target.value,
                                        product: draft.product
                                      }
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  className="table-input"
                                  value={draft.product}
                                  placeholder="Lift product name"
                                  onChange={(event) =>
                                    setProductMappingDrafts((current) => ({
                                      ...current,
                                      [draftKey]: {
                                        unit: draft.unit,
                                        product: event.target.value
                                      }
                                    }))
                                  }
                                />
                              </td>
                              <td>
                                <strong>{productMappingSeenCount(mapping)}</strong>
                                <span className="cell-meta">{productMappingLastSeen(mapping)}</span>
                              </td>
                              <td>
                                <button
                                  className="secondary-button table-inline-button"
                                  onClick={() => openCatalogForMapping(mapping)}
                                  aria-pressed={activeCatalogMappingId === mapping.mapping_id}
                                >
                                  Map Product
                                </button>
                                <button className="secondary-button table-inline-button" onClick={() => void saveProductMapping(mapping)}>
                                  Save
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredProductMappings.length === 0 ? (
                      <p className="empty-state">
                        {isMigrationQueueActive
                          ? `The remap queue is clear for ${selectedOutputMapRoute.product_identifier_label}.`
                          : "No customer keys match this view. Generate a preview job to capture source values, or clear the filters."}
                      </p>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}

            {activeCustomerView === "Manual Import" ? (
              <>
                <section className="manual-flow-guide" aria-label="Manual import workflow">
                  {[
                    {
                      number: "1",
                      title: "Load order source",
                      detail: manualSourceReady ? `${sourceGrid.rows.length} source rows loaded` : "Upload XLSX or use the sample",
                      state: manualSourceReady ? "done" : "active"
                    },
                    {
                      number: "2",
                      title: "Generate preview",
                      detail: manualPreviewReady ? `${displayJobId(lastPreviewJob?.job_id ?? "")} saved as ${lastPreviewJob?.state}` : "Create the canonical order and Lift payload",
                      state: manualPreviewReady ? "done" : manualSourceReady ? "active" : "idle"
                    },
                    {
                      number: "3",
                      title: "Fix blockers",
                      detail: manualFixesNeeded ? `${submitCertificationBlockingCount} submit gates blocking` : "Validation and product mapping are clear",
                      state: manualFixesNeeded ? "warning" : manualPreviewReady ? "done" : "idle"
                    },
                    {
                      number: "4",
                      title: "Submit to Lift",
                      detail: manualSubmitReady ? "Certified for external submit" : "Locked until preview is certified",
                      state: manualSubmitReady ? "active" : "idle"
                    }
                  ].map((step) => (
                    <div className={`manual-flow-step manual-flow-step-${step.state}`} key={step.number}>
                      <span>{step.number}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <small>{step.detail}</small>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="submit-readiness-grid" aria-label="Submit readiness audit">
                  {submitReadinessCards.map((card) => (
                    <article className={`submit-readiness-card submit-readiness-${card.status.toLowerCase()}`} key={card.label}>
                      <div>
                        <span>{card.label}</span>
                        <strong>{card.value}</strong>
                      </div>
                      <p>{card.detail}</p>
                      {card.action ? (
                        <button className="certification-action" onClick={card.action} type="button">
                          {card.actionLabel}
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>

                <section className="panel submit-preflight-panel">
                  <PanelHeader
                    icon={ShieldCheck}
                    title="Lift Submit Preflight"
                    detail={
                      submitPreflightBlockedCount
                        ? `${submitPreflightBlockedCount} blocker${submitPreflightBlockedCount === 1 ? "" : "s"}`
                        : submitPreflightWarningCount
                          ? `${submitPreflightWarningCount} review item${submitPreflightWarningCount === 1 ? "" : "s"}`
                          : "Ready"
                    }
                  />
                  <div className="submit-preflight-body">
                    <div className="submit-preflight-intro">
                      <strong>
                        {submitPreflightBlockedCount
                          ? "Submit test is not clear yet."
                          : submitPreflightWarningCount
                            ? "Submit test is technically clear, with review items."
                            : "Submit test is clear from Pathfinder."}
                      </strong>
                      <span>
                        {activeRouteIsProd && selectedSubmitProfile.mode === "sandbox_customer"
                          ? prodSandboxSubmitConfirmed
                            ? "PROD endpoint with sandbox customer is confirmed for this preview."
                            : "PROD endpoint with sandbox customer is allowed here, but should be confirmed before clicking Submit."
                          : "Use this check before the real Lift submit so the setup and payload are visible in one place."}
                      </span>
                      {prodSandboxConfirmationRequired ? (
                        <label className="prod-sandbox-confirmation">
                          <input
                            type="checkbox"
                            checked={prodSandboxSubmitConfirmed}
                            onChange={(event) =>
                              setConfirmedProdSandboxSubmitKey(event.target.checked ? prodSandboxConfirmationKey : null)
                            }
                          />
                          <span>
                            <strong>Confirm PROD sandbox lane</strong>
                            <small>Use PROD endpoint, but submit this test under LTL Demo / 1249.</small>
                          </span>
                        </label>
                      ) : null}
                    </div>
                    <div className="submit-preflight-items">
                      {submitPreflightItems.map((item) => (
                        <article className={`submit-preflight-item submit-preflight-${item.status.toLowerCase()}`} key={item.label}>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                          <em>{item.detail}</em>
                        </article>
                      ))}
                    </div>
                  </div>
                  <div className="panel-footer-row">
                    <span>
                      Export includes masked headers, canonical order, Lift payload, validation, product resolution, route, environment, and last attempt.
                    </span>
                    <button className="secondary-button" onClick={downloadSubmitPacket} type="button">
                      <FileText size={16} />
                      Download Submit Packet
                    </button>
                  </div>
                </section>

                <section className="manual-import-grid">
                  <div className="panel upload-panel">
                    <PanelHeader icon={FileSpreadsheet} title="1. Upload Order Source" detail={sheetName} />
                    <div className="manual-import-basis">
                      <label className="setup-control">
                        <span>Import basis</span>
                        <select
                          aria-label="Import basis"
                          value={manualImportMethod?.import_method_id ?? "ad-hoc"}
                          onChange={(event) => changeManualImportBasis(event.target.value)}
                        >
                          {activeManualImportMethods.map((method) => (
                            <option key={method.import_method_id} value={method.import_method_id}>
                              {method.name}
                            </option>
                          ))}
                          <option value="ad-hoc">Ad-hoc manual mapping</option>
                        </select>
                      </label>
                      <div className="manual-import-basis-summary">
                        <span>{manualImportMethod ? "Saved Import Method" : "No saved basis"}</span>
                        <strong>{manualImportMethod?.name ?? "Ad-hoc Manual Import"}</strong>
                        <small>
                          {manualImportMethod
                            ? `${activeOutputRoute.name} · saved parser, field, product, and order-name rules`
                            : `${activeOutputRoute.name} · primary route with mappings configured for this upload only`}
                        </small>
                      </div>
                    </div>
                    <label
                      className="drop-zone"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const [file] = Array.from(event.dataTransfer.files);
                        if (file) {
                          void importWorkbook(file);
                        }
                      }}
                    >
                      <Upload size={30} />
                      <div>
                        <strong>{sourceName}</strong>
                        <span>Drop an order workbook here or browse for XLSX, XLS, or CSV files.</span>
                      </div>
                      <input
                        ref={fileInputRef}
                        className="file-input"
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFileChange}
                      />
                    </label>
                    <div className="sheet-summary">
                      {sourceSheets.map((sheet) => (
                        <div key={sheet.sheet_name}>
                          <strong>{sheet.sheet_name}</strong>
                          <span>{sheet.order_row_count} order rows · {sheet.reference_row_count} reference rows</span>
                        </div>
                      ))}
                    </div>
                    {importError ? <p className="import-error">{importError}</p> : null}
                    <div className="submit-profile-panel">
                      <div className="submit-profile-heading">
                        <div>
                          <strong>Submit Profile</strong>
                          <span>Choose whether this preview submits under the customer or the internal demo account.</span>
                        </div>
                        <span className={selectedSubmitProfile.mode === "sandbox_customer" ? "mini-pill mini-pill-warning" : "mini-pill mini-pill-success"}>
                          {selectedSubmitProfile.mode === "sandbox_customer" ? "Sandbox" : "Customer"}
                        </span>
                      </div>
                      <div className="submit-profile-grid">
                        <label className="setup-control">
                          <span>Mode</span>
                          <select
                            value={selectedSubmitProfile.profile_id}
                            onChange={(event) => setSelectedSubmitProfileId(event.target.value)}
                          >
                            {activeOutputRoute.submit_profiles
                              .filter((profile) => profile.enabled)
                              .map((profile) => (
                                <option key={profile.profile_id} value={profile.profile_id}>
                                  {profile.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div>
                          <span>Source Customer</span>
                          <strong>{selectedCustomer.customer_name}</strong>
                          <em>Lift CustomerID {selectedCustomer.lift_customer_id}</em>
                        </div>
                        <div>
                          <span>Submit Customer</span>
                          <strong>{submitCustomer.customer_name}</strong>
                          <em>Lift CustomerID {submitCustomer.lift_customer_id}</em>
                        </div>
                      </div>
                    </div>
                    <div className="action-row">
                      <button className="primary-button" onClick={() => fileInputRef.current?.click()}>
                        Upload XLSX
                      </button>
                      <button className="secondary-button" onClick={resetSample}>
                        Use Sample
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => manualImportMethod ? void saveImportMethod(manualImportMethod, mappings) : undefined}
                        disabled={!manualImportMethod}
                      >
                        {manualImportMethod ? "Save Mapping" : "Ad-hoc Mapping"}
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => void createPreviewJob()}
                        disabled={!manualSourceReady || workspaceState === "saving"}
                      >
                        {workspaceState === "saving" ? "Saving Preview" : "Generate Preview Job"}
                      </button>
                    </div>
                  </div>

                  <div className="panel validation-panel">
                    <PanelHeader icon={Activity} title="2. Preview Validation" detail="Canonical + Lift checks" />
                    <div className="validation-list">
                      {allMessages.map((message) => (
                        <div className="validation-row" key={`${message.code}-${message.field}`}>
                          <span
                            className={
                              message.severity === "PASS"
                                ? "dot dot-success"
                                : message.severity === "WARNING"
                                  ? "dot dot-warning"
                                  : "dot dot-danger"
                            }
                          />
                          <div>
                            <strong>{message.code}</strong>
                            <span>{message.message}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="panel request-panel">
                    <PanelHeader
                      icon={Database}
                      title="Lift Submit Target"
                      detail={selectedSubmitProfile.mode === "sandbox_customer" ? "Sandbox submit preview" : "Customer submit preview"}
                    />
                    <dl>
                      <DetailItem label="Submit Profile" value={lastPreviewJob?.submit_profile_name ?? selectedSubmitProfile.name} />
                      <DetailItem label="Output Route" value={lastPreviewJob?.output_route_name ?? activeOutputRoute.name} />
                      <DetailItem label="Environment" value={activeRouteEnvironmentLabel} />
                      <DetailItem label="Template" value={activeRouteTemplate?.name ?? activeOutputRoute.output_template} />
                      <DetailItem label="Source Customer" value={lastPreviewJob?.source_customer_name ?? selectedCustomer.customer_name} />
                      <DetailItem label="Submit Customer" value={lastPreviewJob?.submit_customer_name ?? submitCustomer.customer_name} />
                      <DetailItem
                        label="Pathfinder Order Number"
                        value={lastPreviewJob?.pathfinder_order_id ?? "Reserved when preview is created"}
                      />
                      <DetailItem
                        label="Ext_ID"
                        value={
                          !lastPreviewJob && workflowImportMethod?.ext_id_strategy === "pathfinder_generated"
                            ? "Same reserved Pathfinder Order Number"
                            : displayedSubmitRequest.headers.Ext_ID
                        }
                      />
                      <DetailItem label="Company" value={displayedSubmitRequest.headers.Company || activeRouteCompanyId} />
                      <DetailItem label="Lift CustomerID" value={displayedLiftPayload.customer.lift_customer_id} />
                      <DetailItem label="Endpoint" value={displayedSubmitRequest.endpoint_url} />
                      <DetailItem
                        label="Route Readiness"
                        value={`${activeRouteDiagnostics.status} · ${activeRouteDiagnostics.summary}`}
                      />
                    </dl>
                    <div className="request-actions">
                      <button className="secondary-button" disabled>
                        Submit to Lift gated
                      </button>
                      <span>
                        {lastPreviewJob
                          ? `${displayJobId(lastPreviewJob.job_id)} saved as ${lastPreviewJob.state}`
                          : `Generate a preview job before ${activeRouteEnvironmentLabel} submission.`}
                      </span>
                    </div>
                  </div>

                  <div className="panel certification-panel">
                    <PanelHeader
                      icon={ShieldCheck}
                      title="3. Submit Certification"
                      detail={submitCertification.can_submit ? "Certified" : `${submitCertificationBlockingCount} blocking`}
                    />
                    <div className="certification-summary">
                      <strong>{submitCertification.can_submit ? "Ready for external submit" : "Submit still gated"}</strong>
                      <span>{submitCertification.summary}</span>
                      {lastPreviewJob ? (
                        <button
                          className="secondary-button compact-button"
                          onClick={() => void refreshSubmitCertification(lastPreviewJob, true)}
                          disabled={certificationRefreshState === "loading"}
                          type="button"
                        >
                          <RefreshCw size={16} />
                          {certificationRefreshState === "loading" ? "Checking" : "Refresh certification"}
                        </button>
                      ) : null}
                    </div>
                    {lastSubmitAttempt ? (
                      <div className="submit-attempt-summary">
                        <div>
                          <span>Last submit attempt</span>
                          <strong>{lastSubmitAttempt.state}</strong>
                        </div>
                        <div>
                          <span>Attempt</span>
                          <strong>{lastSubmitAttempt.attempt_id}</strong>
                        </div>
                        <div>
                          <span>Idempotency key</span>
                          <strong>{lastSubmitAttempt.idempotency_key}</strong>
                        </div>
                        <div>
                          <span>Response</span>
                          <strong>{lastSubmitAttempt.response.message}</strong>
                        </div>
                        <div>
                          <span>Transport</span>
                          <strong>{lastSubmitAttempt.transport_mode ?? "Not recorded"}</strong>
                        </div>
                        <div>
                          <span>HTTP status</span>
                          <strong>{lastSubmitAttempt.response.http_status ?? "No HTTP response"}</strong>
                        </div>
                        <div>
                          <span>Lift order</span>
                          <strong>{lastSubmitAttempt.response.lift_order_id ?? "Pending"}</strong>
                        </div>
                        <div>
                          <span>Endpoint</span>
                          <strong>{lastSubmitAttempt.endpoint_url}</strong>
                        </div>
                        {lastSubmitAttempt.response.error_translation ? (
                          <div className="submit-error-translation">
                            <span>Translated issue</span>
                            <strong>{lastSubmitAttempt.response.error_translation.operator_message}</strong>
                            <em>{lastSubmitAttempt.response.error_translation.suggested_action}</em>
                            <small>
                              {lastSubmitAttempt.response.error_translation.retryable ? "Retryable after review" : "Fix setup/data before retry"} ·{" "}
                              {lastSubmitAttempt.response.error_translation.category}
                            </small>
                            <code>{lastSubmitAttempt.response.error_translation.source_message}</code>
                          </div>
                        ) : null}
                        <details className="submit-raw-response">
                          <summary>Raw Lift response</summary>
                          <pre>{formatRawBodyPreview(lastSubmitAttempt.response.raw_body)}</pre>
                        </details>
                      </div>
                    ) : null}
                    <div className="certification-list">
                      {submitCertification.items.map((item) => (
                        <div className="certification-row" key={item.item_id}>
                          <span
                            className={
                              item.status === "Passed"
                                ? "dot dot-success"
                                : item.status === "Warning"
                                  ? "dot dot-warning"
                                  : "dot dot-danger"
                            }
                          />
                          <div>
                            <strong>{item.label}</strong>
                            <span>{item.message}</span>
                            {item.suggested_action ? <em>{item.suggested_action}</em> : null}
                            {item.action_key ? (
                              <button
                                className="certification-action"
                                onClick={() => handleCertificationAction(item.action_key)}
                                type="button"
                              >
                                Fix this
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="request-actions">
                      <button
                        className={submitCertification.can_submit ? "primary-button" : "secondary-button"}
                        onClick={() => void requestLiftSubmit()}
                        disabled={
                          !lastPreviewJob ||
                          workspaceState === "saving" ||
                          !submitCertification.external_submit_enabled ||
                          (prodSandboxConfirmationRequired && !prodSandboxSubmitConfirmed)
                        }
                      >
                        {submitCertification.external_submit_enabled ? "Submit to Lift" : "Submit gate locked"}
                      </button>
                      <span>
                        {prodSandboxConfirmationRequired && !prodSandboxSubmitConfirmed
                          ? "Confirm the PROD sandbox lane in preflight before submitting."
                          : submitCertification.external_submit_enabled
                          ? "External submit is controlled by certification status."
                          : "External submit requires an explicit Pathfinder feature gate."}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="panel mapping-panel">
                  <PanelHeader icon={Map} title="Field Mapping" detail={`${mappedColumnCount} input elements mapped`} />
                  <div className="mapping-table-wrap">
                    <table className="mapping-table">
                      <thead>
                        <tr>
                          <th>Found Input Element</th>
                          <th>Sample Values</th>
                          <th>Canonical Target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {foundInputElements.map(({ column, sample }) => {
                      const selected = mappings.find((mapping) => mapping.sourceColumn === column)?.targetField ?? "";
                      return (
                        <tr key={column}>
                          <td>
                            <strong>{column}</strong>
                            <span className="cell-meta">Source field</span>
                          </td>
                          <td>{sample || "No sample value found"}</td>
                          <td>
                            <select
                              value={selected}
                              onChange={(event) => setMappings((current) => updateMapping(current, column, event.target.value))}
                            >
                              <option value="">Ignore</option>
                              <CanonicalFieldOptionGroups fields={canonicalRegistryFields} />
                            </select>
                          </td>
                        </tr>
                      );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="panel-action-footer">
                    <span>{hasBlockingFailure ? "Blocking validation failures present" : "Current mapping passes preview validation"}</span>
                    <button
                      className="primary-button"
                      onClick={() => void createPreviewJob()}
                      disabled={!manualSourceReady || workspaceState === "saving"}
                    >
                      {lastPreviewJob ? "Regenerate Preview Job" : "Generate Preview Job"}
                    </button>
                  </div>
                </section>

                <section className="panel jobs-panel product-resolution-panel">
                  <PanelHeader
                    icon={Database}
                    title="Product Resolution Review"
                    detail={`${displayedProductResolutionRows.length} order rows · ${referenceRowCount} reference rows`}
                  />
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Generated Key</th>
                        <th>Qty</th>
                        <th>Status</th>
                        <th>{activeOutputRoute.product_identifier_label}</th>
                        <th>Product Name</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedProductResolutionRows.map((result) => {
                        const savedMapping = productMappings.find(
                          (mapping) =>
                            mapping.output_route_id === result.output_route_id &&
                            mapping.customer_product_key === result.customer_product_key
                        );
                        const draftKey = productMappingDraftKey(result.output_route_id, result.customer_product_key);
                        const draft = productMappingDrafts[draftKey] ?? {
                          unit:
                            savedMapping?.product_identifier_value ??
                            savedMapping?.lift_unit_number ??
                            savedMapping?.lift_product_id ??
                            result.resolved_product_identifier ??
                            result.resolved_unit_number ??
                            result.resolved_product_id ??
                            "",
                          product: savedMapping?.product_name ?? result.product_name ?? result.display_label
                        };
                        return (
                          <tr key={`${result.source_sheet_name}-${result.source_row_number}-${result.customer_product_key}`}>
                            <td>
                              <strong>{result.source_sheet_name}</strong>
                              <span className="cell-meta">Row {result.source_row_number}</span>
                            </td>
                            <td>
                              <strong>{result.customer_product_key}</strong>
                              <span className="cell-meta">{result.display_label}</span>
                            </td>
                            <td>
                              <strong>{displayedCanonicalOrder.lines[result.line_number - 1]?.quantity ?? "—"}</strong>
                            </td>
                            <td>
                              <span
                                className={
                                  result.status === "Mapped"
                                    ? "mini-pill mini-pill-success"
                                    : result.status === "Ambiguous"
                                      ? "mini-pill mini-pill-warning"
                                      : "mini-pill mini-pill-neutral"
                                }
                              >
                                {result.status}
                              </span>
                            </td>
                            <td>
                              <input
                                className="table-input"
                                value={draft.unit}
                                placeholder={outputIdentifierPlaceholder(activeOutputRoute)}
                                onChange={(event) =>
                                  setProductMappingDrafts((current) => ({
                                    ...current,
                                    [draftKey]: {
                                      unit: event.target.value,
                                      product: draft.product
                                    }
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="table-input"
                                value={draft.product}
                                placeholder="Product name"
                                onChange={(event) =>
                                  setProductMappingDrafts((current) => ({
                                    ...current,
                                    [draftKey]: {
                                      unit: draft.unit,
                                      product: event.target.value
                                    }
                                  }))
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="secondary-button table-inline-button"
                                onClick={() => void saveProductMapping(savedMapping ?? result)}
                              >
                                Approve
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {productResolutionRows.length === 0 ? (
                    <p className="empty-state">
                      Saved route mappings are shown before preview. Generate a preview job to persist validation and certification results.
                    </p>
                  ) : null}
                </section>

                <section className="workbench">
                  <div className="panel code-panel source-panel">
                    <PanelHeader icon={FileSpreadsheet} title="Source Grid" detail="Imported rows" />
                    <div className="source-grid">
                      {sourceGrid.columns.length ? (
                        <table>
                          <thead>
                            <tr>
                              {sourceGrid.columns.map((column) => (
                                <th key={column}>{column}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sourceGrid.rows.map((row, index) => (
                              <tr key={index}>
                                {sourceGrid.columns.map((column) => (
                                  <td key={column}>{row[column]}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="empty-state">No rows imported.</p>
                      )}
                    </div>
                  </div>

                  <div className="panel code-panel">
                    <PanelHeader icon={Braces} title="Canonical Order" detail="Platform contract" />
                    <pre>{formatJson(displayedCanonicalOrder)}</pre>
                  </div>

                  <div className="panel code-panel">
                    <PanelHeader icon={Braces} title="Lift Payload" detail="Body + headers" />
                    <pre>{formatJson({ headers: displayedSubmitRequest.headers, body: displayedLiftPayload })}</pre>
                  </div>
                </section>
              </>
            ) : null}

            {activeCustomerView === "Jobs" && !selectedJobDetail ? (
              <section className="panel jobs-panel">
                <PanelHeader icon={Archive} title="Customer Jobs" detail={selectedCustomer.customer_name} />
                <JobListControls
                  archiveFilter={jobArchiveFilter}
                  intakeFilter={jobIntakeFilter}
                  sortField={jobSortField}
                  sortDirection={jobSortDirection}
                  selectedCount={selectedJobs.length}
                  onArchiveFilterChange={setJobArchiveFilter}
                  onIntakeFilterChange={setJobIntakeFilter}
                  onSortFieldChange={setJobSortField}
                  onSortDirectionChange={setJobSortDirection}
                  onBulkAction={() => requestJobsArchive(selectedJobs, jobArchiveFilter !== "Archived")}
                />
                <JobListTable
                  jobs={customerJobs}
                  selectedJobIds={selectedJobIds}
                  onToggleJob={(jobId, selected) =>
                    setSelectedJobIds((current) =>
                      selected ? Array.from(new Set([...current, jobId])) : current.filter((candidate) => candidate !== jobId)
                    )
                  }
                  onToggleAll={(selected) =>
                    setSelectedJobIds((current) =>
                      selected
                        ? Array.from(new Set([...current, ...customerJobs.map((job) => job.job_id)]))
                        : current.filter((jobId) => !customerJobs.some((job) => job.job_id === jobId))
                    )
                  }
                  onOpenJob={(job) => void openJobDetail(job)}
                  onArchiveJob={(job) => requestJobsArchive([job], !job.archived_at)}
                />
                {customerJobs.length === 0 ? <p className="empty-state">No persisted jobs for this customer yet.</p> : null}
              </section>
            ) : null}

            {activeCustomerView === "Settings" ? (
              <section className="customer-overview customer-settings-stack">
                <div className="panel customer-panel">
                  <PanelHeader icon={Settings} title="Customer Settings" detail="Defaults" />
                  <dl className="customer-details">
                    <DetailItem label="Lift CustomerID" value={selectedCustomer.lift_customer_id} />
                    <DetailItem label="Default target" value={primaryRouteTarget?.name ?? primaryOutputRoute.target_system} />
                    <DetailItem label="Default output route" value={primaryOutputRoute.name} />
                    <DetailItem label="Default template" value={primaryRouteTemplate?.name ?? primaryOutputRoute.output_template} />
                    <DetailItem label="Manual import" value={importMethods.some((method) => method.type === "Manual upload" && method.status === "Active") ? "Enabled" : "Not active"} />
                    <DetailItem label="Automation" value={scheduledMethodCount ? `${scheduledMethodCount} configured` : "None configured"} />
                  </dl>
                </div>
                <div className="panel customer-panel source-connections-panel">
                  <PanelHeader icon={Workflow} title="Source Connections" detail="Customer-owned intake systems" />
                  <div className="source-connections-intro">
                    <div>
                      <strong>Connect the systems this customer uses to send order data.</strong>
                      <p>
                        Credentials and authorization stay isolated to {selectedCustomer.customer_name}. Import Methods reference a
                        saved connection without copying its secrets.
                      </p>
                    </div>
                    <span className="mini-pill mini-pill-neutral">
                      {sourceConnections.length} connection{sourceConnections.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="source-connector-catalog" aria-label="Source connector templates">
                    {sourceConnectorDefinitions.map((definition) => (
                      <div className="source-connector-card" key={definition.provider}>
                        <div>
                          <span>{definition.category}</span>
                          <strong>{definition.name}</strong>
                          <p>{definition.description}</p>
                        </div>
                        {definition.availability === "Available" ? (
                          <button
                            className="secondary-button table-inline-button"
                            onClick={() => void createSourceConnection(definition.provider)}
                            disabled={wrikeConnectionState === "saving"}
                          >
                            <Plus size={14} />
                            Add {definition.name}
                          </button>
                        ) : (
                          <span className="mini-pill mini-pill-neutral">Planned</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {sourceConnections.length ? (
                    <div className="source-connection-selector" role="list" aria-label="Saved customer source connections">
                      {sourceConnections.map((connection) => (
                        <button
                          className={connection.connection_id === selectedSourceConnectionId ? "is-active" : ""}
                          key={connection.connection_id}
                          onClick={() => selectSourceConnection(connection)}
                          type="button"
                        >
                          <span>{connection.provider === "wrike" ? "Wrike" : connection.provider}</span>
                          <strong>{connection.name}</strong>
                          <small>{connection.environment} · {connection.status}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state source-connections-empty">
                      No source connections are configured for this customer. Wrike is available now; the other templates are roadmap placeholders.
                    </p>
                  )}

                  {!selectedWrikeConnection && wrikeConnectionMessage ? (
                    <div className={wrikeConnectionState === "error" ? "email-health-error" : "wrike-connection-message"}>
                      {wrikeConnectionState === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                      <span>{wrikeConnectionMessage}</span>
                    </div>
                  ) : null}

                  {selectedWrikeConnection ? (
                    <div className="wrike-connection-panel source-connection-detail">
                      <div className="source-connection-detail-heading">
                        <div>
                          <span className="section-eyebrow">Wrike · {selectedWrikeConnection.environment}</span>
                          <strong>{selectedWrikeConnection.name}</strong>
                          <small>OAuth 2.0 · least-privilege <code>wsReadOnly</code> access</small>
                        </div>
                        {selectedWrikeConnectionStatus ? (
                          <RouteDiagnosticPill
                            status={
                              selectedWrikeConnectionStatus.health.status === "Connected"
                                ? "Passed"
                                : selectedWrikeConnectionStatus.health.status === "Error"
                                  ? "Blocked"
                                  : "Warning"
                            }
                          />
                        ) : null}
                      </div>

                      <div className="wrike-connection-summary">
                        <div>
                          <span>Connection</span>
                          <strong>
                            {selectedWrikeConnectionStatus?.configured
                              ? "Wrike connected"
                              : selectedWrikeConnectionStatus?.oauth_connect_ready
                                ? "Ready to authorize"
                                : "App credentials required"}
                          </strong>
                          <small>{selectedWrikeConnectionStatus?.health.message ?? "Connection health has not been loaded."}</small>
                        </div>
                        <div>
                          <span>Regional Host</span>
                          <strong>{selectedWrikeConnectionStatus?.host ?? "Returned by Wrike"}</strong>
                          <small>Only validated HTTPS Wrike hosts are accepted during authorization.</small>
                        </div>
                        <div>
                          <span>Last Check</span>
                          <strong>{selectedWrikeConnectionStatus?.health.status ?? "Not tested"}</strong>
                          <small>
                            {selectedWrikeConnectionStatus?.health.checked_at
                              ? displayTimestamp(selectedWrikeConnectionStatus.health.checked_at)
                              : "No external request has run."}
                          </small>
                        </div>
                        <div>
                          <span>Capabilities</span>
                          <strong>Read-only</strong>
                          <small>No Wrike writes, Lift actions, polling, or webhooks are enabled by this setup.</small>
                        </div>
                      </div>

                      <div className="wrike-connection-form source-connection-metadata-form">
                        <label className="setup-control">
                          <span>Connection name</span>
                          <input
                            value={wrikeConnectionDraft.name}
                            onChange={(event) => setWrikeConnectionDraft((current) => ({ ...current, name: event.target.value }))}
                            placeholder="Momentara Wrike"
                          />
                        </label>
                        <label className="setup-control">
                          <span>Environment</span>
                          <select
                            value={wrikeConnectionDraft.environment}
                            onChange={(event) =>
                              setWrikeConnectionDraft((current) => ({
                                ...current,
                                environment: event.target.value as "Production" | "Sandbox"
                              }))
                            }
                          >
                            <option value="Production">Production</option>
                            <option value="Sandbox">Sandbox</option>
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Status</span>
                          <select
                            value={wrikeConnectionDraft.status}
                            onChange={(event) =>
                              setWrikeConnectionDraft((current) => ({
                                ...current,
                                status: event.target.value as "Draft" | "Active" | "Inactive"
                              }))
                            }
                          >
                            <option value="Draft">Draft</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>OAuth client ID</span>
                          <input
                            type="password"
                            value={wrikeConnectionDraft.client_id}
                            onChange={(event) => setWrikeConnectionDraft((current) => ({ ...current, client_id: event.target.value }))}
                            placeholder={
                              selectedWrikeConnectionStatus?.credentials.client_id_configured
                                ? "Saved · enter only to replace"
                                : "Required"
                            }
                            autoComplete="new-password"
                          />
                        </label>
                        <label className="setup-control">
                          <span>OAuth client secret</span>
                          <input
                            type="password"
                            value={wrikeConnectionDraft.client_secret}
                            onChange={(event) => setWrikeConnectionDraft((current) => ({ ...current, client_secret: event.target.value }))}
                            placeholder={
                              selectedWrikeConnectionStatus?.credentials.client_secret_configured
                                ? "Saved · enter only to replace"
                                : "Required"
                            }
                            autoComplete="new-password"
                          />
                        </label>
                        <label className="setup-control">
                          <span>Authorized redirect URL</span>
                          <input
                            value={selectedWrikeConnectionStatus?.oauth_redirect_uri ?? "Loading callback URL"}
                            readOnly
                            aria-label="Wrike authorized redirect URL"
                          />
                        </label>
                      </div>

                      <div className="wrike-connection-footer">
                        <div className="wrike-connection-guardrail">
                          <ShieldCheck size={18} />
                          <span>
                            Saving stores credentials in the server secret store for this customer connection. Connecting does not
                            download files, create jobs, or change Wrike.
                          </span>
                        </div>
                        <div className="wrike-connection-actions">
                          <button
                            className="secondary-button"
                            onClick={() => void testWrikeConnection()}
                            disabled={
                              wrikeConnectionState === "testing" ||
                              !selectedWrikeConnectionStatus?.configured ||
                              !selectedWrikeConnectionStatus?.connection_test_enabled
                            }
                            title={
                              !selectedWrikeConnectionStatus?.connection_test_enabled
                                ? "The API connection-test gate is off."
                                : undefined
                            }
                          >
                            <RefreshCw size={14} />
                            {wrikeConnectionState === "testing" ? "Testing" : "Test connection"}
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => void saveWrikeConnection()}
                            disabled={wrikeConnectionState === "saving" || wrikeConnectionState === "authorizing"}
                          >
                            {wrikeConnectionState === "saving" ? "Saving" : "Save connection"}
                          </button>
                          <button
                            className="primary-button"
                            onClick={() => void startWrikeOAuthConnection()}
                            disabled={
                              wrikeConnectionState === "saving" ||
                              wrikeConnectionState === "authorizing" ||
                              !selectedWrikeConnectionStatus?.oauth_connect_ready
                            }
                            title={
                              !selectedWrikeConnectionStatus?.oauth_connect_ready
                                ? "Save the Wrike client ID and secret first."
                                : undefined
                            }
                          >
                            <Workflow size={16} />
                            {wrikeConnectionState === "authorizing"
                              ? "Opening Wrike"
                              : selectedWrikeConnectionStatus?.configured
                                ? "Reconnect Wrike"
                                : "Connect Wrike"}
                          </button>
                        </div>
                      </div>

                      {wrikeConnectionMessage ? (
                        <div className={wrikeConnectionState === "error" ? "email-health-error" : "wrike-connection-message"}>
                          {wrikeConnectionState === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                          <span>{wrikeConnectionMessage}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="panel customer-panel status-access-panel">
                  <PanelHeader icon={ShieldCheck} title="Public Status Access" detail="Secure status links" />
                  <div className="status-access-body">
                    <div className="status-access-grid">
                      <label className="setup-control">
                        <span>Access mode</span>
                        <select
                          value={statusAccessPolicy.mode}
                          onChange={(event) =>
                            updateStatusPolicyDraft({ mode: event.target.value as StatusAccessPolicyMode })
                          }
                        >
                          <option value="Exact email or approved domain">Exact email or approved domain</option>
                          <option value="Exact email only">Exact email only</option>
                          <option value="Invite only">Invite only</option>
                          <option value="Internal only">Internal only</option>
                        </select>
                      </label>
                      <label className="setup-control">
                        <span>Public request links</span>
                        <select
                          value={statusAccessPolicy.allow_public_status_links ? "enabled" : "disabled"}
                          onChange={(event) =>
                            updateStatusPolicyDraft({ allow_public_status_links: event.target.value === "enabled" })
                          }
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <button className="primary-button" onClick={() => void saveStatusAccessPolicy()} disabled={workspaceState === "saving"}>
                        {workspaceState === "saving" ? "Saving" : "Save Access Policy"}
                      </button>
                    </div>
                    <div className="status-access-summary">
                      <div>
                        <span>Mode</span>
                        <strong>{statusAccessPolicy.mode}</strong>
                        <p>{statusPolicyModeDescription(statusAccessPolicy.mode)}</p>
                      </div>
                      <div>
                        <span>Approved domains</span>
                        <strong>{approvedStatusDomainCount}</strong>
                        <p>{suggestedStatusDomainCount ? `${suggestedStatusDomainCount} suggested for review.` : "No pending suggestions."}</p>
                      </div>
                      <div>
                        <span>Blocked domains</span>
                        <strong>{blockedStatusDomainCount}</strong>
                        <p>Blocked domains cannot request public status links for this customer.</p>
                      </div>
                    </div>
                    <div className="status-access-add-row">
                      <label className="setup-control">
                        <span>Customer email domain</span>
                        <input
                          value={newStatusDomain}
                          onChange={(event) => setNewStatusDomain(event.target.value)}
                          placeholder="example.com"
                        />
                      </label>
                      <label className="setup-control">
                        <span>Status</span>
                        <select
                          value={newStatusDomainStatus}
                          onChange={(event) => setNewStatusDomainStatus(event.target.value as StatusAccessDomainStatus)}
                        >
                          <option value="Approved">Approved</option>
                          <option value="Suggested">Suggested</option>
                          <option value="Blocked">Blocked</option>
                        </select>
                      </label>
                      <button className="secondary-button" onClick={addStatusDomainDraft}>
                        Add Domain
                      </button>
                    </div>
                    <div className="status-access-domain-wrap">
                      <table className="status-access-domain-table">
                        <thead>
                          <tr>
                            <th>Domain</th>
                            <th>Status</th>
                            <th>Source</th>
                            <th>Updated</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statusAccessDomains.map((domain) => (
                            <tr key={domain.domain}>
                              <td>
                                <strong>{domain.domain}</strong>
                                {domain.source !== "Admin" ? <span>Inferred from customer/order data</span> : null}
                              </td>
                              <td>
                                <span
                                  className={`status-access-domain-pill status-access-domain-pill-${domain.status.toLowerCase()}`}
                                >
                                  {domain.status}
                                </span>
                              </td>
                              <td>{domain.source}</td>
                              <td>{displayTimestamp(domain.updated_at)}</td>
                              <td>
                                <div className="status-access-actions">
                                  {domain.status === "Blocked" ? (
                                    <button
                                      className="secondary-button"
                                      onClick={() => updateStatusDomainDraft(domain.domain, { status: "Approved" })}
                                    >
                                      Approve
                                    </button>
                                  ) : (
                                    <button
                                      className="secondary-button"
                                      onClick={() => updateStatusDomainDraft(domain.domain, { status: "Blocked" })}
                                    >
                                      Block
                                    </button>
                                  )}
                                  {domain.source === "Admin" ? (
                                    <button className="icon-button danger-icon-button" onClick={() => removeStatusDomainDraft(domain.domain)}>
                                      <Trash2 size={15} />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {statusAccessDomains.length === 0 ? (
                        <p className="empty-state">No approved customer domains yet. Exact order emails can still request secure links.</p>
                      ) : null}
                    </div>
                    <p className="status-access-note">
                      Public requests still send a secure email link before showing status. Approved domains only decide who can request
                      that link for this customer.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {activeGlobalView === "Dashboard" ? (
          <>
            <header className="topbar dashboard-topbar">
              <div>
                <p className="eyebrow">Pathfinder Command Center</p>
                <h1>Order intake, translation, and submit health.</h1>
                <p className="page-intro">
                  Track the work that needs attention before customer orders can move cleanly into destination systems.
                </p>
              </div>
              <div className="dashboard-topbar-actions">
                <label className="dashboard-scope-control">
                  <span>Route scope</span>
                  <select value={selectedOutputMapRoute.output_route_id} onChange={(event) => setOutputMapRouteFilter(event.target.value)}>
                    {outputRoutes.map((route) => (
                      <option key={route.output_route_id} value={route.output_route_id}>
                        {route.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dashboard-scope-control dashboard-time-control">
                  <span>Window</span>
                  <select defaultValue="all">
                    <option value="all">All local jobs</option>
                    <option value="today">Today</option>
                    <option value="7-days">Last 7 days</option>
                  </select>
                </label>
              </div>
            </header>
            <section className="dashboard-kpi-grid" aria-label="Pathfinder operating metrics">
              {[
                {
                  label: "Orders Received",
                  value: dashboardOrderCount,
                  detail: `${dashboardLineCount} line${dashboardLineCount === 1 ? "" : "s"} parsed locally`,
                  intent: "neutral",
                  icon: ClipboardList
                },
                {
                  label: "Ready for Submit",
                  value: dashboardReadyJobs.length,
                  detail: dashboardReadyJobs.length ? "Awaiting final submit action" : "No certified previews waiting",
                  intent: "good",
                  icon: CheckCircle2
                },
                {
                  label: "Needs Mapping",
                  value: dashboardNeedsMappingJobs.length + routeBlockingCount,
                  detail: routeBlockingCount
                    ? `${routeBlockingCount} ${selectedOutputMapRoute.product_identifier_label} gap${routeBlockingCount === 1 ? "" : "s"}`
                    : "Product map is clear for selected route",
                  intent: routeBlockingCount || dashboardNeedsMappingJobs.length ? "warning" : "good",
                  icon: Map
                },
                {
                  label: "Submit Failed",
                  value: dashboardFailedJobs.length,
                  detail: dashboardFailedJobs.length ? "Review Lift/API response details" : "No failed submits in view",
                  intent: dashboardFailedJobs.length ? "bad" : "good",
                  icon: AlertTriangle
                },
                {
                  label: "Submitted to Lift",
                  value: dashboardSubmittedJobs.length,
                  detail: `${dashboardSuccessRate}% of local jobs have target order signal`,
                  intent: dashboardSubmittedJobs.length ? "good" : "neutral",
                  icon: Send
                }
              ].map(({ label, value, detail, intent, icon: Icon }) => (
                <div className={`dashboard-kpi-card dashboard-kpi-${intent}`} key={label}>
                  <div className="dashboard-kpi-icon">
                    <Icon size={20} />
                  </div>
                  <div>
                    <strong>{value}</strong>
                    <span>{label}</span>
                    <small>{detail}</small>
                  </div>
                </div>
              ))}
            </section>
            <section className="dashboard-main-grid">
              <div className="panel jobs-panel dashboard-recent-jobs dashboard-recent-jobs-primary">
                <PanelHeader icon={ClipboardList} title="Recent Jobs" detail="All customers" />
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Customer</th>
                      <th>Source</th>
                      <th>Ext ID</th>
                      <th>Route</th>
                      <th>State</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardRecentJobs.map((job) => (
                      <tr key={job.job_id}>
                        <td>
                          <button className="link-button" onClick={() => void openJobDetail(job)}>
                            {displayJobId(job.job_id)}
                          </button>
                          <span className="cell-meta">{job.target_order_number ?? "No Lift order"}</span>
                        </td>
                        <td>{job.customer_name}</td>
                        <td>{job.import_method_name}</td>
                        <td>{jobExtId(job)}</td>
                        <td>{job.output_route_name}</td>
                        <td>
                          <StatePill state={job.state} />
                        </td>
                        <td>{displayTimestamp(job.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dashboardRecentJobs.length === 0 ? (
                  <p className="empty-state">No persisted jobs yet. Generate a preview job from Manual Import.</p>
                ) : null}
              </div>
              <div className="dashboard-right-rail">
                <div className="panel dashboard-attention-panel">
                  <PanelHeader icon={Activity} title="Needs Attention" detail="Next best actions" />
                  <div className="dashboard-attention-list">
                    {dashboardWorkItems.slice(0, 4).map((item) => (
                      <div className="dashboard-attention-item" key={item.id}>
                        <div className="dashboard-attention-heading">
                          <span className={item.priority === "P1" ? "mini-pill mini-pill-danger" : "mini-pill mini-pill-warning"}>
                            {item.priority}
                          </span>
                          {item.status === "Open" ? <span className="pill pill-warning">Open</span> : <StatePill state={item.status} />}
                        </div>
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                        <div className="dashboard-attention-footer">
                          <small>{item.owner}</small>
                          <button className="secondary-button" onClick={item.action}>
                            {item.actionLabel}
                          </button>
                        </div>
                      </div>
                    ))}
                    {dashboardWorkItems.length === 0 ? (
                      <div className="dashboard-empty-state dashboard-empty-state-compact">
                        <CheckCircle2 size={20} />
                        <div>
                          <strong>No blocking work.</strong>
                          <span>Generate a preview job or refresh target health to keep this current.</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
            <section className="dashboard-secondary-grid">
              <div className="panel dashboard-health-panel">
                <PanelHeader icon={ShieldCheck} title="System Health" detail={`${activeTargetCount}/${targetRows.length} targets active`} />
                <div className="dashboard-health-list">
                  {dashboardHealthRows.map((row) => (
                    <div className="dashboard-health-row" key={row.label}>
                      <span className={`health-dot health-dot-${row.status.toLowerCase()}`} />
                      <div>
                        <strong>{row.label}</strong>
                        <small>{row.detail}</small>
                      </div>
                      <span>{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="dashboard-health-footer">
                  <div>
                    <strong>{dashboardActiveEnvironmentCount}</strong>
                    <span>active environments</span>
                  </div>
                  <div>
                    <strong>{targetRows.reduce((sum, target) => sum + target.output_templates.filter((template) => template.status === "Active").length, 0)}</strong>
                    <span>active templates</span>
                  </div>
                  <div>
                    <strong>{outputRoutes.filter((route) => route.status === "Active").length}</strong>
                    <span>active routes</span>
                  </div>
                </div>
              </div>
              <div className="panel dashboard-customer-health">
                <PanelHeader icon={Users} title="Customer Health" detail="Selected customer" />
                <div className="dashboard-customer-card">
                  <div>
                    <strong>{selectedCustomer.customer_name}</strong>
                    <span>Lift CustomerID {selectedCustomer.lift_customer_id}</span>
                  </div>
                  <span className="mini-pill mini-pill-success">{selectedCustomer.customer_status ?? "Active"}</span>
                </div>
                <dl className="dashboard-detail-grid">
                  <DetailItem label="Previewed jobs" value={`${customerJobs.length}`} />
                  <DetailItem label="Validation pass rate" value={`${validationRate}%`} />
                  <DetailItem label="Import methods" value={`${importMethods.filter((method) => method.status === "Active").length} active`} />
                  <DetailItem label="Product map gaps" value={`${routeBlockingCount}`} />
                </dl>
              </div>
              <div className="panel dashboard-customer-health">
                <PanelHeader icon={Map} title="Product Mapping Gaps" detail={selectedOutputMapRoute.product_identifier_label} />
                <div className="dashboard-map-summary">
                  <strong>{routeMappedCount}/{routeProductMappings.length}</strong>
                  <span>keys mapped for {selectedOutputMapRoute.name}</span>
                </div>
                <button
                  className="secondary-button dashboard-full-button"
                  onClick={() => {
                    setActiveGlobalView("Customers");
                    setActiveCustomerView("Output Product Map");
                  }}
                >
                  Open Output Product Map
                </button>
              </div>
              <div className="panel dashboard-route-card">
                <PanelHeader icon={Workflow} title="Route Scope" detail={selectedOutputMapEnvironment?.name ?? "Environment"} />
                <dl className="dashboard-detail-grid">
                  <DetailItem label="Target" value={selectedOutputMapTarget?.name ?? selectedOutputMapRoute.target_system} />
                  <DetailItem label="Route" value={selectedOutputMapRoute.name} />
                  <DetailItem label="Template" value={selectedOutputMapTemplate?.name ?? selectedOutputMapRoute.output_template} />
                  <DetailItem label="Product Mapping Strategy" value={selectedOutputMapRoute.product_identifier_label} />
                  <DetailItem
                    label="Readiness"
                    value={`${selectedOutputMapDiagnostics.status} · ${selectedOutputMapDiagnostics.blocking_count} blocking`}
                  />
                </dl>
                <button
                  className="secondary-button dashboard-full-button"
                  onClick={() => {
                    setActiveGlobalView("Targets");
                    setSelectedTargetId(selectedOutputMapRoute.target_id);
                    setActiveTargetsView("Output Routes");
                  }}
                >
                  Open Target Setup
                </button>
              </div>
            </section>
          </>
        ) : null}

        {activeGlobalView === "Targets" ? (
          <>
            {!selectedTarget ? (
              <>
                <header className="topbar targets-overview-header">
                  <div>
                    <p className="eyebrow">Targets</p>
                    <h1>Destination platforms</h1>
                    <p className="page-intro">
                      Configure the systems Pathfinder can send orders to, then combine environments and templates into reusable output routes.
                    </p>
                  </div>
                  <button className="primary-button" onClick={() => requestGuardedNavigation(addTargetDraft)}>
                    <Plus size={16} />
                    Add Target
                  </button>
                </header>

                <section className="status-strip target-status-strip">
                  <div className="status-step">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>Targets</strong>
                      <span>{targetRows.length} configured</span>
                    </div>
                  </div>
                  <div className="status-step">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>Active</strong>
                      <span>{targetRows.filter((target) => target.status !== "Draft").length} ready or configured</span>
                    </div>
                  </div>
                  <div className="status-step">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>Templates</strong>
                      <span>{targetRows.reduce((sum, target) => sum + target.output_templates.length, 0)} reusable</span>
                    </div>
                  </div>
                  <div className="status-step">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>Routes</strong>
                      <span>{outputRoutes.length} customer route{outputRoutes.length === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                </section>

                <section className="panel jobs-panel">
                  <PanelHeader icon={Database} title="Targets" detail="Reusable destination platforms" />
                  <table className="targets-overview-table">
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Type</th>
                        <th>Adapter</th>
                        <th>Health</th>
                        <th>Setup</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targetRows.map((target) => {
                        const routeCount = outputRoutes.filter((route) => route.target_id === target.target_id).length;
                        return (
                          <tr key={target.target_id}>
                            <td>
                              <strong>{target.name}</strong>
                              <span className="cell-meta">{target.template}</span>
                            </td>
                            <td>{target.target_type}</td>
                            <td>{target.adapter}</td>
                            <td>{target.health_status}</td>
                            <td>
                              {target.environments.length} env · {target.output_templates.length} template{target.output_templates.length === 1 ? "" : "s"} · {routeCount} route{routeCount === 1 ? "" : "s"}
                            </td>
                            <td>
                              <span className={target.status === "Ready" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                                {target.status}
                              </span>
                            </td>
                            <td>
                              <div className="target-row-actions">
                                <button
                                  className="secondary-button table-inline-button"
                                  onClick={() => requestGuardedNavigation(() => selectTargetForEdit(target))}
                                >
                                  <Edit3 size={14} />
                                  Edit
                                </button>
                                <button
                                  className="icon-button-danger"
                                  type="button"
                                  title={localDraftTargetIds.includes(target.target_id) ? `Discard ${target.name}` : `Delete ${target.name}`}
                                  aria-label={localDraftTargetIds.includes(target.target_id) ? `Discard ${target.name}` : `Delete ${target.name}`}
                                  onClick={() => requestTargetDelete(target)}
                                  disabled={workspaceState === "saving"}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              </>
            ) : (
              <>
                <header className="target-detail-header">
                  <button className="secondary-button" onClick={() => requestGuardedNavigation(() => setSelectedTargetId(null))}>
                    <ArrowLeft size={16} />
                    All targets
                  </button>
                  <div className="target-detail-heading">
                    <p className="eyebrow">Target setup</p>
                    <h1>{selectedTarget.name}</h1>
                    <span>{selectedTarget.target_type} · {selectedTarget.status}</span>
                  </div>
                  <div className="target-header-status">
                    <span className={`health-chip health-chip-${selectedTarget.health_status.toLowerCase()}`}>
                      <i />
                      {selectedTarget.health_status}
                    </span>
                    <span
                      className={`method-save-state ${
                        selectedTargetHasUnsavedChanges ? "method-save-state-dirty" : "method-save-state-clean"
                      }`}
                    >
                      {selectedTargetHasUnsavedChanges ? (
                        "Unsaved changes"
                      ) : (
                        <>
                          <Check size={13} />
                          Saved
                        </>
                      )}
                    </span>
                    <button
                      className="secondary-button destructive-secondary-button"
                      onClick={() => requestTargetDelete(selectedTarget)}
                      disabled={workspaceState === "saving"}
                    >
                      <Trash2 size={15} />
                      {localDraftTargetIds.includes(selectedTarget.target_id) ? "Discard Draft" : "Delete Target"}
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void saveTarget(selectedTarget)}
                      disabled={!selectedTargetHasUnsavedChanges || workspaceState === "saving"}
                    >
                      {workspaceState === "saving" ? "Saving" : "Save Changes"}
                    </button>
                  </div>
                </header>

                <nav className="target-tabs" aria-label="Selected target setup sections">
                  {targetDetailTabs.map((tab) => (
                    <button
                      className={activeTargetsView === tab ? "target-tab target-tab-active" : "target-tab"}
                      key={tab}
                      onClick={() => setActiveTargetsView(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </nav>

                {activeTargetsView === "Environments" ? (
                  <section className="panel setup-panel">
                    <div className="table-panel-header">
                      <PanelHeader icon={SlidersHorizontal} title="Target Environments" detail="Endpoint, auth, and headers" />
                      <button className="secondary-button table-header-action" onClick={() => addTargetEnvironmentDraft(selectedTarget.target_id)}>
                        <Plus size={15} />
                        Add Environment
                      </button>
                    </div>
                    <div className="target-card-stack">
                      <div className="setup-grid target-settings-grid">
                        <label className="setup-control">
                          <span>Target Name</span>
                          <input
                            value={selectedTarget.name}
                            onChange={(event) =>
                              updateTargetDraft(selectedTarget.target_id, (target) => ({
                                ...target,
                                name: event.target.value
                              }))
                            }
                          />
                        </label>
                        <label className="setup-control">
                          <span>Active Environment</span>
                          <select
                            value={selectedTarget.lift.active_environment}
                            onChange={(event) =>
                              updateTargetActiveEnvironmentDraft(selectedTarget.target_id, event.target.value)
                            }
                          >
                            {targetEnvironments.map((environment) => (
                              <option key={environment.environment_id}>{environment.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Target Type</span>
                          <select
                            value={selectedTarget.target_type}
                            onChange={(event) =>
                              updateTargetDraft(selectedTarget.target_id, (target) => ({
                                ...target,
                                target_type: event.target.value as TargetType
                              }))
                            }
                          >
                            {["ERP", "Ecommerce", "Print Factory", "SFTP", "Webhook", "Custom"].map((type) => (
                              <option key={type}>{type}</option>
                            ))}
                          </select>
                        </label>
                        <label className="setup-control">
                          <span>Status</span>
                          <select
                            value={selectedTarget.status}
                            onChange={(event) =>
                              updateTargetDraft(selectedTarget.target_id, (target) => ({
                                ...target,
                                status: event.target.value as TargetConfig["status"]
                              }))
                            }
                          >
                            {["Ready", "Configured", "Draft"].map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {targetEnvironments.map((environment) => (
                        <div className="target-config-card" key={environment.environment_id}>
                          {(() => {
                            const deleteDisabled =
                              targetEnvironments.length <= 1 ||
                              environment.name === selectedTarget.lift.active_environment ||
                              isProtectedTargetEnvironment(environment);
                            const deleteTitle =
                              targetEnvironments.length <= 1
                                ? "A target needs at least one environment"
                                : isProtectedTargetEnvironment(environment)
                                  ? "Seeded Lift environments can be marked inactive instead of removed"
                                  : environment.name === selectedTarget.lift.active_environment
                                    ? "Choose a different active environment before removing this one"
                                    : `Remove ${environment.name}`;

                            return (
                          <div className="target-card-heading">
                            <div>
                              <strong>{environment.name}</strong>
                              <span>{environment.role} · {environment.auth_method}</span>
                            </div>
                            <div className="target-card-actions">
                              <span className={environment.status === "Active" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                                {environment.status}
                              </span>
                              <button
                                className="icon-button-danger"
                                title={deleteTitle}
                                onClick={() =>
                                  setDestructiveConfirmation({
                                    kind: "target-environment",
                                    target_id: selectedTarget.target_id,
                                    target_name: selectedTarget.name,
                                    environment_id: environment.environment_id,
                                    environment_name: environment.name
                                  })
                                }
                                disabled={deleteDisabled}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                            );
                          })()}
                          <div className="setup-grid target-settings-grid">
                            <label className="setup-control">
                              <span>Role</span>
                              <select
                                value={environment.role}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    role: event.target.value as TargetEnvironmentRole
                                  }))
                                }
                              >
                                {["PROD", "QA", "DEV", "Sandbox", "Custom"].map((role) => (
                                  <option key={role}>{role}</option>
                                ))}
                              </select>
                            </label>
                            <label className="setup-control">
                              <span>Status</span>
                              <select
                                value={environment.status}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    status: event.target.value as TargetEnvironment["status"]
                                  }))
                                }
                              >
                                {["Active", "Draft", "Inactive"].map((status) => (
                                  <option key={status}>{status}</option>
                                ))}
                              </select>
                            </label>
                            <label className="setup-control">
                              <span>Auth Method</span>
                              <select
                                value={environment.auth_method}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    auth_method: event.target.value as TargetAuthMethod
                                  }))
                                }
                              >
                                {["Header credentials", "Bearer token", "API key", "None"].map((method) => (
                                  <option key={method}>{method}</option>
                                ))}
                              </select>
                            </label>
                            <label className="setup-control">
                              <span>Company ID</span>
                              <input
                                value={environment.headers.Company ?? ""}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    headers: { ...current.headers, Company: event.target.value }
                                  }))
                                }
                              />
                            </label>
                            <label className="setup-control">
                              <span>Import User</span>
                              <input
                                value={environment.credentials.User ?? ""}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    credentials: { ...current.credentials, User: event.target.value },
                                    headers: { ...current.headers, User: event.target.value }
                                  }))
                                }
                              />
                            </label>
                            <label className="setup-control setup-control-wide">
                              <span>Endpoint URL</span>
                              <input
                                value={environment.endpoint_url}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    endpoint_url: event.target.value
                                  }))
                                }
                              />
                            </label>
                            <label className="setup-control">
                              <span>Password Secret</span>
                              <input
                                type="password"
                                value={isMaskedSecret(environment.credentials.Password) ? "" : environment.credentials.Password ?? ""}
                                placeholder={isMaskedSecret(environment.credentials.Password) ? "Saved secret" : "Enter password"}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    credentials: { ...current.credentials, Password: event.target.value },
                                    headers: { ...current.headers, Password: event.target.value }
                                  }))
                                }
                              />
                            </label>
                            <label className="setup-control">
                              <span>Header Ext_ID</span>
                              <input
                                value={environment.headers.Ext_ID ?? ""}
                                onChange={(event) =>
                                  updateTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id, (current) => ({
                                    ...current,
                                    headers: { ...current.headers, Ext_ID: event.target.value }
                                  }))
                                }
                              />
                            </label>
                          </div>
                          {selectedTarget.target_type === "ERP" && selectedTarget.adapter === "lift-standard-graphics" ? (
                            <ProofingApiSetup
                              apiBaseUrl={apiBaseUrl}
                              targetId={selectedTarget.target_id}
                              environmentId={environment.environment_id}
                              environmentName={environment.name}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="panel-action-footer">
                      <span>Environment edits, credentials, and secrets save from the target header.</span>
                    </div>
                  </section>
                ) : null}

                {activeTargetsView === "Output Templates" ? (
                  <section className="panel setup-panel">
                    <PanelHeader icon={Braces} title="Output Templates" detail="Select a template, then map pasted fields to Canonical Order" />
                    <div className="template-workspace">
                      <aside className="template-list-panel">
                        <div className="template-list-header">
                          <strong>Templates</strong>
                          <button className="secondary-button table-inline-button" onClick={() => addOutputTemplateDraft(selectedTarget)}>
                            <Plus size={14} />
                            Add
                          </button>
                        </div>
                        {targetOutputTemplates.map((template) => (
                          <button
                            className={
                              selectedOutputTemplate?.output_template_id === template.output_template_id
                                ? "template-list-item template-list-item-active"
                                : "template-list-item"
                            }
                            key={template.output_template_id}
                            onClick={() => setActiveOutputTemplateId(template.output_template_id)}
                          >
                            <strong>{template.name}</strong>
                            <span>{template.destination_method} · {template.output_format}</span>
                            <em className={template.status === "Active" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                              {template.status}
                            </em>
                          </button>
                        ))}
                      </aside>

                      {selectedOutputTemplate ? (
                        <div className="template-detail-panel">
                          <div className="target-card-heading">
                            <div>
                              <strong>{selectedOutputTemplate.name}</strong>
                              <span>{selectedOutputTemplate.destination_method} · {selectedOutputTemplate.output_format}</span>
                            </div>
                            <button
                              className="secondary-button table-inline-button"
                              onClick={() => resetOutputTemplateToLiftSample(selectedTarget.target_id, selectedOutputTemplate.output_template_id)}
                            >
                              Reset Lift sample
                            </button>
                            <span className={selectedOutputTemplate.status === "Active" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                              {selectedOutputTemplate.status}
                            </span>
                          </div>
                          <div className="setup-grid target-settings-grid">
                            <label className="setup-control">
                              <span>Template Name</span>
                              <input
                                value={selectedOutputTemplate.name}
                                onChange={(event) =>
                                  updateOutputTemplateDraft(selectedTarget.target_id, selectedOutputTemplate.output_template_id, (current) => ({
                                    ...current,
                                    name: event.target.value
                                  }))
                                }
                              />
                            </label>
                            <label className="setup-control">
                              <span>Destination Method</span>
                              <select
                                value={selectedOutputTemplate.destination_method}
                                onChange={(event) =>
                                  updateOutputTemplateDraft(selectedTarget.target_id, selectedOutputTemplate.output_template_id, (current) => ({
                                    ...current,
                                    destination_method: event.target.value as OutputDestinationMethod
                                  }))
                                }
                              >
                                {["HTTP POST", "SFTP file", "Email attachment", "Manual download"].map((method) => (
                                  <option key={method}>{method}</option>
                                ))}
                              </select>
                            </label>
                            <label className="setup-control">
                              <span>Output Format</span>
                              <select
                                value={selectedOutputTemplate.output_format}
                                onChange={(event) =>
                                  updateOutputTemplateDraft(selectedTarget.target_id, selectedOutputTemplate.output_template_id, (current) => ({
                                    ...current,
                                    output_format: event.target.value as OutputFormat
                                  }))
                                }
                              >
                                {["JSON", "XML", "CSV", "XLSX"].map((format) => (
                                  <option key={format}>{format}</option>
                                ))}
                              </select>
                            </label>
                            <label className="setup-control">
                              <span>Status</span>
                              <select
                                value={selectedOutputTemplate.status}
                                onChange={(event) =>
                                  updateOutputTemplateDraft(selectedTarget.target_id, selectedOutputTemplate.output_template_id, (current) => ({
                                    ...current,
                                    status: event.target.value as OutputTemplate["status"]
                                  }))
                                }
                              >
                                {["Active", "Draft", "Inactive"].map((status) => (
                                  <option key={status}>{status}</option>
                                ))}
                              </select>
                            </label>
                            <label className="setup-control setup-control-wide">
                              <span>Filename Format</span>
                              <input
                                value={selectedOutputTemplate.filename_format}
                                onChange={(event) =>
                                  updateOutputTemplateDraft(selectedTarget.target_id, selectedOutputTemplate.output_template_id, (current) => ({
                                    ...current,
                                    filename_format: event.target.value
                                  }))
                                }
                              />
                            </label>
                            <div className="filename-tags setup-control-wide">
                              <span>Supported tags</span>
                              <div>
                                {filenameTags.map((tag) => (
                                  <code key={tag}>{tag}</code>
                                ))}
                              </div>
                            </div>
                            <label className="setup-control template-editor">
                              <span>Body Template</span>
                              <textarea
                                value={selectedOutputTemplate.body_template}
                                onChange={(event) =>
                                  updateOutputTemplateDraft(selectedTarget.target_id, selectedOutputTemplate.output_template_id, (current) => ({
                                    ...current,
                                    body_template: event.target.value
                                  }))
                                }
                              />
                            </label>
                            <label className="setup-control template-editor">
                              <span>Header Template</span>
                              <textarea
                                value={selectedOutputTemplate.header_template}
                                onChange={(event) =>
                                  updateOutputTemplateDraft(selectedTarget.target_id, selectedOutputTemplate.output_template_id, (current) => ({
                                    ...current,
                                    header_template: event.target.value
                                  }))
                                }
                              />
                            </label>
                          </div>

                          <div className="template-mapping-builder">
                            <div className="resolver-subsection-heading">
                              <h3>Template Field Mapping</h3>
                              <span>
                                {selectedOutputTemplateStats
                                  ? `${selectedOutputTemplateStats.mapped} of ${selectedOutputTemplateStats.total} fields mapped`
                                  : "Paste normal JSON, then choose where each detected field should get its value."}
                              </span>
                            </div>
                            {selectedOutputTemplateStats?.warningFields.length ? (
                              <div className="template-warning-strip">
                                <AlertTriangle size={16} />
                                <span>
                                  {selectedOutputTemplateStats.warningFields.length} detected field
                                  {selectedOutputTemplateStats.warningFields.length === 1 ? "" : "s"} still use pasted/static values.
                                  Map dynamic order, customer, line, or generated fields before submitting.
                                </span>
                              </div>
                            ) : null}
                            {templateFields(selectedOutputTemplate).length ? (
                              <table className="mapping-table">
                                <thead>
                                  <tr>
                                    <th>Area</th>
                                    <th>Template field</th>
                                    <th>Value source</th>
                                    <th>Preview token</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {templateFields(selectedOutputTemplate).map((field) => {
                                    const mappedValue = templateMappingValue(selectedOutputTemplate, field);
                                    return (
                                      <tr key={field.key}>
                                        <td>
                                          <span className={field.section === "body" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                                            {field.section === "body" ? "Body" : "Header"}
                                          </span>
                                        </td>
                                        <td>
                                          <strong>{field.path}</strong>
                                          <span className="cell-meta">{field.sample || "Blank value"}</span>
                                        </td>
                                        <td>
                                          <select
                                            value={mappedValue}
                                            onChange={(event) =>
                                              updateOutputTemplateMapping(
                                                selectedTarget.target_id,
                                                selectedOutputTemplate.output_template_id,
                                                field,
                                                event.target.value
                                              )
                                            }
                                          >
                                            <option value="">Keep pasted/static value</option>
                                            {field.section === "body" && field.path === "source.platform" ? (
                                              <optgroup label="Pathfinder System">
                                                <option value="system.pathfinder.platform">Pathfinder platform</option>
                                              </optgroup>
                                            ) : null}
                                            {field.section === "header" && field.path === "Content-Type" ? (
                                              <optgroup label="Header Presets">
                                                <option value="preset.content_type.application_json">application/json</option>
                                              </optgroup>
                                            ) : null}
                                            <CanonicalFieldOptionGroups fields={canonicalRegistryFields} />
                                            {canonicalCompatibilityOptions.length ? (
                                              <optgroup label="Compatibility Tokens">
                                                {canonicalCompatibilityOptions.map((option) => (
                                                  <option key={option} value={option}>
                                                    {option}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            ) : null}
                                            <optgroup label="Legacy Generated Tokens">
                                              {canonicalOrderOptions.filter((option) => generatedTemplateOptions.includes(option)).map((option) => (
                                                <option key={option} value={option}>
                                                  {option}
                                                </option>
                                              ))}
                                            </optgroup>
                                            <optgroup label="Environment">
                                              {environmentTemplateOptions.map((option) => (
                                                <option key={option} value={option}>
                                                  {option}
                                                </option>
                                              ))}
                                            </optgroup>
                                            <optgroup label="Output Route">
                                              {routeTemplateOptions.map((option) => (
                                                <option key={option} value={option}>
                                                  {option}
                                                </option>
                                              ))}
                                            </optgroup>
                                            <optgroup label="Generated Values">
                                              {generatedTemplateOptions.map((option) => (
                                                <option key={option} value={option}>
                                                  {option}
                                                </option>
                                              ))}
                                            </optgroup>
                                          </select>
                                        </td>
                                        <td>
                                          <strong>{mappingPreviewValue(mappedValue)}</strong>
                                          <span
                                            className={
                                              !mappedValue && !isExpectedStaticTemplateField(field)
                                                ? "cell-meta trend-bad"
                                                : "cell-meta"
                                            }
                                          >
                                            {mappingSourceLabel(mappedValue)}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : (
                              <p className="empty-state">Paste a JSON body or header object to detect fields for mapping.</p>
                            )}
                          </div>

                          <div className="template-preview-grid">
                            <div className="code-panel">
                              <PanelHeader icon={FileText} title="Mapped Body Preview" detail="Shows selected value tokens" />
                              <pre>{mappedTemplatePreview(selectedOutputTemplate, "body")}</pre>
                            </div>
                            <div className="code-panel">
                              <PanelHeader icon={FileText} title="Mapped Header Preview" detail="Shows selected value tokens" />
                              <pre>{mappedTemplatePreview(selectedOutputTemplate, "header")}</pre>
                            </div>
                          </div>

                          <div className="template-mapping-summary">
                            <strong>{effectiveTemplateMappings(selectedOutputTemplate).length} mapped fields</strong>
                            <span>Template fields stay readable while Pathfinder stores the Canonical Order selections.</span>
                          </div>
                        </div>
                      ) : (
                        <div className="empty-state">Add an output template to configure this target.</div>
                      )}
                    </div>
                    <div className="panel-action-footer">
                      <span>Template edits save with this target from the header.</span>
                    </div>
                  </section>
                ) : null}

                {activeTargetsView === "Output Routes" ? (
                  <section className="panel setup-panel output-routes-panel">
                    <PanelHeader icon={Workflow} title="Output Routes" detail="Target + environment + account + template" />
                    <div className="output-route-stack">
                      {selectedTargetRoutes.map((route) => {
                        const environment = targetEnvironments.find((candidate) => candidate.environment_id === route.environment_id);
                        const routeTemplate =
                          targetOutputTemplates.find((candidate) => candidate.output_template_id === route.output_template_id) ??
                          targetOutputTemplates.find((candidate) => candidate.name === route.output_template) ??
                          null;
                        const routeDiagnostics = buildRouteDiagnostics({
                          target: selectedTarget,
                          route,
                          environment,
                          template: routeTemplate
                        });
                        const attentionItems = routeDiagnostics.items.filter((item) => item.status !== "Passed");
                        const activeRouteMappings = productMappings.filter(
                          (mapping) => mapping.output_route_id === route.output_route_id && mapping.status !== "Inactive"
                        );
                        const routeMappingsNeedingRemap = activeRouteMappings.filter(
                          (mapping) => !productMappingHasIdentifierForRoute(mapping, route)
                        );
                        const readyRouteMappingCount = activeRouteMappings.length - routeMappingsNeedingRemap.length;
                        const routeStrategyChange = routeStrategyChanges[route.output_route_id] ?? null;
                        return (
                          <article className="output-route-card" key={route.output_route_id}>
                            <div className="output-route-heading">
                              <div>
                                <strong>{route.name}</strong>
                                <span>{route.target_system} · {route.destination_account_name || "No destination account"}</span>
                              </div>
                              <div className="output-route-chips">
                                <RouteDiagnosticPill status={routeDiagnostics.status} />
                                <span className={route.status === "Active" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                                  {route.status}
                                </span>
                                <span className="mini-pill mini-pill-neutral">{route.product_identifier_label}</span>
                              </div>
                            </div>

                            <div className="output-route-grid">
                              <label className="setup-control setup-control-wide">
                                <span>Route Name</span>
                                <input
                                  value={route.name}
                                  onChange={(event) => updateOutputRouteDraft(route.output_route_id, { name: event.target.value })}
                                />
                              </label>
                              <label className="setup-control">
                                <span>Environment</span>
                                <select
                                  value={route.environment_id}
                                  onChange={(event) => updateOutputRouteDraft(route.output_route_id, { environment_id: event.target.value })}
                                >
                                  {targetEnvironments.map((candidate) => (
                                    <option key={candidate.environment_id} value={candidate.environment_id}>
                                      {candidate.name} · {candidate.role}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="setup-control">
                                <span>Status</span>
                                <select
                                  value={route.status}
                                  onChange={(event) =>
                                    updateOutputRouteDraft(route.output_route_id, {
                                      status: event.target.value as OutputRoute["status"]
                                    })
                                  }
                                >
                                  {["Active", "Draft", "Inactive"].map((status) => (
                                    <option key={status}>{status}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="setup-control">
                                <span>Product Mapping Strategy</span>
                                <select
                                  value={route.product_identifier_type}
                                  onChange={(event) => {
                                    const nextType = event.target.value as OutputProductIdentifierType;
                                    updateOutputRouteStrategyDraft(route, nextType);
                                  }}
                                >
                                  <option value="lift_unit_number">Lift unit_number</option>
                                  <option value="lift_product_id">Lift product_id</option>
                                </select>
                              </label>
                              <label className="setup-control">
                                <span>Destination Account</span>
                                <input
                                  value={route.destination_account_name}
                                  onChange={(event) =>
                                    updateOutputRouteDraft(route.output_route_id, { destination_account_name: event.target.value })
                                  }
                                />
                              </label>
                              <label className="setup-control">
                                <span>Company ID</span>
                                <input
                                  value={route.company_id ?? ""}
                                  onChange={(event) =>
                                    updateOutputRouteDraft(route.output_route_id, {
                                      company_id: event.target.value,
                                      destination_account_id: event.target.value
                                    })
                                  }
                                />
                              </label>
                              <label className="setup-control setup-control-wide">
                                <span>Output Template</span>
                                <select
                                  value={route.output_template_id}
                                  onChange={(event) => {
                                    const template = targetOutputTemplates.find(
                                      (candidate) => candidate.output_template_id === event.target.value
                                    );
                                    updateOutputRouteDraft(route.output_route_id, {
                                      output_template_id: event.target.value,
                                      output_template: template?.name ?? route.output_template
                                    });
                                  }}
                                >
                                  {targetOutputTemplates.map((template) => (
                                    <option key={template.output_template_id} value={template.output_template_id}>
                                      {template.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="setup-control setup-control-wide">
                                <span>Lift Order Lookup URL</span>
                                <input
                                  value={route.order_lookup_url ?? ""}
                                  placeholder="Optional endpoint for AS360/Lift order lookup"
                                  onChange={(event) =>
                                    updateOutputRouteDraft(route.output_route_id, { order_lookup_url: event.target.value })
                                  }
                                />
                              </label>
                              <label className="setup-control setup-control-wide">
                                <span>Lift Proof Report URL</span>
                                <input
                                  value={route.proof_report_url ?? ""}
                                  placeholder="Optional endpoint for AS360 proof report lookup"
                                  onChange={(event) =>
                                    updateOutputRouteDraft(route.output_route_id, { proof_report_url: event.target.value })
                                  }
                                />
                              </label>
                              <label className="setup-control setup-control-wide">
                                <span>Lift Package Details URL</span>
                                <input
                                  value={route.package_details_url ?? ""}
                                  placeholder="Optional endpoint for PackageDetails lookup"
                                  onChange={(event) =>
                                    updateOutputRouteDraft(route.output_route_id, { package_details_url: event.target.value })
                                  }
                                />
                              </label>
                            </div>

                            {activeRouteMappings.length || routeStrategyChange ? (
                              <div
                                className={`route-strategy-impact ${
                                  routeMappingsNeedingRemap.length ? "route-strategy-impact-warning" : "route-strategy-impact-ready"
                                }`}
                              >
                                <div className="route-strategy-impact-heading">
                                  <div>
                                    <span>{routeStrategyChange ? "Strategy change impact" : "Route identifier readiness"}</span>
                                    <strong>
                                      {routeStrategyChange
                                        ? `${outputIdentifierLabel(routeStrategyChange.from)} → ${route.product_identifier_label}`
                                        : route.product_identifier_label}
                                    </strong>
                                  </div>
                                  <div className="route-strategy-impact-counts" aria-label="Route mapping readiness counts">
                                    <span>{readyRouteMappingCount} identifier ready</span>
                                    <span>{routeMappingsNeedingRemap.length} need remap</span>
                                  </div>
                                </div>
                                <p>
                                  {routeMappingsNeedingRemap.length
                                    ? `${routeMappingsNeedingRemap.length} of ${activeRouteMappings.length} active mapping${
                                        activeRouteMappings.length === 1 ? "" : "s"
                                      } do not have the ${route.product_identifier_label} required by this route.`
                                    : activeRouteMappings.length
                                      ? `All ${activeRouteMappings.length} active mapping${
                                          activeRouteMappings.length === 1 ? "" : "s"
                                        } already include the route product identifier this strategy requires.`
                                      : "No active product mappings exist for this route yet; new mappings will use the selected strategy."} {routeStrategyChange
                                    ? `Existing ${outputIdentifierLabel(routeStrategyChange.from)} values will remain stored; Pathfinder will not substitute or rewrite them.`
                                    : "Stored identifiers from other strategies remain available and are not rewritten."}
                                </p>
                                {routeMappingsNeedingRemap.length ? (
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    onClick={() => void reviewRouteRemapQueue(route)}
                                    disabled={workspaceState === "saving"}
                                  >
                                    {selectedTargetHasUnsavedChanges ? "Save Changes & Review Remap Queue" : "Review Remap Queue"}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}

                            <div className="route-diagnostics">
                              <div className="route-diagnostics-summary">
                                <div>
                                  <span>Route Diagnostics</span>
                                  <strong>{routeDiagnostics.summary}</strong>
                                </div>
                                <div className="route-diagnostics-counts">
                                  <span>{routeDiagnostics.passed_count} passed</span>
                                  <span>{routeDiagnostics.warning_count} warning</span>
                                  <span>{routeDiagnostics.blocking_count} blocking</span>
                                </div>
                              </div>
                              <div className="route-diagnostics-list">
                                {(attentionItems.length ? attentionItems : routeDiagnostics.items.slice(0, 4)).map((item) => (
                                  <div className="route-diagnostic-row" key={item.item_id}>
                                    <span
                                      className={
                                        item.status === "Passed"
                                          ? "dot dot-success"
                                          : item.status === "Warning"
                                            ? "dot dot-warning"
                                            : "dot dot-danger"
                                      }
                                    />
                                    <div>
                                      <strong>{item.label}</strong>
                                      <span>{item.message}</span>
                                      {item.suggested_action ? <em>{item.suggested_action}</em> : null}
                                    </div>
                                    {item.action_key ? (
                                      <button
                                        className="certification-action"
                                        type="button"
                                        onClick={() => handleRouteDiagnosticAction(route, item.action_key)}
                                      >
                                        Fix
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="output-route-footer">
                              <div>
                                <span>Endpoint</span>
                                <strong>{environment?.endpoint_url || "Endpoint not configured"}</strong>
                              </div>
                              <div>
                                <span>Submit Profiles</span>
                                <div className="output-route-profile-list">
                                  {route.submit_profiles.map((profile) => (
                                    <span
                                      className={
                                        profile.mode === "sandbox_customer"
                                          ? "mini-pill mini-pill-warning"
                                          : "mini-pill mini-pill-neutral"
                                      }
                                      key={profile.profile_id}
                                    >
                                      {profile.name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <span className="target-footer-save-note">Route edits save with this target from the header.</span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    {selectedTargetRoutes.length === 0 ? (
                      <p className="empty-state">No customer output routes currently point to this target.</p>
                    ) : null}
                  </section>
                ) : null}

                {activeTargetsView === "Value Rules" ? (
                  <section className="panel setup-panel value-rules-panel">
                    <PanelHeader icon={SlidersHorizontal} title="Value Rules" detail="Route-specific controlled values" />
                    <div className="value-rule-stack">
                      {selectedTargetRoutes.map((route) => (
                        <article className="output-route-card value-rule-card" key={route.output_route_id}>
                          <div className="output-route-heading">
                            <div>
                              <strong>{route.name}</strong>
                              <span>
                                Normalize controlled values before Pathfinder builds the {route.output_template} payload.
                              </span>
                            </div>
                            <button className="secondary-button compact-button" onClick={() => addValueRuleDraft(route)}>
                              <Plus size={16} /> Add Rule
                            </button>
                          </div>
                          {(route.value_normalization_rules ?? []).length ? (
                            <table className="mapping-table value-rule-table">
                              <thead>
                                <tr>
                                  <th>Field</th>
                                  <th>Customer values</th>
                                  <th>Lift value</th>
                                  <th>Match</th>
                                  <th>Fallback</th>
                                  <th>Status</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(route.value_normalization_rules ?? []).map((rule) => (
                                  <tr key={rule.value_rule_id}>
                                    <td>
                                      <select
                                        value={rule.canonical_field}
                                        onChange={(event) =>
                                          updateValueRuleDraft(route.output_route_id, rule.value_rule_id, {
                                            canonical_field: event.target.value,
                                            output_field: event.target.value
                                          })
                                        }
                                      >
                                        <CanonicalFieldOptionGroups fields={canonicalRegistryFields} />
                                      </select>
                                    </td>
                                    <td>
                                      <input
                                        value={rule.input_value}
                                        placeholder="UPS Ground, Ground, UPS GND"
                                        onChange={(event) =>
                                          updateValueRuleDraft(route.output_route_id, rule.value_rule_id, {
                                            input_value: event.target.value
                                          })
                                        }
                                      />
                                    </td>
                                    <td>
                                      <input
                                        value={rule.normalized_value}
                                        placeholder="UPS Ground"
                                        onChange={(event) =>
                                          updateValueRuleDraft(route.output_route_id, rule.value_rule_id, {
                                            normalized_value: event.target.value
                                          })
                                        }
                                      />
                                    </td>
                                    <td>
                                      <select
                                        value={rule.match_mode}
                                        onChange={(event) =>
                                          updateValueRuleDraft(route.output_route_id, rule.value_rule_id, {
                                            match_mode: event.target.value as ValueNormalizationRule["match_mode"]
                                          })
                                        }
                                      >
                                        <option value="case_insensitive">Case insensitive</option>
                                        <option value="exact">Exact</option>
                                        <option value="contains">Contains</option>
                                        <option value="regex">Regex</option>
                                      </select>
                                    </td>
                                    <td>
                                      <select
                                        value={rule.fallback_behavior}
                                        onChange={(event) =>
                                          updateValueRuleDraft(route.output_route_id, rule.value_rule_id, {
                                            fallback_behavior: event.target.value as ValueNormalizationRule["fallback_behavior"]
                                          })
                                        }
                                      >
                                        <option value="block_submit">Block submit</option>
                                        <option value="pass_through">Pass through</option>
                                        <option value="use_default">Use default</option>
                                      </select>
                                    </td>
                                    <td>
                                      <select
                                        value={rule.status}
                                        onChange={(event) =>
                                          updateValueRuleDraft(route.output_route_id, rule.value_rule_id, {
                                            status: event.target.value as ValueNormalizationRule["status"]
                                          })
                                        }
                                      >
                                        <option>Active</option>
                                        <option>Draft</option>
                                        <option>Inactive</option>
                                      </select>
                                    </td>
                                    <td>
                                      <button
                                        className="icon-button"
                                        aria-label="Remove value rule"
                                        onClick={() => removeValueRuleDraft(route.output_route_id, rule.value_rule_id)}
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="empty-state">No value rules are configured for this output route.</p>
                          )}
                          <div className="panel-action-footer">
                            <span>Strict rules can block submit when Lift requires an exact controlled value. Rule edits save from the target header.</span>
                          </div>
                        </article>
                      ))}
                    </div>
                    {selectedTargetRoutes.length === 0 ? (
                      <p className="empty-state">No customer output routes currently point to this target.</p>
                    ) : null}
                  </section>
                ) : null}

                {activeTargetsView === "Test & Health" ? (
                  <section className="panel setup-panel">
                    <PanelHeader icon={Activity} title="Test & Health" detail="Route configuration preview" />
                    <div className="target-health-grid">
                      <div>
                        <span>Current Status</span>
                        <strong>{selectedTarget.health_status}</strong>
                      </div>
                      <div>
                        <span>Last Test</span>
                        <strong>{selectedTarget.last_test_at ? displayTimestamp(selectedTarget.last_test_at) : "Not tested"}</strong>
                      </div>
                      <div>
                        <span>Submit Behavior</span>
                        <strong>
                          {selectedTarget.target_type === "ERP"
                            ? `${selectedTargetTestEnvironment?.name ?? selectedTarget.lift.active_environment} submit gated`
                            : "Local test gated"}
                        </strong>
                      </div>
                    </div>
                    <div className="code-panel target-test-preview">
                      <PanelHeader icon={FileText} title="Local Test Preview" detail="No external request is sent" />
                      <pre>{JSON.stringify({
                        target: selectedTarget.name,
                        route: selectedTargetTestRoute?.name ?? "No route configured",
                        environment: selectedTargetTestEnvironment?.name ?? selectedTarget.lift.active_environment,
                        endpoint_url: selectedTargetTestEnvironment?.endpoint_url ?? null,
                        template: selectedTargetTestTemplate?.name ?? selectedTarget.output_templates[0]?.name,
                        destination_method: selectedTargetTestTemplate?.destination_method ?? null,
                        output_format: selectedTargetTestTemplate?.output_format ?? null,
                        destination_account: selectedTargetTestRoute?.destination_account_name ?? null,
                        company_id: selectedTargetTestRoute?.company_id ?? selectedTargetTestEnvironment?.headers.Company ?? selectedTarget.lift.headers.Company,
                        ext_id_rule: "headers.Ext_ID === body.order.ext_id",
                      }, null, 2)}</pre>
                    </div>
                    <div className="panel-action-footer">
                      <span>Route diagnostics are passing. Use Customer Manual Import to generate a preview and perform the gated Lift submit test.</span>
                      <button
                        className="secondary-button"
                        disabled
                        title="This panel validates the route setup. The actual submit test runs from Customer Manual Import after preview certification."
                      >
                        Use Manual Import
                      </button>
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {activeGlobalView === "Jobs" && !selectedJobDetail ? (
          <section className="panel jobs-panel">
            <PanelHeader icon={Archive} title="Processing Jobs" detail="Order history and internal status lookup" />
            <ProofOpsPanel apiBaseUrl={apiBaseUrl} authToken={authSession?.token ?? null} />
            <div className="internal-order-lookup">
              <div>
                <p className="eyebrow">Staff Status Lookup</p>
                <h3>Open the composed order view.</h3>
                <span>Search by Lift order number, source order number, or Ext_ID to review order, proof, and package data.</span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void lookupInternalOrderStatus();
                }}
              >
                <input
                  value={internalOrderLookupNumber}
                  onChange={(event) => setInternalOrderLookupNumber(event.target.value)}
                  placeholder="A0219986 or AS360-30904511"
                  aria-label="Order number"
                />
                <button className="primary-button" type="submit" disabled={internalOrderLookupState === "loading"}>
                  <Search size={16} />
                  {internalOrderLookupState === "loading" ? "Looking up" : "Lookup Order"}
                </button>
              </form>
            </div>
            {internalOrderLookupResult ? (
              <div className="latest-attempt-callout public-status-link-callout internal-order-match">
                <div>
                  <span>Status Snapshot Ready</span>
                  <strong>{internalOrderLookupResult.snapshot.order_number}</strong>
                  <em>
                    {internalOrderLookupResult.match.customer_name} · {displayJobId(internalOrderLookupResult.match.job_id)} · Refreshed{" "}
                    {displayTimestamp(internalOrderLookupResult.snapshot.refreshed_at)}
                  </em>
                  <div className="internal-order-match-summary">
                    <div>
                      <span>State</span>
                      <strong>{internalOrderLookupResult.match.job_state}</strong>
                    </div>
                    <div>
                      <span>Source</span>
                      <strong>{internalOrderLookupResult.match.source_order_id}</strong>
                    </div>
                    <div>
                      <span>Route</span>
                      <strong>{internalOrderLookupResult.snapshot.route.name}</strong>
                    </div>
                    <div>
                      <span>Lines</span>
                      <strong>{internalOrderLookupResult.snapshot.lines.length}</strong>
                    </div>
                    <div>
                      <span>Proofs</span>
                      <strong>{internalOrderLookupResult.snapshot.proofs.length}</strong>
                    </div>
                    <div>
                      <span>Packages</span>
                      <strong>{internalOrderLookupResult.snapshot.packages.length}</strong>
                    </div>
                    <div>
                      <span>Issues</span>
                      <strong>{internalOrderLookupResult.snapshot.issues.length}</strong>
                    </div>
                  </div>
                </div>
                <div className="internal-order-match-actions">
                  <button
                    className="secondary-button"
                    onClick={() => {
                      const matchedJob = allJobsUnfiltered.find(
                        (job) =>
                          job.customer_id === internalOrderLookupResult.match.customer_id &&
                          job.job_id === internalOrderLookupResult.match.job_id
                      );
                      if (matchedJob) {
                        void openJobDetail(matchedJob);
                      }
                      setOrderSnapshotResult(internalOrderLookupResult.snapshot);
                    }}
                  >
                    Open Match
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      const matchedJob = allJobsUnfiltered.find(
                        (job) =>
                          job.customer_id === internalOrderLookupResult.match.customer_id &&
                          job.job_id === internalOrderLookupResult.match.job_id
                      );
                      if (matchedJob) {
                        void createStatusLink(matchedJob);
                      }
                    }}
                    disabled={
                      statusLinkState === "loading" ||
                      !allJobsUnfiltered.some(
                        (job) =>
                          job.customer_id === internalOrderLookupResult.match.customer_id &&
                          job.job_id === internalOrderLookupResult.match.job_id
                      )
                    }
                  >
                    {statusLinkState === "loading" ? "Creating link" : "Create Public Link"}
                  </button>
                </div>
              </div>
            ) : null}
            <JobListControls
              archiveFilter={jobArchiveFilter}
              intakeFilter={jobIntakeFilter}
              sortField={jobSortField}
              sortDirection={jobSortDirection}
              selectedCount={selectedJobs.length}
              onArchiveFilterChange={setJobArchiveFilter}
              onIntakeFilterChange={setJobIntakeFilter}
              onSortFieldChange={setJobSortField}
              onSortDirectionChange={setJobSortDirection}
              onBulkAction={() => requestJobsArchive(selectedJobs, jobArchiveFilter !== "Archived")}
            />
            <JobListTable
              jobs={allJobs}
              includeCustomer
              selectedJobIds={selectedJobIds}
              onToggleJob={(jobId, selected) =>
                setSelectedJobIds((current) =>
                  selected ? Array.from(new Set([...current, jobId])) : current.filter((candidate) => candidate !== jobId)
                )
              }
              onToggleAll={(selected) =>
                setSelectedJobIds((current) =>
                  selected
                    ? Array.from(new Set([...current, ...allJobs.map((job) => job.job_id)]))
                    : current.filter((jobId) => !allJobs.some((job) => job.job_id === jobId))
                )
              }
              onOpenJob={(job) => void openJobDetail(job)}
              onArchiveJob={(job) => requestJobsArchive([job], !job.archived_at)}
            />
            {allJobs.length === 0 ? <p className="empty-state">No persisted jobs yet.</p> : null}
          </section>
        ) : null}

        {selectedJobDetail &&
        (activeGlobalView === "Jobs" || (activeGlobalView === "Customers" && activeCustomerView === "Jobs")) ? (
          <section className="job-detail-layout">
            <div className="job-detail-backbar">
              <button className="secondary-button" onClick={closeJobDetail}>
                <ArrowLeft size={16} />
                All jobs
              </button>
              <span>{selectedJobDetail.archived_at ? `Archived ${displayTimestamp(selectedJobDetail.archived_at)}` : "Active job"}</span>
            </div>
            <div className="panel job-detail-panel">
              <PanelHeader
                icon={ClipboardList}
                title={`${displayJobId(selectedJobDetail.job_id)} Detail`}
                detail={jobDetailState === "loading" ? "Loading attempts" : selectedJobDetail.output_route_name}
              />
              <div className="job-detail-header">
                <div>
                  <p className="eyebrow">Job Detail</p>
                  <h2>{selectedJobDetail.customer_name}</h2>
                  <span>
                    {selectedJobDetail.import_method_name} · {selectedJobDetail.source_file_name} · Pathfinder {selectedJobDetail.pathfinder_order_id}
                  </span>
                  <div className="job-detail-intake-context">
                    <span
                      className={`job-intake-pill ${
                        selectedJobDetail.public_intake?.channel === "customer_dropbox"
                          ? ""
                          : "job-intake-pill-operator"
                      }`}
                    >
                      {selectedJobDetail.public_intake?.channel === "customer_dropbox" ? "Customer dropbox" : "Operator"}
                    </span>
                    {selectedJobDetail.public_intake?.submitted_by_email ? (
                      <small>
                        Submitted by {selectedJobDetail.public_intake.submitted_by_email} · {displayTimestamp(selectedJobDetail.public_intake.submitted_at)}
                      </small>
                    ) : null}
                  </div>
                </div>
                <div className="job-detail-actions">
                  <StatePill state={selectedJobDetail.state} />
                  {canRetrySelectedJob ? (
                    <>
                      {prodSandboxConfirmationRequired && !selectedJobMissingOrderTitle ? (
                        <label className="job-detail-submit-confirmation">
                          <input
                            type="checkbox"
                            checked={prodSandboxSubmitConfirmed}
                            onChange={(event) =>
                              setConfirmedProdSandboxSubmitKey(event.target.checked ? prodSandboxConfirmationKey : null)
                            }
                          />
                          <span>Confirm PROD · LTL Demo / 1249</span>
                        </label>
                      ) : null}
                      <button
                        className="primary-button job-detail-submit-action"
                        onClick={() => void requestLiftSubmit(selectedJobDetail, Boolean(latestJobAttempt))}
                        disabled={
                          workspaceState === "saving" ||
                          selectedJobMissingOrderTitle ||
                          (prodSandboxConfirmationRequired && !prodSandboxSubmitConfirmed)
                        }
                      >
                        <Send size={16} />
                        {workspaceState === "saving"
                          ? "Submitting…"
                          : latestJobAttempt
                            ? "Retry Submit"
                            : "Submit to Lift"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary-button job-detail-view-order"
                      onClick={() => void loadOrderSnapshot(selectedJobDetail)}
                      disabled={
                        orderSnapshotState === "loading" ||
                        !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                      }
                    >
                      <ClipboardList size={16} />
                      {orderSnapshotState === "loading"
                        ? "Refreshing order…"
                        : orderSnapshotResult
                          ? "Refresh Order"
                          : "View Order"}
                    </button>
                  )}
                  <div className="job-detail-action-menu" data-button-menu-root>
                    <button
                      className="secondary-button"
                      onClick={() => setJobActionMenuOpen((current) => !current)}
                      aria-expanded={jobActionMenuOpen}
                    >
                      Actions
                      <ChevronDown size={16} />
                    </button>
                    {jobActionMenuOpen ? <div className="job-detail-action-popover">
                      <strong>Job Actions</strong>
                      <div className="topbar-menu-list">
                        <button
                          className="topbar-menu-item"
                          onClick={() => {
                            setJobActionMenuOpen(false);
                            void createStatusLink(selectedJobDetail);
                          }}
                          disabled={
                            statusLinkState === "loading" ||
                            !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                          }
                        >
                          <Copy size={16} />
                          <span>
                            <strong>{statusLinkState === "loading" ? "Creating link…" : "Create Status Link"}</strong>
                            <small>Generate a secure customer-facing order view.</small>
                          </span>
                        </button>
                        <button
                          className="topbar-menu-item"
                          onClick={() => {
                            setJobActionMenuOpen(false);
                            void lookupLiftOrder(selectedJobDetail);
                          }}
                          disabled={
                            orderLookupState === "loading" ||
                            !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                          }
                        >
                          <Search size={16} />
                          <span>
                            <strong>{orderLookupState === "loading" ? "Looking up order…" : "Lookup Lift Order"}</strong>
                            <small>Run the raw Lift order lookup for diagnostics.</small>
                          </span>
                        </button>
                        <button
                          className="topbar-menu-item"
                          onClick={() => {
                            setJobActionMenuOpen(false);
                            void lookupLiftProofs(selectedJobDetail);
                          }}
                          disabled={
                            proofReportState === "loading" ||
                            !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                          }
                        >
                          <FileText size={16} />
                          <span>
                            <strong>{proofReportState === "loading" ? "Loading proofs…" : "Lookup Proofs"}</strong>
                            <small>Refresh the raw Lift proof report.</small>
                          </span>
                        </button>
                        <button
                          className="topbar-menu-item"
                          onClick={() => {
                            setJobActionMenuOpen(false);
                            void lookupLiftPackages(selectedJobDetail);
                          }}
                          disabled={
                            packageDetailsState === "loading" ||
                            !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                          }
                        >
                          <Archive size={16} />
                          <span>
                            <strong>{packageDetailsState === "loading" ? "Loading packages…" : "Lookup Packages"}</strong>
                            <small>Refresh shipment and package diagnostics.</small>
                          </span>
                        </button>
                        <button
                          className="topbar-menu-item"
                          onClick={() => {
                            setJobActionMenuOpen(false);
                            requestJobsArchive([selectedJobDetail], !selectedJobDetail.archived_at);
                          }}
                        >
                          {selectedJobDetail.archived_at ? <RefreshCw size={16} /> : <Archive size={16} />}
                          <span>
                            <strong>{selectedJobDetail.archived_at ? "Restore Job" : "Archive Job"}</strong>
                            <small>
                              {selectedJobDetail.archived_at
                                ? "Return this job to the active list."
                                : "Hide this job without removing its history or status links."}
                            </small>
                          </span>
                        </button>
                      </div>
                    </div> : null}
                  </div>
                </div>
              </div>
              {selectedJobMissingOrderTitle ? (
                <div className="job-detail-submit-blocker" role="alert">
                  <AlertTriangle size={18} />
                  <span>
                    <strong>Order title required before Lift submit.</strong>
                    <small>Enable Order Name Resolution on the Import Method, then generate a new preview job.</small>
                  </span>
                </div>
              ) : null}
              <dl className="customer-details job-detail-summary">
                <DetailItem label="Pathfinder Order Number" value={selectedJobDetail.pathfinder_order_id} />
                <DetailItem label="Lift Ext_ID" value={jobExtId(selectedJobDetail)} />
                <DetailItem label="Submit profile" value={selectedJobDetail.submit_profile_name} />
                <DetailItem label="Submit customer" value={`${selectedJobDetail.submit_customer_name} / ${selectedJobDetail.submit_customer_id}`} />
                <DetailItem label="Output route" value={selectedJobDetail.output_route_name} />
                <DetailItem label="Lift order number" value={selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id ?? "Pending"} />
                <DetailItem label="Lines" value={`${selectedJobDetail.lift_payload.lines.length}`} />
                <DetailItem label="Created" value={displayTimestamp(selectedJobDetail.created_at)} />
                <DetailItem label="Updated" value={displayTimestamp(selectedJobDetail.updated_at)} />
              </dl>
              {selectedJobDetail.target_order_lookup_url ? (
                <a
                  className="detail-link"
                  href={selectedJobDetail.target_order_lookup_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Lift order lookup
                </a>
              ) : null}
              {statusLinkResult ? (
                <div className="latest-attempt-callout public-status-link-callout">
                  <div>
                    <span>Public status link</span>
                    <strong>{statusLinkResult.status_url}</strong>
                    <em>Expires {displayTimestamp(statusLinkResult.expires_at)}</em>
                  </div>
                  <a className="secondary-button" href={statusLinkResult.status_url} target="_blank" rel="noreferrer">
                    Open Status Page
                  </a>
                </div>
              ) : null}
              {orderSnapshotResult ? (
                <div className="code-panel order-lookup-panel order-snapshot-panel">
                  <PanelHeader
                    icon={ClipboardList}
                    title="Pathfinder Order Snapshot"
                    detail={`${orderSnapshotResult.order_number} · ${orderSnapshotResult.lines.length} line${orderSnapshotResult.lines.length === 1 ? "" : "s"} · ${orderSnapshotResult.packages.length} package${orderSnapshotResult.packages.length === 1 ? "" : "s"}`}
                  />
                  <OrderRollup snapshot={orderSnapshotResult} audience="internal" displayDate={displayTimestamp} />
                  <details className="order-snapshot-developer-details">
                    <summary>Developer details</summary>
                    <div className="customer-details job-detail-summary">
                      <DetailItem label="Source Order" value={orderSnapshotResult.source_order_id} />
                      <DetailItem label="Submit Customer" value={`${orderSnapshotResult.customer.submit_customer_name} / ${orderSnapshotResult.customer.submit_customer_id}`} />
                      <DetailItem label="Route" value={orderSnapshotResult.route.name} />
                      <DetailItem label="Redacted" value={orderSnapshotResult.visibility_policy.redacted_fields.join(", ") || "None"} />
                    </div>
                    <pre>{formatJson(orderSnapshotResult)}</pre>
                  </details>
                </div>
              ) : null}
              {orderLookupResult ? (
                <div className="code-panel order-lookup-panel">
                  <PanelHeader
                    icon={Search}
                    title="Lift Order Lookup"
                    detail={`${orderLookupResult.order_number} · HTTP ${orderLookupResult.http_status}`}
                  />
                  <pre>{formatJson(orderLookupResult.payload)}</pre>
                </div>
              ) : null}
              {proofReportResult ? (
                <div className="code-panel order-lookup-panel">
                  <PanelHeader
                    icon={FileText}
                    title="Lift Proof Report"
                    detail={`${proofReportResult.order_number} · ${proofReportResult.proofs.length} proof${proofReportResult.proofs.length === 1 ? "" : "s"} · HTTP ${proofReportResult.http_status}`}
                  />
                  {proofReportResult.proofs.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th>Product</th>
                          <th>Proof</th>
                          <th>Status</th>
                          <th>Comments</th>
                          <th>Links</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proofReportResult.proofs.map((proof) => (
                          <tr key={`${proof.order_line_id ?? "line"}-${proof.attachment_id ?? proof.proof_filename}`}>
                            <td>{proof.line_number ?? "Unknown"}</td>
                            <td>{proof.product_name ?? "Unknown product"}</td>
                            <td>{proof.proof_filename ?? `Attachment ${proof.attachment_id ?? "unknown"}`}</td>
                            <td>{proof.proof_approval_status ?? "Unknown"}</td>
                            <td>{proof.comments.length}</td>
                            <td>
                              <div className="row-actions">
                                {proof.proof_link_low ? (
                                  <a className="detail-link" href={proof.proof_link_low} target="_blank" rel="noreferrer">
                                    Low
                                  </a>
                                ) : null}
                                {proof.proof_link_high ? (
                                  <a className="detail-link" href={proof.proof_link_high} target="_blank" rel="noreferrer">
                                    High
                                  </a>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="empty-state">No proof rows returned for this Lift order.</p>
                  )}
                  <pre>{formatJson({ proofs: proofReportResult.proofs, raw: proofReportResult.payload })}</pre>
                </div>
              ) : null}
              {packageDetailsResult ? (
                <div className="code-panel order-lookup-panel">
                  <PanelHeader
                    icon={Archive}
                    title="Lift Package Details"
                    detail={`${packageDetailsResult.order_number} · ${packageDetailsResult.packages.length} package${packageDetailsResult.packages.length === 1 ? "" : "s"} · HTTP ${packageDetailsResult.http_status}`}
                  />
                  <p className="import-warning">
                    Internal shipping rate fields are redacted before this data reaches the UI.
                  </p>
                  {packageDetailsResult.packages.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th>Box</th>
                          <th>Product</th>
                          <th>Tracking</th>
                          <th>Method</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {packageDetailsResult.packages.map((pkg) => (
                          <tr key={`${pkg.order_line_id ?? "line"}-${pkg.shipping_id ?? "ship"}-${pkg.box_number ?? "box"}-${pkg.tracking_number ?? "tracking"}`}>
                            <td>{pkg.line_number ?? "Unknown"}</td>
                            <td>{pkg.box_number ?? "Unknown"}</td>
                            <td>
                              <strong>{pkg.product ?? "Unknown product"}</strong>
                              <span className="cell-meta">
                                {[pkg.material, pkg.laminate].filter(Boolean).join(" · ") || "No material detail"}
                              </span>
                            </td>
                            <td>{pkg.tracking_number ?? "No tracking"}</td>
                            <td>{pkg.ship_method ?? "Unknown"}</td>
                            <td>{pkg.tracker_message ?? "No tracker message"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="empty-state">No package rows returned for this Lift order.</p>
                  )}
                  <pre>{formatJson({
                    redacted_fields: packageDetailsResult.redacted_fields,
                    packages: packageDetailsResult.packages,
                    raw: packageDetailsResult.payload
                  })}</pre>
                </div>
              ) : null}
              {latestJobAttempt ? (
                <div className="latest-attempt-callout">
                  <div>
                    <span>Latest submit attempt</span>
                    <strong>{latestJobAttempt.state}</strong>
                    <em>{latestJobAttempt.response.message}</em>
                  </div>
                  {latestJobAttempt.response.error_translation ? (
                    <div>
                      <span>{latestJobAttempt.response.error_translation.category}</span>
                      <strong>{latestJobAttempt.response.error_translation.operator_message}</strong>
                      <em>{latestJobAttempt.response.error_translation.suggested_action}</em>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="empty-state">No submit attempts have been recorded for this job yet.</p>
              )}
            </div>

            <section className="panel jobs-panel">
              <PanelHeader icon={History} title="Submit Attempt History" detail={`${visibleJobDetailAttempts.length} attempt${visibleJobDetailAttempts.length === 1 ? "" : "s"}`} />
              <table>
                <thead>
                  <tr>
                    <th>Attempt</th>
                    <th>State</th>
                    <th>Ext ID</th>
                    <th>Company</th>
                    <th>Response</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobDetailAttempts.map((attempt) => (
                    <tr key={attempt.attempt_id}>
                      <td>
                        <strong>{attempt.attempt_id}</strong>
                        <span className="cell-meta">{attempt.idempotency_key}</span>
                      </td>
                      <td>
                        <span className={attempt.state === "Failed" ? "mini-pill mini-pill-danger" : attempt.state === "Submitted" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
                          {attempt.state}
                        </span>
                      </td>
                      <td>{attempt.ext_id}</td>
                      <td>{attempt.company_id}</td>
                      <td>
                        <strong>{attempt.response.error_translation?.operator_message ?? attempt.response.message}</strong>
                        <span className="cell-meta">{attempt.response.error_translation?.source_message ?? attempt.response.status}</span>
                      </td>
                      <td>{displayTimestamp(attempt.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleJobDetailAttempts.length === 0 ? <p className="empty-state">Attempts will appear here after a submit request.</p> : null}
            </section>

            <section className="job-detail-grid">
              <div className="panel jobs-panel">
                <PanelHeader icon={ShieldCheck} title="Certification Snapshot" detail={selectedJobDetail.submit_certification?.can_submit ? "Certified" : "Blocked"} />
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Status</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedJobDetail.submit_certification?.items ?? []).map((item) => (
                      <tr key={item.item_id}>
                        <td>{item.label}</td>
                        <td>{item.status}</td>
                        <td>{item.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel jobs-panel">
                <PanelHeader icon={Database} title="Product Resolution" detail={`${selectedJobDetail.unresolved_products.length} unresolved`} />
                <table>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Customer Key</th>
                      <th>Resolved Identifier</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedJobDetail.product_resolution_results.map((result) => (
                      <tr key={`${result.source_sheet_name}-${result.source_row_number}-${result.line_number}`}>
                        <td>{result.line_number}</td>
                        <td>{result.customer_product_key || "No key"}</td>
                        <td>{result.resolved_product_identifier ?? result.resolved_unit_number ?? result.resolved_product_id ?? "Needs mapping"}</td>
                        <td>{result.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="preview-grid job-detail-code-grid">
              <div className="panel code-panel">
                <PanelHeader icon={FileSpreadsheet} title="Source Rows" detail={`${selectedJobDetail.parsed_order_rows.length} order rows`} />
                <pre>{formatJson({
                  sheets: selectedJobDetail.source_sheets.map((sheet) => ({
                    sheet_name: sheet.sheet_name,
                    row_count: sheet.parsed_rows.length,
                    order_row_count: sheet.order_row_count,
                    reference_row_count: sheet.reference_row_count
                  })),
                  order_rows: selectedJobDetail.parsed_order_rows.slice(0, 10)
                })}</pre>
              </div>
              <div className="panel code-panel">
                <PanelHeader icon={Braces} title="Canonical Order" detail="Persisted preview" />
                <pre>{formatJson(selectedJobDetail.canonical_order)}</pre>
              </div>
              <div className="panel code-panel">
                <PanelHeader icon={Braces} title="Lift Payload" detail="Rendered target body" />
                <pre>{formatJson({
                  headers: selectedJobDetail.submit_request_masked.headers,
                  body: selectedJobDetail.lift_payload
                })}</pre>
              </div>
            </section>
          </section>
        ) : null}

        {activeGlobalView === "Audit" ? (
          <section className="panel customer-panel">
            <PanelHeader
              icon={History}
              title="Audit"
              detail="Platform administration"
            />
            <dl className="customer-details">
              <DetailItem label="Scope" value="Global" />
              <DetailItem label="Targets" value={`${activeTargetCount}/${targetRows.length} active`} />
              <DetailItem label="Jobs" value={`${allJobs.length} persisted`} />
              <DetailItem label="Customer context" value={selectedCustomer.customer_name} />
            </dl>
          </section>
        ) : null}

        {activeGlobalView === "Settings" ? (
          <>
            <header className="topbar settings-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h1>Canonical Order registry</h1>
                <p className="page-intro">
                  Review the field contract Pathfinder uses between customer inputs, canonical orders, and output templates.
                </p>
              </div>
              <div className="settings-header-actions">
                <button className="secondary-button" onClick={() => downloadCanonicalRegistry("json")}>
                  <FileText size={16} />
                  Export JSON
                </button>
                <button className="secondary-button" onClick={() => downloadCanonicalRegistry("csv")}>
                  <FileSpreadsheet size={16} />
                  Export CSV
                </button>
                <button
                  className="primary-button"
                  onClick={() => setIsCreatingCanonicalField((current) => !current)}
                >
                  {isCreatingCanonicalField ? "Close Field Draft" : "New Draft Field"}
                </button>
              </div>
            </header>

            <section className="metric-strip canonical-registry-metrics" aria-label="Canonical registry metrics">
              {[
                {
                  value: canonicalRegistry?.version ?? "Loading",
                  label: "Registry Version",
                  trend: canonicalRegistry?.status ?? "Waiting for API",
                  icon: Braces
                },
                {
                  value: String(canonicalRegistry?.field_count ?? canonicalRegistryFields.length),
                  label: "Canonical Fields",
                  trend: `${canonicalRequiredCount} required`,
                  icon: Database
                },
                {
                  value: String(canonicalRegistrySections.length),
                  label: "Sections",
                  trend: `${canonicalRepeatableCount} repeatable fields`,
                  icon: Workflow
                },
                {
                  value: canonicalRegistry?.updated_at ? displayTimestamp(canonicalRegistry.updated_at) : "Pending",
                  label: "Last Updated",
                  trend: canonicalRegistry?.registry_id ?? "canonical-order-v1",
                  icon: History
                }
              ].map(({ value, label, trend, icon: Icon }) => (
                <div className="metric-card" key={label}>
                  <div className="metric-icon">
                    <Icon size={20} />
                  </div>
                  <div>
                    <strong>{value}</strong>
                    <span>{label}</span>
                    <small className="trend-good">{trend}</small>
                  </div>
                </div>
              ))}
            </section>

            <section className="panel email-health-panel">
              <div className="panel-header unit-map-panel-header">
                <div className="panel-title">
                  <Bell size={18} strokeWidth={2.2} />
                  <h2>Transactional Email</h2>
                </div>
                <div className="email-health-header-actions">
                  {emailStatus ? <RouteDiagnosticPill status={emailStatus.readiness.status} /> : null}
                  <button
                    className="secondary-button table-inline-button"
                    onClick={() => void loadEmailStatus()}
                    disabled={emailStatusState === "loading"}
                  >
                    <RefreshCw size={14} />
                    {emailStatusState === "loading" ? "Checking" : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="email-health-grid">
                <div className="email-health-summary">
                  <span>Delivery Mode</span>
                  <strong>{emailStatus?.mode === "ses" ? "Amazon SES" : emailStatus?.mode === "log" ? "Log mode" : "Loading"}</strong>
                  <small>
                    {emailStatus?.mode === "ses"
                      ? "Status links are configured for delivery."
                      : "Status links are recorded, not sent to customers yet."}
                  </small>
                </div>
                <div className="email-health-summary">
                  <span>From</span>
                  <strong>{emailStatus?.sender.from ?? "Pending"}</strong>
                  <small>{emailStatus?.sender.from_domain ?? "Sender domain unavailable"}</small>
                </div>
                <div className="email-health-summary">
                  <span>Reply-To</span>
                  <strong>{emailStatus?.sender.status_reply_to ?? "Pending"}</strong>
                  <small>{emailStatus?.sender.status_reply_to_domain ?? "Reply-to domain unavailable"}</small>
                </div>
                <div className="email-health-summary">
                  <span>SES Region</span>
                  <strong>{emailStatus?.ses.region ?? "Pending"}</strong>
                  <small>{emailStatus?.ses.configuration_set ?? "No configuration set"}</small>
                </div>
              </div>

              {emailStatusMessage ? (
                <div className="email-health-error">
                  <AlertTriangle size={16} />
                  <span>{emailStatusMessage}</span>
                </div>
              ) : null}

              <div className="email-readiness-list">
                {(emailStatus?.readiness.items ?? []).map((item) => (
                  <div className="email-readiness-row" key={item.item_id}>
                    <span
                      className={`health-dot health-dot-${
                        item.status === "Ready" ? "healthy" : item.status === "Warning" ? "warning" : "error"
                      }`}
                    />
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.message}</small>
                    </div>
                    <RouteDiagnosticPill status={item.status} />
                  </div>
                ))}
                {!emailStatus && emailStatusState === "loading" ? (
                  <p className="empty-state">Checking transactional email settings...</p>
                ) : null}
              </div>
            </section>

            <section className="panel canonical-governance-panel">
              <div className="panel-header unit-map-panel-header">
                <div className="panel-title">
                  <History size={18} strokeWidth={2.2} />
                  <h2>Registry Governance</h2>
                </div>
                <span>Version snapshots and recent field-contract changes</span>
              </div>
              <div className="canonical-governance-grid">
                <div className="canonical-governance-summary">
                  <span>Latest Snapshot</span>
                  <strong>{latestCanonicalSnapshot?.version ?? "No local snapshot yet"}</strong>
                  <small>
                    {latestCanonicalSnapshot
                      ? `${latestCanonicalSnapshot.field_count} fields · ${displayTimestamp(latestCanonicalSnapshot.created_at)}`
                      : "A snapshot will be created the next time the registry changes."}
                  </small>
                </div>
                <div className="canonical-governance-summary">
                  <span>Snapshot Retention</span>
                  <strong>{canonicalRegistrySnapshots.length}</strong>
                  <small>Most recent 20 registry snapshots are retained locally.</small>
                  {latestCanonicalSnapshot ? (
                    <button
                      className="secondary-button table-inline-button"
                      onClick={() => void openCanonicalSnapshot(latestCanonicalSnapshot.snapshot_id)}
                    >
                      Open Latest
                    </button>
                  ) : null}
                </div>
                <div className="canonical-governance-history">
                  <div>
                    <strong>Recent Changes</strong>
                    <span>{canonicalRegistryHistory.length ? "Latest 5 shown" : "No local changes recorded yet"}</span>
                  </div>
                  {canonicalRegistryHistory.length ? (
                    <ul>
                      {canonicalRegistryHistory.slice(0, 5).map((change) => (
                        <li key={change.change_id}>
                          <span className="mini-pill mini-pill-neutral">{canonicalRegistryActionLabel(change.action)}</span>
                          <div>
                            <strong>{change.summary}</strong>
                            <small>
                              {displayTimestamp(change.created_at)}
                              {change.next_path ? ` · ${change.next_path}` : change.field_path ? ` · ${change.field_path}` : ""}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Saved schema edits from this sprint forward will appear here.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="panel canonical-registry-panel">
              <div className="panel-header unit-map-panel-header">
                <div className="panel-title">
                  <Braces size={18} strokeWidth={2.2} />
                  <h2>Canonical Fields</h2>
                </div>
                <span>Stable field IDs, aliases, and paths for template mappings</span>
              </div>

              {isCreatingCanonicalField ? (
                <section className="canonical-field-create-panel" aria-label="Create canonical field">
                  <div>
                    <strong>Create Draft Field</strong>
                    <span>
                      Add a new canonical field without code changes. Field paths become mapping targets, so use stable
                      lowercase dot notation.
                    </span>
                  </div>
                  <div className="canonical-field-create-grid">
                    <label className="setup-control">
                      <span>Path</span>
                      <input
                        value={newCanonicalFieldDraft.path}
                        placeholder="order.customer_reference"
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            path: event.target.value
                          }))
                        }
                      />
                    </label>
                    <label className="setup-control">
                      <span>Label</span>
                      <input
                        value={newCanonicalFieldDraft.label}
                        placeholder="Customer Reference"
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            label: event.target.value
                          }))
                        }
                      />
                    </label>
                    <label className="setup-control">
                      <span>Section</span>
                      <select
                        value={newCanonicalFieldDraft.section}
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            section: event.target.value as CanonicalFieldDefinition["section"]
                          }))
                        }
                      >
                        {["customer", "contacts", "source", "target", "order", "shipping", "lines"].map((section) => (
                          <option key={section} value={section}>
                            {canonicalSectionLabels[section] ?? section}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="setup-control">
                      <span>Data Type</span>
                      <select
                        value={newCanonicalFieldDraft.data_type}
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            data_type: event.target.value as CanonicalFieldDefinition["data_type"]
                          }))
                        }
                      >
                        {["string", "number", "integer", "boolean", "datetime", "url", "object"].map((dataType) => (
                          <option key={dataType} value={dataType}>
                            {dataType}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="setup-control canonical-field-create-wide">
                      <span>Description</span>
                      <input
                        value={newCanonicalFieldDraft.description}
                        placeholder="What this field means and when to use it"
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            description: event.target.value
                          }))
                        }
                      />
                    </label>
                    <label className="setup-control">
                      <span>Aliases</span>
                      <input
                        value={newCanonicalFieldDraft.aliases}
                        placeholder="Comma-separated search names"
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            aliases: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="canonical-field-create-footer">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={newCanonicalFieldDraft.required}
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            required: event.target.checked
                          }))
                        }
                      />
                      Required field
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={newCanonicalFieldDraft.repeatable}
                        onChange={(event) =>
                          setNewCanonicalFieldDraft((current) => ({
                            ...current,
                            repeatable: event.target.checked
                          }))
                        }
                      />
                      Repeatable line/contact value
                    </label>
                    <button
                      className="primary-button"
                      onClick={() => void createCanonicalRegistryField()}
                      disabled={workspaceState === "saving"}
                    >
                      Create Draft Field
                    </button>
                  </div>
                </section>
              ) : null}

              <div className="canonical-registry-toolbar">
                <label className="unit-map-search">
                  <Search size={16} />
                  <input
                    value={canonicalRegistrySearch}
                    placeholder="Search path, label, alias, or type"
                    onChange={(event) => setCanonicalRegistrySearch(event.target.value)}
                  />
                </label>
                <label className="setup-control unit-map-filter">
                  <span>Section</span>
                  <select
                    value={canonicalRegistrySectionFilter}
                    onChange={(event) => setCanonicalRegistrySectionFilter(event.target.value)}
                  >
                    <option value="All">All sections</option>
                    {canonicalRegistrySections.map((section) => (
                      <option key={section} value={section}>
                        {section} ({canonicalRegistrySectionCounts[section] ?? 0})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="canonical-section-strip">
                {canonicalRegistrySections.map((section) => (
                  <button
                    className={canonicalRegistrySectionFilter === section ? "column-chip" : "column-chip column-chip-muted"}
                    key={section}
                    onClick={() => setCanonicalRegistrySectionFilter(section)}
                    type="button"
                  >
                    {section}
                    <span>{canonicalRegistrySectionCounts[section] ?? 0}</span>
                  </button>
                ))}
              </div>

              <div className="unit-map-table-wrap">
                <table className="canonical-registry-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Section</th>
                      <th>Type</th>
                      <th>Rules</th>
                      <th>Aliases</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCanonicalRegistryFields.map((field) => {
                      const isEditing = editingCanonicalFieldId === field.field_id;
                      return (
                        <tr key={field.field_id}>
                          <td>
                            {isEditing ? (
                              <div className="canonical-field-edit-stack">
                                {field.origin === "custom" ? (
                                  <input
                                    className="table-input"
                                    value={canonicalFieldDraft.path}
                                    placeholder="field.path"
                                    onChange={(event) =>
                                      setCanonicalFieldDraft((current) => ({
                                        ...current,
                                        path: event.target.value
                                      }))
                                    }
                                  />
                                ) : null}
                                <input
                                  className="table-input"
                                  value={canonicalFieldDraft.label}
                                  placeholder="Field label"
                                  onChange={(event) =>
                                    setCanonicalFieldDraft((current) => ({
                                      ...current,
                                      label: event.target.value
                                    }))
                                  }
                                />
                                <input
                                  className="table-input"
                                  value={canonicalFieldDraft.description}
                                  placeholder="Description"
                                  onChange={(event) =>
                                    setCanonicalFieldDraft((current) => ({
                                      ...current,
                                      description: event.target.value
                                    }))
                                  }
                                />
                              </div>
                            ) : (
                              <>
                                <div className="canonical-field-heading">
                                  <strong>{field.label}</strong>
                                  <span className={field.origin === "custom" ? "mini-pill mini-pill-warning" : "mini-pill mini-pill-neutral"}>
                                    {field.origin === "custom" ? "Custom" : "Core"}
                                  </span>
                                </div>
                                <span className="cell-meta">{field.description}</span>
                              </>
                            )}
                            <span className="cell-meta">{field.path}</span>
                            <span className="cell-meta">{field.field_id}</span>
                            <span className="cell-meta">
                              Used in {field.usage?.total ?? 0} saved reference{(field.usage?.total ?? 0) === 1 ? "" : "s"}
                            </span>
                          </td>
                          <td>{field.section}</td>
                          <td>{field.data_type}</td>
                          <td>
                            <div className="canonical-field-rules">
                              <span className={field.required ? "mini-pill mini-pill-warning" : "mini-pill mini-pill-neutral"}>
                                {field.required ? "Required" : "Optional"}
                              </span>
                              {field.repeatable ? <span className="mini-pill mini-pill-neutral">Repeatable</span> : null}
                            </div>
                          </td>
                          <td>
                            {isEditing ? (
                              <input
                                className="table-input"
                                value={canonicalFieldDraft.aliases}
                                placeholder="Comma-separated aliases"
                                onChange={(event) =>
                                  setCanonicalFieldDraft((current) => ({
                                    ...current,
                                    aliases: event.target.value
                                  }))
                                }
                              />
                            ) : field.aliases.length ? (
                              field.aliases.join(", ")
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <select
                                className="table-input"
                                value={canonicalFieldDraft.status}
                                onChange={(event) =>
                                  setCanonicalFieldDraft((current) => ({
                                    ...current,
                                    status: event.target.value as CanonicalFieldDefinition["status"]
                                  }))
                                }
                              >
                                <option value="Active">Active</option>
                                <option value="Draft">Draft</option>
                                <option value="Deprecated">Deprecated</option>
                              </select>
                            ) : (
                              <span
                                className={field.status === "Active" ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}
                              >
                                {field.status}
                              </span>
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <div className="canonical-registry-actions">
                                <button
                                  className="primary-button table-inline-button"
                                  onClick={() => void saveCanonicalFieldEdit(field)}
                                  disabled={workspaceState === "saving"}
                                >
                                  Save
                                </button>
                                <button
                                  className="secondary-button table-inline-button"
                                  onClick={() => setEditingCanonicalFieldId(null)}
                                >
                                  Cancel
                                </button>
                                {field.origin === "custom" && canonicalFieldDraft.path.trim() !== field.path ? (
                                  <button
                                    className="secondary-button table-inline-button"
                                    onClick={() => void renameCanonicalRegistryFieldPath(field)}
                                    disabled={workspaceState === "saving"}
                                  >
                                    Rename Path
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <div className="canonical-registry-actions">
                                <button className="secondary-button table-inline-button" onClick={() => startCanonicalFieldEdit(field)}>
                                  Edit
                                </button>
                                {field.origin === "custom" && field.status === "Draft" ? (
                                  <button
                                    className="secondary-button table-inline-button"
                                    onClick={() => void deleteCanonicalRegistryField(field)}
                                    disabled={workspaceState === "saving"}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredCanonicalRegistryFields.length === 0 ? (
                  <p className="empty-state">No canonical fields match this view.</p>
                ) : null}
              </div>
            </section>
          </>
        ) : null}

        {bulkProductMappingReview ? (
          <div className="product-map-modal-backdrop" role="presentation" onClick={() => setBulkProductMappingReview(null)}>
            <section
              className="product-map-modal bulk-product-mapping-review-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Confirm bulk product mapping"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-section-header">
                <div>
                  <p className="eyebrow">Bulk Product Mapping</p>
                  <h2>Confirm one product for {bulkProductMappingReview.mappings.length} Pathfinder rows</h2>
                  <span>Review the exact rows, route strategy, and Lift identifier before saving.</span>
                </div>
                <button
                  className="modal-close-button"
                  onClick={() => setBulkProductMappingReview(null)}
                  aria-label="Cancel bulk product mapping"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="bulk-product-mapping-review-body">
                <div className="bulk-product-mapping-review-summary">
                  <div>
                    <span>Output Route</span>
                    <strong>{bulkProductMappingReview.route_name}</strong>
                    <small>{bulkProductMappingReview.identifier_label} strategy</small>
                  </div>
                  <div>
                    <span>Lift Product</span>
                    <strong>{bulkProductMappingReview.product_name || "Product name not supplied"}</strong>
                    <small>{bulkProductMappingReview.catalog_scope}</small>
                    <small>
                      Product ID {bulkProductMappingReview.lift_product_id || "unavailable"} · Unit number{" "}
                      {bulkProductMappingReview.lift_unit_number || "unavailable"}
                    </small>
                  </div>
                  <div>
                    <span>Identifier To Save</span>
                    <strong>{bulkProductMappingReview.identifier}</strong>
                    <small>{bulkProductMappingReview.identifier_label}</small>
                  </div>
                </div>
                <div className="bulk-product-mapping-review-list">
                  <div className="bulk-product-mapping-review-list-heading">
                    <strong>Selected Pathfinder rows</strong>
                    <span>{bulkProductMappingReview.mappings.length} exact rows</span>
                  </div>
                  {bulkProductMappingReview.mappings.map((mapping) => (
                    <div key={mapping.mapping_id} className="bulk-product-mapping-review-row">
                      <div>
                        <strong>{mapping.customer_product_key}</strong>
                        <span>{mapping.display_label}</span>
                      </div>
                      <div>
                        <span>Current</span>
                        <strong>{mapping.current_identifier || "Unmapped"}</strong>
                      </div>
                      <div>
                        <span>After save</span>
                        <strong>{bulkProductMappingReview.identifier}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bulk-product-mapping-review-note">
                  <ShieldCheck size={18} />
                  <span>
                    Every listed row will receive the same route product identifier. Row-level Map Product remains unchanged for individual assignments.
                  </span>
                </div>
              </div>
              <div className="modal-action-row">
                <button className="secondary-button" onClick={() => setBulkProductMappingReview(null)}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  onClick={() => void confirmBulkProductMappingReview()}
                  disabled={workspaceState === "saving"}
                >
                  Confirm {bulkProductMappingReview.mappings.length} Assignments
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {canonicalImpactReview ? (
          <div className="product-map-modal-backdrop" role="presentation" onClick={() => setCanonicalImpactReview(null)}>
            <section
              className="product-map-modal canonical-impact-modal"
              role="dialog"
              aria-modal="true"
              aria-label={canonicalImpactTitle(canonicalImpactReview.action)}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-section-header">
                <div>
                  <p className="eyebrow">Canonical Registry</p>
                  <h2>{canonicalImpactTitle(canonicalImpactReview.action)}</h2>
                  <span>{canonicalImpactSummary(canonicalImpactReview)}</span>
                </div>
                <button className="modal-close-button" onClick={() => setCanonicalImpactReview(null)} aria-label="Close impact review">
                  <X size={16} />
                </button>
              </div>
              <div className="canonical-impact-body">
                <div className="canonical-impact-hero">
                  <div>
                    <span>Field</span>
                    <strong>{canonicalImpactReview.field.label}</strong>
                    <small>{canonicalImpactReview.field.path}</small>
                  </div>
                  <div>
                    <span>Review Type</span>
                    <strong>{canonicalImpactRiskLabel(canonicalImpactReview)}</strong>
                    <small>
                      {canonicalImpactReview.nextPath
                        ? `New path: ${canonicalImpactReview.nextPath}`
                        : `${canonicalImpactReview.field.usage?.total ?? 0} saved reference${(canonicalImpactReview.field.usage?.total ?? 0) === 1 ? "" : "s"}`}
                    </small>
                  </div>
                </div>
                <div className="canonical-impact-grid">
                  {[
                    ["Import mappings", canonicalImpactReview.field.usage?.import_method_mappings ?? 0],
                    ["Saved mapping templates", canonicalImpactReview.field.usage?.saved_mapping_templates ?? 0],
                    ["Output template mappings", canonicalImpactReview.field.usage?.output_template_mappings ?? 0],
                    ["Template tokens", canonicalImpactReview.field.usage?.output_template_tokens ?? 0],
                    ["Value rules", canonicalImpactReview.field.usage?.value_rules ?? 0]
                  ].map(([label, value]) => (
                    <div className="canonical-impact-count" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="canonical-impact-note">
                  <ShieldCheck size={18} />
                  <span>
                    {canonicalImpactReview.action === "rename"
                      ? "Historical preview and submit snapshots remain unchanged for audit accuracy."
                      : "A registry change entry and snapshot will be recorded when this is saved."}
                  </span>
                </div>
              </div>
              <div className="modal-action-row">
                <button className="secondary-button" onClick={() => setCanonicalImpactReview(null)}>
                  Cancel
                </button>
                <button className="primary-button" onClick={() => void confirmCanonicalImpactReview()} disabled={workspaceState === "saving"}>
                  Confirm Change
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {selectedCanonicalSnapshot || canonicalSnapshotState === "loading" ? (
          <div className="product-map-modal-backdrop" role="presentation" onClick={() => setSelectedCanonicalSnapshot(null)}>
            <section
              className="product-map-modal product-map-modal-wide canonical-snapshot-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Canonical registry snapshot"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-section-header">
                <div>
                  <p className="eyebrow">Registry Snapshot</p>
                  <h2>{selectedCanonicalSnapshot?.version ?? "Loading snapshot"}</h2>
                  <span>
                    {selectedCanonicalSnapshot
                      ? `${selectedCanonicalSnapshot.field_count} fields captured ${displayTimestamp(selectedCanonicalSnapshot.created_at)}`
                      : "Loading snapshot details and current comparison."}
                  </span>
                </div>
                <button className="modal-close-button" onClick={() => setSelectedCanonicalSnapshot(null)} aria-label="Close snapshot detail">
                  <X size={16} />
                </button>
              </div>
              {selectedCanonicalSnapshot ? (
                <>
                  <div className="canonical-snapshot-toolbar">
                    <button className="secondary-button" onClick={() => downloadCanonicalSnapshot(selectedCanonicalSnapshot.snapshot_id, "json")}>
                      <FileText size={16} />
                      Export Snapshot JSON
                    </button>
                    <button className="secondary-button" onClick={() => downloadCanonicalSnapshot(selectedCanonicalSnapshot.snapshot_id, "csv")}>
                      <FileSpreadsheet size={16} />
                      Export Snapshot CSV
                    </button>
                    <span>{selectedCanonicalSnapshot.summary}</span>
                  </div>
                  <div className="canonical-impact-grid canonical-snapshot-diff">
                    {[
                      ["Added since snapshot", canonicalSnapshotCompare?.counts.added ?? 0],
                      ["Removed since snapshot", canonicalSnapshotCompare?.counts.removed ?? 0],
                      ["Changed since snapshot", canonicalSnapshotCompare?.counts.changed ?? 0]
                    ].map(([label, value]) => (
                      <div className="canonical-impact-count" key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="unit-map-table-wrap">
                    <table className="canonical-registry-table canonical-snapshot-table">
                      <thead>
                        <tr>
                          <th>Captured Field</th>
                          <th>Section</th>
                          <th>Type</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCanonicalSnapshot.fields.slice(0, 20).map((field) => (
                          <tr key={field.field_id}>
                            <td>
                              <strong>{field.label}</strong>
                              <span className="cell-meta">{field.path}</span>
                            </td>
                            <td>{field.section}</td>
                            <td>{field.data_type}</td>
                            <td>{field.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {selectedCanonicalSnapshot.fields.length > 20 ? (
                      <p className="empty-state">{selectedCanonicalSnapshot.fields.length - 20} additional fields included in exports.</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="empty-state">Loading snapshot...</p>
              )}
            </section>
          </div>
        ) : null}

        {destructiveConfirmation && destructiveConfirmationCopy ? (
          <div
            className="product-map-modal-backdrop"
            role="presentation"
            onClick={() => workspaceState !== "saving" && setDestructiveConfirmation(null)}
          >
            <section
              className="product-map-modal destructive-confirmation-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="destructive-confirmation-title"
              aria-describedby="destructive-confirmation-description"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-section-header">
                <div>
                  <p className="eyebrow">{destructiveConfirmationCopy.eyebrow}</p>
                  <h2 id="destructive-confirmation-title">{destructiveConfirmationCopy.title}</h2>
                  <span id="destructive-confirmation-description">Review the exact item before continuing.</span>
                </div>
                <button
                  className="modal-close-button"
                  onClick={() => setDestructiveConfirmation(null)}
                  aria-label="Cancel confirmation"
                  disabled={workspaceState === "saving"}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="destructive-confirmation-body">
                <AlertTriangle size={22} />
                <div>
                  <strong>{destructiveConfirmationCopy.item}</strong>
                  <span>{destructiveConfirmationCopy.body}</span>
                </div>
              </div>
              <div className="modal-action-row">
                <button
                  className="secondary-button"
                  onClick={() => setDestructiveConfirmation(null)}
                  disabled={workspaceState === "saving"}
                >
                  Cancel
                </button>
                <button
                  className={
                    destructiveConfirmation.kind === "jobs" ||
                    (destructiveConfirmation.kind === "public-intake-link" && destructiveConfirmation.action === "rotate")
                      ? "primary-button"
                      : "danger-button"
                  }
                  onClick={() => void confirmDestructiveAction()}
                  disabled={workspaceState === "saving"}
                >
                  {destructiveConfirmation.kind === "jobs" ? (
                    <Archive size={16} />
                  ) : destructiveConfirmation.kind === "public-intake-link" && destructiveConfirmation.action === "rotate" ? (
                    <RefreshCw size={16} />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  {destructiveConfirmationCopy.confirmLabel}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {leavePrompt ? (
          <div className="product-map-modal-backdrop" role="presentation" onClick={cancelLeavePrompt}>
            <section
              className="product-map-modal unsaved-changes-modal"
              role="dialog"
              aria-modal="true"
              aria-label={leavePrompt.title}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-section-header">
                <div>
                  <p className="eyebrow">Unsaved Changes</p>
                  <h2>{leavePrompt.title}</h2>
                  <span>{leavePrompt.body}</span>
                </div>
                <button className="modal-close-button" onClick={cancelLeavePrompt} aria-label="Keep editing">
                  <X size={16} />
                </button>
              </div>
              <div className="unsaved-changes-body">
                <ShieldCheck size={22} />
                <div>
                  <strong>Choose how to continue.</strong>
                  <span>Saving persists the current setup for future sessions and other users. Continuing without saving reloads the last saved version.</span>
                </div>
              </div>
              <div className="modal-action-row">
                <button className="secondary-button" onClick={cancelLeavePrompt}>
                  Keep Editing
                </button>
                <button className="secondary-button" onClick={() => void discardPromptChangesAndContinue()}>
                  Continue Without Saving
                </button>
                <button className="primary-button" onClick={() => void savePromptChangesAndContinue()} disabled={workspaceState === "saving"}>
                  {leavePrompt.scope === "import-method" ? "Save Method" : "Save Changes"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
