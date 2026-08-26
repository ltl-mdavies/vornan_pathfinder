import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BatchGetItemCommand,
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
  type TransactWriteItem,
  type WriteRequest
} from "@aws-sdk/client-dynamodb";
import {
  canonicalFieldRegistry,
  canonicalRegistryMetadata,
  type CanonicalFieldDataType,
  type CanonicalFieldDefinition,
  type CanonicalFieldSection,
  type CanonicalOrder,
  type ProcessingState,
  type ValidationMessage
} from "@pathfinder/canonical";
import type { LiftCustomer } from "@pathfinder/customer-directory";
import {
  getSourceConnectorDefinition,
  normalizeCustomerSourceConnection,
  type CustomerSourceConnection,
  type SourceConnectionEnvironment,
  type SourceConnectionStatus,
  type SourceConnectorProvider
} from "@pathfinder/source-connections";
import type {
  LiftStepDefinition,
  NormalizedLiftOrder,
  OrderRollupHeaderFieldSource,
  OrderRollupIssue,
  OrderRollupPackage,
  OrderRollupProof,
  OrderRollupProofSummary,
  OrderRollupSourceStatus,
  OrderRollupShipmentSummary
} from "@pathfinder/order-rollup";
import {
  buildLiftOrderLookupUrl,
  defaultLiftTargetConfig,
  extractLiftOrderId,
  type LiftSubmitErrorTranslation,
  type LiftOrderPayload,
  type LiftSubmitRequest,
  type LiftTargetConfig,
  type ValueNormalizationRule
} from "@pathfinder/lift-adapter";
import {
  buildDefaultMappings,
  createDefaultOrderNameResolutionConfig,
  createLegacyOrderNameResolutionConfig,
  normalizeOrderNameResolutionConfig,
  sampleSourceGrid,
  type FieldMapping,
  type LiftExtIdStrategy,
  type OrderNameResolutionConfig as TemplateOrderNameResolutionConfig,
  type OrderNameResolutionResult,
  type ParsedSourceRow,
  type ParsedWorkbookSheet,
  type SourceGrid
} from "@pathfinder/templates";
import {
  normalizeWrikeSourceConfig,
  type WrikePendingOrderTask,
  type WrikeSourceConfig
} from "@pathfinder/wrike-adapter";
import { readTargetSecrets, writeTargetSecrets, type TargetSecrets } from "./secrets-store.js";
import { assertLocalStorageDriver, getPathfinderPersistenceRuntimeConfig } from "./runtime-config.js";
import type {
  WrikeSourceOrderImpact,
  WrikeSourceOrderImpactAssessment
} from "./wrike-source-order-impact.js";

export type ImportMethodStatus = "Active" | "Inactive" | "Draft" | "Paused" | "Archived";
export type ImportMethodSource = "XLSX" | "Google Sheet" | "PDF PO" | "REST API" | "Clipboard" | "SFTP" | "Wrike";
export type ProductResolverStrategy = "derived_key" | "composite_key" | "direct_lift_unit_number";
export type ProductResolutionMode = "map_to_lift_unit" | "send_derived_unit";
export type ProductMappingStatus = "Mapped" | "Unmapped" | "Ambiguous" | "Inactive";
export type ProductMappingSource = "Observed order" | "Preloaded catalog" | "Manual entry";
export type OutputProductIdentifierType =
  | "lift_unit_number"
  | "lift_product_id"
  | "sku"
  | "variant_id"
  | "catalog_item_id"
  | "custom";
export type TargetType = "ERP" | "Ecommerce" | "Print Factory" | "SFTP" | "Webhook" | "Custom";
export type TargetEnvironmentRole = "PROD" | "QA" | "DEV" | "Sandbox" | "Custom";
export type TargetAuthMethod = "Header credentials" | "Bearer token" | "API key" | "None";
export type OutputDestinationMethod = "HTTP POST" | "SFTP file" | "Email attachment" | "Manual download";
export type OutputFormat = "JSON" | "XML" | "CSV" | "XLSX";
export type SubmitProfileMode = "live_customer" | "sandbox_customer";
export type SubmitCertificationStatus = "Passed" | "Warning" | "Blocked";

export interface PublicIntakeConfig {
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

export function createDefaultPublicIntakeConfig(): PublicIntakeConfig {
  return {
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
}
export type SubmitCertificationActionKey =
  | "manual-import"
  | "field-mapping"
  | "product-map"
  | "target-environments"
  | "target-output-routes"
  | "target-output-templates"
  | "target-health";
export type SubmitAttemptStatus =
  | "Blocked"
  | "Gate Locked"
  | "Dry Run"
  | "Submission Uncertain"
  | "Submitted"
  | "Failed";
export type SubmitAttemptTransportMode = "dry_run" | "mock" | "live";

export interface SubmitIntegritySnapshot {
  version: 1;
  fingerprint: string;
  payload_sha256: string;
  request_sha256: string;
  document_set_sha256: string;
  reviewed_at: string;
}
export type OrderStatusTokenStatus = "Active" | "Revoked";
export type PublicIntakeEmailVerificationStatus = "Pending" | "Verified" | "Consumed" | "Expired";

export interface PublicIntakeEmailVerificationRecord {
  token_hash: string;
  public_key_hash: string;
  email_hash: string;
  email_masked: string;
  code_hash: string;
  verification_token_hash: string | null;
  status: PublicIntakeEmailVerificationStatus;
  attempts: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  expires_at_epoch: number;
  verified_at: string | null;
  consumed_at: string | null;
  delivery_mode: "log" | "ses";
  delivery_status: "Pending" | "Logged" | "Sent" | "Failed";
  provider_message_id: string | null;
}
export type StatusAccessPolicyMode =
  | "Exact email only"
  | "Exact email or approved domain"
  | "Invite only"
  | "Internal only";
export type StatusAccessDomainStatus = "Approved" | "Suggested" | "Blocked";
export type StatusAccessDomainSource = "Customer email" | "Order email" | "Imported contact" | "Admin" | "Seed";
export type StatusProofVisibility = "off" | "status_only" | "review_link";

export interface StatusAccessDomain {
  domain: string;
  status: StatusAccessDomainStatus;
  source: StatusAccessDomainSource;
  created_at: string;
  updated_at: string;
}

export interface StatusAccessPolicy {
  mode: StatusAccessPolicyMode;
  allow_public_status_links: boolean;
  proof_visibility: StatusProofVisibility;
  approved_email_domains: StatusAccessDomain[];
  updated_at: string;
}

export type CustomerProofAccessMode = "disabled" | "view_only" | "review";
export type CustomerProofReviewExperience = "simple" | "advanced";

export interface CustomerProofCustomerIdentity {
  proof_customer_id: string;
  verified_order_number: string;
  verified_at: string;
  verified_by: string;
}

export interface CustomerProofOrderOverride {
  order_number: string;
  access_mode: CustomerProofAccessMode;
  review_experience: CustomerProofReviewExperience;
  updated_at: string;
  updated_by: string;
}

export interface CustomerProofCapabilityPolicy {
  access_mode: CustomerProofAccessMode;
  review_experience: CustomerProofReviewExperience;
  customer_identity: CustomerProofCustomerIdentity | null;
  order_overrides: CustomerProofOrderOverride[];
  updated_at: string;
  updated_by: string;
}

export interface CustomerProofCapabilityAuditEntry {
  change_id: string;
  scope: "customer" | "order" | "identity";
  order_number: string | null;
  previous_access_mode: CustomerProofAccessMode;
  next_access_mode: CustomerProofAccessMode;
  previous_review_experience: CustomerProofReviewExperience;
  next_review_experience: CustomerProofReviewExperience;
  actor_id: string;
  created_at: string;
  previous_proof_customer_id?: string | null;
  next_proof_customer_id?: string | null;
  verification_order_number?: string | null;
}

export interface ResolvedCustomerProofCapability {
  association_status: "associated" | "unassociated" | "ambiguous";
  pathfinder_customer_id: string | null;
  proof_customer_id: string | null;
  identity_verified_at: string | null;
  customer_name: string | null;
  access_mode: CustomerProofAccessMode;
  review_experience: CustomerProofReviewExperience;
  source: "customer_default" | "order_override" | "ltl_demo_qa" | "safe_default";
  policy_updated_at: string | null;
}

export interface ProductResolutionConfig {
  strategy: ProductResolverStrategy;
  mode: ProductResolutionMode;
  source_column: string;
  prefix: string;
  suffix: string;
  composite_columns: string[];
  fallback_strategy: "none" | "composite_key";
  direct_unit_number_column?: string | null;
}

export type OrderNameResolutionConfig = TemplateOrderNameResolutionConfig;

export interface CustomerProductMapping {
  mapping_id: string;
  output_route_id: string;
  target_id: string;
  target_template: string;
  source_scope_id?: string | null;
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
  replacement_version_id?: string | null;
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

export type ProductMappingReplacementAction = "New" | "Updated" | "Unchanged" | "Deactivate";

export interface ProductMappingReplacementPreviewRow {
  mapping_id: string;
  customer_product_key: string;
  display_label: string;
  action: ProductMappingReplacementAction;
  current_status: ProductMappingStatus | null;
  next_status: ProductMappingStatus;
}

export interface ProductMappingReplacementSummary {
  replacement_id: string;
  output_route_id: string;
  source_file_name: string;
  actor_id: string;
  created_at: string;
  rolled_back_at: string | null;
  imported_count: number;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  deactivated_count: number;
  clear_existing_assignments: boolean;
}

export interface ProductMappingReplacementCheckpoint extends ProductMappingReplacementSummary {
  before_mappings: CustomerProductMapping[];
  introduced_mapping_ids: string[];
  previous_version_id?: string | null;
}

export interface ProductMappingReplacementPreview {
  preview_token: string;
  output_route_id: string;
  source_file_name: string;
  clear_existing_assignments: boolean;
  imported_count: number;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  deactivated_count: number;
  rows: ProductMappingReplacementPreviewRow[];
}

export interface LiftUnitCatalogItem {
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

export interface LiftCatalogPreset {
  preset_id: string;
  output_route_id: string;
  target_id: string;
  catalog_id: string;
  catalog_name: string;
  status: "Active" | "Inactive";
  created_at: string;
  updated_at: string;
}

export interface ProductResolutionResult {
  output_route_id: string;
  source_scope_id: string;
  source_sheet_name: string;
  source_row_number: number;
  line_number: number;
  strategy: ProductResolverStrategy;
  mode: ProductResolutionMode;
  customer_product_key: string;
  display_label: string;
  source_columns: string[];
  resolved_product_identifier: string | null;
  resolved_unit_number: string | null;
  resolved_product_id?: string | null;
  product_name: string | null;
  status: ProductMappingStatus;
  message: string;
}

export interface SavedFieldMappingTemplate {
  template_id: string;
  name: string;
  version: string;
  status: "Draft" | "Published" | "Archived";
  mappings: FieldMapping[];
  updated_at: string;
}

export interface DetectedSourceSchemaSheet {
  sheet_name: string;
  role?: "order_lines" | "shipping_attachment" | "reference_catalog" | "ignore";
  columns: string[];
  order_row_count: number;
  reference_row_count: number;
  incomplete_row_count?: number;
  sections?: DetectedSourceSchemaSection[];
  header_row?: number | null;
  header_row_count?: 1 | 2;
  ignored_header_rows?: number[];
}

export interface DetectedSourceSchemaSection {
  scope_id: string;
  section_id: string;
  label: string;
  line_kind: "print" | "hardware" | "custom";
  columns: string[];
  header_row: number;
  header_row_count: 1 | 2;
  quantity_column: string | null;
  quantity_value_rules?: Array<{ source_value: string; output_quantity: number }>;
  missing_quantity_behavior: "reference" | "block";
  order_row_count: number;
  reference_row_count: number;
  incomplete_row_count: number;
}

export interface SourceSheetHeaderOverride {
  header_row: number | null;
  header_row_count: 1 | 2;
}

export interface SourceWorkbookSectionConfig {
  section_id: string;
  label: string;
  line_kind: "print" | "hardware" | "custom";
  header_row: number | null;
  header_row_count: 1 | 2;
  header_signature: string[];
  quantity_column: string | null;
  quantity_value_rules?: Array<{ source_value: string; output_quantity: number }>;
  missing_quantity_behavior: "reference" | "block";
  required: boolean;
}

export interface SourceWorkbookSheetConfig {
  role: "order_lines" | "shipping_attachment" | "reference_catalog" | "ignore";
  enabled: boolean;
  sections: SourceWorkbookSectionConfig[];
}

export interface DetectedSourceParserConfig {
  header_row: number | null;
  header_row_count: 1 | 2;
  quantity_column: string | null;
  ignore_repeated_headers: boolean;
  reference_rows_mode: "rows_without_quantity" | "ignore";
  sheet_header_overrides: Record<string, SourceSheetHeaderOverride>;
  workbook_structure?: Record<string, SourceWorkbookSheetConfig>;
}

export interface DetectedSourceSchema {
  source_file_name: string;
  selected_sheet_name: string;
  columns: string[];
  sheets: DetectedSourceSchemaSheet[];
  detected_at: string;
  parser_config?: DetectedSourceParserConfig;
}

export interface ImportMethod {
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
    workbook_structure?: Record<string, SourceWorkbookSheetConfig>;
    sample_template_name?: string | null;
    detected_schema?: DetectedSourceSchema | null;
    detected_schema_history?: DetectedSourceSchema[];
  };
  workbook_sheet_policy: "rows_with_quantity";
  product_resolution_config: ProductResolutionConfig;
  product_resolution_overrides: Record<string, ProductResolutionConfig>;
  order_name_resolution_config: OrderNameResolutionConfig;
  ext_id_strategy: LiftExtIdStrategy;
  public_intake: PublicIntakeConfig;
  /** Runtime-only operations evidence. Excluded from the import contract fingerprint. */
  wrike_operations_snapshot?: WrikeOperationsSnapshot | null;
  last_run_at?: string | null;
  success_rate?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WrikeOperationsCandidateFailure {
  stage: string;
  reason_code: string;
  task_id: string | null;
  evidence_ids: string[];
  job_ids: string[];
}

export interface WrikeOperationsSnapshot {
  version: 1;
  run_id: string;
  source: "scheduled" | "operator";
  customer_id: string;
  import_method_id: string;
  checked_at: string;
  discovery_summary: {
    task_count: number;
    scoped_task_count: number;
    eligible_order_count: number;
    pending_order_count: number;
    placard_order_pending_count: number;
    likely_pending_order_count: number;
  };
  root_scopes: Array<{
    configured_folder_id: string;
    resolved_folder_id: string;
    task_count: number;
  }>;
  pending_intake: WrikePendingOrderTask[];
  prepared_count: number;
  replayed_count: number;
  failed_count: number;
  candidate_failures: WrikeOperationsCandidateFailure[];
  scheduled_submit: {
    eligible_count: number;
    submitted_count: number;
    replayed_count: number;
    reconciliation_needed_count?: number;
    reconciled_count?: number;
    failed_count: number;
  };
  status_writeback: {
    eligible_count: number;
    posted_count: number;
    replayed_count: number;
    failed_count: number;
  };
  safety: {
    lift_order_submitted: boolean;
    wrike_status_changed: boolean;
    uncertain_lift_retry_allowed: false;
  };
}

export interface TargetConfig {
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

export interface TargetEnvironment {
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

export interface OutputTemplate {
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

export interface OutputRoute {
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
  shipping_report_url?: string | null;
  status: "Active" | "Draft" | "Inactive";
  updated_at: string;
}

export interface SubmitProfile {
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

export interface SubmitCertificationItem {
  item_id: string;
  label: string;
  status: SubmitCertificationStatus;
  blocking: boolean;
  message: string;
  suggested_action?: string;
  action_key?: SubmitCertificationActionKey;
}

export interface SubmitCertification {
  can_submit: boolean;
  external_submit_enabled: boolean;
  live_transport_enabled?: boolean;
  live_customer_submit_allowed?: boolean;
  summary: string;
  items: SubmitCertificationItem[];
}

export interface WrikeSourceOrderHistoryEntry {
  event_id: string;
  action:
    | "source_order_created"
    | "source_version_prepared"
    | "source_change_observed_after_transport"
    | "source_change_assessed_no_impact"
    | "campaign_identity_captured";
  created_at: string;
  source_evidence_id: string;
  import_method_fingerprint: string;
  reference_proof_evidence_ids: string[];
  message: string;
  impact_assessment?: WrikeSourceOrderImpactAssessment;
}

export type WrikeSourceOrderReviewDispositionValue =
  | "no_lift_update_needed"
  | "resolved";

export interface WrikeSourceOrderReviewDisposition {
  disposition_id: string;
  event_id: string;
  disposition: WrikeSourceOrderReviewDispositionValue;
  actor_id: string;
  created_at: string;
  note: string | null;
}

export interface WrikeRelatedSourceJobSummary {
  job_id: string;
  pathfinder_order_id: string;
  state: ProcessingState;
  target_order_number: string | null;
  source_evidence_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WrikeSourceOrderSummary {
  source_order_key: string;
  related_record_count: number;
  related_records: WrikeRelatedSourceJobSummary[];
}

export interface ProcessingJobPreview {
  job_id: string;
  pathfinder_order_id: string;
  customer_id: string;
  customer_name: string;
  source_customer_id: string;
  source_customer_name: string;
  submit_customer_id: string;
  submit_customer_name: string;
  submit_profile_id: string;
  submit_profile_name: string;
  submit_mode: SubmitProfileMode;
  sandbox: boolean;
  import_method_id: string;
  import_method_name: string;
  output_route_id: string;
  output_route_name: string;
  target_order_number?: string | null;
  /** Runtime list projection from the latest durable Lift order-header evidence. */
  target_order_status?: NormalizedLiftOrder["status"] | null;
  target_order_status_checked_at?: string | null;
  /** Runtime list projection from the latest durable Lift order snapshot. */
  target_order_created_at?: string | null;
  /** Whether the projected Lift creation value includes a trustworthy time. */
  target_order_created_precision?: "date" | "timestamp" | null;
  /** Provenance for the projected Lift creation value. */
  target_order_created_source?: "lift_header" | "pathfinder_submit_confirmation" | null;
  /** Runtime projection of the latest meaningful operator-visible event. */
  last_activity_at?: string | null;
  order_confirmed_at?: string | null;
  target_order_lookup_url?: string | null;
  target_order_association_history?: LiftOrderAssociationHistoryEntry[];
  wrike_status_writebacks?: WrikeStatusWritebackRecord[];
  recovery_audit?: JobRecoveryAuditEntry[];
  scheduled_wrike_intake?: {
    source: "scheduled_polling";
    task_id: string;
    import_method_id: string;
    discovered_at: string;
  } | null;
  state: ProcessingState;
  source_file_name: string;
  sheet_name?: string | null;
  source_grid: SourceGrid;
  source_sheets: ParsedWorkbookSheet[];
  parsed_order_rows: ParsedSourceRow[];
  reference_rows: ParsedSourceRow[];
  mappings: FieldMapping[];
  /**
   * Immutable preparation settings used by an authenticated manual preview.
   * These values are request-local evidence; they do not update the saved
   * Import Method or customer product mappings.
   */
  manual_preview_basis?: {
    mode: "request_local";
    mappings: FieldMapping[];
    product_resolution_config: ProductResolutionConfig;
    product_resolution_overrides: Record<string, ProductResolutionConfig>;
    order_name_resolution_config: OrderNameResolutionConfig;
    ext_id_strategy: LiftExtIdStrategy;
    captured_at: string;
  } | null;
  product_resolution_results: ProductResolutionResult[];
  order_name_resolution_result?: OrderNameResolutionResult;
  unresolved_products: CustomerProductMapping[];
  canonical_order: CanonicalOrder;
  canonical_validation: ValidationMessage[];
  lift_payload: LiftOrderPayload;
  lift_validation: ValidationMessage[];
  submit_certification?: SubmitCertification;
  submit_integrity?: SubmitIntegritySnapshot;
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
  source_evidence?: {
    provider: "wrike";
    evidence_id: string;
    evidence_sha256: string;
    import_method_fingerprint: string;
    connection_id: string;
    account_id: string;
    task_id: string;
    task_title?: string | null;
    root_folder_id?: string | null;
    campaign_folder_id?: string | null;
    campaign_name?: string | null;
    attachment_id: string;
    version_id: string;
    captured_at: string;
  } | null;
  source_order_last_seen_at?: string | null;
  source_order_history?: WrikeSourceOrderHistoryEntry[];
  source_order_impact?: WrikeSourceOrderImpact;
  source_order_review_dispositions?: WrikeSourceOrderReviewDisposition[];
  /** Read-only list projection. Related records remain independently stored for audit. */
  source_order_summary?: WrikeSourceOrderSummary;
  source_document_publications?: Array<{
    document_role: "order_grid" | "reference_proof";
    evidence_id: string;
    publication_id: string;
    sha256: string;
    object_version_id: string;
    published_at: string;
    expires_at: string;
    /** Immutable source PDFs represented by this delivery object. */
    source_evidence_ids?: string[];
  }>;
}

export interface JobRecoveryAuditEntry {
  recovery_id: string;
  action: "product_mappings_re_evaluated";
  source: "operator";
  actor_id: string;
  created_at: string;
  previous_state: ProcessingState;
  next_state: ProcessingState;
  previous_unresolved_count: number;
  next_unresolved_count: number;
  source_evidence_id: string;
  source_task_id: string;
  previous_mapping_fingerprint: string;
  next_mapping_fingerprint: string;
  message: string;
}

/**
 * Keep DynamoDB job records below the item-size boundary without losing the
 * submitted order or workbook diagnostics. The immutable source workbook is
 * retained separately as source evidence; zero/blank-quantity catalog rows
 * are therefore redundant in the operational job record.
 */
export function compactProcessingJobForDynamo(job: ProcessingJobPreview): ProcessingJobPreview {
  const orderRowsOnly = (rows: ParsedSourceRow[] | undefined) =>
    (rows ?? []).filter((row) => row.row_type === "order");

  return {
    ...job,
    parsed_order_rows: orderRowsOnly(job.parsed_order_rows),
    reference_rows: [],
    source_sheets: (job.source_sheets ?? []).map((sheet) => ({
      ...sheet,
      parsed_rows: orderRowsOnly(sheet.parsed_rows),
      sections: (sheet.sections ?? []).map((section) => ({
        ...section,
        parsed_rows: orderRowsOnly(section.parsed_rows)
      }))
    }))
  };
}

export interface WrikeStatusWritebackRecord {
  writeback_id: string;
  task_id: string;
  connection_id: string;
  order_number: string;
  contract_number: string;
  comment_sha256: string;
  status_url_sha256: string;
  state: "prepared" | "submission_uncertain" | "posted" | "failed";
  prepared_at: string;
  updated_at: string;
  posted_at: string | null;
  comment_id: string | null;
  failure_category: string | null;
  prepared_by_email: string | null;
}

export interface LiftOrderAssociationVerification {
  order_number: string;
  customer_id: string;
  customer_name: string | null;
  order_title: string | null;
  contract_number: string | null;
  created_by: string | null;
  order_status: string | null;
  line_count: number;
  fetched_at: string;
  external_order_id?: string | null;
  company_id?: string | null;
  po_number?: string | null;
  order_type?: string | null;
  line_fingerprint?: string | null;
  submit_attempt_id?: string | null;
  request_fingerprint?: string | null;
}

export interface LiftOrderAssociationHistoryEntry {
  association_id: string;
  source: "manual_verified" | "scheduled_uncertain_reconciliation";
  action: "linked" | "replaced";
  previous_order_number: string | null;
  order_number: string;
  linked_at: string;
  linked_by_email: string | null;
  reason: string;
  verification: LiftOrderAssociationVerification;
  automatic_wrike_status_writeback_suppressed?: boolean;
}

export interface NormalizedLiftSubmitResponse {
  status: "not_sent" | "accepted" | "rejected" | "error";
  http_status?: number | null;
  lift_order_id?: string | null;
  message: string;
  raw_body?: unknown;
  error_translation?: LiftSubmitErrorTranslation | null;
  received_at: string;
}

export interface SubmitAttempt {
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
  request_fingerprint?: string;
  document_preflight?: {
    required: boolean;
    checked_at: string | null;
    documents: Array<{
      document_role: "order_grid" | "reference_proof";
      publication_id: string;
      object_version_id: string;
      content_length: number;
      http_status: 200;
      redirect_count: 0;
    }>;
  };
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

export interface PathfinderCustomerWorkspace {
  customer: LiftCustomer;
  source_connections: CustomerSourceConnection[];
  import_methods: ImportMethod[];
  output_routes: OutputRoute[];
  templates: SavedFieldMappingTemplate[];
  jobs: ProcessingJobPreview[];
  submit_attempts?: SubmitAttempt[];
  product_mappings: CustomerProductMapping[];
  catalog_presets: LiftCatalogPreset[];
  product_mapping_replacement_checkpoint?: ProductMappingReplacementCheckpoint | null;
  product_mapping_replacement_history?: ProductMappingReplacementSummary[];
  product_mapping_active_versions?: Record<string, string | null>;
  status_access_policy: StatusAccessPolicy;
  proof_capability_policy: CustomerProofCapabilityPolicy;
  proof_capability_audit: CustomerProofCapabilityAuditEntry[];
  primary_target_id: string;
  primary_output_route_id: string;
  updated_at: string;
}

export interface PathfinderStore {
  version: 1;
  targets: Record<string, TargetConfig>;
  workspaces: Record<string, PathfinderCustomerWorkspace>;
  jobs: ProcessingJobPreview[];
  submit_attempts: SubmitAttempt[];
  lift_unit_catalog: LiftUnitCatalogItem[];
  order_status_tokens?: OrderStatusTokenRecord[];
  public_intake_email_verifications?: PublicIntakeEmailVerificationRecord[];
  order_status_snapshots?: PublicOrderStatusSnapshot[];
  canonical_registry?: {
    overrides: Record<string, CanonicalFieldOverride>;
    custom_fields: CanonicalFieldDefinition[];
    snapshots: CanonicalRegistrySnapshot[];
    history: CanonicalRegistryChangeEntry[];
    updated_at: string;
  };
}

export interface PublicOrderStatusSnapshot {
  snapshot_id: string;
  order_key: string;
  order_number: string;
  source_order_id: string;
  customer: {
    source_customer_name: string;
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
    name: string;
    target: string;
    template: string;
  };
  header: {
    ext_id: string;
    po_number?: string | null;
    contract_number?: string | null;
    order_title?: string | null;
    requested_ship_date?: string | null;
    due_date?: string | null;
    actual_ship_date?: string | null;
    shipping?: unknown;
    field_sources?: {
      po_number?: OrderRollupHeaderFieldSource;
      contract_number?: OrderRollupHeaderFieldSource;
      order_title?: OrderRollupHeaderFieldSource;
      requested_ship_date?: OrderRollupHeaderFieldSource;
      due_date?: OrderRollupHeaderFieldSource;
      actual_ship_date?: OrderRollupHeaderFieldSource;
      shipping?: OrderRollupHeaderFieldSource;
    };
  };
  live_order?: NormalizedLiftOrder | null;
  order_status?: NormalizedLiftOrder["status"];
  proof_summary?: OrderRollupProofSummary | null;
  proof_visibility: StatusProofVisibility;
  shipment_summary?: OrderRollupShipmentSummary | null;
  lines: Array<{
    line_number: number;
    order_line_id: string | number | null;
    product_name: string | null | undefined;
    description: string | null | undefined;
    quantity: number;
    unit_number?: string | null;
    product_id?: string | null;
    material?: string | null;
    final_height?: number | null;
    final_width?: number | null;
    step?: LiftStepDefinition | null;
    proof_count: number;
    package_count: number;
    latest_proof_status: string | null;
    latest_tracking_message: string | null;
    proofs: OrderRollupProof[];
    packages: OrderRollupPackage[];
  }>;
  lookups: {
    order: { ok: boolean; http_status: number; fetched_at: string } | null;
    proofs: { ok: boolean; http_status: number; fetched_at: string } | null;
    packages: { ok: boolean; http_status: number; fetched_at: string; redacted_fields: string[] } | null;
    shipping?: { ok: boolean; http_status: number; fetched_at: string } | null;
  };
  source_status?: Partial<Record<OrderRollupSourceStatus["source"], OrderRollupSourceStatus>>;
  issues: OrderRollupIssue[];
  visibility_policy: {
    audience: "public_status";
    redacted_fields: string[];
    token_required: true;
    proof_visibility: StatusProofVisibility;
  };
  refreshed_at: string;
}

export interface OrderStatusTokenRecord {
  token_hash: string;
  order_key: string;
  customer_id: string;
  job_id: string;
  order_number: string;
  orders?: Array<{
    order_key: string;
    customer_id: string;
    job_id: string;
    order_number: string;
  }>;
  status: OrderStatusTokenStatus;
  created_at: string;
  updated_at: string;
  expires_at: string;
  expires_at_epoch: number;
  created_by_email?: string | null;
  requested_email_hash?: string | null;
  requested_email_masked?: string | null;
  email_delivery?: {
    mode: "log" | "ses";
    status: "Pending" | "Logged" | "Sent" | "Failed";
    provider_message_id?: string | null;
    error?: string | null;
    updated_at: string;
  } | null;
}

export interface CanonicalFieldOverride {
  field_id: string;
  label?: string;
  aliases?: string[];
  status?: CanonicalFieldDefinition["status"];
  description?: string | null;
  updated_at: string;
}

export interface CanonicalFieldCreateInput {
  path: string;
  section: CanonicalFieldSection;
  label: string;
  data_type: CanonicalFieldDataType;
  required?: boolean;
  repeatable?: boolean;
  status?: CanonicalFieldDefinition["status"];
  aliases?: string[];
  description?: string;
}

export interface CanonicalFieldUsageSummary {
  import_method_mappings: number;
  saved_mapping_templates: number;
  output_template_mappings: number;
  output_template_tokens: number;
  value_rules: number;
  total: number;
}

export type CanonicalRegistryChangeAction =
  | "field_metadata_updated"
  | "custom_field_created"
  | "custom_field_removed"
  | "custom_field_renamed";

export interface CanonicalRegistryChangeEntry {
  change_id: string;
  action: CanonicalRegistryChangeAction;
  summary: string;
  field_id?: string;
  field_path?: string;
  previous_path?: string;
  next_path?: string;
  usage_total?: number;
  created_at: string;
  details?: Record<string, unknown>;
}

export interface CanonicalRegistrySnapshot {
  snapshot_id: string;
  registry_id: string;
  version: string;
  status: string;
  field_count: number;
  custom_field_count: number;
  change_id: string;
  action: CanonicalRegistryChangeAction;
  summary: string;
  fields: CanonicalFieldDefinition[];
  created_at: string;
}

const storePath =
  process.env.PATHFINDER_LOCAL_STORE_PATH ??
  (process.env.PATHFINDER_RUNTIME === "lambda"
    ? "/tmp/pathfinder-store.local.json"
    : fileURLToPath(new URL("../../../data/pathfinder-store.local.json", import.meta.url)));
const targetId = "lift-standard-graphics";
const ecommerceTargetId = "thinkdifferentprint-ecommerce";
const outputRouteId = "route-ltl-lift-91-standard-graphics";
const manualImportMethodId = "manual-xlsx";
const defaultLiftOrderLookupUrl = "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360Orders/N?offset=0";
const defaultLiftProofReportUrl = "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0";
const defaultLiftPackageDetailsUrl = "https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/PackageDetails/package_details?offset=0";
const defaultLiftShippingReportUrl = "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/ShippingReport/N?offset=0";

function now() {
  return new Date().toISOString();
}

function cloneDefaultLiftConfig(): LiftTargetConfig {
  return JSON.parse(JSON.stringify(defaultLiftTargetConfig)) as LiftTargetConfig;
}

function createSeedEnvironments(lift = cloneDefaultLiftConfig()): TargetEnvironment[] {
  return [
    {
      environment_id: "env-lift-qa1",
      name: "QA1",
      role: "QA",
      endpoint_url: lift.environments.QA1.endpoint_url,
      auth_method: "Header credentials",
      headers: {
        "Content-Type": "application/json",
        Ext_ID: "body.order.ext_id",
        User: lift.credentials.User,
        Password: "********",
        Company: lift.headers.Company
      },
      credentials: { ...lift.credentials },
      status: "Active",
      last_test_at: null,
      last_test_status: "Not tested"
    },
    {
      environment_id: "env-lift-prod",
      name: "PROD",
      role: "PROD",
      endpoint_url: lift.environments.PROD.endpoint_url,
      auth_method: "Header credentials",
      headers: {
        "Content-Type": "application/json",
        Ext_ID: "body.order.ext_id",
        User: lift.credentials.User,
        Password: "********",
        Company: lift.headers.Company
      },
      credentials: { ...lift.credentials },
      status: "Active",
      last_test_at: null,
      last_test_status: "Not tested"
    }
  ];
}

function createSeedOutputTemplate(timestamp = now()): OutputTemplate {
  return {
    output_template_id: "template-lift-standard-graphics",
    name: "Lift High End Work",
    destination_method: "HTTP POST",
    output_format: "JSON",
    body_template: JSON.stringify(
      {
        customer: {
          lift_customer_id: "LIFT_CUSTOMER_ID_TBD",
          customer_name: "Momentara",
          crm_id: "CRM-EXAMPLE-001"
        },
        contacts: [
          {
            first_name: "Jane",
            last_name: "Smith",
            title: "Marketing Manager",
            email: "jane.smith@example.com",
            mobile_phone: "555-555-0101",
            office_phone: "555-555-0100",
            home_phone: null,
            slack: "@jane.smith",
            fax: null
          }
        ],
        source: {
          platform: "Pathfinder",
          pathfinder_customer_id: "customer_momentara",
          source_system: "Manual Upload",
          source_customer: "Momentara",
          source_record_id: "AS360-30904511",
          source_record_url: null,
          source_template: "Momentara OOH Order Form",
          submitted_at: "2026-06-18T14:32:00-04:00",
          pathfinder_job_id: "job_20260618_000001",
          pathfinder_canonical_order_id: "co_20260618_000001"
        },
        order: {
          ext_id: "AS360-30904511",
          po_number: "1122334455",
          contract_number: "1122334455",
          order_title: "Campaign",
          order_note: "Optional order-level production note.",
          requested_ship_date: "06/23/2026",
          due_date: "06/24/2026",
          order_attachment: "https://example.com/imports/momentara-order.xlsx",
          artwork_folder_url: "https://example.com/artwork/momentara-order",
          reference_proof_url: "https://go.vornan.co/d/example/reference-proof.pdf",
          shipping: {
            method: "UPS Ground",
            account_number: null,
            acct_billing_zip: "45202",
            acct_billing_country: "US",
            attention_to: "Jane Smith",
            company: "Example Company",
            address_1: "123 Main St",
            address_2: "Suite 200",
            city: "Cincinnati",
            state: "OH",
            postal_code: "45202",
            country: "US",
            phone: "555-555-0100",
            email: "jane.smith@example.com",
            instructions: "Deliver to receiving dock."
          }
        },
        lines: [
          {
            line_number: 1,
            unit_number: "2SHEET_46x60_48PT",
            customer_sku: "OOH-2SHEET-46X60",
            description: "2 Sheet Poster",
            product_id: "PROD-2SHEET-POSTER",
            product_name: "2 Sheet Poster",
            quantity: 1,
            artwork: {
              file_name: "momentara_campaign_art.pdf",
              file_url: "https://example.com/artwork/momentara_campaign_art.pdf",
              checksum: null
            },
            dimensions: {
              final_height: 46.2,
              final_width: 60.2,
              live_height: 43,
              live_width: 57,
              bleed: 0.125
            },
            production: {
              material: "15pt Styrene",
              laminate: "8520",
              coating: "N",
              premask: "N",
              ink: "4CP/0",
              cut_type: "Square Cut"
            },
            line_note: "Optional line-level production note."
          }
        ]
      },
      null,
      2
    ),
    header_template: JSON.stringify(
      {
        "Content-Type": "application/json",
        Ext_ID: "AS360-30904511",
        User: "LIFT_IMPORT_USERNAME_TBD",
        Password: "LIFT_IMPORT_PASSWORD_TBD",
        Company: "91"
      },
      null,
      2
    ),
    canonical_mappings: [
      { sourceColumn: "body:customer.lift_customer_id", targetField: "customer.lift_customer_id", required: true },
      { sourceColumn: "body:customer.customer_name", targetField: "customer.name", required: false },
      { sourceColumn: "body:customer.crm_id", targetField: "customer.crm_id", required: false },
      { sourceColumn: "body:contacts[].first_name", targetField: "contacts[].first_name", required: false },
      { sourceColumn: "body:contacts[].last_name", targetField: "contacts[].last_name", required: false },
      { sourceColumn: "body:contacts[].title", targetField: "contacts[].title", required: false },
      { sourceColumn: "body:contacts[].email", targetField: "contacts[].email", required: false },
      { sourceColumn: "body:contacts[].mobile_phone", targetField: "contacts[].mobile_phone", required: false },
      { sourceColumn: "body:contacts[].office_phone", targetField: "contacts[].office_phone", required: false },
      { sourceColumn: "body:contacts[].home_phone", targetField: "contacts[].home_phone", required: false },
      { sourceColumn: "body:contacts[].slack", targetField: "contacts[].slack", required: false },
      { sourceColumn: "body:contacts[].fax", targetField: "contacts[].fax", required: false },
      { sourceColumn: "body:source.pathfinder_customer_id", targetField: "customer.id", required: false },
      { sourceColumn: "body:source.source_customer", targetField: "source.source_customer", required: false },
      { sourceColumn: "body:source.source_record_id", targetField: "source.source_record_id", required: false },
      { sourceColumn: "body:source.source_record_url", targetField: "source.source_record_url", required: false },
      { sourceColumn: "body:source.source_template", targetField: "source.source_template", required: false },
      { sourceColumn: "body:source.submitted_at", targetField: "source.submitted_at", required: false },
      { sourceColumn: "body:source.pathfinder_job_id", targetField: "generated.pathfinder_job_id", required: false },
      { sourceColumn: "body:order.ext_id", targetField: "order.external_order_id", required: true },
      { sourceColumn: "body:order.po_number", targetField: "order.po_number", required: false },
      { sourceColumn: "body:order.contract_number", targetField: "order.contract_number", required: false },
      { sourceColumn: "body:order.order_title", targetField: "order.order_title", required: false },
      { sourceColumn: "body:order.order_note", targetField: "order.order_note", required: false },
      { sourceColumn: "body:order.requested_ship_date", targetField: "order.ship_date", required: false },
      { sourceColumn: "body:order.due_date", targetField: "order.due_date", required: false },
      { sourceColumn: "body:order.order_attachment", targetField: "order.order_attachment", required: false },
      { sourceColumn: "body:order.artwork_folder_url", targetField: "order.artwork_folder_url", required: false },
      { sourceColumn: "body:order.reference_proof_url", targetField: "order.reference_proof_url", required: false },
      { sourceColumn: "body:order.shipping.method", targetField: "order.shipping.method", required: false },
      { sourceColumn: "body:order.shipping.acct_billing_zip", targetField: "order.shipping.acct_billing_zip", required: false },
      { sourceColumn: "body:order.shipping.acct_billing_country", targetField: "order.shipping.acct_billing_country", required: false },
      { sourceColumn: "body:lines[].line_number", targetField: "lines[].line_number", required: false },
      { sourceColumn: "body:lines[].unit_number", targetField: "lines[].unit_number", required: true },
      { sourceColumn: "body:lines[].customer_sku", targetField: "lines[].customer_sku", required: false },
      { sourceColumn: "body:lines[].description", targetField: "lines[].description", required: false },
      { sourceColumn: "body:lines[].product_id", targetField: "lines[].product_id", required: false },
      { sourceColumn: "body:lines[].product_name", targetField: "lines[].product_name", required: false },
      { sourceColumn: "body:lines[].quantity", targetField: "lines[].quantity", required: true },
      { sourceColumn: "body:lines[].artwork.file_name", targetField: "lines[].artwork.file_name", required: false },
      { sourceColumn: "body:lines[].artwork.file_url", targetField: "lines[].artwork.file_url", required: false },
      { sourceColumn: "body:lines[].artwork.checksum", targetField: "lines[].artwork.checksum", required: false },
      { sourceColumn: "body:lines[].dimensions.final_height", targetField: "lines[].dimensions.final_height", required: false },
      { sourceColumn: "body:lines[].dimensions.final_width", targetField: "lines[].dimensions.final_width", required: false },
      { sourceColumn: "body:lines[].dimensions.live_height", targetField: "lines[].dimensions.live_height", required: false },
      { sourceColumn: "body:lines[].dimensions.live_width", targetField: "lines[].dimensions.live_width", required: false },
      { sourceColumn: "body:lines[].dimensions.bleed", targetField: "lines[].dimensions.bleed", required: false },
      { sourceColumn: "body:lines[].production.material", targetField: "lines[].production.material", required: false },
      { sourceColumn: "body:lines[].production.laminate", targetField: "lines[].production.laminate", required: false },
      { sourceColumn: "body:lines[].production.coating", targetField: "lines[].production.coating", required: false },
      { sourceColumn: "body:lines[].production.premask", targetField: "lines[].production.premask", required: false },
      { sourceColumn: "body:lines[].production.ink", targetField: "lines[].production.ink", required: false },
      { sourceColumn: "body:lines[].line_note", targetField: "lines[].line_note", required: false },
      { sourceColumn: "header:Ext_ID", targetField: "order.external_order_id", required: true },
      { sourceColumn: "header:User", targetField: "environment.credentials.User", required: true },
      { sourceColumn: "header:Password", targetField: "environment.credentials.Password", required: true },
      { sourceColumn: "header:Company", targetField: "environment.headers.Company", required: true }
    ],
    filename_format: "orders-%y-%m-%d-%h-%i-%s.json",
    status: "Active",
    updated_at: timestamp
  };
}

function createSeedEcommerceOutputTemplate(timestamp = now()): OutputTemplate {
  return {
    output_template_id: "template-thinkdifferentprint-order",
    name: "ThinkDifferentPrint Ecommerce Order",
    destination_method: "HTTP POST",
    output_format: "JSON",
    body_template: JSON.stringify(
      {
        order_id: "{{order.ext_id}}",
        customer: "{{customer.name}}",
        items: "{{lines[]}}"
      },
      null,
      2
    ),
    header_template: JSON.stringify(
      {
        "Content-Type": "application/json",
        Authorization: "{{environment.credentials.token}}"
      },
      null,
      2
    ),
    canonical_mappings: [],
    filename_format: "ecomm-orders-%y-%m-%d-%h-%i-%s.json",
    status: "Draft",
    updated_at: timestamp
  };
}

export function createMomentaraProductResolutionConfig(): ProductResolutionConfig {
  return {
    strategy: "derived_key",
    mode: "map_to_lift_unit",
    source_column: "SIGN TYPE",
    prefix: "MOMENTARA__",
    suffix: "",
    composite_columns: [
      "DESCRIPTION",
      "Media Type",
      "Final Size Width",
      "Final Size Length",
      "STOCK",
      "FINISHING"
    ],
    fallback_strategy: "none",
    direct_unit_number_column: null
  };
}

export function createNeutralProductResolutionConfig(): ProductResolutionConfig {
  return {
    strategy: "derived_key",
    mode: "map_to_lift_unit",
    source_column: "",
    prefix: "",
    suffix: "",
    composite_columns: [],
    fallback_strategy: "none",
    direct_unit_number_column: null
  };
}

// Compatibility contract: normalization of already-persisted methods keeps the
// original Momentara fallback. New workspace/method construction must call the
// neutral constructor explicitly instead of changing this legacy default.
export function createDefaultProductResolutionConfig(): ProductResolutionConfig {
  return createMomentaraProductResolutionConfig();
}

function createSeedTarget(): TargetConfig {
  const lift = cloneDefaultLiftConfig();
  const timestamp = now();
  return {
    target_id: targetId,
    name: "Lift ERP",
    target_type: "ERP",
    adapter: "lift-standard-graphics",
    format: "JSON",
    template: "Lift High End Work",
    status: "Ready",
    health_status: "Untested",
    environments: createSeedEnvironments(lift),
    output_templates: [createSeedOutputTemplate(timestamp)],
    lift,
    last_test_at: null,
    updated_at: timestamp
  };
}

function createSeedEcommerceTarget(): TargetConfig {
  const lift = cloneDefaultLiftConfig();
  const timestamp = now();
  lift.environments = {
    QA1: { endpoint_url: "" },
    PROD: { endpoint_url: "" }
  };
  lift.headers = {
    ...lift.headers,
    Company: ""
  };
  lift.credentials = {
    User: "",
    Password: ""
  };

  return {
    target_id: ecommerceTargetId,
    name: "ThinkDifferentPrint",
    target_type: "Ecommerce",
    adapter: "lift-standard-graphics",
    format: "JSON",
    template: "ThinkDifferentPrint Ecommerce Order",
    status: "Draft",
    health_status: "Untested",
    environments: [
      {
        environment_id: "env-thinkdifferentprint-sandbox",
        name: "QA1",
        role: "Sandbox",
        endpoint_url: "",
        auth_method: "Bearer token",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer {{token}}"
        },
        credentials: {
          token: ""
        },
        status: "Draft",
        last_test_at: null,
        last_test_status: "Not tested"
      }
    ],
    output_templates: [createSeedEcommerceOutputTemplate(timestamp)],
    lift,
    last_test_at: null,
    updated_at: timestamp
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function setMissing(record: Record<string, unknown>, key: string, value: unknown) {
  if (!(key in record)) {
    record[key] = value;
  }
}

const lineShippingTemplateFields = new Set([
  "body:lines[].shipping.method",
  "body:lines[].shipping.account_number",
  "body:lines[].shipping.acct_billing_zip",
  "body:lines[].shipping.acct_billing_country",
  "body:lines[].shipping.attention_to",
  "body:lines[].shipping.company",
  "body:lines[].shipping.address_1",
  "body:lines[].shipping.address_2",
  "body:lines[].shipping.city",
  "body:lines[].shipping.state",
  "body:lines[].shipping.postal_code",
  "body:lines[].shipping.country",
  "body:lines[].shipping.phone",
  "body:lines[].shipping.email",
  "body:lines[].shipping.instructions"
]);

function reorderStandardBody(body: Record<string, unknown>) {
  const order = asRecord(body.order);
  const orderedOrder: Record<string, unknown> = {};
  for (const key of [
    "ext_id",
    "po_number",
    "contract_number",
    "order_title",
    "order_note",
    "requested_ship_date",
    "due_date",
    "order_attachment",
    "artwork_folder_url",
    "reference_proof_url",
    "shipping"
  ]) {
    if (key in order) {
      orderedOrder[key] = order[key];
    }
  }
  for (const [key, value] of Object.entries(order)) {
    if (!(key in orderedOrder)) {
      orderedOrder[key] = value;
    }
  }

  const orderedBody: Record<string, unknown> = {};
  const orderedBodyEntries: Array<[string, unknown]> = [
    ["customer", body.customer],
    ["contacts", body.contacts],
    ["source", body.source],
    ["order", orderedOrder],
    ["lines", body.lines]
  ];
  for (const [key, value] of orderedBodyEntries) {
    if (value !== undefined) {
      orderedBody[key] = value;
    }
  }
  for (const [key, value] of Object.entries(body)) {
    if (!(key in orderedBody)) {
      orderedBody[key] = value;
    }
  }

  return orderedBody;
}

function normalizeStandardOutputTemplate(template: OutputTemplate): OutputTemplate {
  if (template.output_template_id !== "template-lift-standard-graphics") {
    return template;
  }

  const seedTemplate = createSeedOutputTemplate(template.updated_at);
  const currentMappings = template.canonical_mappings
    .filter((mapping) => !lineShippingTemplateFields.has(mapping.sourceColumn))
    .map((mapping) =>
      mapping.targetField === "order.artwork_folder_url" && mapping.sourceColumn === "body:order.FLEX_FIELD9"
        ? { ...mapping, sourceColumn: "body:order.artwork_folder_url" }
        : mapping
    );
  const sourceColumns = new Set(currentMappings.map((mapping) => mapping.sourceColumn));
  const canonical_mappings = [
    ...currentMappings,
    ...seedTemplate.canonical_mappings.filter((mapping) => !sourceColumns.has(mapping.sourceColumn))
  ];
  let body_template = template.body_template;

  try {
    const body = asRecord(JSON.parse(template.body_template));
    const customer = asRecord(body.customer);
    setMissing(customer, "crm_id", "{{customer.crm_id}}");
    body.customer = customer;

    if (!Array.isArray(body.contacts)) {
      body.contacts = [
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
      ];
    }

    const order = asRecord(body.order);
    setMissing(order, "due_date", "{{order.due_date}}");
    setMissing(order, "order_attachment", "{{order.order_attachment}}");
    if (order.FLEX_FIELD9 === "{{order.artwork_folder_url}}") {
      delete order.FLEX_FIELD9;
    }
    setMissing(order, "artwork_folder_url", "{{order.artwork_folder_url}}");
    setMissing(order, "reference_proof_url", "{{order.reference_proof_url}}");
    const orderShipping = asRecord(order.shipping);
    setMissing(orderShipping, "acct_billing_zip", "{{order.shipping.acct_billing_zip}}");
    setMissing(orderShipping, "acct_billing_country", "{{order.shipping.acct_billing_country}}");
    if (Object.keys(orderShipping).length) {
      order.shipping = orderShipping;
    }
    body.order = order;

    const lines = Array.isArray(body.lines) ? body.lines : [];
    const firstLine = asRecord(lines[0]);
    if (Object.keys(firstLine).length) {
      setMissing(firstLine, "product_id", "{{lines[].product_id}}");
      delete firstLine.shipping;
      body.lines = [firstLine, ...lines.slice(1)];
    }

    body_template = JSON.stringify(reorderStandardBody(body), null, 2);
  } catch {
    body_template = template.body_template;
  }

  return {
    ...template,
    body_template,
    canonical_mappings
  };
}

function createDefaultSubmitProfiles(): SubmitProfile[] {
  return [
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
  ];
}

function createDefaultValueNormalizationRules(): ValueNormalizationRule[] {
  const base = {
    canonical_field: "order.shipping.method",
    output_field: "order.shipping.method",
    match_mode: "case_insensitive" as const,
    fallback_behavior: "block_submit" as const,
    status: "Active" as const,
    notes: "Lift requires the shipping method to match the configured Lift value exactly."
  };

  return [
    {
      ...base,
      value_rule_id: "value-rule-shipping-ups-ground",
      input_value: "UPS Ground, Ground, UPS GND",
      normalized_value: "UPS Ground"
    }
  ];
}

function createSeedOutputRoute(timestamp = now()): OutputRoute {
  const lift = cloneDefaultLiftConfig();
  return {
    output_route_id: outputRouteId,
    name: "Larger Than Life · Lift / 91 · High End Work",
    target_id: targetId,
    environment_id: "env-lift-qa1",
    output_template_id: "template-lift-standard-graphics",
    target_system: "Lift ERP",
    destination_account_name: "Larger Than Life",
    destination_account_id: lift.headers.Company,
    company_id: lift.headers.Company,
    output_template: "Lift High End Work",
    product_identifier_type: "lift_product_id",
    product_identifier_label: "Lift product_id",
    submit_profiles: createDefaultSubmitProfiles(),
    value_normalization_rules: createDefaultValueNormalizationRules(),
    order_lookup_url: defaultLiftOrderLookupUrl,
    proof_report_url: defaultLiftProofReportUrl,
    package_details_url: defaultLiftPackageDetailsUrl,
    shipping_report_url: defaultLiftShippingReportUrl,
    status: "Active",
    updated_at: timestamp
  };
}

function createSeedLiftUnitCatalog(timestamp = now()): LiftUnitCatalogItem[] {
  return [
    {
      catalog_item_id: "local-unit-2sheet-46x60-48pt",
      product_id: null,
      unit_number: "2SHEET_46x60_48PT",
      unit_numbers: ["2SHEET_46x60_48PT"],
      product_name: "2 Sheet Poster",
      company_id: "91",
      target_id: targetId,
      environment_id: null,
      catalog_id: null,
      catalog_name: null,
      accounting_item_code: null,
      product_type: "REGULAR",
      parent_product_id: null,
      unit_price: null,
      quantity: null,
      attribute_1: null,
      attribute_2: null,
      material_id: null,
      storage_type_id: null,
      warehouse_location_id: null,
      image_url: null,
      status: "Active",
      category: "OOH Poster",
      description: "46x60 48pt poster product for standard graphics order testing.",
      source: "Local seed",
      updated_at: timestamp
    },
    {
      catalog_item_id: "local-unit-banner-36x96-13oz",
      product_id: null,
      unit_number: "BANNER_36x96_13OZ",
      unit_numbers: ["BANNER_36x96_13OZ"],
      product_name: "13oz Vinyl Banner",
      company_id: "91",
      target_id: targetId,
      environment_id: null,
      catalog_id: null,
      catalog_name: null,
      accounting_item_code: null,
      product_type: "REGULAR",
      parent_product_id: null,
      unit_price: null,
      quantity: null,
      attribute_1: null,
      attribute_2: null,
      material_id: null,
      storage_type_id: null,
      warehouse_location_id: null,
      image_url: null,
      status: "Active",
      category: "Banner",
      description: "36x96 13oz vinyl banner product for standard graphics order testing.",
      source: "Local seed",
      updated_at: timestamp
    },
    {
      catalog_item_id: "local-unit-sandbox-smoke-poster",
      product_id: null,
      unit_number: "SANDBOX_SMOKE_POSTER",
      unit_numbers: ["SANDBOX_SMOKE_POSTER"],
      product_name: "Sandbox smoke poster",
      company_id: "91",
      target_id: targetId,
      environment_id: null,
      catalog_id: null,
      catalog_name: null,
      accounting_item_code: null,
      product_type: "REGULAR",
      parent_product_id: null,
      unit_price: null,
      quantity: null,
      attribute_1: null,
      attribute_2: null,
      material_id: null,
      storage_type_id: null,
      warehouse_location_id: null,
      image_url: null,
      status: "Active",
      category: "Sandbox",
      description: "Internal sandbox product used for non-customer-facing Lift submit checks.",
      source: "Local seed",
      updated_at: timestamp
    }
  ];
}

type WorkspaceSeedProfile = "neutral" | "momentara_legacy";

function createSeedMethod(timestamp: string, profile: WorkspaceSeedProfile = "neutral"): ImportMethod {
  const mappings = buildDefaultMappings(sampleSourceGrid.columns);
  const route = createSeedOutputRoute(timestamp);

  return {
    import_method_id: manualImportMethodId,
    name: "Manual XLSX",
    type: "Manual upload",
    source: "XLSX",
    status: "Active",
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    target_template: route.output_template,
    template_id: "template_manual_xlsx_v1",
    mappings,
    source_config: {},
    workbook_sheet_policy: "rows_with_quantity",
    product_resolution_config:
      profile === "momentara_legacy"
        ? createMomentaraProductResolutionConfig()
        : createNeutralProductResolutionConfig(),
    product_resolution_overrides: {},
    order_name_resolution_config: createDefaultOrderNameResolutionConfig(),
    ext_id_strategy: "pathfinder_generated",
    public_intake: createDefaultPublicIntakeConfig(),
    last_run_at: null,
    success_rate: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

function createSeedCatalogPresets(
  profile: WorkspaceSeedProfile,
  route: OutputRoute,
  timestamp = now()
): LiftCatalogPreset[] {
  return profile === "momentara_legacy"
    ? [
        {
          preset_id: "catalog-preset-empirical-momentara-pg-8102",
          output_route_id: route.output_route_id,
          target_id: route.target_id,
          catalog_id: "8102",
          catalog_name: "Empirical - Momentara PG",
          status: "Active",
          created_at: timestamp,
          updated_at: timestamp
        }
      ]
    : [];
}

const publicEmailDomains = new Set([
  "aol.com",
  "icloud.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "live.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "ymail.com"
]);

function normalizeEmailDomain(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  const atIndex = email.lastIndexOf("@");
  const domain = atIndex >= 0 ? email.slice(atIndex + 1) : email;
  return domain.replace(/^\.+|\.+$/g, "");
}

function inferredStatusAccessDomain(
  email: unknown,
  source: StatusAccessDomainSource,
  timestamp: string
): StatusAccessDomain | null {
  const domain = normalizeEmailDomain(email);

  if (!domain || !domain.includes(".") || publicEmailDomains.has(domain)) {
    return null;
  }

  return {
    domain,
    status: "Approved",
    source,
    created_at: timestamp,
    updated_at: timestamp
  };
}

function createDefaultStatusAccessPolicy(customer: LiftCustomer, timestamp = now()): StatusAccessPolicy {
  const inferredDomains = [inferredStatusAccessDomain(customer.default_invoice_email_address, "Customer email", timestamp)]
    .filter((domain): domain is StatusAccessDomain => Boolean(domain))
    .filter((domain, index, domains) => domains.findIndex((candidate) => candidate.domain === domain.domain) === index);

  return {
    mode: "Exact email or approved domain",
    allow_public_status_links: true,
    proof_visibility: "status_only",
    approved_email_domains: inferredDomains,
    updated_at: timestamp
  };
}

function normalizeStatusAccessPolicy(
  policy: StatusAccessPolicy | undefined,
  customer: LiftCustomer,
  timestamp = now()
): StatusAccessPolicy {
  const defaultPolicy = createDefaultStatusAccessPolicy(customer, timestamp);
  const domainsByName = new Map<string, StatusAccessDomain>();

  [...defaultPolicy.approved_email_domains, ...(policy?.approved_email_domains ?? [])].forEach((domain) => {
    const normalizedDomain = normalizeEmailDomain(domain.domain);

    if (!normalizedDomain || !normalizedDomain.includes(".") || publicEmailDomains.has(normalizedDomain)) {
      return;
    }

    domainsByName.set(normalizedDomain, {
      ...domain,
      domain: normalizedDomain,
      status: domain.status ?? "Approved",
      source: domain.source ?? "Admin",
      created_at: domain.created_at ?? timestamp,
      updated_at: domain.updated_at ?? timestamp
    });
  });

  return {
    mode: policy?.mode ?? defaultPolicy.mode,
    allow_public_status_links: policy?.allow_public_status_links ?? defaultPolicy.allow_public_status_links,
    proof_visibility:
      policy?.proof_visibility === "off" ||
      policy?.proof_visibility === "status_only" ||
      policy?.proof_visibility === "review_link"
        ? policy.proof_visibility
        : defaultPolicy.proof_visibility,
    approved_email_domains: Array.from(domainsByName.values()).sort((first, second) =>
      first.domain.localeCompare(second.domain)
    ),
    updated_at: policy?.updated_at ?? defaultPolicy.updated_at
  };
}

function safeProofCapabilityActor(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:@-]{1,180}$/.test(normalized) ? normalized : "unknown-operator";
}

function normalizedProofAccessMode(value: unknown): CustomerProofAccessMode {
  return value === "disabled" || value === "view_only" || value === "review"
    ? value
    : "view_only";
}

function normalizedProofReviewExperience(
  value: unknown,
  accessMode: CustomerProofAccessMode
): CustomerProofReviewExperience {
  if (accessMode !== "review") return "simple";
  return value === "advanced" ? "advanced" : "simple";
}

function createDefaultCustomerProofCapabilityPolicy(timestamp = now()): CustomerProofCapabilityPolicy {
  return {
    access_mode: "view_only",
    review_experience: "simple",
    customer_identity: null,
    order_overrides: [],
    updated_at: timestamp,
    updated_by: "system-default"
  };
}

function normalizeCustomerProofCapabilityPolicy(
  policy: CustomerProofCapabilityPolicy | undefined,
  timestamp = now()
): CustomerProofCapabilityPolicy {
  const accessMode = normalizedProofAccessMode(policy?.access_mode);
  const overrides = new Map<string, CustomerProofOrderOverride>();
  for (const candidate of policy?.order_overrides ?? []) {
    const orderNumber = candidate?.order_number?.trim().toUpperCase();
    if (!/^A\d{7,8}$/.test(orderNumber)) continue;
    const overrideAccessMode = normalizedProofAccessMode(candidate.access_mode);
    overrides.set(orderNumber, {
      order_number: orderNumber,
      access_mode: overrideAccessMode,
      review_experience: normalizedProofReviewExperience(
        candidate.review_experience,
        overrideAccessMode
      ),
      updated_at: Number.isFinite(Date.parse(candidate.updated_at))
        ? new Date(candidate.updated_at).toISOString()
        : timestamp,
      updated_by: safeProofCapabilityActor(candidate.updated_by)
    });
  }
  return {
    access_mode: accessMode,
    review_experience: normalizedProofReviewExperience(
      policy?.review_experience,
      accessMode
    ),
    customer_identity: normalizeProofCustomerIdentity(policy?.customer_identity),
    order_overrides: [...overrides.values()]
      .sort((left, right) => left.order_number.localeCompare(right.order_number))
      .slice(0, 100),
    updated_at: Number.isFinite(Date.parse(policy?.updated_at ?? ""))
      ? new Date(policy!.updated_at).toISOString()
      : timestamp,
    updated_by: safeProofCapabilityActor(policy?.updated_by ?? "system-default")
  };
}

function normalizedProofCapabilityAudit(
  entries: CustomerProofCapabilityAuditEntry[] | undefined
) {
  return (entries ?? [])
    .filter((entry) =>
      /^pcap_[a-f0-9]{24}$/.test(entry?.change_id ?? "") &&
      (entry.scope === "customer" || entry.scope === "order" || entry.scope === "identity") &&
      (entry.order_number === null || /^A\d{7,8}$/.test(entry.order_number)) &&
      Number.isFinite(Date.parse(entry.created_at))
    )
    .slice(0, 100);
}

function normalizeProofCustomerIdentity(
  identity: CustomerProofCustomerIdentity | null | undefined
): CustomerProofCustomerIdentity | null {
  const proofCustomerId = identity?.proof_customer_id?.trim() ?? "";
  const orderNumber = identity?.verified_order_number?.trim().toUpperCase() ?? "";
  if (
    !/^\d{1,20}$/.test(proofCustomerId) ||
    !/^A\d{7,8}$/.test(orderNumber) ||
    !Number.isFinite(Date.parse(identity?.verified_at ?? ""))
  ) {
    return null;
  }
  return {
    proof_customer_id: proofCustomerId,
    verified_order_number: orderNumber,
    verified_at: new Date(identity!.verified_at).toISOString(),
    verified_by: safeProofCapabilityActor(identity?.verified_by)
  };
}

function assertCustomerProofCapabilityInput(
  accessMode: unknown,
  reviewExperience: unknown
) {
  if (
    accessMode !== "disabled" &&
    accessMode !== "view_only" &&
    accessMode !== "review"
  ) {
    throw new CustomerProofCapabilityValidationError(
      "Proof access must be Disabled, View only, or Review enabled."
    );
  }
  if (reviewExperience !== "simple" && reviewExperience !== "advanced") {
    throw new CustomerProofCapabilityValidationError(
      "Proof review experience must be Simple or Advanced."
    );
  }
  if (accessMode !== "review" && reviewExperience === "advanced") {
    throw new CustomerProofCapabilityValidationError(
      "Advanced review requires Proof review access to be enabled."
    );
  }
}

export class CustomerProofCapabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerProofCapabilityValidationError";
  }
}

export class CustomerProofCapabilityConflictError extends Error {
  constructor() {
    super("Vornan Proof settings changed after this customer page was loaded. Refresh and try again.");
    this.name = "CustomerProofCapabilityConflictError";
  }
}

export class CustomerProofCapabilityPersistenceError extends Error {
  constructor() {
    super("Vornan Proof settings could not be saved right now. Refresh the customer page before trying again.");
    this.name = "CustomerProofCapabilityPersistenceError";
  }
}

function proofCapabilityAuditEntry(input: {
  scope: "customer" | "order" | "identity";
  order_number: string | null;
  previous_access_mode: CustomerProofAccessMode;
  next_access_mode: CustomerProofAccessMode;
  previous_review_experience: CustomerProofReviewExperience;
  next_review_experience: CustomerProofReviewExperience;
  actor_id: string;
  created_at: string;
  previous_proof_customer_id?: string | null;
  next_proof_customer_id?: string | null;
  verification_order_number?: string | null;
}): CustomerProofCapabilityAuditEntry {
  return {
    change_id: `pcap_${randomBytes(12).toString("hex")}`,
    ...input,
    actor_id: safeProofCapabilityActor(input.actor_id)
  };
}

function createWorkspace(
  customer: LiftCustomer,
  profile: WorkspaceSeedProfile = "neutral"
): PathfinderCustomerWorkspace {
  const timestamp = now();
  const method = createSeedMethod(timestamp, profile);
  const route = createSeedOutputRoute(timestamp);
  const catalogPresets = createSeedCatalogPresets(profile, route, timestamp);

  return {
    customer,
    source_connections: [],
    import_methods: [method],
    output_routes: [route],
    templates: [
      {
        template_id: method.template_id,
        name: "Manual XLSX Field Mapping",
        version: "1.0.0",
        status: "Draft",
        mappings: method.mappings,
        updated_at: timestamp
      }
    ],
    jobs: [],
    submit_attempts: [],
    product_mappings: [],
    catalog_presets: catalogPresets,
    status_access_policy: createDefaultStatusAccessPolicy(customer, timestamp),
    proof_capability_policy: createDefaultCustomerProofCapabilityPolicy(timestamp),
    proof_capability_audit: [],
    primary_target_id: targetId,
    primary_output_route_id: route.output_route_id,
    updated_at: timestamp
  };
}

function createSeedStore(): PathfinderStore {
  const timestamp = now();
  return {
    version: 1,
    targets: {
      [targetId]: createSeedTarget(),
      [ecommerceTargetId]: createSeedEcommerceTarget()
    },
    workspaces: {},
    jobs: [],
    submit_attempts: [],
    lift_unit_catalog: createSeedLiftUnitCatalog(timestamp),
    order_status_tokens: [],
    public_intake_email_verifications: [],
    order_status_snapshots: [],
    canonical_registry: {
      overrides: {},
      custom_fields: [],
      snapshots: [],
      history: [],
      updated_at: timestamp
    }
  };
}

interface DynamoTableConfig {
  customers: string;
  workspaces: string;
  targets: string;
  import_methods: string;
  output_routes: string;
  product_mappings: string;
  jobs: string;
  order_ids: string;
  submit_attempts: string;
  lift_product_cache: string;
  order_status_tokens: string;
  order_status_snapshots: string;
  canonical_registry: string;
}

let dynamoClient: DynamoDBClient | null = null;

function getDynamoClient() {
  dynamoClient ??= new DynamoDBClient({});
  return dynamoClient;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be configured when PATHFINDER_STORAGE_DRIVER=dynamodb.`);
  }
  return value;
}

function getDynamoTableConfig(): DynamoTableConfig {
  return {
    customers: requireEnv("PATHFINDER_CUSTOMERS_TABLE"),
    workspaces: requireEnv("PATHFINDER_CUSTOMER_WORKSPACES_TABLE"),
    targets: requireEnv("PATHFINDER_TARGETS_TABLE"),
    import_methods: requireEnv("PATHFINDER_IMPORT_METHODS_TABLE"),
    output_routes: requireEnv("PATHFINDER_OUTPUT_ROUTES_TABLE"),
    product_mappings: requireEnv("PATHFINDER_PRODUCT_MAPPINGS_TABLE"),
    jobs: requireEnv("PATHFINDER_JOBS_TABLE"),
    order_ids: requireEnv("PATHFINDER_ORDER_IDS_TABLE"),
    submit_attempts: requireEnv("PATHFINDER_SUBMIT_ATTEMPTS_TABLE"),
    lift_product_cache: requireEnv("PATHFINDER_LIFT_PRODUCT_CACHE_TABLE"),
    order_status_tokens: requireEnv("PATHFINDER_ORDER_STATUS_TOKENS_TABLE"),
    order_status_snapshots: requireEnv("PATHFINDER_ORDER_STATUS_SNAPSHOTS_TABLE"),
    canonical_registry: requireEnv("PATHFINDER_CANONICAL_REGISTRY_TABLE")
  };
}

function dynamoString(value: string | number | null | undefined) {
  return { S: String(value ?? "") };
}

function dynamoItem(keys: Record<string, string>, data: unknown): Record<string, AttributeValue> {
  return {
    ...Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, dynamoString(value)])),
    data: { S: JSON.stringify(data) },
    updated_at: dynamoString(now())
  };
}

function parseDynamoData<T>(item: Record<string, AttributeValue>): T | null {
  const data = item.data?.S;
  if (!data) {
    return null;
  }
  return JSON.parse(data) as T;
}

async function scanDynamoTable(tableName: string) {
  const items: Record<string, AttributeValue>[] = [];
  let ExclusiveStartKey: Record<string, AttributeValue> | undefined;

  do {
    const response = await getDynamoClient().send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey
      })
    );
    items.push(...((response.Items ?? []) as Record<string, AttributeValue>[]));
    ExclusiveStartKey = response.LastEvaluatedKey as Record<string, AttributeValue> | undefined;
  } while (ExclusiveStartKey);

  return items;
}

async function getDynamoData<T>(tableName: string, key: Record<string, string>, consistentRead = false) {
  const response = await getDynamoClient().send(
    new GetItemCommand({
      TableName: tableName,
      Key: Object.fromEntries(Object.entries(key).map(([keyName, value]) => [keyName, dynamoString(value)])),
      ConsistentRead: consistentRead
    })
  );

  return response.Item ? parseDynamoData<T>(response.Item as Record<string, AttributeValue>) : null;
}

async function putDynamoData(tableName: string, keys: Record<string, string>, data: unknown, extra?: Record<string, AttributeValue>) {
  await getDynamoClient().send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        ...dynamoItem(keys, data),
        ...(extra ?? {})
      }
    })
  );
}

function pathfinderOrderNumberCandidate(timestamp = Date.now()) {
  return `PF${timestamp.toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`;
}

export function createUnreservedPathfinderOrderNumberCandidate() {
  return pathfinderOrderNumberCandidate();
}

const locallyReservedPathfinderOrderNumbers = new Set<string>();

export function getLocalReservedPathfinderOrderNumberCount() {
  return locallyReservedPathfinderOrderNumbers.size;
}

export async function reservePathfinderOrderNumber() {
  const config = getPathfinderPersistenceRuntimeConfig();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pathfinderOrderNumber = pathfinderOrderNumberCandidate();

    if (config.storage_driver === "dynamodb") {
      try {
        const tables = getDynamoTableConfig();
        await getDynamoClient().send(
          new PutItemCommand({
            TableName: tables.order_ids,
            Item: {
              pathfinder_order_id: dynamoString(pathfinderOrderNumber),
              created_at: dynamoString(now())
            },
            ConditionExpression: "attribute_not_exists(pathfinder_order_id)"
          })
        );
        return pathfinderOrderNumber;
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
          continue;
        }
        throw error;
      }
    }

    const store = await readStore();
    if (
      !locallyReservedPathfinderOrderNumbers.has(pathfinderOrderNumber) &&
      !store.jobs.some((job) => job.pathfinder_order_id === pathfinderOrderNumber)
    ) {
      locallyReservedPathfinderOrderNumbers.add(pathfinderOrderNumber);
      return pathfinderOrderNumber;
    }
  }

  throw new Error("Pathfinder could not reserve a unique Order Number. Try the preview again.");
}

async function batchWriteDynamo(tableName: string, requests: WriteRequest[]) {
  for (let index = 0; index < requests.length; index += 25) {
    let requestItems: Record<string, WriteRequest[]> = {
      [tableName]: requests.slice(index, index + 25)
    };

    do {
      const response = await getDynamoClient().send(new BatchWriteItemCommand({ RequestItems: requestItems }));
      requestItems = response.UnprocessedItems ?? {};
    } while (Object.keys(requestItems).length > 0);
  }
}

async function replaceDynamoTable(
  tableName: string,
  keyAttributes: string[],
  putItems: Array<Record<string, AttributeValue>>
) {
  const existingItems = await scanDynamoTable(tableName);
  const deleteRequests = existingItems.map((item) => ({
    DeleteRequest: {
      Key: Object.fromEntries(keyAttributes.map((key) => [key, item[key] ?? dynamoString("")]))
    }
  }));
  await batchWriteDynamo(tableName, deleteRequests);

  const putRequests = putItems.map((item) => ({
    PutRequest: {
      Item: item
    }
  }));
  await batchWriteDynamo(tableName, putRequests);
}

async function upsertDynamoTable(tableName: string, putItems: Array<Record<string, AttributeValue>>) {
  const putRequests = putItems.map((item) => ({
    PutRequest: {
      Item: item
    }
  }));
  await batchWriteDynamo(tableName, putRequests);
}

function durableRecordUpdatedAt(item: Record<string, AttributeValue>) {
  const data = parseDynamoData<Record<string, unknown>>(item);
  const candidate = data?.updated_at ?? data?.created_at;
  return typeof candidate === "string" && candidate.trim() ? candidate : item.updated_at?.S ?? now();
}

async function upsertDynamoTableMonotonic(
  tableName: string,
  putItems: Array<Record<string, AttributeValue>>
) {
  await Promise.all(
    putItems.map(async (item) => {
      const recordUpdatedAt = durableRecordUpdatedAt(item);
      try {
        await getDynamoClient().send(
          new PutItemCommand({
            TableName: tableName,
            Item: {
              ...item,
              record_updated_at: dynamoString(recordUpdatedAt)
            },
            // Whole-store persistence may race with a newer focused save. The
            // semantic record timestamp makes stale snapshots harmless. The
            // legacy updated_at comparison safely bootstraps records created
            // before record_updated_at without granting one stale overwrite.
            ConditionExpression:
              "(#recordUpdatedAt <= :recordUpdatedAt) OR " +
              "(attribute_not_exists(#recordUpdatedAt) AND " +
              "(attribute_not_exists(#writeUpdatedAt) OR #writeUpdatedAt <= :recordUpdatedAt))",
            ExpressionAttributeNames: {
              "#recordUpdatedAt": "record_updated_at",
              "#writeUpdatedAt": "updated_at"
            },
            ExpressionAttributeValues: {
              ":recordUpdatedAt": dynamoString(recordUpdatedAt)
            }
          })
        );
      } catch (error) {
        if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
          return;
        }
        throw error;
      }
    })
  );
}

function workspaceRecord(
  workspace: PathfinderCustomerWorkspace
): Omit<PathfinderCustomerWorkspace, "import_methods" | "output_routes" | "jobs" | "submit_attempts" | "product_mappings"> {
  const { import_methods, output_routes, jobs, submit_attempts, product_mappings, ...record } = workspace;
  return {
    ...record,
    product_mapping_replacement_checkpoint: record.product_mapping_replacement_checkpoint
      ? { ...record.product_mapping_replacement_checkpoint, before_mappings: [] }
      : null
  };
}

function customerRouteKey(customerId: string, outputRouteId: string, replacementVersionId?: string | null) {
  const base = `${customerId}#${outputRouteId}`;
  return replacementVersionId ? `${base}#version#${replacementVersionId}` : base;
}

function mappingReplacementVersion(mapping: CustomerProductMapping) {
  return mapping.replacement_version_id ?? null;
}

function activeProductMappingVersion(workspace: PathfinderCustomerWorkspace, outputRouteId: string) {
  return workspace.product_mapping_active_versions?.[outputRouteId] ?? null;
}

function mappingsForVersion(
  mappings: CustomerProductMapping[],
  outputRouteId: string,
  replacementVersionId: string | null
) {
  return mappings.filter(
    (mapping) =>
      mapping.output_route_id === outputRouteId && mappingReplacementVersion(mapping) === replacementVersionId
  );
}

function liftProductCachePartition(item: LiftUnitCatalogItem) {
  return [item.target_id, item.environment_id ?? "any-env", item.company_id].join("#");
}

function liftProductCacheSort(item: LiftUnitCatalogItem) {
  return item.product_id ?? item.unit_number ?? item.catalog_item_id;
}

function liftProductCacheIdentity(item: LiftUnitCatalogItem) {
  return `${liftProductCachePartition(item)}\0${liftProductCacheSort(item)}`;
}

function pushByCustomer<T>(map: Map<string, T[]>, customerId: string | undefined, item: T) {
  if (!customerId) {
    return;
  }
  const items = map.get(customerId) ?? [];
  items.push(item);
  map.set(customerId, items);
}

async function readDynamoStore(): Promise<PathfinderStore | null> {
  const tables = getDynamoTableConfig();
  const [
    customerItems,
    workspaceItems,
    targetItems,
    importMethodItems,
    outputRouteItems,
    productMappingItems,
    jobItems,
    submitAttemptItems,
    liftProductItems,
    canonicalRegistryItems
  ] = await Promise.all([
    scanDynamoTable(tables.customers),
    scanDynamoTable(tables.workspaces),
    scanDynamoTable(tables.targets),
    scanDynamoTable(tables.import_methods),
    scanDynamoTable(tables.output_routes),
    scanDynamoTable(tables.product_mappings),
    scanDynamoTable(tables.jobs),
    scanDynamoTable(tables.submit_attempts),
    scanDynamoTable(tables.lift_product_cache),
    scanDynamoTable(tables.canonical_registry)
  ]);

  if (
    targetItems.length === 0 &&
    workspaceItems.length === 0 &&
    customerItems.length === 0 &&
    canonicalRegistryItems.length === 0
  ) {
    return null;
  }

  const targets = Object.fromEntries(
    targetItems
      .map((item) => parseDynamoData<TargetConfig>(item))
      .filter((target): target is TargetConfig => Boolean(target))
      .map((target) => [target.target_id, target])
  ) as Record<string, TargetConfig>;

  const customers = Object.fromEntries(
    customerItems
      .map((item) => parseDynamoData<LiftCustomer>(item))
      .filter((customer): customer is LiftCustomer => Boolean(customer))
      .map((customer) => [customer.lift_customer_id, customer])
  ) as Record<string, LiftCustomer>;

  const importMethodsByCustomer = new Map<string, ImportMethod[]>();
  importMethodItems
    .map((item) => parseDynamoData<ImportMethod & { customer_id?: string }>(item))
    .filter((method): method is ImportMethod & { customer_id: string } => Boolean(method?.customer_id))
    .forEach((method) => pushByCustomer(importMethodsByCustomer, method.customer_id, method));

  const outputRoutesByCustomer = new Map<string, OutputRoute[]>();
  outputRouteItems
    .map((item) => parseDynamoData<OutputRoute & { customer_id?: string }>(item))
    .filter((route): route is OutputRoute & { customer_id: string } => Boolean(route?.customer_id))
    .forEach((route) => pushByCustomer(outputRoutesByCustomer, route.customer_id, route));

  const productMappingsByCustomer = new Map<string, CustomerProductMapping[]>();
  productMappingItems
    .map((item) => parseDynamoData<CustomerProductMapping & { customer_id?: string }>(item))
    .filter((mapping): mapping is CustomerProductMapping & { customer_id: string } => Boolean(mapping?.customer_id))
    .forEach((mapping) => pushByCustomer(productMappingsByCustomer, mapping.customer_id, mapping));

  const jobs = jobItems
    .map((item) => parseDynamoData<ProcessingJobPreview>(item))
    .filter((job): job is ProcessingJobPreview => Boolean(job));
  const jobsByCustomer = new Map<string, ProcessingJobPreview[]>();
  jobs.forEach((job) => pushByCustomer(jobsByCustomer, job.customer_id, job));

  const submitAttempts = submitAttemptItems
    .map((item) => parseDynamoData<SubmitAttempt>(item))
    .filter((attempt): attempt is SubmitAttempt => Boolean(attempt));
  const submitAttemptsByCustomer = new Map<string, SubmitAttempt[]>();
  submitAttempts.forEach((attempt) => pushByCustomer(submitAttemptsByCustomer, attempt.customer_id, attempt));

  const workspaces = Object.fromEntries(
    workspaceItems
      .map((item) => parseDynamoData<PathfinderCustomerWorkspace>(item))
      .filter((workspace): workspace is PathfinderCustomerWorkspace => Boolean(workspace?.customer?.lift_customer_id))
      .map((workspace) => {
        const customerId = workspace.customer.lift_customer_id;
        const allCustomerMappings = productMappingsByCustomer.get(customerId) ?? [];
        const customerRoutes = outputRoutesByCustomer.get(customerId) ?? [];
        const activeMappings = customerRoutes.flatMap((route) =>
          mappingsForVersion(allCustomerMappings, route.output_route_id, activeProductMappingVersion(workspace, route.output_route_id))
        );
        const checkpoint = workspace.product_mapping_replacement_checkpoint;
        const beforeMappings = checkpoint
          ? mappingsForVersion(
              allCustomerMappings,
              checkpoint.output_route_id,
              checkpoint.previous_version_id ?? null
            )
          : [];
        return [
          customerId,
          {
            ...workspace,
            customer: customers[customerId] ?? workspace.customer,
            import_methods: importMethodsByCustomer.get(customerId) ?? [],
            output_routes: customerRoutes,
            product_mappings: activeMappings,
            product_mapping_replacement_checkpoint: checkpoint
              ? { ...checkpoint, before_mappings: beforeMappings }
              : null,
            jobs: jobsByCustomer.get(customerId) ?? [],
            submit_attempts: submitAttemptsByCustomer.get(customerId) ?? []
          }
        ] as const;
      })
  ) as Record<string, PathfinderCustomerWorkspace>;

  const liftUnitCatalog = liftProductItems
    .map((item) => parseDynamoData<LiftUnitCatalogItem>(item))
    .filter((item): item is LiftUnitCatalogItem => Boolean(item));

  const canonicalRegistry =
    canonicalRegistryItems
      .map((item) => parseDynamoData<PathfinderStore["canonical_registry"]>(item))
      .find((registry): registry is NonNullable<PathfinderStore["canonical_registry"]> => Boolean(registry)) ?? undefined;

  return {
    version: 1,
    targets,
    workspaces,
    jobs,
    submit_attempts: submitAttempts,
    lift_unit_catalog: liftUnitCatalog,
    order_status_tokens: [],
    public_intake_email_verifications: [],
    order_status_snapshots: [],
    canonical_registry: canonicalRegistry
  };
}

async function writeDynamoStore(store: PathfinderStore) {
  const tables = getDynamoTableConfig();
  const workspaces = Object.values(store.workspaces);
  const retainedProductMappings = Array.from(
    new Map(
      workspaces.flatMap((workspace) =>
        [
          ...workspace.product_mappings,
          ...(workspace.product_mapping_replacement_checkpoint?.before_mappings ?? [])
        ].map((mapping) => [
          `${workspace.customer.lift_customer_id}\0${mapping.output_route_id}\0${mapping.replacement_version_id ?? "legacy"}\0${mapping.mapping_id}`,
          { workspace, mapping }
        ] as const)
      )
    ).values()
  );

  await upsertDynamoTableMonotonic(
    tables.targets,
    Object.values(store.targets).map((target) => dynamoItem({ target_id: target.target_id }, target))
  );
  // Customers and customer workspaces are lifecycle records. Upsert them so
  // readers never observe a delete/rewrite gap and seed a partial workspace.
  await upsertDynamoTable(
    tables.customers,
    workspaces.map((workspace) =>
      dynamoItem({ customer_id: workspace.customer.lift_customer_id }, workspace.customer)
    )
  );
  const durableWorkspaceRecords = await Promise.all(workspaces.map(async (workspace) => {
    const customerId = workspace.customer.lift_customer_id;
    const current = await getDynamoClient().send(new GetItemCommand({
      TableName: tables.workspaces,
      Key: { customer_id: dynamoString(customerId) },
      ConsistentRead: true
    }));
    const stored = current.Item ? parseDynamoData<PathfinderCustomerWorkspace>(current.Item) : null;
    const record = workspaceRecord(workspace);
    // Product-list replacement has its own conditional persistence boundary.
    // Generic whole-store saves must preserve that durable version pointer and
    // history so a stale or partial workspace cannot hide the active catalog.
    if (stored) {
      record.product_mapping_active_versions = stored.product_mapping_active_versions ?? {};
      record.product_mapping_replacement_checkpoint = stored.product_mapping_replacement_checkpoint ?? null;
      record.product_mapping_replacement_history = stored.product_mapping_replacement_history ?? [];
    }
    return dynamoItem({ customer_id: customerId }, record);
  }));
  await upsertDynamoTableMonotonic(tables.workspaces, durableWorkspaceRecords);
  // Import methods are lifecycle records: removal is represented by an
  // Archived status, not by deleting the DynamoDB item. Upsert them so a
  // concurrent writer holding an older workspace snapshot cannot erase a
  // newly saved method during an unrelated whole-store persistence pass.
  await upsertDynamoTableMonotonic(
    tables.import_methods,
    workspaces.flatMap((workspace) =>
      workspace.import_methods.map((method) =>
        dynamoItem(
          { customer_id: workspace.customer.lift_customer_id, import_method_id: method.import_method_id },
          { ...method, customer_id: workspace.customer.lift_customer_id }
        )
      )
    )
  );
  await upsertDynamoTableMonotonic(
    tables.output_routes,
    workspaces.flatMap((workspace) =>
      workspace.output_routes.map((route) =>
        dynamoItem(
          { customer_id: workspace.customer.lift_customer_id, output_route_id: route.output_route_id },
          { ...route, customer_id: workspace.customer.lift_customer_id }
        )
      )
    )
  );
  // Versioned product mappings are durable lifecycle records. Active-version
  // pointers select the visible catalog; unrelated saves must never delete a
  // complete prior version while persisting a partial workspace snapshot.
  await upsertDynamoTable(
    tables.product_mappings,
    retainedProductMappings.map(({ workspace, mapping }) =>
        dynamoItem(
          {
            customer_route_id: customerRouteKey(
              workspace.customer.lift_customer_id,
              mapping.output_route_id,
              mapping.replacement_version_id
            ),
            mapping_id: mapping.mapping_id
          },
          { ...mapping, customer_id: workspace.customer.lift_customer_id }
        )
    )
  );
  // Jobs are archived in place and must remain durable across unrelated saves.
  await upsertDynamoTableMonotonic(
    tables.jobs,
    store.jobs.map((job) =>
      dynamoItem(
        { customer_id: job.customer_id, job_id: job.job_id },
        compactProcessingJobForDynamo(job)
      )
    )
  );
  // Submit attempts are an append/update-only durability boundary. They are
  // written individually and must not be replaced by an unrelated workspace save.
  await replaceDynamoTable(
    tables.lift_product_cache,
    ["route_environment_id", "product_id"],
    store.lift_unit_catalog.map((item) =>
      dynamoItem(
        { route_environment_id: liftProductCachePartition(item), product_id: liftProductCacheSort(item) },
        item
      )
    )
  );
  await upsertDynamoTableMonotonic(
    tables.canonical_registry,
    store.canonical_registry ? [dynamoItem({ registry_id: "default" }, store.canonical_registry)] : []
  );
}

export function maskTargetConfig(target: TargetConfig): TargetConfig {
  return {
    ...target,
    environments: target.environments.map((environment) => ({
      ...environment,
      credentials: {
        ...environment.credentials,
        Password: environment.credentials.Password ? "********" : environment.credentials.Password,
        token: environment.credentials.token ? "********" : environment.credentials.token,
        api_key: environment.credentials.api_key ? "********" : environment.credentials.api_key
      },
      headers: {
        ...environment.headers,
        Password: environment.headers.Password ? "********" : environment.headers.Password
      }
    })),
    lift: {
      ...target.lift,
      credentials: {
        ...target.lift.credentials,
        Password: "********"
      }
    }
  };
}

function normalizeTarget(target: TargetConfig): TargetConfig {
  const seed = createSeedTarget();
  const lift: LiftTargetConfig = {
    ...seed.lift,
    ...(target.lift ?? {}),
    environments: {
      ...seed.lift.environments,
      ...(target.lift?.environments ?? {})
    },
    headers: {
      ...seed.lift.headers,
      ...(target.lift?.headers ?? {}),
      Ext_ID: {
        ...seed.lift.headers.Ext_ID,
        ...(target.lift?.headers?.Ext_ID ?? {})
      }
    },
    credentials: {
      ...seed.lift.credentials,
      ...(target.lift?.credentials ?? {})
    },
    order_date_format:
      target.lift?.order_date_format === "YYYY-MM-DD" ? "YYYY-MM-DD" : "MM/DD/YYYY"
  };

  return {
    ...seed,
    ...target,
    target_type: target.target_type ?? seed.target_type,
    health_status: target.health_status ?? "Untested",
    environments: target.environments?.length ? target.environments : createSeedEnvironments(lift),
    output_templates: (target.output_templates?.length
      ? target.output_templates
      : [createSeedOutputTemplate(target.updated_at ?? now())]
    ).map(normalizeStandardOutputTemplate),
    lift,
    last_test_at: target.last_test_at ?? null
  };
}

function normalizeSourceHeaderRow(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const row = Number(value);
  return Number.isInteger(row) && row >= 1 ? row : null;
}

function normalizeSourceSheetHeaderOverrides(value: unknown): Record<string, SourceSheetHeaderOverride> {
  return Object.fromEntries(
    Object.entries(asRecord(value))
      .map(([sheetName, rawOverride]) => {
        const normalizedSheetName = sheetName.trim();
        const override = asRecord(rawOverride);
        if (!normalizedSheetName || Object.keys(override).length === 0) {
          return null;
        }

        return [
          normalizedSheetName,
          {
            header_row: normalizeSourceHeaderRow(override.header_row),
            header_row_count: override.header_row_count === 2 ? 2 : 1
          }
        ] as const;
      })
      .filter((entry): entry is readonly [string, SourceSheetHeaderOverride] => entry !== null)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeSourceWorkbookStructure(value: unknown): Record<string, SourceWorkbookSheetConfig> {
  return Object.fromEntries(
    Object.entries(asRecord(value))
      .map(([sheetName, rawSheet]) => {
        const normalizedSheetName = sheetName.trim();
        const sheet = asRecord(rawSheet);
        if (!normalizedSheetName || Object.keys(sheet).length === 0) {
          return null;
        }
        const role =
          sheet.role === "shipping_attachment" ||
          sheet.role === "reference_catalog" ||
          sheet.role === "ignore"
            ? sheet.role
            : ("order_lines" as const);
        const sections = (Array.isArray(sheet.sections) ? sheet.sections : [])
          .map((rawSection, index) => {
            const section = asRecord(rawSection);
            const sectionId =
              typeof section.section_id === "string"
                ? section.section_id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64)
                : "";
            if (!sectionId) {
              return null;
            }
            const lineKind =
              section.line_kind === "hardware" || section.line_kind === "custom"
                ? section.line_kind
                : ("print" as const);
            return {
              section_id: sectionId,
              label:
                typeof section.label === "string" && section.label.trim()
                  ? section.label.trim().slice(0, 100)
                  : `Section ${index + 1}`,
              line_kind: lineKind,
              header_row: normalizeSourceHeaderRow(section.header_row),
              header_row_count: section.header_row_count === 2 ? (2 as const) : (1 as const),
              header_signature: Array.isArray(section.header_signature)
                ? section.header_signature
                    .filter((column): column is string => typeof column === "string")
                    .map((column) => column.trim())
                    .filter(Boolean)
                    .slice(0, 100)
                : [],
              quantity_column:
                typeof section.quantity_column === "string" && section.quantity_column.trim()
                  ? section.quantity_column.trim().slice(0, 120)
                  : null,
              quantity_value_rules: Array.isArray(section.quantity_value_rules)
                ? section.quantity_value_rules
                    .map((rawRule) => {
                      const rule = asRecord(rawRule);
                      const sourceValue =
                        typeof rule.source_value === "string"
                          ? rule.source_value.trim().replace(/\s+/g, " ").slice(0, 40)
                          : "";
                      const outputQuantity = Number(rule.output_quantity);
                      return sourceValue && Number.isFinite(outputQuantity) && outputQuantity > 0
                        ? { source_value: sourceValue, output_quantity: outputQuantity }
                        : null;
                    })
                    .filter(
                      (rule): rule is { source_value: string; output_quantity: number } => rule !== null
                    )
                    .slice(0, 10)
                : [],
              missing_quantity_behavior:
                section.missing_quantity_behavior === "block" ? ("block" as const) : ("reference" as const),
              required: section.required === true
            } as SourceWorkbookSectionConfig;
          })
          .filter((section): section is SourceWorkbookSectionConfig => section !== null)
          .sort((left, right) => (left.header_row ?? Number.MAX_SAFE_INTEGER) - (right.header_row ?? Number.MAX_SAFE_INTEGER));

        return [
          normalizedSheetName,
          {
            role,
            enabled: sheet.enabled !== false && role !== "ignore",
            sections
          }
        ] as const;
      })
      .filter((entry): entry is readonly [string, SourceWorkbookSheetConfig] => entry !== null)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function normalizeDetectedSourceSchema(value: unknown): DetectedSourceSchema | null {
  const schema = asRecord(value);
  if (Object.keys(schema).length === 0) {
    return null;
  }

  const parserConfig = asRecord(schema.parser_config);
  const normalizedParserConfig: DetectedSourceParserConfig | undefined = Object.keys(parserConfig).length
    ? {
        header_row: normalizeSourceHeaderRow(parserConfig.header_row),
        header_row_count: parserConfig.header_row_count === 2 ? (2 as const) : (1 as const),
        quantity_column: typeof parserConfig.quantity_column === "string" ? parserConfig.quantity_column : null,
        ignore_repeated_headers: parserConfig.ignore_repeated_headers !== false,
        reference_rows_mode:
          parserConfig.reference_rows_mode === "ignore" ? ("ignore" as const) : ("rows_without_quantity" as const),
        sheet_header_overrides: normalizeSourceSheetHeaderOverrides(parserConfig.sheet_header_overrides),
        ...(parserConfig.workbook_structure !== undefined
          ? { workbook_structure: normalizeSourceWorkbookStructure(parserConfig.workbook_structure) }
          : {})
      }
    : undefined;

  const sheets = Array.isArray(schema.sheets)
    ? schema.sheets.map((value) => {
        const sheet = asRecord(value);
        const headerRow = normalizeSourceHeaderRow(sheet.header_row);
        const role: NonNullable<DetectedSourceSchemaSheet["role"]> =
          sheet.role === "shipping_attachment" ||
          sheet.role === "reference_catalog" ||
          sheet.role === "ignore"
            ? sheet.role
            : "order_lines";
        return {
          sheet_name: typeof sheet.sheet_name === "string" ? sheet.sheet_name : "",
          role,
          columns: Array.isArray(sheet.columns)
            ? sheet.columns.filter((column): column is string => typeof column === "string")
            : [],
          order_row_count:
            typeof sheet.order_row_count === "number" && Number.isFinite(sheet.order_row_count)
              ? Math.max(0, Math.floor(sheet.order_row_count))
              : 0,
          reference_row_count:
            typeof sheet.reference_row_count === "number" && Number.isFinite(sheet.reference_row_count)
              ? Math.max(0, Math.floor(sheet.reference_row_count))
              : 0,
          incomplete_row_count:
            typeof sheet.incomplete_row_count === "number" && Number.isFinite(sheet.incomplete_row_count)
              ? Math.max(0, Math.floor(sheet.incomplete_row_count))
              : 0,
          sections: Array.isArray(sheet.sections)
            ? sheet.sections
                .map((rawSection) => {
                  const section = asRecord(rawSection);
                  const headerRow = normalizeSourceHeaderRow(section.header_row);
                  const sectionId = typeof section.section_id === "string" ? section.section_id.trim() : "";
                  if (!headerRow || !sectionId) {
                    return null;
                  }
                  return {
                    scope_id: typeof section.scope_id === "string" ? section.scope_id : "",
                    section_id: sectionId,
                    label: typeof section.label === "string" ? section.label : sectionId,
                    line_kind:
                      section.line_kind === "hardware" || section.line_kind === "custom"
                        ? section.line_kind
                        : ("print" as const),
                    columns: Array.isArray(section.columns)
                      ? section.columns.filter((column): column is string => typeof column === "string")
                      : [],
                    header_row: headerRow,
                    header_row_count: section.header_row_count === 2 ? (2 as const) : (1 as const),
                    quantity_column:
                      typeof section.quantity_column === "string" ? section.quantity_column : null,
                    quantity_value_rules: Array.isArray(section.quantity_value_rules)
                      ? section.quantity_value_rules
                          .map((rawRule) => {
                            const rule = asRecord(rawRule);
                            const sourceValue =
                              typeof rule.source_value === "string" ? rule.source_value.trim().slice(0, 40) : "";
                            const outputQuantity = Number(rule.output_quantity);
                            return sourceValue && Number.isFinite(outputQuantity) && outputQuantity > 0
                              ? { source_value: sourceValue, output_quantity: outputQuantity }
                              : null;
                          })
                          .filter(
                            (rule): rule is { source_value: string; output_quantity: number } => rule !== null
                          )
                          .slice(0, 10)
                      : [],
                    missing_quantity_behavior:
                      section.missing_quantity_behavior === "block" ? ("block" as const) : ("reference" as const),
                    order_row_count:
                      typeof section.order_row_count === "number"
                        ? Math.max(0, Math.floor(section.order_row_count))
                        : 0,
                    reference_row_count:
                      typeof section.reference_row_count === "number"
                        ? Math.max(0, Math.floor(section.reference_row_count))
                        : 0,
                    incomplete_row_count:
                      typeof section.incomplete_row_count === "number"
                        ? Math.max(0, Math.floor(section.incomplete_row_count))
                        : 0
                  } as DetectedSourceSchemaSection;
                })
                .filter((section): section is DetectedSourceSchemaSection => section !== null)
            : [],
          ...(sheet.header_row !== undefined ? { header_row: headerRow } : {}),
          ...(sheet.header_row_count !== undefined
            ? { header_row_count: sheet.header_row_count === 2 ? (2 as const) : (1 as const) }
            : {}),
          ...(Array.isArray(sheet.ignored_header_rows)
            ? {
                ignored_header_rows: sheet.ignored_header_rows.filter(
                  (row): row is number => typeof row === "number" && Number.isInteger(row) && row >= 1
                )
              }
            : {})
        };
      })
    : [];

  return {
    source_file_name: typeof schema.source_file_name === "string" ? schema.source_file_name : "",
    selected_sheet_name: typeof schema.selected_sheet_name === "string" ? schema.selected_sheet_name : "",
    columns: Array.isArray(schema.columns)
      ? schema.columns.filter((column): column is string => typeof column === "string")
      : [],
    sheets,
    detected_at: typeof schema.detected_at === "string" ? schema.detected_at : "",
    ...(normalizedParserConfig ? { parser_config: normalizedParserConfig } : {})
  };
}

function detectedSourceSchemaStructureKey(schema: DetectedSourceSchema) {
  return JSON.stringify({
    selected_sheet_name: schema.selected_sheet_name,
    columns: schema.columns,
    sheets: schema.sheets.map((sheet) => ({
      sheet_name: sheet.sheet_name,
      columns: sheet.columns,
      header_row: sheet.header_row ?? null,
      header_row_count: sheet.header_row_count ?? 1,
      ignored_header_rows: sheet.ignored_header_rows ?? [],
      role: sheet.role ?? "order_lines",
      sections: sheet.sections ?? []
    })),
    parser_config: schema.parser_config ?? null
  });
}

function normalizeDetectedSourceSchemaHistory(value: unknown, currentSchema: DetectedSourceSchema | null) {
  const currentStructureKey = currentSchema ? detectedSourceSchemaStructureKey(currentSchema) : null;
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map(normalizeDetectedSourceSchema)
    .filter((schema): schema is DetectedSourceSchema => Boolean(schema))
    .filter((schema) => {
      const structureKey = detectedSourceSchemaStructureKey(schema);
      if (structureKey === currentStructureKey || seen.has(structureKey)) {
        return false;
      }
      seen.add(structureKey);
      return true;
    })
    .slice(0, 5);
}

function normalizeImportSourceConfig(sourceConfig: ImportMethod["source_config"] | undefined): ImportMethod["source_config"] {
  const source = asRecord(sourceConfig);
  const detectedSchema =
    source.detected_schema === null
      ? null
      : source.detected_schema === undefined
        ? undefined
        : normalizeDetectedSourceSchema(source.detected_schema);
  return {
    google_sheet_url:
      typeof source.google_sheet_url === "string" || source.google_sheet_url === null
        ? source.google_sheet_url
        : undefined,
    google_sheet_tab:
      typeof source.google_sheet_tab === "string" || source.google_sheet_tab === null
        ? source.google_sheet_tab
        : undefined,
    google_sheet_range:
      typeof source.google_sheet_range === "string" || source.google_sheet_range === null
        ? source.google_sheet_range
        : undefined,
    pdf_review_mode:
      source.pdf_review_mode === "manual_review" || source.pdf_review_mode === "assisted_extract"
        ? source.pdf_review_mode
        : undefined,
    api_endpoint_url:
      typeof source.api_endpoint_url === "string" || source.api_endpoint_url === null
        ? source.api_endpoint_url
        : undefined,
    sftp_path: typeof source.sftp_path === "string" || source.sftp_path === null ? source.sftp_path : undefined,
    wrike: source.wrike === undefined ? undefined : normalizeWrikeSourceConfig(source.wrike),
    header_row: source.header_row === undefined ? undefined : normalizeSourceHeaderRow(source.header_row),
    header_row_count: source.header_row_count === undefined ? undefined : source.header_row_count === 2 ? 2 : 1,
    quantity_column:
      typeof source.quantity_column === "string" || source.quantity_column === null
        ? source.quantity_column
        : undefined,
    ignore_repeated_headers:
      typeof source.ignore_repeated_headers === "boolean" ? source.ignore_repeated_headers : undefined,
    reference_rows_mode:
      source.reference_rows_mode === "rows_without_quantity" || source.reference_rows_mode === "ignore"
        ? source.reference_rows_mode
        : undefined,
    sheet_header_overrides: normalizeSourceSheetHeaderOverrides(source.sheet_header_overrides),
    workbook_structure: normalizeSourceWorkbookStructure(source.workbook_structure),
    sample_template_name:
      typeof source.sample_template_name === "string" || source.sample_template_name === null
        ? source.sample_template_name
        : undefined,
    detected_schema: detectedSchema,
    detected_schema_history: normalizeDetectedSourceSchemaHistory(
      source.detected_schema_history,
      detectedSchema ?? null
    )
  };
}

function normalizePublicIntakeConfig(
  value: Partial<PublicIntakeConfig> | null | undefined,
  fallback = createDefaultPublicIntakeConfig()
): PublicIntakeConfig {
  const domains = Array.from(
    new Set(
      (Array.isArray(value?.allowed_email_domains) ? value.allowed_email_domains : fallback.allowed_email_domains)
        .map((domain) => String(domain).trim().toLowerCase().replace(/^@/, ""))
        .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    )
  ).slice(0, 20);
  const maxRows = Number(value?.max_order_rows ?? fallback.max_order_rows);

  return {
    enabled: value?.enabled === true,
    public_key: typeof value?.public_key === "string" ? value.public_key.trim() : fallback.public_key,
    headline:
      typeof value?.headline === "string" && value.headline.trim()
        ? value.headline.trim().slice(0, 100)
        : fallback.headline,
    instructions:
      typeof value?.instructions === "string" && value.instructions.trim()
        ? value.instructions.trim().slice(0, 600)
        : fallback.instructions,
    require_email: value?.require_email_verification === true ? true : value?.require_email !== false,
    require_email_verification: value?.require_email_verification === true,
    allowed_email_domains: domains,
    submit_profile_id:
      typeof value?.submit_profile_id === "string" && value.submit_profile_id.trim()
        ? value.submit_profile_id.trim()
        : null,
    max_order_rows: Number.isFinite(maxRows) ? Math.min(1000, Math.max(1, Math.floor(maxRows))) : fallback.max_order_rows,
    published_at:
      typeof value?.published_at === "string" && !Number.isNaN(Date.parse(value.published_at))
        ? value.published_at
        : null
  };
}

function normalizeImportMethod(method: ImportMethod): ImportMethod {
  const route = createSeedOutputRoute();
  return {
    ...method,
    mappings: normalizeFieldMappings(method.mappings),
    status: method.status ?? "Draft",
    output_route_id: method.output_route_id ?? route.output_route_id,
    target_id: method.target_id ?? route.target_id,
    target_template: method.target_template ?? route.output_template,
    source_config: normalizeImportSourceConfig(method.source_config),
    workbook_sheet_policy: method.workbook_sheet_policy ?? "rows_with_quantity",
    product_resolution_config: {
      ...createDefaultProductResolutionConfig(),
      ...(method.product_resolution_config ?? {})
    },
    product_resolution_overrides: Object.fromEntries(
      Object.entries(method.product_resolution_overrides ?? {}).map(([scopeId, config]) => [
        scopeId,
        {
          ...createDefaultProductResolutionConfig(),
          ...config
        }
      ])
    ),
    order_name_resolution_config: normalizeOrderNameResolutionConfig(
      method.order_name_resolution_config,
      method.order_name_resolution_config
        ? createDefaultOrderNameResolutionConfig()
        : createLegacyOrderNameResolutionConfig()
    ),
    ext_id_strategy: method.ext_id_strategy === "pathfinder_generated" ? "pathfinder_generated" : "customer_order_id",
    public_intake: normalizePublicIntakeConfig(method.public_intake),
    wrike_operations_snapshot: normalizeWrikeOperationsSnapshot(method.wrike_operations_snapshot)
  };
}

function normalizeWrikeOperationsSnapshot(
  snapshot: WrikeOperationsSnapshot | null | undefined
): WrikeOperationsSnapshot | null {
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !snapshot.run_id?.trim() ||
    !snapshot.customer_id?.trim() ||
    !snapshot.import_method_id?.trim() ||
    Number.isNaN(Date.parse(snapshot.checked_at))
  ) {
    return null;
  }
  const count = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  };
  return {
    ...snapshot,
    source: snapshot.source === "operator" ? "operator" : "scheduled",
    discovery_summary: {
      task_count: count(snapshot.discovery_summary?.task_count),
      scoped_task_count: count(snapshot.discovery_summary?.scoped_task_count),
      eligible_order_count: count(snapshot.discovery_summary?.eligible_order_count),
      pending_order_count: count(snapshot.discovery_summary?.pending_order_count),
      placard_order_pending_count: count(snapshot.discovery_summary?.placard_order_pending_count),
      likely_pending_order_count: count(snapshot.discovery_summary?.likely_pending_order_count)
    },
    root_scopes: (snapshot.root_scopes ?? []).slice(0, 10),
    pending_intake: (snapshot.pending_intake ?? []).slice(0, 100),
    prepared_count: count(snapshot.prepared_count),
    replayed_count: count(snapshot.replayed_count),
    failed_count: count(snapshot.failed_count),
    candidate_failures: (snapshot.candidate_failures ?? []).slice(0, 75),
    scheduled_submit: {
      eligible_count: count(snapshot.scheduled_submit?.eligible_count),
      submitted_count: count(snapshot.scheduled_submit?.submitted_count),
      replayed_count: count(snapshot.scheduled_submit?.replayed_count),
      failed_count: count(snapshot.scheduled_submit?.failed_count)
    },
    status_writeback: {
      eligible_count: count(snapshot.status_writeback?.eligible_count),
      posted_count: count(snapshot.status_writeback?.posted_count),
      replayed_count: count(snapshot.status_writeback?.replayed_count),
      failed_count: count(snapshot.status_writeback?.failed_count)
    },
    safety: {
      lift_order_submitted: snapshot.safety?.lift_order_submitted === true,
      wrike_status_changed: snapshot.safety?.wrike_status_changed === true,
      uncertain_lift_retry_allowed: false
    }
  };
}

function normalizeFieldMappings(mappings: FieldMapping[] | undefined): FieldMapping[] {
  return (mappings ?? []).flatMap<FieldMapping>((mapping): FieldMapping[] => {
    const targetField = typeof mapping.targetField === "string" ? mapping.targetField.trim().slice(0, 240) : "";
    const scopeId =
      typeof mapping.scopeId === "string" && mapping.scopeId.trim()
        ? mapping.scopeId.trim().slice(0, 240)
        : null;
    const sourceColumn =
      typeof mapping.sourceColumn === "string" ? mapping.sourceColumn.trim().slice(0, 160) : "";
    if (mapping.ignored === true) {
      return sourceColumn && targetField
        ? [
            {
              sourceColumn,
              targetField,
              ...(scopeId ? { scopeId } : {}),
              ignored: true
            }
          ]
        : [];
    }
    if (!targetField) {
      return [];
    }

    if (mapping.valueExpression?.kind === "composite") {
      const sourceColumns = Array.from(
        new Set(
          (mapping.valueExpression.sourceColumns ?? [])
            .filter((column): column is string => typeof column === "string")
            .map((column) => column.trim().slice(0, 160))
            .filter(Boolean)
            .slice(0, 12)
        )
      );
      if (!sourceColumns.length) {
        return [];
      }
      const maxLength =
        typeof mapping.valueExpression.maxLength === "number" &&
        Number.isInteger(mapping.valueExpression.maxLength)
          ? Math.max(1, Math.min(2_000, mapping.valueExpression.maxLength))
          : null;
      return [
        {
          sourceColumn: "",
          targetField,
          ...(scopeId ? { scopeId } : {}),
          ...(mapping.required !== undefined ? { required: Boolean(mapping.required) } : {}),
          valueExpression: {
            kind: "composite" as const,
            sourceColumns,
            separator:
              typeof mapping.valueExpression.separator === "string"
                ? mapping.valueExpression.separator.slice(0, 24)
                : " ",
            prefix:
              typeof mapping.valueExpression.prefix === "string"
                ? mapping.valueExpression.prefix.slice(0, 120)
                : "",
            suffix:
              typeof mapping.valueExpression.suffix === "string"
                ? mapping.valueExpression.suffix.slice(0, 120)
                : "",
            skipEmpty: mapping.valueExpression.skipEmpty !== false,
            fallback:
              typeof mapping.valueExpression.fallback === "string" && mapping.valueExpression.fallback.trim()
                ? mapping.valueExpression.fallback.trim().slice(0, 500)
                : null,
            maxLength
          }
        }
      ];
    }

    return sourceColumn
      ? [
          {
            sourceColumn,
            targetField,
            ...(scopeId ? { scopeId } : {}),
            ...(mapping.required !== undefined ? { required: Boolean(mapping.required) } : {})
          }
        ]
      : [];
  });
}

function normalizeProductMapping(mapping: CustomerProductMapping): CustomerProductMapping {
  const route = createSeedOutputRoute();
  const productIdentifierType = mapping.product_identifier_type ?? "lift_unit_number";
  const productIdentifierValue =
    mapping.product_identifier_value ??
    (productIdentifierType === "lift_product_id" ? mapping.lift_product_id : mapping.lift_unit_number) ??
    mapping.lift_unit_number ??
    mapping.lift_product_id ??
    null;

  return {
    ...mapping,
    source_scope_id:
      typeof mapping.source_scope_id === "string" && mapping.source_scope_id.trim()
        ? mapping.source_scope_id.trim().slice(0, 160)
        : null,
    output_route_id: mapping.output_route_id ?? route.output_route_id,
    target_id: mapping.target_id ?? route.target_id,
    target_template: mapping.target_template ?? route.output_template,
    product_identifier_type: productIdentifierType,
    product_identifier_value: productIdentifierValue,
    lift_unit_number:
      productIdentifierType === "lift_unit_number"
        ? mapping.lift_unit_number ?? productIdentifierValue
        : mapping.lift_unit_number ?? null,
    lift_product_id:
      productIdentifierType === "lift_product_id"
        ? mapping.lift_product_id ?? productIdentifierValue
        : mapping.lift_product_id ?? null,
    mapping_source: mapping.mapping_source ?? (mapping.last_seen_examples?.length ? "Observed order" : "Manual entry"),
    source_file_name: mapping.source_file_name ?? null,
    replacement_version_id:
      typeof mapping.replacement_version_id === "string" && mapping.replacement_version_id.trim()
        ? mapping.replacement_version_id.trim().slice(0, 120)
        : null,
    last_seen_examples: mapping.last_seen_examples ?? []
  };
}

function normalizeCatalogPreset(preset: LiftCatalogPreset, workspace: PathfinderCustomerWorkspace): LiftCatalogPreset {
  const timestamp = now();
  const route =
    workspace.output_routes.find((candidate) => candidate.output_route_id === preset.output_route_id) ??
    workspace.output_routes.find((candidate) => candidate.output_route_id === workspace.primary_output_route_id) ??
    workspace.output_routes[0];
  const catalogId = String(preset.catalog_id ?? "").trim();
  const presetId =
    preset.preset_id ||
    `catalog-preset-${workspace.customer.lift_customer_id}-${route?.output_route_id ?? "route"}-${catalogId || Date.now()}`;

  return {
    preset_id: presetId,
    output_route_id: route?.output_route_id ?? preset.output_route_id,
    target_id: route?.target_id ?? preset.target_id ?? targetId,
    catalog_id: catalogId,
    catalog_name: String(preset.catalog_name ?? catalogId ?? "Lift catalog").trim() || catalogId || "Lift catalog",
    status: preset.status ?? "Active",
    created_at: preset.created_at ?? timestamp,
    updated_at: preset.updated_at ?? timestamp
  };
}

function normalizeLiftCatalogItem(item: Partial<LiftUnitCatalogItem>, timestamp = now()): LiftUnitCatalogItem {
  const unitNumber = item.unit_number ?? null;
  const productId = item.product_id ?? null;
  const unitNumbers = Array.from(
    new Set([...(unitNumber ? [unitNumber] : []), ...(item.unit_numbers ?? [])].filter(Boolean))
  );
  return {
    catalog_item_id:
      item.catalog_item_id ??
      [
        item.target_id ?? targetId,
        item.company_id ?? "91",
        item.environment_id ?? "any-env",
        productId ? `product-${productId}` : unitNumber ? `unit-${unitNumber}` : `catalog-${item.catalog_id ?? "unknown"}`,
        item.product_name ?? "unnamed"
      ]
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    product_id: productId,
    unit_number: unitNumber,
    unit_numbers: unitNumbers,
    product_name: item.product_name ?? unitNumber ?? productId ?? "Unnamed Lift product",
    company_id: item.company_id ?? "91",
    target_id: item.target_id ?? targetId,
    environment_id: item.environment_id ?? null,
    catalog_id: item.catalog_id ?? null,
    catalog_name: item.catalog_name ?? null,
    accounting_item_code: item.accounting_item_code ?? null,
    product_type: item.product_type ?? null,
    parent_product_id: item.parent_product_id ?? null,
    unit_price: item.unit_price ?? null,
    quantity: item.quantity ?? null,
    attribute_1: item.attribute_1 ?? null,
    attribute_2: item.attribute_2 ?? null,
    material_id: item.material_id ?? null,
    storage_type_id: item.storage_type_id ?? null,
    warehouse_location_id: item.warehouse_location_id ?? null,
    image_url: item.image_url ?? null,
    status: item.status ?? "Active",
    category: item.category ?? item.catalog_name ?? item.product_type ?? null,
    description: item.description ?? null,
    raw_payload: item.raw_payload ?? null,
    source: item.source ?? "Manual",
    updated_at: item.updated_at ?? timestamp
  };
}

function normalizeLiftUnitCatalog(catalog: LiftUnitCatalogItem[] | undefined): LiftUnitCatalogItem[] {
  const timestamp = now();
  const seededByUnit = new Map(createSeedLiftUnitCatalog(timestamp).map((item) => [item.catalog_item_id, item]));

  (catalog ?? []).forEach((item) => {
    const normalized = normalizeLiftCatalogItem(item, timestamp);
    seededByUnit.set(normalized.catalog_item_id, normalized);
  });

  return Array.from(seededByUnit.values());
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

function normalizeSubmitProfiles(route: OutputRoute): SubmitProfile[] {
  const defaults = createDefaultSubmitProfiles();
  const existingProfiles = route.submit_profiles ?? [];
  const profilesById = new Map(defaults.map((profile) => [profile.profile_id, profile]));
  existingProfiles.forEach((profile) => {
    profilesById.set(profile.profile_id, {
      ...(profilesById.get(profile.profile_id) ?? profile),
      ...profile,
      enabled: profile.enabled ?? true,
      customer_override: profile.customer_override ?? null
    });
  });
  return Array.from(profilesById.values());
}

function normalizeCanonicalRegistry(
  registry: PathfinderStore["canonical_registry"] | undefined
): NonNullable<PathfinderStore["canonical_registry"]> {
  const timestamp = now();
  return {
    custom_fields: (registry?.custom_fields ?? []).map((field) => ({
      ...field,
      status: field.status ?? "Draft",
      aliases: Array.isArray(field.aliases) ? field.aliases : [],
      repeatable: field.repeatable ?? field.path.includes("[]"),
      required: field.required ?? false
    })),
    overrides: Object.fromEntries(
      Object.entries(registry?.overrides ?? {}).map(([fieldId, override]) => [
        fieldId,
        {
          field_id: override.field_id ?? fieldId,
          label: override.label,
          aliases: Array.isArray(override.aliases) ? override.aliases : undefined,
          status: override.status,
          description: override.description ?? undefined,
          updated_at: override.updated_at ?? timestamp
        }
      ])
    ),
    snapshots: registry?.snapshots ?? [],
    history: registry?.history ?? [],
    updated_at: registry?.updated_at ?? timestamp
  };
}

function registryChangeId(timestamp: string) {
  return `chg_${timestamp.replace(/[-:.TZ]/g, "")}_${Math.random().toString(36).slice(2, 7)}`;
}

function registrySnapshotId(timestamp: string) {
  return `snap_${timestamp.replace(/[-:.TZ]/g, "")}_${Math.random().toString(36).slice(2, 7)}`;
}

function applyCanonicalFieldOverride(field: CanonicalFieldDefinition, override?: CanonicalFieldOverride) {
  return {
    ...field,
    label: override?.label ?? field.label,
    aliases: override?.aliases ?? field.aliases,
    status: override?.status ?? field.status,
    description: override?.description ?? field.description
  };
}

function registrySnapshotFields(registry: NonNullable<PathfinderStore["canonical_registry"]>) {
  return [
    ...canonicalFieldRegistry.map((field) => applyCanonicalFieldOverride(field, registry.overrides[field.field_id])),
    ...registry.custom_fields.map((field) => applyCanonicalFieldOverride(field, registry.overrides[field.field_id]))
  ];
}

function recordCanonicalRegistryChange(
  registry: NonNullable<PathfinderStore["canonical_registry"]>,
  action: CanonicalRegistryChangeAction,
  summary: string,
  details: Record<string, unknown> = {}
) {
  const timestamp = now();
  const change: CanonicalRegistryChangeEntry = {
    change_id: registryChangeId(timestamp),
    action,
    summary,
    created_at: timestamp,
    details
  };
  const fieldId = details.field_id;
  const fieldPath = details.field_path;
  const previousPath = details.previous_path;
  const nextPath = details.next_path;
  const usageTotal = details.usage_total;

  if (typeof fieldId === "string") {
    change.field_id = fieldId;
  }
  if (typeof fieldPath === "string") {
    change.field_path = fieldPath;
  }
  if (typeof previousPath === "string") {
    change.previous_path = previousPath;
  }
  if (typeof nextPath === "string") {
    change.next_path = nextPath;
  }
  if (typeof usageTotal === "number") {
    change.usage_total = usageTotal;
  }

  const fields = registrySnapshotFields(registry);
  const snapshotNumber = (registry.snapshots?.length ?? 0) + 1;
  const snapshot: CanonicalRegistrySnapshot = {
    snapshot_id: registrySnapshotId(timestamp),
    registry_id: canonicalRegistryMetadata.registry_id,
    version: `${canonicalRegistryMetadata.version}+local.${snapshotNumber}`,
    status: canonicalRegistryMetadata.status,
    field_count: fields.length,
    custom_field_count: registry.custom_fields.length,
    change_id: change.change_id,
    action,
    summary,
    fields,
    created_at: timestamp
  };

  registry.history = [change, ...(registry.history ?? [])].slice(0, 50);
  registry.snapshots = [snapshot, ...(registry.snapshots ?? [])].slice(0, 20);
  registry.updated_at = timestamp;

  return { change, snapshot };
}

function normalizeWorkspace(workspace: PathfinderCustomerWorkspace): PathfinderCustomerWorkspace {
  const route = createSeedOutputRoute();
  const outputRoutes = (workspace.output_routes?.length ? workspace.output_routes : [route]).map((candidate) => {
    const candidateWithoutLegacyContract = { ...candidate } as OutputRoute & { order_name_contract?: unknown };
    delete candidateWithoutLegacyContract.order_name_contract;
    return {
      ...route,
      ...candidateWithoutLegacyContract,
      environment_id: candidate.environment_id ?? route.environment_id,
      output_template_id: candidate.output_template_id ?? route.output_template_id,
      submit_profiles: normalizeSubmitProfiles(candidate),
      value_normalization_rules: candidate.value_normalization_rules?.length
        ? candidate.value_normalization_rules
        : route.value_normalization_rules,
      order_lookup_url: candidate.order_lookup_url ?? route.order_lookup_url ?? null,
      proof_report_url: candidate.proof_report_url ?? route.proof_report_url ?? null,
      package_details_url: candidate.package_details_url ?? route.package_details_url ?? null,
      shipping_report_url: candidate.shipping_report_url ?? route.shipping_report_url ?? null
    };
  });
  const primaryOutputRouteId = workspace.primary_output_route_id ?? outputRoutes[0]?.output_route_id ?? route.output_route_id;
  const catalogPresets = Array.isArray(workspace.catalog_presets)
    ? workspace.catalog_presets
    : createSeedCatalogPresets(
        workspace.customer.customer_name.toLowerCase().includes("momentara")
          ? "momentara_legacy"
          : "neutral",
        outputRoutes[0] ?? route
      );

  return {
    ...workspace,
    source_connections: (workspace.source_connections ?? []).map(normalizeCustomerSourceConnection),
    import_methods: (workspace.import_methods ?? []).map(normalizeImportMethod),
    output_routes: outputRoutes,
    product_mappings: (workspace.product_mappings ?? []).map(normalizeProductMapping),
    catalog_presets: catalogPresets.map((preset) =>
      normalizeCatalogPreset(preset, { ...workspace, output_routes: outputRoutes })
    ),
    product_mapping_replacement_checkpoint: workspace.product_mapping_replacement_checkpoint ?? null,
    product_mapping_replacement_history: workspace.product_mapping_replacement_history ?? [],
    product_mapping_active_versions: workspace.product_mapping_active_versions ?? {},
    status_access_policy: normalizeStatusAccessPolicy(workspace.status_access_policy, workspace.customer),
    proof_capability_policy: normalizeCustomerProofCapabilityPolicy(
      workspace.proof_capability_policy
    ),
    proof_capability_audit: normalizedProofCapabilityAudit(
      workspace.proof_capability_audit
    ),
    primary_target_id: workspace.primary_target_id ?? route.target_id,
    primary_output_route_id: primaryOutputRouteId,
    submit_attempts: workspace.submit_attempts ?? [],
    jobs: workspace.jobs ?? []
  };
}

interface PathfinderStoreReadScope {
  pending?: Promise<PathfinderStore>;
  store?: PathfinderStore;
}

const pathfinderStoreReadScope = new AsyncLocalStorage<PathfinderStoreReadScope>();

/**
 * Coalesces full Pathfinder store reads inside one bounded execution (for
 * example, a single scheduled Wrike cycle). It never shares data between
 * Lambda invocations or HTTP requests.
 */
export function withPathfinderStoreReadScope<T>(operation: () => Promise<T>): Promise<T> {
  return pathfinderStoreReadScope.run({}, operation);
}

function setScopedStore(store: PathfinderStore) {
  const scope = pathfinderStoreReadScope.getStore();
  if (!scope) return;
  scope.store = store;
  scope.pending = Promise.resolve(store);
}

function replaceScopedJob(job: ProcessingJobPreview) {
  const scope = pathfinderStoreReadScope.getStore();
  if (!scope?.store) return;
  scope.store.jobs = [
    job,
    ...scope.store.jobs.filter(
      (candidate) => candidate.customer_id !== job.customer_id || candidate.job_id !== job.job_id
    )
  ];
  const workspace = scope.store.workspaces[job.customer_id];
  if (workspace) {
    workspace.jobs = scope.store.jobs.filter((candidate) => candidate.customer_id === job.customer_id);
    workspace.updated_at = job.updated_at;
  }
}

function replaceScopedSubmitAttempt(attempt: SubmitAttempt) {
  const scope = pathfinderStoreReadScope.getStore();
  if (!scope?.store) return;
  scope.store.submit_attempts = [
    attempt,
    ...scope.store.submit_attempts.filter((candidate) => candidate.attempt_id !== attempt.attempt_id)
  ];
  const workspace = scope.store.workspaces[attempt.customer_id];
  if (workspace) {
    workspace.submit_attempts = scope.store.submit_attempts.filter(
      (candidate) => candidate.customer_id === attempt.customer_id
    );
    workspace.updated_at = attempt.updated_at;
  }
}

function replaceScopedImportMethod(
  customerId: string,
  method: ImportMethod
) {
  const scope = pathfinderStoreReadScope.getStore();
  const workspace = scope?.store?.workspaces[customerId];
  if (!workspace) return;
  workspace.import_methods = [
    method,
    ...workspace.import_methods.filter(
      (candidate) => candidate.import_method_id !== method.import_method_id
    )
  ];
}

function replaceScopedWorkspace(workspace: PathfinderCustomerWorkspace) {
  const scope = pathfinderStoreReadScope.getStore();
  if (!scope?.store) return;
  scope.store.workspaces[workspace.customer.lift_customer_id] = workspace;
}

function mergeScopedLiftProductCatalog(items: LiftUnitCatalogItem[]) {
  const scope = pathfinderStoreReadScope.getStore();
  if (!scope?.store) return;
  const merged = new Map(
    scope.store.lift_unit_catalog.map((item) => [liftProductCacheIdentity(item), item])
  );
  items.forEach((item) => merged.set(liftProductCacheIdentity(item), item));
  scope.store.lift_unit_catalog = Array.from(merged.values());
}

export class WorkspacePersistenceConflictError extends Error {
  constructor() {
    super("This customer workspace changed while it was being saved. Reload it before trying again.");
    this.name = "WorkspacePersistenceConflictError";
  }
}

export class ProductMappingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductMappingValidationError";
  }
}

export class CatalogPresetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogPresetValidationError";
  }
}

type FocusedDynamoRecord = {
  table_name: string;
  keys: Record<string, string>;
  data: unknown;
  expected_updated_at: string | null;
};

function dynamoItemWithRecordTimestamp(keys: Record<string, string>, data: unknown) {
  const item = dynamoItem(keys, data);
  return {
    ...item,
    record_updated_at: dynamoString(durableRecordUpdatedAt(item))
  };
}

async function persistFocusedDynamoRecords(records: FocusedDynamoRecord[], clientRequestSeed: string) {
  const currentItems = await Promise.all(
    records.map((record) =>
      getDynamoClient().send(new GetItemCommand({
        TableName: record.table_name,
        Key: Object.fromEntries(
          Object.entries(record.keys).map(([key, value]) => [key, dynamoString(value)])
        ),
        ConsistentRead: true
      }))
    )
  );

  for (let index = 0; index < records.length; index += 1) {
    const expectedUpdatedAt = records[index].expected_updated_at;
    const storedItem = currentItems[index].Item as Record<string, AttributeValue> | undefined;
    const stored = storedItem ? parseDynamoData<{ updated_at?: string }>(storedItem) : null;
    if (
      (expectedUpdatedAt === null && storedItem) ||
      (expectedUpdatedAt !== null && (!storedItem || stored?.updated_at !== expectedUpdatedAt))
    ) {
      throw new WorkspacePersistenceConflictError();
    }
  }

  const transactItems: TransactWriteItem[] = records.map((record, index): TransactWriteItem => {
    const storedItem = currentItems[index].Item as Record<string, AttributeValue> | undefined;
    const keyNames = Object.keys(record.keys);
    const absenceKey = keyNames[keyNames.length - 1];
    if (storedItem) {
      return {
        Put: {
          TableName: record.table_name,
          Item: dynamoItemWithRecordTimestamp(record.keys, record.data),
          ConditionExpression: "#stored_data = :expected_data",
          ExpressionAttributeNames: { "#stored_data": "data" },
          ExpressionAttributeValues: {
            ":expected_data": storedItem.data as AttributeValue
          }
        }
      };
    }
    return {
      Put: {
        TableName: record.table_name,
        Item: dynamoItemWithRecordTimestamp(record.keys, record.data),
        ConditionExpression: "attribute_not_exists(#absence_key)",
        ExpressionAttributeNames: { "#absence_key": absenceKey }
      }
    };
  });

  try {
    await getDynamoClient().send(new TransactWriteItemsCommand({
      ClientRequestToken: createHash("sha256")
        .update(clientRequestSeed)
        .digest("hex")
        .slice(0, 36),
      TransactItems: transactItems
    }));
  } catch (error) {
    if ((error as { name?: string }).name === "TransactionCanceledException") {
      throw new WorkspacePersistenceConflictError();
    }
    throw error;
  }
}

async function writeStore(store: PathfinderStore) {
  const sanitizedStore: PathfinderStore = {
    ...store,
    targets: Object.fromEntries(
      Object.entries(store.targets).map(([id, target]) => [id, maskTargetConfig(target)])
    ) as Record<string, TargetConfig>
  };
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    await writeDynamoStore(sanitizedStore);
    setScopedStore(store);
    return;
  }

  assertLocalStorageDriver();
  await mkdir(dirname(storePath), { recursive: true });
  const temporaryStorePath = `${storePath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryStorePath, `${JSON.stringify(sanitizedStore, null, 2)}\n`, "utf8");
  await rename(temporaryStorePath, storePath);
  setScopedStore(store);
}

export async function persistPublicOrderStatusSnapshot(snapshot: PublicOrderStatusSnapshot) {
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    await putDynamoData(tables.order_status_snapshots, { order_key: snapshot.order_key }, snapshot);
    return snapshot;
  }

  const store = await readStore();
  store.order_status_snapshots = [
    snapshot,
    ...(store.order_status_snapshots ?? []).filter((candidate) => candidate.order_key !== snapshot.order_key)
  ];
  await writeStore(store);
  return snapshot;
}

export async function getPublicOrderStatusSnapshot(orderKey: string) {
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    return getDynamoData<PublicOrderStatusSnapshot>(tables.order_status_snapshots, { order_key: orderKey });
  }

  const store = await readStore();
  return (store.order_status_snapshots ?? []).find((snapshot) => snapshot.order_key === orderKey) ?? null;
}

export async function getPublicOrderStatusSnapshots(orderKeys: string[]) {
  const uniqueKeys = Array.from(new Set(orderKeys.filter((orderKey) => orderKey.trim())));
  if (!uniqueKeys.length) return [];

  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tableName = getDynamoTableConfig().order_status_snapshots;
    const snapshots: PublicOrderStatusSnapshot[] = [];

    for (let index = 0; index < uniqueKeys.length; index += 100) {
      let keys: Record<string, AttributeValue>[] = uniqueKeys
        .slice(index, index + 100)
        .map((orderKey) => ({ order_key: dynamoString(orderKey) }));

      do {
        const response = await getDynamoClient().send(new BatchGetItemCommand({
          RequestItems: {
            [tableName]: {
              Keys: keys,
              ConsistentRead: false
            }
          }
        }));
        snapshots.push(
          ...((response.Responses?.[tableName] ?? []) as Record<string, AttributeValue>[])
            .map((item) => parseDynamoData<PublicOrderStatusSnapshot>(item))
            .filter((snapshot): snapshot is PublicOrderStatusSnapshot => snapshot != null)
        );
        keys = (response.UnprocessedKeys?.[tableName]?.Keys ?? []) as Record<string, AttributeValue>[];
      } while (keys.length);
    }

    return snapshots;
  }

  const requested = new Set(uniqueKeys);
  const store = await readStore();
  return (store.order_status_snapshots ?? []).filter((snapshot) => requested.has(snapshot.order_key));
}

export async function persistOrderStatusToken(tokenRecord: OrderStatusTokenRecord) {
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    await putDynamoData(
      tables.order_status_tokens,
      { token_hash: tokenRecord.token_hash },
      tokenRecord,
      { expires_at_epoch: { N: String(tokenRecord.expires_at_epoch) } }
    );
    return tokenRecord;
  }

  const store = await readStore();
  store.order_status_tokens = [
    tokenRecord,
    ...(store.order_status_tokens ?? []).filter((candidate) => candidate.token_hash !== tokenRecord.token_hash)
  ];
  await writeStore(store);
  return tokenRecord;
}

function rebindStatusTokenRecord(
  token: OrderStatusTokenRecord,
  args: { customer_id: string; job_id: string; order_number: string; order_key: string; updated_at: string }
) {
  const bindings = token.orders?.length
    ? token.orders
    : [{
        order_key: token.order_key,
        customer_id: token.customer_id,
        job_id: token.job_id,
        order_number: token.order_number
      }];
  if (!bindings.some((binding) => binding.customer_id === args.customer_id && binding.job_id === args.job_id)) {
    return null;
  }
  const orders = bindings.map((binding) =>
    binding.customer_id === args.customer_id && binding.job_id === args.job_id
      ? {
          ...binding,
          order_key: args.order_key,
          order_number: args.order_number
        }
      : binding
  );
  const primary = orders[0];
  return {
    ...token,
    order_key: primary.order_key,
    customer_id: primary.customer_id,
    job_id: primary.job_id,
    order_number: primary.order_number,
    orders,
    updated_at: args.updated_at
  } satisfies OrderStatusTokenRecord;
}

export async function rebindActiveOrderStatusTokensForJob(args: {
  customer_id: string;
  job_id: string;
  order_number: string;
  order_key: string;
}) {
  const config = getPathfinderPersistenceRuntimeConfig();
  const updatedAt = now();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const items = await scanDynamoTable(tables.order_status_tokens);
    const tokens: OrderStatusTokenRecord[] = [];
    for (const item of items) {
      const token = parseDynamoData<OrderStatusTokenRecord>(item);
      if (!token || token.status !== "Active") continue;
      const rebound = rebindStatusTokenRecord(token, { ...args, updated_at: updatedAt });
      if (rebound) tokens.push(rebound);
    }
    await Promise.all(tokens.map((token) => persistOrderStatusToken(token)));
    return tokens.length;
  }

  const store = await readStore();
  let rebound = 0;
  store.order_status_tokens = (store.order_status_tokens ?? []).map((token) => {
    if (token.status !== "Active") return token;
    const next = rebindStatusTokenRecord(token, { ...args, updated_at: updatedAt });
    if (!next) return token;
    rebound += 1;
    return next;
  });
  await writeStore(store);
  return rebound;
}

export async function getOrderStatusToken(tokenHash: string) {
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    return getDynamoData<OrderStatusTokenRecord>(tables.order_status_tokens, { token_hash: tokenHash });
  }

  const store = await readStore();
  return (store.order_status_tokens ?? []).find((token) => token.token_hash === tokenHash) ?? null;
}

export async function persistPublicIntakeEmailVerification(record: PublicIntakeEmailVerificationRecord) {
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    await putDynamoData(
      tables.order_status_tokens,
      { token_hash: record.token_hash },
      record,
      { expires_at_epoch: { N: String(record.expires_at_epoch) } }
    );
    return record;
  }

  const store = await readStore();
  store.public_intake_email_verifications = [
    record,
    ...(store.public_intake_email_verifications ?? []).filter(
      (candidate) => candidate.token_hash !== record.token_hash
    )
  ];
  await writeStore(store);
  return record;
}

export async function getPublicIntakeEmailVerification(tokenHash: string) {
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    return getDynamoData<PublicIntakeEmailVerificationRecord>(tables.order_status_tokens, { token_hash: tokenHash });
  }

  const store = await readStore();
  return (
    (store.public_intake_email_verifications ?? []).find((record) => record.token_hash === tokenHash) ?? null
  );
}

export async function consumePublicIntakeEmailVerification(record: PublicIntakeEmailVerificationRecord) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (
    record.status !== "Verified" ||
    !record.verification_token_hash ||
    record.expires_at_epoch <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  const consumed: PublicIntakeEmailVerificationRecord = {
    ...record,
    status: "Consumed",
    consumed_at: now(),
    updated_at: now()
  };

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    try {
      await getDynamoClient().send(
        new PutItemCommand({
          TableName: tables.order_status_tokens,
          Item: {
            ...dynamoItem({ token_hash: record.token_hash }, consumed),
            expires_at_epoch: { N: String(consumed.expires_at_epoch) }
          },
          ConditionExpression: "#stored_data = :expected_data",
          ExpressionAttributeNames: { "#stored_data": "data" },
          ExpressionAttributeValues: { ":expected_data": { S: JSON.stringify(record) } }
        })
      );
      return consumed;
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        return null;
      }
      throw error;
    }
  }

  const store = await readStore();
  const current = (store.public_intake_email_verifications ?? []).find(
    (candidate) => candidate.token_hash === record.token_hash
  );
  if (
    !current ||
    current.status !== "Verified" ||
    current.verification_token_hash !== record.verification_token_hash
  ) {
    return null;
  }
  store.public_intake_email_verifications = [
    consumed,
    ...(store.public_intake_email_verifications ?? []).filter(
      (candidate) => candidate.token_hash !== record.token_hash
    )
  ];
  await writeStore(store);
  return consumed;
}

const placeholderCredentialValues = new Set([
  "",
  "********",
  "SECRET_REFERENCE_ONLY",
  "LIFT_IMPORT_PASSWORD_TBD",
  "LIFT_IMPORT_USERNAME_TBD"
]);

function isUsableCredentialValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !placeholderCredentialValues.has(value.trim());
}

function hydrateTargetWithSecrets(target: TargetConfig, targetSecrets: TargetSecrets): TargetConfig {
  if (!targetSecrets) {
    return target;
  }

  return {
    ...target,
    environments: target.environments.map((environment) => {
      const environmentSecrets = targetSecrets.environments?.[environment.environment_id];
      if (!environmentSecrets) {
        return environment;
      }

      return {
        ...environment,
        headers: {
          ...environment.headers,
          ...(environmentSecrets.headers ?? {})
        },
        credentials: {
          ...environment.credentials,
          ...(environmentSecrets.credentials ?? {})
        }
      };
    }),
    lift: {
      ...target.lift,
      credentials: {
        ...target.lift.credentials,
        ...(targetSecrets.lift?.credentials ?? {})
      }
    }
  };
}

async function hydrateTargetsWithSecrets(targets: Record<string, TargetConfig>) {
  const hydratedTargets = await Promise.all(
    Object.entries(targets).map(async ([id, target]) => {
      const targetSecrets = await readTargetSecrets(target.target_id);
      return [id, hydrateTargetWithSecrets(target, targetSecrets)] as const;
    })
  );
  return Object.fromEntries(hydratedTargets) as Record<string, TargetConfig>;
}

async function persistTargetSecrets(target: TargetConfig) {
  const targetSecrets: TargetSecrets = await readTargetSecrets(target.target_id);
  const environments = { ...(targetSecrets.environments ?? {}) };

  for (const environment of target.environments) {
    const existingEnvironmentSecrets = environments[environment.environment_id] ?? {};
    const credentials = { ...(existingEnvironmentSecrets.credentials ?? {}) };
    const headers = { ...(existingEnvironmentSecrets.headers ?? {}) };

    for (const key of ["User", "Password", "token", "api_key"] as const) {
      if (isUsableCredentialValue(environment.credentials[key])) {
        credentials[key] = environment.credentials[key];
      }
    }

    for (const key of ["User", "Password"] as const) {
      if (isUsableCredentialValue(environment.headers[key])) {
        headers[key] = environment.headers[key];
      }
    }

    environments[environment.environment_id] = {
      ...existingEnvironmentSecrets,
      credentials,
      headers
    };
  }

  const liftCredentials = { ...(targetSecrets.lift?.credentials ?? {}) };
  for (const key of ["User", "Password"] as const) {
    if (isUsableCredentialValue(target.lift.credentials[key])) {
      liftCredentials[key] = target.lift.credentials[key];
    }
  }

  await writeTargetSecrets(target.target_id, {
    ...targetSecrets,
    environments,
    lift: {
      ...(targetSecrets.lift ?? {}),
      credentials: liftCredentials
    }
  });
}

async function readStoreUncached(): Promise<PathfinderStore> {
  const config = getPathfinderPersistenceRuntimeConfig();
  try {
    let parsed: PathfinderStore | null = null;

    if (config.storage_driver === "dynamodb") {
      parsed = await readDynamoStore();
    } else {
      assertLocalStorageDriver();
      const content = await readFile(storePath, "utf8");
      parsed = JSON.parse(content) as PathfinderStore;
    }

    if (!parsed) {
      const seed = createSeedStore();
      seed.targets = await hydrateTargetsWithSecrets(seed.targets);
      await writeStore(seed);
      return seed;
    }

    let normalizedTargets = Object.fromEntries(
      Object.entries(parsed.targets ?? {}).map(([id, target]) => [id, normalizeTarget(target as TargetConfig)])
    );
    if (!normalizedTargets[ecommerceTargetId]) {
      normalizedTargets[ecommerceTargetId] = createSeedEcommerceTarget();
    }
    normalizedTargets = await hydrateTargetsWithSecrets(normalizedTargets);

    const normalizedSubmitAttempts = (parsed.submit_attempts ?? []).map(normalizeSubmitAttempt);
    const normalizedJobs = (parsed.jobs ?? []).map((job) => reconcileConfirmedJob(job, normalizedSubmitAttempts));

    return {
      ...parsed,
      targets: normalizedTargets,
      workspaces: Object.fromEntries(
        Object.entries(parsed.workspaces ?? {}).map(([id, workspace]) => [
          id,
          normalizeWorkspace(workspace as PathfinderCustomerWorkspace)
        ])
      ),
      jobs: normalizedJobs,
      submit_attempts: normalizedSubmitAttempts,
      lift_unit_catalog: normalizeLiftUnitCatalog(parsed.lift_unit_catalog),
      order_status_tokens: parsed.order_status_tokens ?? [],
      public_intake_email_verifications: parsed.public_intake_email_verifications ?? [],
      order_status_snapshots: parsed.order_status_snapshots ?? [],
      canonical_registry: normalizeCanonicalRegistry(parsed.canonical_registry)
    };
  } catch (error) {
    if (config.storage_driver === "dynamodb") {
      throw error;
    }

    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `Could not read the local Pathfinder store at ${storePath}; the existing file was preserved.`,
        { cause: error }
      );
    }

    const seed = createSeedStore();
    seed.targets = await hydrateTargetsWithSecrets(seed.targets);
    await writeStore(seed);
    return seed;
  }
}

export async function readStore(): Promise<PathfinderStore> {
  const scope = pathfinderStoreReadScope.getStore();
  if (!scope) {
    return readStoreUncached();
  }
  if (scope.store) {
    return scope.store;
  }
  if (scope.pending) {
    return scope.pending;
  }

  const pending = readStoreUncached();
  scope.pending = pending;
  try {
    const store = await pending;
    scope.store = store;
    return store;
  } catch (error) {
    if (scope.pending === pending) {
      delete scope.pending;
    }
    throw error;
  }
}

export async function getOrCreateWorkspace(customer: LiftCustomer) {
  const store = await readStore();
  const existing = store.workspaces[customer.lift_customer_id];

  if (existing) {
    const normalized = normalizeWorkspace(existing);
    normalized.customer = customer;
    normalized.status_access_policy = normalizeStatusAccessPolicy(normalized.status_access_policy, customer);
    normalized.jobs = store.jobs.filter((job) => job.customer_id === customer.lift_customer_id);
    normalized.submit_attempts = store.submit_attempts.filter((attempt) => attempt.customer_id === customer.lift_customer_id);
    return normalized;
  }

  const workspace = createWorkspace(customer);
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const customerResponse = await getDynamoClient().send(new GetItemCommand({
      TableName: tables.customers,
      Key: { customer_id: dynamoString(customer.lift_customer_id) },
      ConsistentRead: true
    }));
    const records: FocusedDynamoRecord[] = [
      {
        table_name: tables.workspaces,
        keys: { customer_id: customer.lift_customer_id },
        data: workspaceRecord(workspace),
        expected_updated_at: null
      },
      ...workspace.import_methods.map((method) => ({
        table_name: tables.import_methods,
        keys: {
          customer_id: customer.lift_customer_id,
          import_method_id: method.import_method_id
        },
        data: { ...method, customer_id: customer.lift_customer_id },
        expected_updated_at: null
      })),
      ...workspace.output_routes.map((route) => ({
        table_name: tables.output_routes,
        keys: {
          customer_id: customer.lift_customer_id,
          output_route_id: route.output_route_id
        },
        data: { ...route, customer_id: customer.lift_customer_id },
        expected_updated_at: null
      }))
    ];
    if (!customerResponse.Item) {
      records.unshift({
        table_name: tables.customers,
        keys: { customer_id: customer.lift_customer_id },
        data: customer,
        expected_updated_at: null
      });
    }
    await persistFocusedDynamoRecords(
      records,
      `workspace-create\0${customer.lift_customer_id}\0${workspace.updated_at}`
    );
    replaceScopedWorkspace(workspace);
    return workspace;
  }

  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace;
}

export async function getWorkspace(customerId: string) {
  const store = await readStore();
  const existing = store.workspaces[customerId];
  if (!existing) return null;
  const normalized = normalizeWorkspace(existing);
  normalized.jobs = store.jobs.filter((job) => job.customer_id === customerId);
  normalized.submit_attempts = store.submit_attempts.filter((attempt) => attempt.customer_id === customerId);
  return normalized;
}

export class SourceConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Source connection ${connectionId} was not found.`);
    this.name = "SourceConnectionNotFoundError";
  }
}

export class SourceConnectorUnavailableError extends Error {
  constructor(provider: SourceConnectorProvider) {
    super(`${getSourceConnectorDefinition(provider)?.name ?? provider} is planned but is not available yet.`);
    this.name = "SourceConnectorUnavailableError";
  }
}

export async function createCustomerSourceConnection(
  customer: LiftCustomer,
  input: {
    provider: SourceConnectorProvider;
    name?: string;
    environment?: SourceConnectionEnvironment;
  }
) {
  const definition = getSourceConnectorDefinition(input.provider);
  if (!definition || definition.availability !== "Available") {
    throw new SourceConnectorUnavailableError(input.provider);
  }

  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const connection = normalizeCustomerSourceConnection({
    connection_id: `source_${input.provider}_${randomBytes(6).toString("hex")}`,
    name: input.name?.trim() || `${customer.customer_name} ${definition.name}`,
    provider: input.provider,
    status: "Draft",
    environment: input.environment === "Sandbox" ? "Sandbox" : "Production",
    auth_strategy: definition.auth_strategy,
    created_at: timestamp,
    updated_at: timestamp
  });

  workspace.source_connections = [...workspace.source_connections, connection];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return connection;
}

export async function updateCustomerSourceConnection(
  customer: LiftCustomer,
  connectionId: string,
  patch: {
    name?: string;
    status?: SourceConnectionStatus;
    environment?: SourceConnectionEnvironment;
  }
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const current = workspace.source_connections.find((connection) => connection.connection_id === connectionId);
  if (!current) {
    throw new SourceConnectionNotFoundError(connectionId);
  }
  const timestamp = now();
  const next = normalizeCustomerSourceConnection({
    ...current,
    name: patch.name ?? current.name,
    status: patch.status ?? current.status,
    environment: patch.environment ?? current.environment,
    updated_at: timestamp
  });
  workspace.source_connections = workspace.source_connections.map((connection) =>
    connection.connection_id === connectionId ? next : connection
  );
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return next;
}

export async function findCustomerSourceConnection(customer: LiftCustomer, connectionId: string) {
  const workspace = await getOrCreateWorkspace(customer);
  return workspace.source_connections.find((connection) => connection.connection_id === connectionId) ?? null;
}

export async function findCustomerSourceConnectionById(connectionId: string) {
  const store = await readStore();
  for (const workspace of Object.values(store.workspaces)) {
    const connection = (workspace.source_connections ?? []).find(
      (candidate) => candidate.connection_id === connectionId
    );
    if (connection) {
      return { customer: workspace.customer, connection: normalizeCustomerSourceConnection(connection) };
    }
  }
  return null;
}

export async function getPublicIntakeMethodByKey(publicKey: string) {
  const normalizedKey = publicKey.trim();
  if (!normalizedKey) {
    return null;
  }

  const store = await readStore();
  for (const workspace of Object.values(store.workspaces)) {
    const normalized = normalizeWorkspace(workspace);
    const method = normalized.import_methods.find(
      (candidate) =>
        candidate.status === "Active" &&
        candidate.public_intake.enabled &&
        candidate.public_intake.public_key === normalizedKey
    );
    if (method) {
      return {
        customer: normalized.customer,
        workspace: normalized,
        method
      };
    }
  }

  return null;
}

export class PublicIntakeLifecycleError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 404 | 409
  ) {
    super(message);
    this.name = "PublicIntakeLifecycleError";
  }
}

export async function rotateImportMethodPublicIntakeKey(customer: LiftCustomer, methodId: string) {
  const store = await readStore();
  const existingWorkspace = store.workspaces[customer.lift_customer_id];
  if (!existingWorkspace) {
    throw new PublicIntakeLifecycleError("Customer workspace not found.", 404);
  }

  const workspace = normalizeWorkspace(existingWorkspace);
  const methodIndex = workspace.import_methods.findIndex((method) => method.import_method_id === methodId);
  if (methodIndex < 0) {
    throw new PublicIntakeLifecycleError(`Import method ${methodId} was not found.`, 404);
  }

  const method = workspace.import_methods[methodIndex];
  if (method.status !== "Active" || !method.public_intake.enabled || !method.public_intake.public_key) {
    throw new PublicIntakeLifecycleError(
      "Publish and save this active Customer Order Dropbox before rotating its private link.",
      409
    );
  }

  const timestamp = now();
  workspace.import_methods[methodIndex] = {
    ...method,
    public_intake: {
      ...method.public_intake,
      public_key: randomBytes(18).toString("base64url"),
      published_at: timestamp
    },
    updated_at: timestamp
  };
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace;
}

export async function revokeImportMethodPublicIntakeKey(customer: LiftCustomer, methodId: string) {
  const store = await readStore();
  const existingWorkspace = store.workspaces[customer.lift_customer_id];
  if (!existingWorkspace) {
    throw new PublicIntakeLifecycleError("Customer workspace not found.", 404);
  }

  const workspace = normalizeWorkspace(existingWorkspace);
  const methodIndex = workspace.import_methods.findIndex((method) => method.import_method_id === methodId);
  if (methodIndex < 0) {
    throw new PublicIntakeLifecycleError(`Import method ${methodId} was not found.`, 404);
  }

  const method = workspace.import_methods[methodIndex];
  if (!method.public_intake.public_key) {
    throw new PublicIntakeLifecycleError("This Customer Order Dropbox does not have a private link to revoke.", 409);
  }

  const timestamp = now();
  workspace.import_methods[methodIndex] = {
    ...method,
    public_intake: {
      ...method.public_intake,
      enabled: false,
      public_key: "",
      published_at: null
    },
    updated_at: timestamp
  };
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace;
}

export async function getCanonicalRegistryOverrides() {
  const store = await readStore();
  return normalizeCanonicalRegistry(store.canonical_registry);
}

export async function getCanonicalRegistryGovernance() {
  const store = await readStore();
  const registry = normalizeCanonicalRegistry(store.canonical_registry);
  return {
    history: registry.history ?? [],
    snapshots: registry.snapshots ?? []
  };
}

export async function updateCanonicalRegistryFieldOverride(
  fieldId: string,
  patch: Partial<Pick<CanonicalFieldOverride, "label" | "aliases" | "status" | "description">>
) {
  const store = await readStore();
  const registry = normalizeCanonicalRegistry(store.canonical_registry);
  const timestamp = now();
  const existing = registry.overrides[fieldId] ?? {
    field_id: fieldId,
    updated_at: timestamp
  };
  const next: CanonicalFieldOverride = {
    ...existing,
    updated_at: timestamp
  };

  if ("label" in patch) {
    next.label = patch.label;
  }
  if ("aliases" in patch) {
    next.aliases = patch.aliases;
  }
  if ("status" in patch) {
    next.status = patch.status;
  }
  if ("description" in patch) {
    next.description = patch.description;
  }

  registry.overrides[fieldId] = next;
  recordCanonicalRegistryChange(registry, "field_metadata_updated", "Updated canonical field metadata.", {
    field_id: fieldId,
    patch
  });
  store.canonical_registry = registry;
  await writeStore(store);
  return registry;
}

function canonicalFieldIdFromPath(path: string) {
  return `canonical.${path.replace(/\[\]/g, ".items").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

export async function addCanonicalRegistryCustomField(input: CanonicalFieldCreateInput) {
  const store = await readStore();
  const registry = normalizeCanonicalRegistry(store.canonical_registry);
  const field: CanonicalFieldDefinition = {
    field_id: canonicalFieldIdFromPath(input.path),
    path: input.path,
    section: input.section,
    label: input.label,
    data_type: input.data_type,
    required: input.required ?? false,
    repeatable: input.repeatable ?? input.path.includes("[]"),
    status: input.status ?? "Draft",
    aliases: input.aliases ?? [],
    description: input.description
  };

  registry.custom_fields = [
    ...registry.custom_fields.filter((candidate) => candidate.field_id !== field.field_id && candidate.path !== field.path),
    field
  ];
  recordCanonicalRegistryChange(registry, "custom_field_created", `Created custom field ${field.path}.`, {
    field_id: field.field_id,
    field_path: field.path,
    section: field.section,
    data_type: field.data_type
  });
  store.canonical_registry = registry;
  await writeStore(store);
  return registry;
}

export async function deleteCanonicalRegistryCustomField(fieldId: string) {
  const store = await readStore();
  const registry = normalizeCanonicalRegistry(store.canonical_registry);
  const existingField = registry.custom_fields.find((field) => field.field_id === fieldId);

  if (!existingField) {
    return null;
  }

  registry.custom_fields = registry.custom_fields.filter((field) => field.field_id !== fieldId);
  delete registry.overrides[fieldId];
  recordCanonicalRegistryChange(registry, "custom_field_removed", `Removed draft custom field ${existingField.path}.`, {
    field_id: existingField.field_id,
    field_path: existingField.path,
    section: existingField.section
  });
  store.canonical_registry = registry;
  await writeStore(store);
  return registry;
}

function emptyCanonicalFieldUsage(): CanonicalFieldUsageSummary {
  return {
    import_method_mappings: 0,
    saved_mapping_templates: 0,
    output_template_mappings: 0,
    output_template_tokens: 0,
    value_rules: 0,
    total: 0
  };
}

function countTemplateTokens(templateText: string, fieldPath: string) {
  const escaped = fieldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(templateText.matchAll(new RegExp(`{{\\s*${escaped}\\s*}}`, "g"))).length;
}

function finalizeCanonicalFieldUsage(usage: CanonicalFieldUsageSummary) {
  usage.total =
    usage.import_method_mappings +
    usage.saved_mapping_templates +
    usage.output_template_mappings +
    usage.output_template_tokens +
    usage.value_rules;
  return usage;
}

function canonicalFieldUsageForStore(store: PathfinderStore, fieldPath: string): CanonicalFieldUsageSummary {
  const usage = emptyCanonicalFieldUsage();

  Object.values(store.workspaces ?? {}).forEach((workspace) => {
    workspace.import_methods?.forEach((method) => {
      usage.import_method_mappings += (method.mappings ?? []).filter((mapping) => mapping.targetField === fieldPath).length;
    });
    workspace.templates?.forEach((template) => {
      usage.saved_mapping_templates += (template.mappings ?? []).filter((mapping) => mapping.targetField === fieldPath).length;
    });
    workspace.output_routes?.forEach((route) => {
      usage.value_rules += (route.value_normalization_rules ?? []).filter(
        (rule) => rule.canonical_field === fieldPath || rule.output_field === fieldPath
      ).length;
    });
  });

  Object.values(store.targets ?? {}).forEach((target) => {
    target.output_templates?.forEach((template) => {
      usage.output_template_mappings += (template.canonical_mappings ?? []).filter(
        (mapping) => mapping.targetField === fieldPath
      ).length;
      usage.output_template_tokens +=
        countTemplateTokens(template.body_template ?? "", fieldPath) +
        countTemplateTokens(template.header_template ?? "", fieldPath);
    });
  });

  return finalizeCanonicalFieldUsage(usage);
}

export async function getCanonicalRegistryUsageByPath() {
  const store = await readStore();
  const registry = normalizeCanonicalRegistry(store.canonical_registry);
  const paths = new Set<string>([
    ...registry.custom_fields.map((field) => field.path),
    ...Object.values(registry.overrides).map((override) => override.field_id)
  ]);

  Object.values(store.workspaces ?? {}).forEach((workspace) => {
    workspace.import_methods?.forEach((method) =>
      method.mappings?.forEach((mapping) => paths.add(mapping.targetField))
    );
    workspace.templates?.forEach((template) =>
      template.mappings?.forEach((mapping) => paths.add(mapping.targetField))
    );
    workspace.output_routes?.forEach((route) =>
      route.value_normalization_rules?.forEach((rule) => {
        paths.add(rule.canonical_field);
        paths.add(rule.output_field);
      })
    );
  });
  Object.values(store.targets ?? {}).forEach((target) =>
    target.output_templates?.forEach((template) =>
      template.canonical_mappings?.forEach((mapping) => paths.add(mapping.targetField))
    )
  );

  return Object.fromEntries(Array.from(paths).map((path) => [path, canonicalFieldUsageForStore(store, path)]));
}

function replaceTemplateToken(templateText: string, oldPath: string, newPath: string) {
  const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return templateText.replace(new RegExp(`{{\\s*${escaped}\\s*}}`, "g"), `{{${newPath}}}`);
}

function renameFieldMappings(mappings: FieldMapping[] = [], oldPath: string, newPath: string) {
  return mappings.map((mapping) =>
    mapping.targetField === oldPath
      ? {
          ...mapping,
          targetField: newPath
        }
      : mapping
  );
}

export async function renameCanonicalRegistryCustomField(fieldId: string, newPath: string) {
  const store = await readStore();
  const registry = normalizeCanonicalRegistry(store.canonical_registry);
  const existingField = registry.custom_fields.find((field) => field.field_id === fieldId);

  if (!existingField) {
    return null;
  }

  const oldPath = existingField.path;
  const timestamp = now();
  registry.custom_fields = registry.custom_fields.map((field) =>
    field.field_id === fieldId
      ? {
          ...field,
          path: newPath,
          aliases: Array.from(new Set([...(field.aliases ?? []), oldPath])),
          repeatable: field.repeatable || newPath.includes("[]")
        }
      : field
  );
  registry.updated_at = timestamp;

  Object.values(store.workspaces ?? {}).forEach((workspace) => {
    workspace.import_methods = (workspace.import_methods ?? []).map((method) => ({
      ...method,
      mappings: renameFieldMappings(method.mappings, oldPath, newPath),
      updated_at: timestamp
    }));
    workspace.templates = (workspace.templates ?? []).map((template) => ({
      ...template,
      mappings: renameFieldMappings(template.mappings, oldPath, newPath),
      updated_at: timestamp
    }));
    workspace.output_routes = (workspace.output_routes ?? []).map((route) => ({
      ...route,
      value_normalization_rules: (route.value_normalization_rules ?? []).map((rule) => ({
        ...rule,
        canonical_field: rule.canonical_field === oldPath ? newPath : rule.canonical_field,
        output_field: rule.output_field === oldPath ? newPath : rule.output_field
      })),
      updated_at: timestamp
    }));
    workspace.updated_at = timestamp;
  });

  store.targets = Object.fromEntries(
    Object.entries(store.targets ?? {}).map(([id, target]) => [
      id,
      {
        ...target,
        output_templates: (target.output_templates ?? []).map((template) => ({
          ...template,
          canonical_mappings: renameFieldMappings(template.canonical_mappings, oldPath, newPath),
          body_template: replaceTemplateToken(template.body_template ?? "", oldPath, newPath),
          header_template: replaceTemplateToken(template.header_template ?? "", oldPath, newPath),
          updated_at: timestamp
        })),
        updated_at: timestamp
      }
    ])
  );

  store.canonical_registry = registry;
  const usage = canonicalFieldUsageForStore(store, newPath);
  recordCanonicalRegistryChange(registry, "custom_field_renamed", `Renamed custom field ${oldPath} to ${newPath}.`, {
    field_id: fieldId,
    previous_path: oldPath,
    next_path: newPath,
    usage_total: usage.total
  });
  await writeStore(store);
  return {
    registry,
    old_path: oldPath,
    new_path: newPath,
    usage
  };
}

export async function updateImportMethod(customer: LiftCustomer, methodId: string, methodPatch: Partial<ImportMethod>) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const expectedWorkspaceUpdatedAt = workspace.updated_at;
  const timestamp = now();
  const existingMethod = workspace.import_methods.find((method) => method.import_method_id === methodId);
  const isCompleteNewMethod =
    Boolean(methodPatch.name) &&
    Boolean(methodPatch.type) &&
    Boolean(methodPatch.source) &&
    Boolean(methodPatch.status) &&
    Boolean(methodPatch.output_route_id) &&
    Boolean(methodPatch.template_id);

  if (!existingMethod && !isCompleteNewMethod) {
    throw new Error(`Import method ${methodId} does not exist. Create a new import method before saving settings.`);
  }

  const methodSource = existingMethod ?? createSeedMethod(timestamp);
  const normalizedMethodSource = normalizeImportMethod(methodSource);
  let nextSourceConfig = normalizeImportSourceConfig({
    ...(methodSource.source_config ?? {}),
    ...(methodPatch.source_config ?? {})
  });
  const existingDetectedSchema = normalizedMethodSource.source_config.detected_schema ?? null;
  const nextDetectedSchema = nextSourceConfig.detected_schema ?? null;
  if (
    existingMethod &&
    existingDetectedSchema &&
    (!nextDetectedSchema ||
      detectedSourceSchemaStructureKey(existingDetectedSchema) !== detectedSourceSchemaStructureKey(nextDetectedSchema))
  ) {
    nextSourceConfig = {
      ...nextSourceConfig,
      detected_schema_history: normalizeDetectedSourceSchemaHistory(
        [existingDetectedSchema, ...(nextSourceConfig.detected_schema_history ?? [])],
        nextDetectedSchema
      )
    };
  }
  const nextMethod: ImportMethod = {
    ...normalizedMethodSource,
    ...methodPatch,
    import_method_id: methodId,
    mappings: normalizeFieldMappings(methodPatch.mappings ?? normalizedMethodSource.mappings),
    source_config: nextSourceConfig,
    workbook_sheet_policy: methodPatch.workbook_sheet_policy ?? methodSource.workbook_sheet_policy ?? "rows_with_quantity",
    product_resolution_config: {
      ...createDefaultProductResolutionConfig(),
      ...(methodSource.product_resolution_config ?? {}),
      ...(methodPatch.product_resolution_config ?? {})
    },
    product_resolution_overrides: Object.fromEntries(
      Object.entries({
        ...(methodSource.product_resolution_overrides ?? {}),
        ...(methodPatch.product_resolution_overrides ?? {})
      }).map(([scopeId, config]) => [
        scopeId,
        {
          ...createDefaultProductResolutionConfig(),
          ...config
        }
      ])
    ),
    order_name_resolution_config: normalizeOrderNameResolutionConfig(
      {
        ...(normalizedMethodSource.order_name_resolution_config ?? {}),
        ...(methodPatch.order_name_resolution_config ?? {})
      },
      normalizedMethodSource.order_name_resolution_config
    ),
    ext_id_strategy:
      methodPatch.ext_id_strategy === "pathfinder_generated" || methodPatch.ext_id_strategy === "customer_order_id"
        ? methodPatch.ext_id_strategy
        : normalizedMethodSource.ext_id_strategy,
    public_intake: (() => {
      const nextConfig = normalizePublicIntakeConfig(
        {
          ...normalizedMethodSource.public_intake,
          ...(methodPatch.public_intake ?? {})
        },
        normalizedMethodSource.public_intake
      );
      const nextStatus = methodPatch.status ?? normalizedMethodSource.status;
      const shouldPublish = nextConfig.enabled && nextStatus === "Active";
      return {
        ...nextConfig,
        public_key: normalizedMethodSource.public_intake.public_key || (shouldPublish ? randomBytes(18).toString("base64url") : ""),
        published_at: shouldPublish
          ? normalizedMethodSource.public_intake.published_at ?? timestamp
          : normalizedMethodSource.public_intake.published_at
      };
    })(),
    // Runtime operations evidence has its own optimistic persistence boundary.
    // Never let an older Admin form submission overwrite the latest scheduler snapshot.
    wrike_operations_snapshot: existingMethod
      ? normalizedMethodSource.wrike_operations_snapshot ?? null
      : null,
    updated_at: timestamp
  };

  workspace.import_methods = [
    nextMethod,
    ...workspace.import_methods.filter((method) => method.import_method_id !== methodId)
  ];
  const existingTemplate = workspace.templates.find(
    (template) => template.template_id === nextMethod.template_id
  );
  workspace.templates = [
    existingTemplate ?? {
      template_id: nextMethod.template_id,
      name: `${nextMethod.name} Field Mapping`,
      version: "1.0.0",
      // A missing legacy mirror is created safely as Draft. Existing template
      // lifecycle and content change only through an explicit template action.
      status: "Draft",
      mappings: nextMethod.mappings,
      updated_at: timestamp
    },
    ...workspace.templates.filter((template) => template.template_id !== nextMethod.template_id)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    await persistFocusedDynamoRecords(
      [
        {
          table_name: tables.workspaces,
          keys: { customer_id: customer.lift_customer_id },
          data: workspaceRecord(workspace),
          expected_updated_at: expectedWorkspaceUpdatedAt
        },
        {
          table_name: tables.import_methods,
          keys: { customer_id: customer.lift_customer_id, import_method_id: methodId },
          data: { ...nextMethod, customer_id: customer.lift_customer_id },
          expected_updated_at: existingMethod?.updated_at ?? null
        }
      ],
      `import-method-save\0${customer.lift_customer_id}\0${methodId}\0${timestamp}`
    );
    replaceScopedWorkspace(workspace);
    return workspace;
  }
  await writeStore(store);

  return workspace;
}

export async function listWrikeOperationsSnapshots() {
  const store = await readStore();
  return Object.values(store.workspaces)
    .flatMap((workspace) => workspace.import_methods.map((method) => ({
      customer_id: workspace.customer.lift_customer_id,
      customer_name: workspace.customer.customer_name,
      import_method_id: method.import_method_id,
      import_method_name: method.name,
      snapshot: normalizeWrikeOperationsSnapshot(method.wrike_operations_snapshot)
    })))
    .filter((entry): entry is typeof entry & { snapshot: WrikeOperationsSnapshot } => Boolean(entry.snapshot))
    .sort((left, right) => Date.parse(right.snapshot.checked_at) - Date.parse(left.snapshot.checked_at));
}

export async function persistWrikeOperationsSnapshot(
  customer: LiftCustomer,
  methodId: string,
  snapshotValue: WrikeOperationsSnapshot
) {
  const snapshot = normalizeWrikeOperationsSnapshot(snapshotValue);
  if (
    !snapshot ||
    snapshot.customer_id !== customer.lift_customer_id ||
    snapshot.import_method_id !== methodId
  ) {
    throw new Error("Wrike operations snapshot identity is invalid.");
  }

  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tableName = getDynamoTableConfig().import_methods;
    const key = {
      customer_id: dynamoString(customer.lift_customer_id),
      import_method_id: dynamoString(methodId)
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await getDynamoClient().send(new GetItemCommand({
        TableName: tableName,
        Key: key,
        ConsistentRead: true
      }));
      const existingData = response.Item?.data?.S;
      const existingMethod = response.Item
        ? parseDynamoData<ImportMethod & { customer_id?: string }>(response.Item as Record<string, AttributeValue>)
        : null;
      if (!existingData || !existingMethod) {
        throw new Error(`Import method ${methodId} does not exist.`);
      }
      const nextMethod = normalizeImportMethod({
        ...existingMethod,
        wrike_operations_snapshot: snapshot
      });
      try {
        await getDynamoClient().send(new PutItemCommand({
          TableName: tableName,
          Item: dynamoItem(
            { customer_id: customer.lift_customer_id, import_method_id: methodId },
            { ...nextMethod, customer_id: customer.lift_customer_id }
          ),
          ConditionExpression: "#data = :expected_data",
          ExpressionAttributeNames: { "#data": "data" },
          ExpressionAttributeValues: { ":expected_data": { S: existingData } }
        }));
        replaceScopedImportMethod(customer.lift_customer_id, nextMethod);
        return snapshot;
      } catch (error) {
        if (!isConditionalCheckFailure(error) || attempt === 2) throw error;
      }
    }
    throw new Error("Wrike operations snapshot could not be saved safely.");
  }

  const store = await readStore();
  const workspace = normalizeWorkspace(
    store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer)
  );
  const existingMethod = workspace.import_methods.find(
    (method) => method.import_method_id === methodId
  );
  if (!existingMethod) throw new Error(`Import method ${methodId} does not exist.`);
  const nextMethod = normalizeImportMethod({
    ...existingMethod,
    wrike_operations_snapshot: snapshot
  });
  workspace.import_methods = [
    nextMethod,
    ...workspace.import_methods.filter((method) => method.import_method_id !== methodId)
  ];
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return snapshot;
}

export async function archiveImportMethod(customer: LiftCustomer, methodId: string) {
  return updateImportMethod(customer, methodId, { status: "Archived" });
}

export async function updateOutputRoute(customer: LiftCustomer, routeId: string, routePatch: Partial<OutputRoute>) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const expectedWorkspaceUpdatedAt = workspace.updated_at;
  const timestamp = now();
  const storedRoute = workspace.output_routes.find((route) => route.output_route_id === routeId) ?? null;
  const existingRoute = storedRoute ?? createSeedOutputRoute(timestamp);
  const linkedMethodsBefore = workspace.import_methods.filter((method) => method.output_route_id === routeId);
  const routePatchWithoutLegacyContract = { ...routePatch } as Partial<OutputRoute> & { order_name_contract?: unknown };
  delete routePatchWithoutLegacyContract.order_name_contract;
  const nextRoute: OutputRoute = {
    ...existingRoute,
    ...routePatchWithoutLegacyContract,
    output_route_id: routeId,
    submit_profiles: normalizeSubmitProfiles({
      ...existingRoute,
      ...routePatch
    } as OutputRoute),
    value_normalization_rules:
      routePatch.value_normalization_rules ?? existingRoute.value_normalization_rules ?? createDefaultValueNormalizationRules(),
    order_lookup_url: routePatch.order_lookup_url ?? existingRoute.order_lookup_url ?? null,
    proof_report_url: routePatch.proof_report_url ?? existingRoute.proof_report_url ?? null,
    package_details_url: routePatch.package_details_url ?? existingRoute.package_details_url ?? null,
    shipping_report_url: routePatch.shipping_report_url ?? existingRoute.shipping_report_url ?? null,
    updated_at: timestamp
  };

  workspace.output_routes = [
    nextRoute,
    ...workspace.output_routes.filter((route) => route.output_route_id !== routeId)
  ];
  workspace.import_methods = workspace.import_methods.map((method) =>
    method.output_route_id === routeId
      ? {
          ...method,
          target_id: nextRoute.target_id,
          target_template: nextRoute.output_template,
          updated_at: timestamp
        }
      : method
  );
  workspace.primary_output_route_id =
    workspace.primary_output_route_id === routeId ? nextRoute.output_route_id : workspace.primary_output_route_id;
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const linkedMethodsAfter = workspace.import_methods.filter((method) => method.output_route_id === routeId);
    const expectedMethodsById = new Map(
      linkedMethodsBefore.map((method) => [method.import_method_id, method])
    );
    await persistFocusedDynamoRecords(
      [
        {
          table_name: tables.workspaces,
          keys: { customer_id: customer.lift_customer_id },
          data: workspaceRecord(workspace),
          expected_updated_at: expectedWorkspaceUpdatedAt
        },
        {
          table_name: tables.output_routes,
          keys: { customer_id: customer.lift_customer_id, output_route_id: routeId },
          data: { ...nextRoute, customer_id: customer.lift_customer_id },
          expected_updated_at: storedRoute?.updated_at ?? null
        },
        ...linkedMethodsAfter.map((method) => ({
          table_name: tables.import_methods,
          keys: {
            customer_id: customer.lift_customer_id,
            import_method_id: method.import_method_id
          },
          data: { ...method, customer_id: customer.lift_customer_id },
          expected_updated_at: expectedMethodsById.get(method.import_method_id)?.updated_at ?? null
        }))
      ],
      `output-route-save\0${customer.lift_customer_id}\0${routeId}\0${timestamp}`
    );
    replaceScopedWorkspace(workspace);
    return workspace;
  }
  await writeStore(store);

  return workspace;
}

export async function updateStatusAccessPolicy(customer: LiftCustomer, policyPatch: Partial<StatusAccessPolicy>) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();

  workspace.status_access_policy = normalizeStatusAccessPolicy(
    {
      ...workspace.status_access_policy,
      ...policyPatch,
      approved_email_domains:
        policyPatch.approved_email_domains ?? workspace.status_access_policy.approved_email_domains,
      updated_at: timestamp
    },
    customer,
    timestamp
  );
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);

  return workspace;
}

async function mutateCustomerProofCapabilityWorkspace(
  customer: LiftCustomer,
  expectedPolicyUpdatedAt: string,
  mutation: (
    workspace: PathfinderCustomerWorkspace,
    timestamp: string
  ) => PathfinderCustomerWorkspace
) {
  if (!Number.isFinite(Date.parse(expectedPolicyUpdatedAt))) {
    throw new CustomerProofCapabilityValidationError(
      "The current Proof settings version is required. Refresh the customer page and try again."
    );
  }
  const config = getPathfinderPersistenceRuntimeConfig();
  const timestamp = now();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: tables.workspaces,
      Key: { customer_id: dynamoString(customer.lift_customer_id) },
      ConsistentRead: true
    }));
    const storedData = response.Item?.data?.S;
    const storedWorkspace = response.Item
      ? parseDynamoData<PathfinderCustomerWorkspace>(response.Item as Record<string, AttributeValue>)
      : null;
    if (!storedWorkspace) {
      throw new CustomerProofCapabilityValidationError(
        "Set up this customer workspace before saving Vornan Proof settings."
      );
    }
    const workspace = normalizeWorkspace(storedWorkspace);
    if (workspace.proof_capability_policy.updated_at !== expectedPolicyUpdatedAt) {
      throw new CustomerProofCapabilityConflictError();
    }
    const previousPolicy = JSON.stringify(workspace.proof_capability_policy);
    const previousAudit = JSON.stringify(workspace.proof_capability_audit);
    const next = mutation(workspace, timestamp);
    if (
      JSON.stringify(next.proof_capability_policy) === previousPolicy &&
      JSON.stringify(next.proof_capability_audit) === previousAudit
    ) {
      return workspace;
    }
    next.updated_at = timestamp;
    const command = new PutItemCommand({
      TableName: tables.workspaces,
      Item: dynamoItem(
        { customer_id: customer.lift_customer_id },
        workspaceRecord(next)
      ),
      ConditionExpression: storedData
        ? "#stored_data = :expected_data"
        : "attribute_not_exists(customer_id)",
      ...(storedData
        ? {
            ExpressionAttributeNames: { "#stored_data": "data" },
            ExpressionAttributeValues: { ":expected_data": { S: storedData } }
          }
        : {})
    });
    try {
      await getDynamoClient().send(command);
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        throw new CustomerProofCapabilityConflictError();
      }
      throw new CustomerProofCapabilityPersistenceError();
    }
    const scope = pathfinderStoreReadScope.getStore();
    if (scope?.store) scope.store.workspaces[customer.lift_customer_id] = next;
    return next;
  }

  const store = await readStore();
  const storedWorkspace = store.workspaces[customer.lift_customer_id];
  if (!storedWorkspace) {
    throw new CustomerProofCapabilityValidationError(
      "Set up this customer workspace before saving Vornan Proof settings."
    );
  }
  const workspace = normalizeWorkspace(storedWorkspace);
  if (workspace.proof_capability_policy.updated_at !== expectedPolicyUpdatedAt) {
    throw new CustomerProofCapabilityConflictError();
  }
  const previousPolicy = JSON.stringify(workspace.proof_capability_policy);
  const previousAudit = JSON.stringify(workspace.proof_capability_audit);
  const next = mutation(workspace, timestamp);
  if (
    JSON.stringify(next.proof_capability_policy) === previousPolicy &&
    JSON.stringify(next.proof_capability_audit) === previousAudit
  ) {
    return workspace;
  }
  next.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = next;
  try {
    await writeStore(store);
  } catch {
    throw new CustomerProofCapabilityPersistenceError();
  }
  return next;
}

export async function updateCustomerProofCapabilityPolicy(
  customer: LiftCustomer,
  policyPatch: Pick<CustomerProofCapabilityPolicy, "access_mode" | "review_experience">,
  actorId: string,
  expectedPolicyUpdatedAt: string
) {
  assertCustomerProofCapabilityInput(
    policyPatch.access_mode,
    policyPatch.review_experience
  );
  return mutateCustomerProofCapabilityWorkspace(
    customer,
    expectedPolicyUpdatedAt,
    (workspace, timestamp) => {
      const previous = workspace.proof_capability_policy;
      if (policyPatch.access_mode !== "disabled" && !previous.customer_identity) {
        throw new CustomerProofCapabilityValidationError(
          "Verify this customer's Proof identity from an associated Lift order before enabling Proof."
        );
      }
      if (
        previous.access_mode === policyPatch.access_mode &&
        previous.review_experience === policyPatch.review_experience
      ) {
        return workspace;
      }
      const next = normalizeCustomerProofCapabilityPolicy({
        ...previous,
        access_mode: policyPatch.access_mode,
        review_experience: policyPatch.review_experience,
        updated_at: timestamp,
        updated_by: safeProofCapabilityActor(actorId)
      }, timestamp);
      if (
        previous.access_mode !== next.access_mode ||
        previous.review_experience !== next.review_experience
      ) {
        workspace.proof_capability_audit = [
          proofCapabilityAuditEntry({
            scope: "customer",
            order_number: null,
            previous_access_mode: previous.access_mode,
            next_access_mode: next.access_mode,
            previous_review_experience: previous.review_experience,
            next_review_experience: next.review_experience,
            actor_id: actorId,
            created_at: timestamp
          }),
          ...workspace.proof_capability_audit
        ].slice(0, 100);
      }
      workspace.proof_capability_policy = next;
      return workspace;
    }
  );
}

export async function upsertCustomerProofOrderOverride(
  customer: LiftCustomer,
  orderNumberValue: string,
  policyPatch: Pick<CustomerProofOrderOverride, "access_mode" | "review_experience">,
  actorId: string,
  expectedPolicyUpdatedAt: string
) {
  const orderNumber = orderNumberValue.trim().toUpperCase();
  if (!/^A\d{7,8}$/.test(orderNumber)) {
    throw new CustomerProofCapabilityValidationError(
      "A valid Lift order number is required for a Proof override."
    );
  }
  assertCustomerProofCapabilityInput(
    policyPatch.access_mode,
    policyPatch.review_experience
  );
  return mutateCustomerProofCapabilityWorkspace(
    customer,
    expectedPolicyUpdatedAt,
    (workspace, timestamp) => {
      const policy = workspace.proof_capability_policy;
      if (policyPatch.access_mode !== "disabled" && !policy.customer_identity) {
        throw new CustomerProofCapabilityValidationError(
          "Verify this customer's Proof identity from an associated Lift order before enabling an order exception."
        );
      }
      const previousOverride = policy.order_overrides.find(
        (candidate) => candidate.order_number === orderNumber
      );
      if (
        previousOverride?.access_mode === policyPatch.access_mode &&
        previousOverride?.review_experience === policyPatch.review_experience
      ) {
        return workspace;
      }
      if (
        !previousOverride &&
        policy.access_mode === policyPatch.access_mode &&
        policy.review_experience === policyPatch.review_experience
      ) {
        return workspace;
      }
      const previousAccessMode = previousOverride?.access_mode ?? policy.access_mode;
      const previousReviewExperience = previousOverride?.review_experience ?? policy.review_experience;
      const nextOverride: CustomerProofOrderOverride = {
        order_number: orderNumber,
        access_mode: policyPatch.access_mode,
        review_experience: policyPatch.review_experience,
        updated_at: timestamp,
        updated_by: safeProofCapabilityActor(actorId)
      };
      workspace.proof_capability_policy = normalizeCustomerProofCapabilityPolicy({
        ...policy,
        order_overrides: [
          nextOverride,
          ...policy.order_overrides.filter(
            (candidate) => candidate.order_number !== orderNumber
          )
        ],
        updated_at: timestamp,
        updated_by: safeProofCapabilityActor(actorId)
      }, timestamp);
      if (
        previousAccessMode !== nextOverride.access_mode ||
        previousReviewExperience !== nextOverride.review_experience
      ) {
        workspace.proof_capability_audit = [
          proofCapabilityAuditEntry({
            scope: "order",
            order_number: orderNumber,
            previous_access_mode: previousAccessMode,
            next_access_mode: nextOverride.access_mode,
            previous_review_experience: previousReviewExperience,
            next_review_experience: nextOverride.review_experience,
            actor_id: actorId,
            created_at: timestamp
          }),
          ...workspace.proof_capability_audit
        ].slice(0, 100);
      }
      return workspace;
    }
  );
}

export async function verifyCustomerProofCustomerIdentity(
  customer: LiftCustomer,
  proofCustomerIdValue: string,
  verifiedOrderNumberValue: string,
  actorId: string,
  expectedPolicyUpdatedAt: string
) {
  const proofCustomerId = proofCustomerIdValue.trim();
  const verifiedOrderNumber = verifiedOrderNumberValue.trim().toUpperCase();
  if (!/^\d{1,20}$/.test(proofCustomerId) || !/^A\d{7,8}$/.test(verifiedOrderNumber)) {
    throw new CustomerProofCapabilityValidationError(
      "Proof customer identity requires an exact numeric customer ID and associated Lift order."
    );
  }
  return mutateCustomerProofCapabilityWorkspace(
    customer,
    expectedPolicyUpdatedAt,
    (workspace, timestamp) => {
      const policy = workspace.proof_capability_policy;
      const previousIdentity = policy.customer_identity;
      const nextIdentity: CustomerProofCustomerIdentity = {
        proof_customer_id: proofCustomerId,
        verified_order_number: verifiedOrderNumber,
        verified_at: timestamp,
        verified_by: safeProofCapabilityActor(actorId)
      };
      if (
        previousIdentity?.proof_customer_id === nextIdentity.proof_customer_id &&
        previousIdentity.verified_order_number === nextIdentity.verified_order_number
      ) {
        return workspace;
      }
      workspace.proof_capability_policy = normalizeCustomerProofCapabilityPolicy({
        ...policy,
        customer_identity: nextIdentity,
        updated_at: timestamp,
        updated_by: safeProofCapabilityActor(actorId)
      }, timestamp);
      workspace.proof_capability_audit = [
        proofCapabilityAuditEntry({
          scope: "identity",
          order_number: verifiedOrderNumber,
          previous_access_mode: policy.access_mode,
          next_access_mode: policy.access_mode,
          previous_review_experience: policy.review_experience,
          next_review_experience: policy.review_experience,
          actor_id: actorId,
          created_at: timestamp,
          previous_proof_customer_id: previousIdentity?.proof_customer_id ?? null,
          next_proof_customer_id: proofCustomerId,
          verification_order_number: verifiedOrderNumber
        }),
        ...workspace.proof_capability_audit
      ].slice(0, 100);
      return workspace;
    }
  );
}

export async function removeCustomerProofOrderOverride(
  customer: LiftCustomer,
  orderNumberValue: string,
  actorId: string,
  expectedPolicyUpdatedAt: string
) {
  const orderNumber = orderNumberValue.trim().toUpperCase();
  if (!/^A\d{7,8}$/.test(orderNumber)) {
    throw new CustomerProofCapabilityValidationError(
      "A valid Lift order number is required for a Proof override."
    );
  }
  return mutateCustomerProofCapabilityWorkspace(
    customer,
    expectedPolicyUpdatedAt,
    (workspace, timestamp) => {
      const policy = workspace.proof_capability_policy;
      const previous = policy.order_overrides.find(
        (candidate) => candidate.order_number === orderNumber
      );
      if (!previous) return workspace;
      workspace.proof_capability_policy = normalizeCustomerProofCapabilityPolicy({
        ...policy,
        order_overrides: policy.order_overrides.filter(
          (candidate) => candidate.order_number !== orderNumber
        ),
        updated_at: timestamp,
        updated_by: safeProofCapabilityActor(actorId)
      }, timestamp);
      workspace.proof_capability_audit = [
        proofCapabilityAuditEntry({
          scope: "order",
          order_number: orderNumber,
          previous_access_mode: previous.access_mode,
          next_access_mode: policy.access_mode,
          previous_review_experience: previous.review_experience,
          next_review_experience: policy.review_experience,
          actor_id: actorId,
          created_at: timestamp
        }),
        ...workspace.proof_capability_audit
      ].slice(0, 100);
      return workspace;
    }
  );
}

function unresolvedCustomerProofCapability(
  associationStatus: "unassociated" | "ambiguous"
): ResolvedCustomerProofCapability {
  return {
    association_status: associationStatus,
    pathfinder_customer_id: null,
    proof_customer_id: null,
    identity_verified_at: null,
    customer_name: null,
    access_mode: "view_only",
    review_experience: "simple",
    source: "safe_default",
    policy_updated_at: null
  };
}

function resolvedCustomerProofCapabilityFromWorkspace(
  workspace: PathfinderCustomerWorkspace,
  orderNumber: string
): ResolvedCustomerProofCapability {
  const normalized = normalizeWorkspace(workspace);
  const policy = normalized.proof_capability_policy;
  const override = policy.order_overrides.find(
    (candidate) => candidate.order_number === orderNumber
  );
  return {
    association_status: "associated",
    pathfinder_customer_id: normalized.customer.lift_customer_id,
    proof_customer_id: policy.customer_identity?.proof_customer_id ?? null,
    identity_verified_at: policy.customer_identity?.verified_at ?? null,
    customer_name: normalized.customer.customer_name,
    access_mode: override?.access_mode ?? policy.access_mode,
    review_experience: override?.review_experience ?? policy.review_experience,
    source: override ? "order_override" : "customer_default",
    policy_updated_at: override?.updated_at ?? policy.updated_at
  };
}

export async function resolveCustomerProofCapabilityForCustomerOrder(
  customerIdValue: string,
  orderNumberValue: string
): Promise<ResolvedCustomerProofCapability> {
  const customerId = customerIdValue.trim();
  const orderNumber = orderNumberValue.trim().toUpperCase();
  if (!/^\d{1,20}$/.test(customerId)) {
    throw new CustomerProofCapabilityValidationError(
      "A valid verified customer ID is required to resolve Proof capability."
    );
  }
  if (!/^A\d{7,8}$/.test(orderNumber)) {
    throw new CustomerProofCapabilityValidationError(
      "A valid Lift order number is required to resolve Proof capability."
    );
  }
  const store = await readStore();
  const workspace = store.workspaces[customerId];
  if (!workspace) return unresolvedCustomerProofCapability("unassociated");
  const normalized = normalizeWorkspace(workspace);
  if (normalized.customer.lift_customer_id !== customerId) {
    return unresolvedCustomerProofCapability("unassociated");
  }
  return resolvedCustomerProofCapabilityFromWorkspace(normalized, orderNumber);
}

export async function resolveCustomerProofCapabilityForOrder(
  orderNumberValue: string
): Promise<ResolvedCustomerProofCapability> {
  const orderNumber = orderNumberValue.trim().toUpperCase();
  if (!/^A\d{7,8}$/.test(orderNumber)) {
    throw new CustomerProofCapabilityValidationError(
      "A valid Lift order number is required to resolve Proof capability."
    );
  }
  const store = await readStore();
  const customerIds = [...new Set(
    store.jobs
      .filter((job) => job.target_order_number?.trim().toUpperCase() === orderNumber)
      .map((job) => job.customer_id)
      .filter(Boolean)
  )];
  if (customerIds.length !== 1) {
    return unresolvedCustomerProofCapability(
      customerIds.length ? "ambiguous" : "unassociated"
    );
  }
  const workspace = store.workspaces[customerIds[0]!];
  if (!workspace) return unresolvedCustomerProofCapability("unassociated");
  return resolvedCustomerProofCapabilityFromWorkspace(workspace, orderNumber);
}

export async function listJobs() {
  const store = await readStore();
  return store.jobs;
}

export async function getJob(customer: LiftCustomer, jobId: string) {
  const store = await readStore();
  return store.jobs.find((job) => job.customer_id === customer.lift_customer_id && job.job_id === jobId) ?? null;
}

export async function persistJobSnapshot(customer: LiftCustomer, job: ProcessingJobPreview) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const nextJob = {
    ...job,
    updated_at: now()
  };

  store.jobs = [
    nextJob,
    ...store.jobs.filter(
      (candidate) => candidate.customer_id !== customer.lift_customer_id || candidate.job_id !== job.job_id
    )
  ];
  workspace.jobs = store.jobs.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
  workspace.updated_at = nextJob.updated_at;
  store.workspaces[customer.lift_customer_id] = workspace;
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    await upsertDynamoTableMonotonic(tables.jobs, [
      dynamoItem(
        { customer_id: nextJob.customer_id, job_id: nextJob.job_id },
        compactProcessingJobForDynamo(nextJob)
      )
    ]);
  } else {
    await writeStore(store);
  }

  return nextJob;
}

export class WrikeSourceOrderReviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrikeSourceOrderReviewConflictError";
  }
}

let localWrikeSourceOrderReviewQueue: Promise<void> = Promise.resolve();

function normalizedSourceOrderReviewNote(value: string | null | undefined) {
  const note = value?.trim().replace(/\s+/g, " ") ?? "";
  if (note.length > 300) {
    throw new WrikeSourceOrderReviewConflictError("Keep the review note to 300 characters or fewer.");
  }
  return note || null;
}

function nextSourceOrderReviewDisposition(args: {
  job: ProcessingJobPreview;
  event_id: string;
  disposition: WrikeSourceOrderReviewDispositionValue;
  actor_id: string;
  note?: string | null;
  created_at: string;
}) {
  const event = args.job.source_order_history?.find(
    (entry) =>
      entry.event_id === args.event_id &&
      entry.action === "source_change_observed_after_transport"
  );
  if (!event) {
    throw new WrikeSourceOrderReviewConflictError(
      "This source review event is no longer available. Refresh the job and try again."
    );
  }
  const existing = args.job.source_order_review_dispositions?.find(
    (entry) => entry.event_id === args.event_id
  );
  if (existing) return { job: args.job, disposition: existing, reused: true as const };
  const actorId = args.actor_id.trim().toLowerCase().slice(0, 200) || "authenticated-operator";
  const disposition: WrikeSourceOrderReviewDisposition = {
    disposition_id: `wsord_${createHash("sha256")
      .update("pathfinder-wrike-source-order-review-v1\0")
      .update(args.job.customer_id)
      .update("\0")
      .update(args.job.job_id)
      .update("\0")
      .update(args.event_id)
      .digest("hex")}`,
    event_id: args.event_id,
    disposition: args.disposition,
    actor_id: actorId,
    created_at: args.created_at,
    note: normalizedSourceOrderReviewNote(args.note)
  };
  return {
    job: {
      ...args.job,
      updated_at: args.created_at,
      source_order_review_dispositions: [
        disposition,
        ...(args.job.source_order_review_dispositions ?? [])
      ].slice(0, 100)
    },
    disposition,
    reused: false as const
  };
}

export async function recordWrikeSourceOrderReviewDisposition(
  customer: LiftCustomer,
  args: {
    job_id: string;
    event_id: string;
    disposition: WrikeSourceOrderReviewDispositionValue;
    actor_id: string;
    note?: string | null;
  }
) {
  if (!["no_lift_update_needed", "resolved"].includes(args.disposition)) {
    throw new WrikeSourceOrderReviewConflictError("Choose a supported source review disposition.");
  }
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: tables.jobs,
      Key: {
        customer_id: dynamoString(customer.lift_customer_id),
        job_id: dynamoString(args.job_id)
      },
      ConsistentRead: true
    }));
    const item = response.Item as Record<string, AttributeValue> | undefined;
    const job = item ? parseDynamoData<ProcessingJobPreview>(item) : null;
    if (!job) return null;
    const next = nextSourceOrderReviewDisposition({
      job,
      event_id: args.event_id,
      disposition: args.disposition,
      actor_id: args.actor_id,
      note: args.note,
      created_at: now()
    });
    if (next.reused) return next;
    const expectedUpdatedAt = item?.updated_at?.S;
    if (!expectedUpdatedAt) {
      throw new WrikeSourceOrderReviewConflictError(
        "The current job version could not be verified safely. Refresh and try again."
      );
    }
    try {
      await getDynamoClient().send(new PutItemCommand({
        TableName: tables.jobs,
        Item: {
          ...dynamoItem(
            { customer_id: next.job.customer_id, job_id: next.job.job_id },
            compactProcessingJobForDynamo(next.job)
          ),
          updated_at: dynamoString(next.job.updated_at)
        },
        ConditionExpression: "updated_at = :expected_updated_at",
        ExpressionAttributeValues: {
          ":expected_updated_at": dynamoString(expectedUpdatedAt)
        }
      }));
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
      throw new WrikeSourceOrderReviewConflictError(
        "This job changed while the review was being saved. Refresh and try again."
      );
    }
    return next;
  }

  const operation = localWrikeSourceOrderReviewQueue.then(async () => {
    const store = await readStore();
    const job = store.jobs.find(
      (candidate) =>
        candidate.customer_id === customer.lift_customer_id && candidate.job_id === args.job_id
    );
    if (!job) return null;
    const next = nextSourceOrderReviewDisposition({
      job,
      event_id: args.event_id,
      disposition: args.disposition,
      actor_id: args.actor_id,
      note: args.note,
      created_at: now()
    });
    if (next.reused) return next;
    store.jobs = store.jobs.map((candidate) =>
      candidate.customer_id === customer.lift_customer_id && candidate.job_id === args.job_id
        ? next.job
        : candidate
    );
    const workspace = normalizeWorkspace(
      store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer)
    );
    workspace.jobs = store.jobs.filter(
      (candidate) => candidate.customer_id === customer.lift_customer_id
    );
    workspace.updated_at = next.job.updated_at;
    store.workspaces[customer.lift_customer_id] = workspace;
    await writeStore(store);
    return next;
  });
  localWrikeSourceOrderReviewQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export class LiftOrderAssociationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiftOrderAssociationConflictError";
  }
}

let localLiftOrderAssociationQueue: Promise<void> = Promise.resolve();

function normalizedLiftOrderNumber(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function buildLiftOrderAssociationEntry(args: {
  job: ProcessingJobPreview;
  order_number: string;
  linked_at: string;
  linked_by_email?: string | null;
  reason: string;
  verification: LiftOrderAssociationVerification;
  source?: LiftOrderAssociationHistoryEntry["source"];
}): LiftOrderAssociationHistoryEntry {
  const previousOrderNumber = normalizedLiftOrderNumber(args.job.target_order_number);
  return {
    association_id: `loa_${createHash("sha256")
      .update("pathfinder-lift-order-association-v1")
      .update("\0")
      .update(args.job.customer_id)
      .update("\0")
      .update(args.job.job_id)
      .update("\0")
      .update(previousOrderNumber ?? "")
      .update("\0")
      .update(args.order_number)
      .update("\0")
      .update(args.linked_at)
      .digest("hex")}`,
    source: args.source ?? "manual_verified",
    action: previousOrderNumber ? "replaced" : "linked",
    previous_order_number: previousOrderNumber,
    order_number: args.order_number,
    linked_at: args.linked_at,
    linked_by_email: args.linked_by_email?.trim().toLowerCase() || null,
    reason: args.reason,
    verification: args.verification,
    automatic_wrike_status_writeback_suppressed:
      args.source === "scheduled_uncertain_reconciliation" ? true : undefined
  };
}

function nextLiftOrderAssociatedJob(args: {
  job: ProcessingJobPreview;
  order_number: string;
  lookup_url: string | null;
  linked_at: string;
  linked_by_email?: string | null;
  reason: string;
  verification: LiftOrderAssociationVerification;
  source?: LiftOrderAssociationHistoryEntry["source"];
}) {
  const association = buildLiftOrderAssociationEntry(args);
  const job: ProcessingJobPreview = {
    ...args.job,
    state: "Order Confirmed",
    target_order_number: args.order_number,
    order_confirmed_at: args.job.order_confirmed_at ?? args.linked_at,
    target_order_lookup_url: args.lookup_url,
    target_order_association_history: [
      ...(args.job.target_order_association_history ?? []),
      association
    ],
    updated_at: args.linked_at
  };
  return { job, association };
}

export async function associateJobWithLiftOrder(
  customer: LiftCustomer,
  args: {
    job_id: string;
    order_number: string;
    expected_current_order_number?: string | null;
    linked_by_email?: string | null;
    reason: string;
    verification: LiftOrderAssociationVerification;
    source?: LiftOrderAssociationHistoryEntry["source"];
    expected_uncertain_attempt?: {
      attempt_id: string;
      idempotency_key: string;
      request_fingerprint: string | null;
    } | null;
  }
) {
  const orderNumber = normalizedLiftOrderNumber(args.order_number);
  const expectedCurrentOrderNumber = normalizedLiftOrderNumber(args.expected_current_order_number);
  if (!orderNumber || args.verification.order_number !== orderNumber) {
    throw new LiftOrderAssociationConflictError("The verified Lift order binding is invalid.");
  }
  const reason = args.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 8 || reason.length > 500) {
    throw new LiftOrderAssociationConflictError("Enter an association reason between 8 and 500 characters.");
  }

  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: tables.jobs,
      Key: {
        customer_id: dynamoString(customer.lift_customer_id),
        job_id: dynamoString(args.job_id)
      },
      ConsistentRead: true
    }));
    const item = response.Item as Record<string, AttributeValue> | undefined;
    const job = item ? parseDynamoData<ProcessingJobPreview>(item) : null;
    if (!job) return null;
    const currentOrderNumber = normalizedLiftOrderNumber(job.target_order_number);
    if (currentOrderNumber === orderNumber) {
      return { job, association: null, reused: true as const };
    }
    if (currentOrderNumber !== expectedCurrentOrderNumber) {
      throw new LiftOrderAssociationConflictError(
        "The job's Lift order association changed after verification. Refresh and verify the replacement again."
      );
    }
    const route = await getDynamoData<OutputRoute>(tables.output_routes, {
      customer_id: customer.lift_customer_id,
      output_route_id: job.output_route_id
    }, true);
    const linkedAt = now();
    const next = nextLiftOrderAssociatedJob({
      job,
      order_number: orderNumber,
      lookup_url: buildLiftOrderLookupUrl(route?.order_lookup_url, orderNumber),
      linked_at: linkedAt,
      linked_by_email: args.linked_by_email,
      reason,
      verification: args.verification,
      source: args.source
    });
    const expectedUpdatedAt = item?.updated_at?.S;
    if (!expectedUpdatedAt) {
      throw new LiftOrderAssociationConflictError("The current job version could not be verified safely.");
    }
    try {
      const jobPut = {
        TableName: tables.jobs,
        Item: {
          ...dynamoItem(
            { customer_id: next.job.customer_id, job_id: next.job.job_id },
            compactProcessingJobForDynamo(next.job)
          ),
          updated_at: dynamoString(linkedAt),
          target_order_number: dynamoString(orderNumber)
        },
        ConditionExpression: "updated_at = :expected_updated_at",
        ExpressionAttributeValues: {
          ":expected_updated_at": dynamoString(expectedUpdatedAt)
        }
      };
      if (args.expected_uncertain_attempt) {
        await getDynamoClient().send(new TransactWriteItemsCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: tables.submit_attempts,
                Key: {
                  customer_id: dynamoString(customer.lift_customer_id),
                  attempt_id: dynamoString(args.expected_uncertain_attempt.attempt_id)
                },
                ConditionExpression:
                  "#state = :uncertain AND idempotency_key = :idempotency_key",
                ExpressionAttributeNames: { "#state": "state" },
                ExpressionAttributeValues: {
                  ":uncertain": dynamoString("Submission Uncertain"),
                  ":idempotency_key": dynamoString(args.expected_uncertain_attempt.idempotency_key)
                }
              }
            },
            { Put: jobPut }
          ]
        }));
      } else {
        await getDynamoClient().send(new PutItemCommand(jobPut));
      }
    } catch (error) {
      const transactionConditionFailed = Boolean(
        args.expected_uncertain_attempt &&
        error &&
        typeof error === "object" &&
        "name" in error &&
        (error as { name?: unknown }).name === "TransactionCanceledException"
      );
      if (!isConditionalCheckFailure(error) && !transactionConditionFailed) throw error;
      throw new LiftOrderAssociationConflictError(
        "The job changed while the Lift order association was being saved. Refresh and verify it again."
      );
    }
    return { ...next, reused: false as const };
  }

  const operation = localLiftOrderAssociationQueue.then(async () => {
    const store = await readStore();
    const job = store.jobs.find(
      (candidate) => candidate.customer_id === customer.lift_customer_id && candidate.job_id === args.job_id
    );
    if (!job) return null;
    const currentOrderNumber = normalizedLiftOrderNumber(job.target_order_number);
    if (currentOrderNumber === orderNumber) {
      return { job, association: null, reused: true as const };
    }
    if (currentOrderNumber !== expectedCurrentOrderNumber) {
      throw new LiftOrderAssociationConflictError(
        "The job's Lift order association changed after verification. Refresh and verify the replacement again."
      );
    }
    const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
    const route = workspace.output_routes.find((candidate) => candidate.output_route_id === job.output_route_id);
    const next = nextLiftOrderAssociatedJob({
      job,
      order_number: orderNumber,
      lookup_url: buildLiftOrderLookupUrl(route?.order_lookup_url, orderNumber),
      linked_at: now(),
      linked_by_email: args.linked_by_email,
      reason,
      verification: args.verification,
      source: args.source
    });
    if (args.expected_uncertain_attempt) {
      const attempt = store.submit_attempts.find(
        (candidate) =>
          candidate.customer_id === customer.lift_customer_id &&
          candidate.attempt_id === args.expected_uncertain_attempt?.attempt_id
      );
      if (
        !attempt ||
        attempt.state !== "Submission Uncertain" ||
        attempt.idempotency_key !== args.expected_uncertain_attempt.idempotency_key ||
        (attempt.request_fingerprint?.trim() || null) !==
          args.expected_uncertain_attempt.request_fingerprint
      ) {
        throw new LiftOrderAssociationConflictError(
          "The uncertain submit attempt changed after verification. Refresh and verify it again."
        );
      }
    }
    store.jobs = store.jobs.map((candidate) =>
      candidate.customer_id === customer.lift_customer_id && candidate.job_id === args.job_id
        ? next.job
        : candidate
    );
    workspace.jobs = store.jobs.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
    workspace.updated_at = next.job.updated_at;
    store.workspaces[customer.lift_customer_id] = workspace;
    await writeStore(store);
    return { ...next, reused: false as const };
  });
  localLiftOrderAssociationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export class WrikeStatusWritebackConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrikeStatusWritebackConflictError";
  }
}

let localWrikeStatusWritebackQueue: Promise<void> = Promise.resolve();

function wrikeStatusWritebackId(args: {
  customer_id: string;
  job_id: string;
  task_id: string;
  order_number: string;
}) {
  return `wsw_${createHash("sha256")
    .update("pathfinder-wrike-status-writeback-v1\0")
    .update(args.customer_id)
    .update("\0")
    .update(args.job_id)
    .update("\0")
    .update(args.task_id)
    .update("\0")
    .update(args.order_number)
    .digest("hex")}`;
}

async function mutateJobForWrikeStatusWriteback(
  customer: LiftCustomer,
  jobId: string,
  transform: (job: ProcessingJobPreview) => { job: ProcessingJobPreview; record: WrikeStatusWritebackRecord }
) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: tables.jobs,
      Key: { customer_id: dynamoString(customer.lift_customer_id), job_id: dynamoString(jobId) },
      ConsistentRead: true
    }));
    const item = response.Item as Record<string, AttributeValue> | undefined;
    const job = item ? parseDynamoData<ProcessingJobPreview>(item) : null;
    if (!job) return null;
    const expectedUpdatedAt = item?.updated_at?.S;
    if (!expectedUpdatedAt) {
      throw new WrikeStatusWritebackConflictError("The current job version could not be verified safely.");
    }
    const next = transform(job);
    try {
      await getDynamoClient().send(new PutItemCommand({
        TableName: tables.jobs,
        Item: {
          ...dynamoItem(
            { customer_id: next.job.customer_id, job_id: next.job.job_id },
            compactProcessingJobForDynamo(next.job)
          ),
          updated_at: dynamoString(next.job.updated_at)
        },
        ConditionExpression: "updated_at = :expected_updated_at",
        ExpressionAttributeValues: { ":expected_updated_at": dynamoString(expectedUpdatedAt) }
      }));
    } catch (error) {
      if (!isConditionalCheckFailure(error)) throw error;
      throw new WrikeStatusWritebackConflictError(
        "The job changed while the Wrike status comment was being prepared. Refresh before trying again."
      );
    }
    return next;
  }

  const operation = localWrikeStatusWritebackQueue.then(async () => {
    const store = await readStore();
    const job = store.jobs.find(
      (candidate) => candidate.customer_id === customer.lift_customer_id && candidate.job_id === jobId
    );
    if (!job) return null;
    const next = transform(job);
    const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
    store.jobs = store.jobs.map((candidate) =>
      candidate.customer_id === customer.lift_customer_id && candidate.job_id === jobId ? next.job : candidate
    );
    workspace.jobs = store.jobs.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
    workspace.updated_at = next.job.updated_at;
    store.workspaces[customer.lift_customer_id] = workspace;
    await writeStore(store);
    return next;
  });
  localWrikeStatusWritebackQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function prepareWrikeStatusWriteback(
  customer: LiftCustomer,
  args: {
    job_id: string;
    task_id: string;
    connection_id: string;
    order_number: string;
    contract_number: string;
    comment_sha256: string;
    status_url_sha256: string;
    prepared_by_email?: string | null;
  }
) {
  const writebackId = wrikeStatusWritebackId({
    customer_id: customer.lift_customer_id,
    job_id: args.job_id,
    task_id: args.task_id,
    order_number: args.order_number
  });
  return mutateJobForWrikeStatusWriteback(customer, args.job_id, (job) => {
    const existing = (job.wrike_status_writebacks ?? []).find((entry) => entry.writeback_id === writebackId);
    if (existing) {
      const same =
        existing.connection_id === args.connection_id &&
        existing.contract_number === args.contract_number &&
        existing.comment_sha256 === args.comment_sha256 &&
        existing.status_url_sha256 === args.status_url_sha256;
      if (!same) {
        throw new WrikeStatusWritebackConflictError(
          "A different Wrike status comment is already bound to this task and Lift order."
        );
      }
      return { job, record: existing };
    }
    const timestamp = now();
    const record: WrikeStatusWritebackRecord = {
      writeback_id: writebackId,
      task_id: args.task_id,
      connection_id: args.connection_id,
      order_number: args.order_number,
      contract_number: args.contract_number,
      comment_sha256: args.comment_sha256,
      status_url_sha256: args.status_url_sha256,
      state: "prepared",
      prepared_at: timestamp,
      updated_at: timestamp,
      posted_at: null,
      comment_id: null,
      failure_category: null,
      prepared_by_email: args.prepared_by_email?.trim().toLowerCase() || null
    };
    return {
      record,
      job: { ...job, wrike_status_writebacks: [...(job.wrike_status_writebacks ?? []), record], updated_at: timestamp }
    };
  });
}

export async function transitionWrikeStatusWriteback(
  customer: LiftCustomer,
  args: {
    job_id: string;
    writeback_id: string;
    expected_state: WrikeStatusWritebackRecord["state"];
    next_state: WrikeStatusWritebackRecord["state"];
    comment_id?: string | null;
    failure_category?: string | null;
  }
) {
  return mutateJobForWrikeStatusWriteback(customer, args.job_id, (job) => {
    const entries = job.wrike_status_writebacks ?? [];
    const current = entries.find((entry) => entry.writeback_id === args.writeback_id);
    if (!current) throw new WrikeStatusWritebackConflictError("The prepared Wrike status comment was not found.");
    if (current.state !== args.expected_state) {
      throw new WrikeStatusWritebackConflictError(
        `The Wrike status comment is already ${current.state.replace(/_/g, " ")}; it will not be posted again.`
      );
    }
    const timestamp = now();
    const record: WrikeStatusWritebackRecord = {
      ...current,
      state: args.next_state,
      updated_at: timestamp,
      posted_at: args.next_state === "posted" ? timestamp : current.posted_at,
      comment_id: args.comment_id ?? current.comment_id,
      failure_category: args.failure_category ?? null
    };
    return {
      record,
      job: {
        ...job,
        wrike_status_writebacks: entries.map((entry) => entry.writeback_id === record.writeback_id ? record : entry),
        updated_at: timestamp
      }
    };
  });
}

export async function setJobsArchived(
  customer: LiftCustomer,
  jobIds: string[],
  archived: boolean,
  archivedByEmail?: string | null
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const requestedIds = new Set(jobIds.map((jobId) => jobId.trim()).filter(Boolean));
  const timestamp = now();
  const updatedJobs: ProcessingJobPreview[] = [];

  store.jobs = store.jobs.map((job) => {
    if (job.customer_id !== customer.lift_customer_id || !requestedIds.has(job.job_id)) {
      return job;
    }

    const nextJob: ProcessingJobPreview = {
      ...job,
      archived_at: archived ? timestamp : null,
      archived_by_email: archived ? archivedByEmail ?? null : null,
      updated_at: timestamp
    };
    updatedJobs.push(nextJob);
    return nextJob;
  });

  workspace.jobs = store.jobs.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);

  return {
    jobs: updatedJobs,
    workspace
  };
}

export async function getSubmitAttemptByIdempotencyKey(customer: LiftCustomer, idempotencyKey: string) {
  const store = await readStore();
  return (
    store.submit_attempts.find(
      (attempt) => attempt.customer_id === customer.lift_customer_id && attempt.idempotency_key === idempotencyKey
    ) ?? null
  );
}

function isConditionalCheckFailure(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "ConditionalCheckFailedException"
  );
}

let localSubmitAttemptReservationQueue: Promise<void> = Promise.resolve();

export async function reserveSubmitAttempt(customer: LiftCustomer, attempt: SubmitAttempt) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tableName = getDynamoTableConfig().submit_attempts;
    try {
      await getDynamoClient().send(new PutItemCommand({
        TableName: tableName,
        Item: {
          ...dynamoItem({ customer_id: attempt.customer_id, attempt_id: attempt.attempt_id }, attempt),
          idempotency_key: dynamoString(attempt.idempotency_key),
          state: dynamoString(attempt.state),
          transport_completed: { BOOL: false }
        },
        ConditionExpression: "attribute_not_exists(customer_id) AND attribute_not_exists(attempt_id)"
      }));
      replaceScopedSubmitAttempt(attempt);
      return { attempt, created: true as const };
    } catch (error) {
      if (!isConditionalCheckFailure(error)) {
        throw error;
      }
      const response = await getDynamoClient().send(new GetItemCommand({
        TableName: tableName,
        Key: {
          customer_id: dynamoString(attempt.customer_id),
          attempt_id: dynamoString(attempt.attempt_id)
        },
        ConsistentRead: true
      }));
      const existing = response.Item
        ? parseDynamoData<SubmitAttempt>(response.Item as Record<string, AttributeValue>)
        : null;
      if (!existing || existing.idempotency_key !== attempt.idempotency_key) {
        throw new Error("The reserved submit attempt could not be reconciled safely.");
      }
      const normalizedExisting = normalizeSubmitAttempt(existing);
      replaceScopedSubmitAttempt(normalizedExisting);
      return { attempt: normalizedExisting, created: false as const };
    }
  }

  const operation = localSubmitAttemptReservationQueue.then(async () => {
    const store = await readStore();
    const existing = store.submit_attempts.find(
      (candidate) =>
        candidate.customer_id === customer.lift_customer_id &&
        (candidate.attempt_id === attempt.attempt_id || candidate.idempotency_key === attempt.idempotency_key)
    );
    if (existing) {
      return { attempt: normalizeSubmitAttempt(existing), created: false as const };
    }
    const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
    store.submit_attempts = [attempt, ...(store.submit_attempts ?? [])];
    workspace.submit_attempts = store.submit_attempts.filter(
      (candidate) => candidate.customer_id === customer.lift_customer_id
    );
    workspace.updated_at = attempt.updated_at;
    store.workspaces[customer.lift_customer_id] = workspace;
    await writeStore(store);
    return { attempt, created: true as const };
  });
  localSubmitAttemptReservationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function normalizeSubmitAttempt(attempt: SubmitAttempt): SubmitAttempt {
  if (attempt.response.lift_order_id) {
    return attempt;
  }

  const targetOrderNumber = extractLiftOrderId(attempt.response.raw_body, attempt.response.message);
  return targetOrderNumber
    ? {
        ...attempt,
        response: {
          ...attempt.response,
          lift_order_id: targetOrderNumber
        }
      }
    : attempt;
}

function reconcileConfirmedJob(job: ProcessingJobPreview, attempts: SubmitAttempt[]): ProcessingJobPreview {
  const confirmedAttempt = attempts.find(
    (attempt) =>
      attempt.job_id === job.job_id &&
      attempt.customer_id === job.customer_id &&
      attempt.state === "Submitted" &&
      attempt.response.status === "accepted" &&
      Boolean(attempt.response.lift_order_id)
  );
  const targetOrderNumber = job.target_order_number ?? confirmedAttempt?.response.lift_order_id ?? null;

  if (!targetOrderNumber) {
    return job;
  }

  return {
    ...job,
    state: job.state === "Submitted" ? "Order Confirmed" : job.state,
    target_order_number: targetOrderNumber,
    order_confirmed_at:
      job.order_confirmed_at ??
      job.target_order_association_history?.at(-1)?.linked_at ??
      confirmedAttempt?.updated_at ??
      null
  };
}

export async function listSubmitAttemptsForJob(customer: LiftCustomer, jobId: string) {
  const store = await readStore();
  return store.submit_attempts.filter(
    (attempt) => attempt.customer_id === customer.lift_customer_id && attempt.job_id === jobId
  );
}

function normalizePersistedSubmitAttempt(attempt: SubmitAttempt) {
  const targetOrderNumber =
    attempt.response.lift_order_id ?? extractLiftOrderId(attempt.response.raw_body, attempt.response.message) ?? null;
  const normalizedAttempt = targetOrderNumber && !attempt.response.lift_order_id
    ? {
        ...attempt,
        response: {
          ...attempt.response,
          lift_order_id: targetOrderNumber
        }
      }
    : attempt;
  const submitJobState: ProcessingState | null =
    attempt.state === "Submitted"
      ? targetOrderNumber
        ? "Order Confirmed"
        : "Submitted"
      : attempt.state === "Submission Uncertain"
        ? "Submitted"
        : attempt.state === "Failed"
          ? "Submit Failed"
          : null;
  return { normalizedAttempt, submitJobState, targetOrderNumber };
}

async function persistDynamoSubmitJobState(
  customer: LiftCustomer,
  attempt: SubmitAttempt,
  submitJobState: ProcessingState | null,
  targetOrderNumber: string | null
) {
  if (!submitJobState) return null;
  const tables = getDynamoTableConfig();
  const submittedJob = await getDynamoData<ProcessingJobPreview>(tables.jobs, {
    customer_id: customer.lift_customer_id,
    job_id: attempt.job_id
  }, true);
  if (!submittedJob) return null;
  const submittedRoute = await getDynamoData<OutputRoute>(tables.output_routes, {
    customer_id: customer.lift_customer_id,
    output_route_id: submittedJob.output_route_id
  }, true);
  const targetOrderLookupUrl = buildLiftOrderLookupUrl(submittedRoute?.order_lookup_url, targetOrderNumber);
  const updatedJob: ProcessingJobPreview = {
    ...submittedJob,
    state: submitJobState,
    target_order_number: targetOrderNumber ?? submittedJob.target_order_number ?? null,
    order_confirmed_at:
      submitJobState === "Order Confirmed"
        ? submittedJob.order_confirmed_at ?? attempt.updated_at
        : submittedJob.order_confirmed_at ?? null,
    target_order_lookup_url: targetOrderLookupUrl ?? submittedJob.target_order_lookup_url ?? null,
    updated_at: attempt.updated_at
  };
  await putDynamoData(
    tables.jobs,
    { customer_id: updatedJob.customer_id, job_id: updatedJob.job_id },
    compactProcessingJobForDynamo(updatedJob)
  );
  replaceScopedJob(updatedJob);
  return updatedJob;
}

async function putDynamoSubmitAttempt(attempt: SubmitAttempt, complete: boolean, requireReservation = false) {
  const tables = getDynamoTableConfig();
  await getDynamoClient().send(new PutItemCommand({
    TableName: tables.submit_attempts,
    Item: {
      ...dynamoItem({ customer_id: attempt.customer_id, attempt_id: attempt.attempt_id }, attempt),
      idempotency_key: dynamoString(attempt.idempotency_key),
      state: dynamoString(attempt.state),
      transport_completed: { BOOL: complete }
    },
    ...(requireReservation
      ? {
          ConditionExpression:
            "idempotency_key = :idempotency_key AND #state = :submission_uncertain AND transport_completed = :false",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: {
            ":idempotency_key": dynamoString(attempt.idempotency_key),
            ":submission_uncertain": dynamoString("Submission Uncertain"),
            ":false": { BOOL: false }
          }
        }
      : {})
  }));
}

export async function finalizeReservedSubmitAttempt(customer: LiftCustomer, attempt: SubmitAttempt) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver !== "dynamodb") {
    return persistSubmitAttempt(customer, attempt);
  }
  const { normalizedAttempt, submitJobState, targetOrderNumber } = normalizePersistedSubmitAttempt(attempt);
  try {
    await putDynamoSubmitAttempt(normalizedAttempt, true, true);
  } catch (error) {
    if (!isConditionalCheckFailure(error)) throw error;
    const tables = getDynamoTableConfig();
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: tables.submit_attempts,
      Key: {
        customer_id: dynamoString(normalizedAttempt.customer_id),
        attempt_id: dynamoString(normalizedAttempt.attempt_id)
      },
      ConsistentRead: true
    }));
    const existing = response.Item
      ? parseDynamoData<SubmitAttempt>(response.Item as Record<string, AttributeValue>)
      : null;
    if (
      !existing ||
      existing.idempotency_key !== normalizedAttempt.idempotency_key ||
      response.Item?.transport_completed?.BOOL !== true
    ) {
      throw new Error("The finalized submit attempt could not be reconciled safely.");
    }
    const normalizedExisting = normalizeSubmitAttempt(existing);
    replaceScopedSubmitAttempt(normalizedExisting);
    return normalizedExisting;
  }
  await persistDynamoSubmitJobState(customer, normalizedAttempt, submitJobState, targetOrderNumber);
  replaceScopedSubmitAttempt(normalizedAttempt);
  return normalizedAttempt;
}

export async function persistSubmitAttempt(customer: LiftCustomer, attempt: SubmitAttempt) {
  const { normalizedAttempt, submitJobState, targetOrderNumber } = normalizePersistedSubmitAttempt(attempt);
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    await putDynamoSubmitAttempt(normalizedAttempt, true);
    await persistDynamoSubmitJobState(customer, normalizedAttempt, submitJobState, targetOrderNumber);
    replaceScopedSubmitAttempt(normalizedAttempt);
    return normalizedAttempt;
  }
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = attempt.updated_at;
  const submittedJob = store.jobs.find(
    (job) => job.job_id === attempt.job_id && job.customer_id === customer.lift_customer_id
  );
  const submittedRoute = submittedJob
    ? workspace.output_routes.find((route) => route.output_route_id === submittedJob.output_route_id)
    : null;
  const targetOrderLookupUrl = buildLiftOrderLookupUrl(submittedRoute?.order_lookup_url, targetOrderNumber);

  store.submit_attempts = [
    normalizedAttempt,
    ...(store.submit_attempts ?? []).filter((candidate) => candidate.attempt_id !== attempt.attempt_id)
  ];
  if (submitJobState) {
    store.jobs = store.jobs.map((job) =>
      job.job_id === attempt.job_id && job.customer_id === customer.lift_customer_id
        ? {
            ...job,
            state: submitJobState,
            target_order_number: targetOrderNumber ?? job.target_order_number ?? null,
            order_confirmed_at:
              submitJobState === "Order Confirmed"
                ? job.order_confirmed_at ?? timestamp
                : job.order_confirmed_at ?? null,
            target_order_lookup_url: targetOrderLookupUrl ?? job.target_order_lookup_url ?? null,
            updated_at: timestamp
          }
        : job
    );
  }
  workspace.submit_attempts = store.submit_attempts.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
  workspace.jobs = store.jobs.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);

  return normalizedAttempt;
}

function catalogPresetMatches(
  preset: LiftCatalogPreset,
  candidate: Pick<
    LiftCatalogPreset,
    "output_route_id" | "target_id" | "catalog_id" | "catalog_name" | "status"
  >
) {
  return (
    preset.output_route_id === candidate.output_route_id &&
    preset.target_id === candidate.target_id &&
    preset.catalog_id === candidate.catalog_id &&
    preset.catalog_name === candidate.catalog_name &&
    preset.status === candidate.status
  );
}

async function persistCatalogPresetWorkspace(
  store: PathfinderStore,
  workspace: PathfinderCustomerWorkspace,
  expectedWorkspaceUpdatedAt: string,
  operationSeed: string
) {
  store.workspaces[workspace.customer.lift_customer_id] = workspace;
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    await persistFocusedDynamoRecords(
      [{
        table_name: getDynamoTableConfig().workspaces,
        keys: { customer_id: workspace.customer.lift_customer_id },
        data: workspaceRecord(workspace),
        expected_updated_at: expectedWorkspaceUpdatedAt
      }],
      operationSeed
    );
    replaceScopedWorkspace(workspace);
    return;
  }
  await writeStore(store);
}

export async function listProductMappings(customer: LiftCustomer) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  return workspace.product_mappings;
}

export async function listCatalogPresets(customer: LiftCustomer) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  return workspace.catalog_presets;
}

export async function upsertCatalogPreset(
  customer: LiftCustomer,
  patch: Partial<LiftCatalogPreset>,
  expectedWorkspaceUpdatedAt?: string | null
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const routeId = String(patch.output_route_id ?? "").trim();
  const route = workspace.output_routes.find((candidate) => candidate.output_route_id === routeId);
  const catalogId = String(patch.catalog_id ?? "").trim();

  if (!routeId || !route) {
    throw new CatalogPresetValidationError("Choose a valid output route before saving this catalog preset.");
  }
  if (!catalogId) {
    throw new CatalogPresetValidationError("Catalog ID is required.");
  }

  const presetId =
    patch.preset_id ??
    `catalog-preset-${customer.lift_customer_id}-${route.output_route_id}-${catalogId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const existing = workspace.catalog_presets.find((preset) => preset.preset_id === presetId);
  if (existing && existing.output_route_id !== route.output_route_id) {
    throw new CatalogPresetValidationError("This catalog preset belongs to a different output route.");
  }
  const candidate = {
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    catalog_id: catalogId,
    catalog_name: String(patch.catalog_name ?? existing?.catalog_name ?? catalogId).trim() || catalogId,
    status: patch.status === "Inactive" ? "Inactive" as const : "Active" as const
  };
  if (existing && catalogPresetMatches(existing, candidate)) {
    return { workspace, changed: false };
  }
  if (expectedWorkspaceUpdatedAt && expectedWorkspaceUpdatedAt !== workspace.updated_at) {
    throw new WorkspacePersistenceConflictError();
  }
  const previousWorkspaceUpdatedAt = workspace.updated_at;
  const timestamp = now();
  const preset = normalizeCatalogPreset(
    {
      ...(existing ?? {
        preset_id: presetId,
        output_route_id: route.output_route_id,
        target_id: route.target_id,
        catalog_id: catalogId,
        catalog_name: candidate.catalog_name,
        status: "Active",
        created_at: timestamp,
        updated_at: timestamp
      }),
      ...patch,
      preset_id: presetId,
      ...candidate,
      updated_at: timestamp
    } as LiftCatalogPreset,
    workspace
  );

  workspace.catalog_presets = [
    preset,
    ...workspace.catalog_presets.filter((candidate) => candidate.preset_id !== preset.preset_id)
  ];
  workspace.updated_at = timestamp;
  await persistCatalogPresetWorkspace(
    store,
    workspace,
    previousWorkspaceUpdatedAt,
    `catalog-preset-save\0${customer.lift_customer_id}\0${route.output_route_id}\0${presetId}\0${timestamp}`
  );
  return { workspace, changed: true };
}

export async function deleteCatalogPreset(
  customer: LiftCustomer,
  presetId: string,
  options: { output_route_id?: string | null; expected_workspace_updated_at?: string | null } = {}
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const existing = workspace.catalog_presets.find((preset) => preset.preset_id === presetId);
  if (!existing) {
    return { workspace, changed: false };
  }
  const routeId = String(options.output_route_id ?? "").trim();
  if (!routeId || existing.output_route_id !== routeId) {
    throw new CatalogPresetValidationError("This catalog preset belongs to a different output route.");
  }
  if (
    options.expected_workspace_updated_at &&
    options.expected_workspace_updated_at !== workspace.updated_at
  ) {
    throw new WorkspacePersistenceConflictError();
  }
  const previousWorkspaceUpdatedAt = workspace.updated_at;
  const timestamp = now();
  workspace.catalog_presets = workspace.catalog_presets.filter((preset) => preset.preset_id !== presetId);
  workspace.updated_at = timestamp;
  await persistCatalogPresetWorkspace(
    store,
    workspace,
    previousWorkspaceUpdatedAt,
    `catalog-preset-delete\0${customer.lift_customer_id}\0${routeId}\0${presetId}\0${timestamp}`
  );
  return { workspace, changed: true };
}

export async function listLiftUnitCatalog(filters: {
  target_id?: string;
  environment_id?: string;
  company_id?: string;
  q?: string;
  product_id?: string;
  product_name?: string;
  catalog_id?: string;
  catalog_name?: string;
  product_type?: string;
  accounting_item_code?: string;
  parent_product_id?: string;
  status?: string;
  include_inactive?: boolean;
  fetch_size?: number;
  fetch_offset?: number;
} = {}) {
  const store = await readStore();
  const query = filters.q?.trim().toLowerCase() ?? "";
  const productName = filters.product_name?.trim().toLowerCase();
  const catalogName = filters.catalog_name?.trim().toLowerCase();
  const fetchOffset = Math.max(0, filters.fetch_offset ?? 0);
  const fetchSize =
    typeof filters.fetch_size === "number" && Number.isFinite(filters.fetch_size)
      ? Math.max(0, Math.min(5000, filters.fetch_size))
      : null;
  const filtered = store.lift_unit_catalog
    .filter((item) => !filters.target_id || item.target_id === filters.target_id)
    .filter((item) => !filters.environment_id || !item.environment_id || item.environment_id === filters.environment_id)
    .filter((item) => !filters.company_id || item.company_id === filters.company_id)
    .filter((item) => !filters.product_id || item.product_id === filters.product_id)
    .filter((item) => !productName || item.product_name.toLowerCase() === productName)
    .filter((item) => !filters.catalog_id || item.catalog_id === filters.catalog_id)
    .filter((item) => !catalogName || item.catalog_name?.toLowerCase() === catalogName)
    .filter((item) => !filters.product_type || item.product_type === filters.product_type)
    .filter((item) => !filters.accounting_item_code || item.accounting_item_code === filters.accounting_item_code)
    .filter((item) => !filters.parent_product_id || item.parent_product_id === filters.parent_product_id)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => filters.include_inactive || item.status === "Active")
    .map((item) => ({ item, score: query ? liftCatalogSearchScore(item, query) : 0 }))
    .filter((entry) => !query || entry.score > 0)
    .sort((first, second) => (query ? second.score - first.score : 0) || compareLiftCatalogItems(first.item, second.item))
    .map((entry) => entry.item);

  return fetchSize === null ? filtered : filtered.slice(fetchOffset, fetchOffset + fetchSize);
}

export class LiftProductCatalogPersistenceError extends Error {
  constructor(
    public readonly persistence_outcome: "partial" | "uncertain",
    public readonly definitely_persisted_count: number,
    public readonly requested_count: number
  ) {
    super(
      persistence_outcome === "partial"
        ? "Pathfinder saved only part of the selected Lift product catalog."
        : "Pathfinder could not confirm every Lift product catalog write."
    );
    this.name = "LiftProductCatalogPersistenceError";
  }
}

export class LiftProductCatalogCollisionError extends Error {
  constructor(
    public readonly collision_count: number,
    public readonly requested_count: number,
    public readonly definitely_persisted_count = 0
  ) {
    super("Pathfinder found Lift product identities that belong to another catalog.");
    this.name = "LiftProductCatalogCollisionError";
  }
}

type FocusedLiftProductCacheWrite = {
  item: LiftUnitCatalogItem;
  dynamo_item: Record<string, AttributeValue>;
  expected_existing_item?: Record<string, AttributeValue>;
};

function liftProductCatalogScope(item: LiftUnitCatalogItem) {
  return String(item.catalog_id ?? "").trim();
}

function incomingLiftProductCatalogCollisionCount(items: LiftUnitCatalogItem[]) {
  const catalogByIdentity = new Map<string, string>();
  const collisions = new Set<string>();
  items.forEach((item) => {
    const identity = liftProductCacheIdentity(item);
    const catalogId = liftProductCatalogScope(item);
    const existingCatalogId = catalogByIdentity.get(identity);
    if (existingCatalogId !== undefined && existingCatalogId !== catalogId) {
      collisions.add(identity);
      return;
    }
    catalogByIdentity.set(identity, catalogId);
  });
  return collisions.size;
}

async function inspectExistingLiftProductCatalogRows(
  tableName: string,
  items: LiftUnitCatalogItem[]
) {
  let collisionCount = 0;
  const existingByIdentity = new Map<string, Record<string, AttributeValue>>();
  for (const item of items) {
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: tableName,
      Key: {
        route_environment_id: dynamoString(liftProductCachePartition(item)),
        product_id: dynamoString(liftProductCacheSort(item))
      },
      ConsistentRead: true
    }));
    if (!response.Item) continue;
    const storedItem = response.Item as Record<string, AttributeValue>;
    const existing = parseDynamoData<LiftUnitCatalogItem>(
      storedItem
    );
    if (!existing) {
      throw new Error("The existing Lift product cache row could not be verified.");
    }
    const serializedCatalogScope = liftProductCatalogScope(existing);
    const durableCatalogScope = storedItem.catalog_scope?.S?.trim();
    if (durableCatalogScope !== undefined && durableCatalogScope !== serializedCatalogScope) {
      throw new Error("The existing Lift product cache catalog scope could not be verified.");
    }
    if ((durableCatalogScope ?? serializedCatalogScope) !== liftProductCatalogScope(item)) {
      collisionCount += 1;
    }
    existingByIdentity.set(liftProductCacheIdentity(item), storedItem);
  }
  return { collision_count: collisionCount, existing_by_identity: existingByIdentity };
}

async function reconcileFocusedLiftProductCacheBatch(
  tableName: string,
  writes: FocusedLiftProductCacheWrite[]
) {
  const confirmed: LiftUnitCatalogItem[] = [];
  for (const write of writes) {
    const response = await getDynamoClient().send(new GetItemCommand({
      TableName: tableName,
      Key: {
        route_environment_id: write.dynamo_item.route_environment_id,
        product_id: write.dynamo_item.product_id
      },
      ConsistentRead: true
    }));
    if (
      response.Item?.catalog_refresh_id?.S === write.dynamo_item.catalog_refresh_id?.S &&
      response.Item?.data?.S === write.dynamo_item.data?.S
    ) {
      confirmed.push(write.item);
    }
  }
  return confirmed;
}

async function persistFocusedLiftProductCache(
  tableName: string,
  items: LiftUnitCatalogItem[],
  existingByIdentity: Map<string, Record<string, AttributeValue>>
) {
  const refreshId = randomBytes(16).toString("hex");
  const writes: FocusedLiftProductCacheWrite[] = items.map((item) => ({
    item,
    dynamo_item: {
      ...dynamoItem(
        {
          route_environment_id: liftProductCachePartition(item),
          product_id: liftProductCacheSort(item)
        },
        item
      ),
      catalog_refresh_id: dynamoString(refreshId),
      catalog_scope: dynamoString(liftProductCatalogScope(item))
    },
    expected_existing_item: existingByIdentity.get(liftProductCacheIdentity(item))
  }));
  const definitelyPersisted: LiftUnitCatalogItem[] = [];

  for (let index = 0; index < writes.length; index += 25) {
    const batch = writes.slice(index, index + 25);
    const transactItems: TransactWriteItem[] = batch.map((write): TransactWriteItem => {
      const expected = write.expected_existing_item;
      if (!expected) {
        return {
          Put: {
            TableName: tableName,
            Item: write.dynamo_item,
            ConditionExpression:
              "attribute_not_exists(#partition_key) AND attribute_not_exists(#sort_key)",
            ExpressionAttributeNames: {
              "#partition_key": "route_environment_id",
              "#sort_key": "product_id"
            }
          }
        };
      }
      const durableCatalogScope = expected.catalog_scope?.S?.trim();
      return {
        Put: {
          TableName: tableName,
          Item: write.dynamo_item,
          ConditionExpression: durableCatalogScope !== undefined
            ? "#catalog_scope = :catalog_scope"
            : "attribute_not_exists(#catalog_scope) AND #stored_data = :expected_data",
          ExpressionAttributeNames: durableCatalogScope !== undefined
            ? { "#catalog_scope": "catalog_scope" }
            : { "#catalog_scope": "catalog_scope", "#stored_data": "data" },
          ExpressionAttributeValues: durableCatalogScope !== undefined
            ? { ":catalog_scope": dynamoString(liftProductCatalogScope(write.item)) }
            : { ":expected_data": expected.data as AttributeValue }
        }
      };
    });

    try {
      await getDynamoClient().send(new TransactWriteItemsCommand({
        ClientRequestToken: createHash("sha256")
          .update(refreshId)
          .update("\0")
          .update(String(index))
          .digest("hex")
          .slice(0, 36),
        TransactItems: transactItems
      }));
      definitelyPersisted.push(...batch.map((write) => write.item));
    } catch {
      let reconciled: LiftUnitCatalogItem[];
      try {
        reconciled = await reconcileFocusedLiftProductCacheBatch(tableName, batch);
      } catch {
        mergeScopedLiftProductCatalog(definitelyPersisted);
        throw new LiftProductCatalogPersistenceError(
          "uncertain",
          definitelyPersisted.length,
          items.length
        );
      }

      definitelyPersisted.push(...reconciled);
      if (reconciled.length === batch.length) {
        continue;
      }
      let collisionCount: number;
      try {
        ({ collision_count: collisionCount } = await inspectExistingLiftProductCatalogRows(
          tableName,
          batch.map((write) => write.item)
        ));
      } catch {
        mergeScopedLiftProductCatalog(definitelyPersisted);
        throw new LiftProductCatalogPersistenceError(
          "uncertain",
          definitelyPersisted.length,
          items.length
        );
      }
      if (collisionCount > 0) {
        mergeScopedLiftProductCatalog(definitelyPersisted);
        throw new LiftProductCatalogCollisionError(
          collisionCount,
          items.length,
          definitelyPersisted.length
        );
      }
      mergeScopedLiftProductCatalog(definitelyPersisted);
      throw new LiftProductCatalogPersistenceError(
        "partial",
        definitelyPersisted.length,
        items.length
      );
    }
  }

  mergeScopedLiftProductCatalog(definitelyPersisted);
  return definitelyPersisted;
}

export async function upsertLiftProductCatalog(items: LiftUnitCatalogItem[]) {
  const timestamp = now();
  const normalizedInput = items.map((item) =>
    normalizeLiftCatalogItem({ ...item, updated_at: timestamp }, timestamp)
  );
  const incomingCollisionCount = incomingLiftProductCatalogCollisionCount(normalizedInput);
  if (incomingCollisionCount > 0) {
    throw new LiftProductCatalogCollisionError(incomingCollisionCount, normalizedInput.length);
  }
  const normalizedByIdentity = new Map<string, LiftUnitCatalogItem>();
  normalizedInput.forEach((normalized) => {
    normalizedByIdentity.set(liftProductCacheIdentity(normalized), normalized);
  });
  const normalizedItems = Array.from(normalizedByIdentity.values());
  const config = getPathfinderPersistenceRuntimeConfig();

  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    const inspection = await inspectExistingLiftProductCatalogRows(
      tables.lift_product_cache,
      normalizedItems
    );
    if (inspection.collision_count > 0) {
      throw new LiftProductCatalogCollisionError(inspection.collision_count, normalizedItems.length);
    }
    return persistFocusedLiftProductCache(
      tables.lift_product_cache,
      normalizedItems,
      inspection.existing_by_identity
    );
  }

  const store = await readStore();
  const nextByIdentity = new Map(
    store.lift_unit_catalog.map((item) => [liftProductCacheIdentity(item), item])
  );
  const collisionCount = normalizedItems.filter((item) => {
    const existing = nextByIdentity.get(liftProductCacheIdentity(item));
    return existing && liftProductCatalogScope(existing) !== liftProductCatalogScope(item);
  }).length;
  if (collisionCount > 0) {
    throw new LiftProductCatalogCollisionError(collisionCount, normalizedItems.length);
  }
  normalizedItems.forEach((item) => nextByIdentity.set(liftProductCacheIdentity(item), item));

  store.lift_unit_catalog = Array.from(nextByIdentity.values());
  await writeStore(store);
  return normalizedItems;
}

export async function updateProductMapping(
  customer: LiftCustomer,
  mappingId: string,
  patch: Partial<CustomerProductMapping>
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const existingMapping = workspace.product_mappings.find((mapping) => mapping.mapping_id === mappingId);
  const requestedRouteId = String(
    patch.output_route_id ?? existingMapping?.output_route_id ?? workspace.primary_output_route_id ?? ""
  ).trim();
  const route = workspace.output_routes.find(
    (candidate) => candidate.output_route_id === requestedRouteId
  );
  if (!route) {
    throw new ProductMappingValidationError("Choose a valid customer route before approving this product mapping.");
  }
  if (existingMapping && existingMapping.output_route_id !== route.output_route_id) {
    throw new ProductMappingValidationError("This product mapping belongs to a different customer route.");
  }
  const existing =
    existingMapping ??
    ({
      mapping_id: mappingId,
      output_route_id: route.output_route_id,
      target_id: route.target_id,
      target_template: route.output_template,
      customer_product_key: patch.customer_product_key ?? mappingId,
      display_label: patch.display_label ?? patch.customer_product_key ?? mappingId,
      source_columns: patch.source_columns ?? [],
      product_identifier_type: route.product_identifier_type,
      product_identifier_value: null,
      lift_unit_number: null,
      lift_product_id: null,
      product_name: null,
      status: "Unmapped",
      replacement_version_id: activeProductMappingVersion(workspace, route.output_route_id),
      last_seen_examples: [],
      created_at: timestamp,
      updated_at: timestamp
    } satisfies CustomerProductMapping);
  const nextMapping: CustomerProductMapping = {
    ...existing,
    ...patch,
    mapping_id: mappingId,
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    target_template: route.output_template,
    replacement_version_id:
      existing.replacement_version_id ??
      activeProductMappingVersion(workspace, route.output_route_id),
    product_identifier_type:
      route.product_identifier_type,
    product_identifier_value:
      patch.product_identifier_value ??
      patch.lift_unit_number ??
      patch.lift_product_id ??
      existing.product_identifier_value ??
      existing.lift_unit_number ??
      existing.lift_product_id ??
      null,
    lift_unit_number:
      patch.lift_unit_number ??
      (patch.product_identifier_type === "lift_unit_number" ? patch.product_identifier_value ?? null : undefined) ??
      existing.lift_unit_number ??
      null,
    lift_product_id:
      patch.lift_product_id ??
      (patch.product_identifier_type === "lift_product_id" ? patch.product_identifier_value ?? null : undefined) ??
      existing.lift_product_id ??
      null,
    status:
      patch.status ??
      (patch.product_identifier_value ||
      patch.lift_unit_number ||
      patch.lift_product_id ||
      existing.product_identifier_value ||
      existing.lift_unit_number ||
      existing.lift_product_id
        ? "Mapped"
        : existing.status),
    updated_at: timestamp
  };

  if (existingMapping) {
    const { updated_at: _existingUpdatedAt, ...existingComparable } = normalizeProductMapping(existingMapping);
    const { updated_at: _nextUpdatedAt, ...nextComparable } = normalizeProductMapping(nextMapping);
    if (JSON.stringify(existingComparable) === JSON.stringify(nextComparable)) {
      return {
        product_mappings: workspace.product_mappings,
        product_mapping: existingMapping,
        changed: false
      };
    }
  }

  workspace.product_mappings = [
    nextMapping,
    ...workspace.product_mappings.filter((mapping) => mapping.mapping_id !== mappingId)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    await persistFocusedDynamoRecords(
      [{
        table_name: getDynamoTableConfig().product_mappings,
        keys: {
          customer_route_id: customerRouteKey(
            customer.lift_customer_id,
            nextMapping.output_route_id,
            nextMapping.replacement_version_id
          ),
          mapping_id: nextMapping.mapping_id
        },
        data: { ...nextMapping, customer_id: customer.lift_customer_id },
        expected_updated_at: existingMapping?.updated_at ?? null
      }],
      `product-mapping-save\0${customer.lift_customer_id}\0${nextMapping.output_route_id}\0${nextMapping.mapping_id}\0${timestamp}`
    );
  } else {
    await writeStore(store);
  }
  return {
    product_mappings: workspace.product_mappings,
    product_mapping: nextMapping,
    changed: true
  };
}

export async function bulkUpsertProductMappings(customer: LiftCustomer, mappings: CustomerProductMapping[]) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const nextById = new Map(workspace.product_mappings.map((mapping) => [mapping.mapping_id, mapping]));
  const fallbackRoute =
    workspace.output_routes.find((route) => route.output_route_id === workspace.primary_output_route_id) ??
    createSeedOutputRoute(timestamp);

  const updatedMappings: CustomerProductMapping[] = [];
  mappings.forEach((mapping) => {
    const route =
      workspace.output_routes.find((candidate) => candidate.output_route_id === mapping.output_route_id) ??
      fallbackRoute;
    const normalizedMapping = normalizeProductMapping({
      ...mapping,
      output_route_id: mapping.output_route_id ?? route.output_route_id,
      target_id: mapping.target_id ?? route.target_id,
      target_template: mapping.target_template ?? route.output_template,
      product_identifier_type: mapping.product_identifier_type ?? route.product_identifier_type,
      product_identifier_value:
        mapping.product_identifier_value ?? mapping.lift_unit_number ?? mapping.lift_product_id ?? null,
      replacement_version_id:
        mapping.replacement_version_id ??
        activeProductMappingVersion(workspace, mapping.output_route_id ?? route.output_route_id)
    });
    const nextMapping = {
      ...(nextById.get(mapping.mapping_id) ?? normalizedMapping),
      ...normalizedMapping,
      updated_at: timestamp
    };
    nextById.set(mapping.mapping_id, nextMapping);
    updatedMappings.push(nextMapping);
  });

  workspace.product_mappings = Array.from(nextById.values());
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    await upsertDynamoTableMonotonic(
      tables.product_mappings,
      updatedMappings.map((mapping) =>
        dynamoItem(
          {
            customer_route_id: customerRouteKey(
              customer.lift_customer_id,
              mapping.output_route_id,
              mapping.replacement_version_id
            ),
            mapping_id: mapping.mapping_id
          },
          { ...mapping, customer_id: customer.lift_customer_id }
        )
      )
    );
  } else {
    await writeStore(store);
  }
  return workspace.product_mappings;
}

export class ProductMappingReplacementConflictError extends Error {
  constructor(message = "The product map changed after this replacement preview. Review it again before applying changes.") {
    super(message);
    this.name = "ProductMappingReplacementConflictError";
  }
}

export class ProductMappingReplacementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductMappingReplacementValidationError";
  }
}

interface ProductMappingReplacementInput {
  output_route_id: string;
  source_file_name: string;
  clear_existing_assignments: boolean;
  product_mappings: CustomerProductMapping[];
}

interface ProductMappingReplacementPlan {
  preview: ProductMappingReplacementPreview;
  next_route_mappings: CustomerProductMapping[];
  introduced_mapping_ids: string[];
}

function replacementActorId(actorId: string) {
  return `operator_${createHash("sha256").update(actorId || "local-operator").digest("hex").slice(0, 24)}`;
}

function replacementMappingId(outputRouteId: string, customerProductKey: string) {
  return `product_${createHash("sha256")
    .update(outputRouteId)
    .update("\0")
    .update(customerProductKey)
    .digest("hex")
    .slice(0, 24)}`;
}

function replacementComparable(mapping: CustomerProductMapping) {
  return {
    customer_product_key: mapping.customer_product_key,
    display_label: mapping.display_label,
    source_columns: mapping.source_columns,
    product_identifier_type: mapping.product_identifier_type,
    product_identifier_value: mapping.product_identifier_value,
    lift_unit_number: mapping.lift_unit_number,
    lift_product_id: mapping.lift_product_id ?? null,
    product_name: mapping.product_name,
    status: mapping.status
  };
}

function replacementPreviewToken(args: {
  outputRouteId: string;
  sourceFileName: string;
  clearExistingAssignments: boolean;
  currentMappings: CustomerProductMapping[];
  candidates: CustomerProductMapping[];
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        output_route_id: args.outputRouteId,
        source_file_name: args.sourceFileName,
        clear_existing_assignments: args.clearExistingAssignments,
        current: [...args.currentMappings]
          .sort((first, second) => first.mapping_id.localeCompare(second.mapping_id))
          .map((mapping) => ({ ...replacementComparable(mapping), mapping_id: mapping.mapping_id })),
        candidates: [...args.candidates]
          .sort((first, second) => first.customer_product_key.localeCompare(second.customer_product_key))
          .map(replacementComparable)
      })
    )
    .digest("hex");
}

function buildProductMappingReplacementPlan(
  workspace: PathfinderCustomerWorkspace,
  input: ProductMappingReplacementInput,
  timestamp: string
): ProductMappingReplacementPlan {
  const route = workspace.output_routes.find((candidate) => candidate.output_route_id === input.output_route_id);
  if (!route) {
    throw new ProductMappingReplacementValidationError("The selected output route no longer exists.");
  }
  const sourceFileName = String(input.source_file_name ?? "").trim().slice(0, 240);
  if (!sourceFileName) {
    throw new ProductMappingReplacementValidationError("A source-list name is required for the replacement checkpoint.");
  }
  if (!Array.isArray(input.product_mappings) || input.product_mappings.length === 0) {
    throw new ProductMappingReplacementValidationError("The authoritative product list must contain at least one valid product.");
  }

  const currentRouteMappings = workspace.product_mappings.filter(
    (mapping) => mapping.output_route_id === route.output_route_id
  );
  const currentByKey = new Map(currentRouteMappings.map((mapping) => [mapping.customer_product_key, mapping]));
  const seenKeys = new Set<string>();
  const introducedMappingIds: string[] = [];
  const rows: ProductMappingReplacementPreviewRow[] = [];

  const importedMappings = input.product_mappings.map((candidate) => {
    const customerProductKey = String(candidate.customer_product_key ?? "").trim().slice(0, 500);
    if (!customerProductKey) {
      throw new ProductMappingReplacementValidationError("Every imported product must have a customer product key.");
    }
    if (seenKeys.has(customerProductKey)) {
      throw new ProductMappingReplacementValidationError(
        `The authoritative list contains the product key ${customerProductKey} more than once.`
      );
    }
    seenKeys.add(customerProductKey);
    const existing = currentByKey.get(customerProductKey);
    const mappingId = existing?.mapping_id ?? replacementMappingId(route.output_route_id, customerProductKey);
    if (!existing) {
      introducedMappingIds.push(mappingId);
    }
    const identifierValue = input.clear_existing_assignments
      ? null
      : candidate.product_identifier_value ?? candidate.lift_product_id ?? candidate.lift_unit_number ?? null;
    const nextStatus: ProductMappingStatus = identifierValue ? "Mapped" : "Unmapped";
    const importedExamples = Array.isArray(candidate.last_seen_examples) ? candidate.last_seen_examples : [];
    const nextMapping: CustomerProductMapping = {
      ...(existing ?? {}),
      mapping_id: mappingId,
      output_route_id: route.output_route_id,
      target_id: route.target_id,
      target_template: route.output_template,
      source_scope_id: candidate.source_scope_id ?? existing?.source_scope_id ?? null,
      customer_product_key: customerProductKey,
      display_label: String(candidate.display_label || candidate.product_name || customerProductKey).trim().slice(0, 500),
      source_columns: Array.from(
        new Set((candidate.source_columns ?? []).map((column) => String(column).trim()).filter(Boolean))
      ).slice(0, 20),
      product_identifier_type: route.product_identifier_type,
      product_identifier_value: identifierValue,
      lift_unit_number:
        route.product_identifier_type === "lift_unit_number" ? identifierValue : input.clear_existing_assignments ? null : candidate.lift_unit_number ?? null,
      lift_product_id:
        route.product_identifier_type === "lift_product_id" ? identifierValue : input.clear_existing_assignments ? null : candidate.lift_product_id ?? null,
      product_name: input.clear_existing_assignments
        ? null
        : candidate.product_name ?? existing?.product_name ?? candidate.display_label ?? customerProductKey,
      status: nextStatus,
      mapping_source: "Preloaded catalog",
      source_file_name: sourceFileName,
      last_seen_examples: [
        ...importedExamples,
        ...(existing?.last_seen_examples ?? []).filter(
          (example) => !importedExamples.some(
            (imported) => imported.sheet_name === example.sheet_name && imported.row_number === example.row_number
          )
        )
      ].slice(0, 8),
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    };
    const action: ProductMappingReplacementAction = !existing
      ? "New"
      : JSON.stringify(replacementComparable(existing)) === JSON.stringify(replacementComparable(nextMapping))
        ? "Unchanged"
        : "Updated";
    rows.push({
      mapping_id: mappingId,
      customer_product_key: customerProductKey,
      display_label: nextMapping.display_label,
      action,
      current_status: existing?.status ?? null,
      next_status: nextStatus
    });
    return nextMapping;
  });

  const omittedMappings = currentRouteMappings.map((mapping) => {
    if (seenKeys.has(mapping.customer_product_key) || mapping.status === "Inactive") {
      return mapping;
    }
    rows.push({
      mapping_id: mapping.mapping_id,
      customer_product_key: mapping.customer_product_key,
      display_label: mapping.display_label,
      action: "Deactivate",
      current_status: mapping.status,
      next_status: "Inactive"
    });
    return { ...mapping, status: "Inactive" as const, updated_at: timestamp };
  }).filter((mapping) => !seenKeys.has(mapping.customer_product_key));

  const nextRouteMappings = [...importedMappings, ...omittedMappings];
  if (nextRouteMappings.length > 2000) {
    throw new ProductMappingReplacementValidationError(
      "This route contains more than 2,000 product records. Split the list into a separately reviewed catalog workflow."
    );
  }
  const counts = {
    new_count: rows.filter((row) => row.action === "New").length,
    updated_count: rows.filter((row) => row.action === "Updated").length,
    unchanged_count: rows.filter((row) => row.action === "Unchanged").length,
    deactivated_count: rows.filter((row) => row.action === "Deactivate").length
  };
  return {
    preview: {
      preview_token: replacementPreviewToken({
        outputRouteId: route.output_route_id,
        sourceFileName,
        clearExistingAssignments: Boolean(input.clear_existing_assignments),
        currentMappings: currentRouteMappings,
        candidates: input.product_mappings
      }),
      output_route_id: route.output_route_id,
      source_file_name: sourceFileName,
      clear_existing_assignments: Boolean(input.clear_existing_assignments),
      imported_count: importedMappings.length,
      ...counts,
      rows
    },
    next_route_mappings: nextRouteMappings,
    introduced_mapping_ids: introducedMappingIds
  };
}

async function readDynamoReplacementContext(
  customerId: string,
  outputRouteId: string,
  replacementVersionId: string | null
) {
  const tables = getDynamoTableConfig();
  const [workspaceResponse, mappingsResponse] = await Promise.all([
    getDynamoClient().send(new GetItemCommand({
      TableName: tables.workspaces,
      Key: { customer_id: dynamoString(customerId) },
      ConsistentRead: true
    })),
    getDynamoClient().send(new QueryCommand({
      TableName: tables.product_mappings,
      KeyConditionExpression: "customer_route_id = :route",
      ExpressionAttributeValues: {
        ":route": dynamoString(customerRouteKey(customerId, outputRouteId, replacementVersionId))
      },
      ConsistentRead: true
    }))
  ]);
  if (!workspaceResponse.Item?.data?.S) {
    throw new ProductMappingReplacementConflictError("The customer workspace changed before the replacement could be saved.");
  }
  return {
    tables,
    workspace_item: workspaceResponse.Item,
    mapping_items: mappingsResponse.Items ?? []
  };
}

async function persistProductMappingReplacement(args: {
  customer: LiftCustomer;
  workspace: PathfinderCustomerWorkspace;
  expectedWorkspace: PathfinderCustomerWorkspace;
  nextRouteMappings: CustomerProductMapping[];
  expectedRouteMappings: CustomerProductMapping[];
  nextVersionId: string | null;
}) {
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver !== "dynamodb") {
    const store = await readStore();
    store.workspaces[args.customer.lift_customer_id] = args.workspace;
    await writeStore(store);
    return;
  }

  const context = await readDynamoReplacementContext(
    args.customer.lift_customer_id,
    args.nextRouteMappings[0]?.output_route_id ?? args.expectedRouteMappings[0]?.output_route_id ?? "",
    activeProductMappingVersion(
      args.expectedWorkspace,
      args.nextRouteMappings[0]?.output_route_id ?? args.expectedRouteMappings[0]?.output_route_id ?? ""
    )
  );
  const expectedById = new Map(args.expectedRouteMappings.map((mapping) => [mapping.mapping_id, mapping]));
  const storedWorkspace = parseDynamoData<PathfinderCustomerWorkspace>(context.workspace_item);
  if (
    !storedWorkspace ||
    storedWorkspace.updated_at !== args.expectedWorkspace.updated_at ||
    context.mapping_items.length !== args.expectedRouteMappings.length ||
    context.mapping_items.some((item) => {
      const mappingId = item.mapping_id?.S ?? "";
      const expected = expectedById.get(mappingId);
      const stored = parseDynamoData<CustomerProductMapping & { customer_id?: string }>(item);
      return !expected || !stored || stored.updated_at !== expected.updated_at;
    })
  ) {
    throw new ProductMappingReplacementConflictError();
  }

  const stagedMappings = args.nextRouteMappings.map((mapping) => ({
    ...mapping,
    replacement_version_id: args.nextVersionId
  }));
  await batchWriteDynamo(
    context.tables.product_mappings,
    stagedMappings.map((mapping) => ({
      PutRequest: {
        Item: dynamoItem(
          {
            customer_route_id: customerRouteKey(
              args.customer.lift_customer_id,
              mapping.output_route_id,
              mapping.replacement_version_id
            ),
            mapping_id: mapping.mapping_id
          },
          { ...mapping, customer_id: args.customer.lift_customer_id }
        )
      }
    }))
  );
  try {
    await getDynamoClient().send(new TransactWriteItemsCommand({
      ClientRequestToken: createHash("sha256")
        .update(args.workspace.product_mapping_replacement_checkpoint?.replacement_id ?? randomBytes(16).toString("hex"))
        .update("\0")
        .update(args.workspace.updated_at)
        .digest("hex")
        .slice(0, 36),
      TransactItems: [
        {
          Put: {
            TableName: context.tables.workspaces,
            Item: dynamoItem(
              { customer_id: args.customer.lift_customer_id },
              workspaceRecord(args.workspace)
            ),
            ConditionExpression: "#data = :expected_data",
            ExpressionAttributeNames: { "#data": "data" },
            ExpressionAttributeValues: { ":expected_data": context.workspace_item.data as AttributeValue }
          }
        }
      ]
    }));
  } catch (error) {
    if ((error as { name?: string }).name === "TransactionCanceledException") {
      throw new ProductMappingReplacementConflictError();
    }
    throw error;
  }
}

export async function previewProductMappingReplacement(
  customer: LiftCustomer,
  input: ProductMappingReplacementInput
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  return buildProductMappingReplacementPlan(workspace, input, now()).preview;
}

export async function applyProductMappingReplacement(
  customer: LiftCustomer,
  input: ProductMappingReplacementInput,
  previewToken: string,
  actorId: string
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const plan = buildProductMappingReplacementPlan(workspace, input, timestamp);
  if (!previewToken || previewToken !== plan.preview.preview_token) {
    throw new ProductMappingReplacementConflictError();
  }
  const beforeMappings = workspace.product_mappings.filter(
    (mapping) => mapping.output_route_id === input.output_route_id
  );
  const expectedWorkspace = { ...workspace, product_mappings: [...workspace.product_mappings] };
  const replacementId = `product_replace_${randomBytes(12).toString("hex")}`;
  const previousVersionId = activeProductMappingVersion(workspace, input.output_route_id);
  const versionedRouteMappings = plan.next_route_mappings.map((mapping) => ({
    ...mapping,
    replacement_version_id: replacementId
  }));
  const summary: ProductMappingReplacementSummary = {
    replacement_id: replacementId,
    output_route_id: input.output_route_id,
    source_file_name: plan.preview.source_file_name,
    actor_id: replacementActorId(actorId),
    created_at: timestamp,
    rolled_back_at: null,
    imported_count: plan.preview.imported_count,
    new_count: plan.preview.new_count,
    updated_count: plan.preview.updated_count,
    unchanged_count: plan.preview.unchanged_count,
    deactivated_count: plan.preview.deactivated_count,
    clear_existing_assignments: plan.preview.clear_existing_assignments
  };
  workspace.product_mappings = [
    ...workspace.product_mappings.filter((mapping) => mapping.output_route_id !== input.output_route_id),
    ...versionedRouteMappings
  ];
  workspace.product_mapping_active_versions = {
    ...(workspace.product_mapping_active_versions ?? {}),
    [input.output_route_id]: replacementId
  };
  workspace.product_mapping_replacement_checkpoint = {
    ...summary,
    before_mappings: beforeMappings,
    introduced_mapping_ids: plan.introduced_mapping_ids,
    previous_version_id: previousVersionId
  };
  workspace.product_mapping_replacement_history = [
    summary,
    ...(workspace.product_mapping_replacement_history ?? [])
  ].slice(0, 20);
  workspace.updated_at = timestamp;
  await persistProductMappingReplacement({
    customer,
    workspace,
    expectedWorkspace,
    nextRouteMappings: versionedRouteMappings,
    expectedRouteMappings: beforeMappings,
    nextVersionId: replacementId
  });
  return normalizeWorkspace((await readStore()).workspaces[customer.lift_customer_id] ?? workspace);
}

export async function rollbackProductMappingReplacement(
  customer: LiftCustomer,
  replacementId: string,
  actorId: string
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const checkpoint = workspace.product_mapping_replacement_checkpoint;
  if (!checkpoint || checkpoint.replacement_id !== replacementId || checkpoint.rolled_back_at) {
    throw new ProductMappingReplacementValidationError("Only the latest applied product-list replacement can be rolled back.");
  }
  const timestamp = now();
  const currentRouteMappings = workspace.product_mappings.filter(
    (mapping) => mapping.output_route_id === checkpoint.output_route_id
  );
  const expectedWorkspace = { ...workspace, product_mappings: [...workspace.product_mappings] };
  const beforeIds = new Set(checkpoint.before_mappings.map((mapping) => mapping.mapping_id));
  const inactiveIntroduced = currentRouteMappings
    .filter((mapping) => !beforeIds.has(mapping.mapping_id))
    .map((mapping) => ({ ...mapping, status: "Inactive" as const, updated_at: timestamp }));
  const restoredRouteMappings = [
    ...checkpoint.before_mappings.map((mapping) => ({ ...mapping, updated_at: timestamp })),
    ...inactiveIntroduced
  ];
  workspace.product_mappings = [
    ...workspace.product_mappings.filter((mapping) => mapping.output_route_id !== checkpoint.output_route_id),
    ...restoredRouteMappings
  ];
  workspace.product_mapping_active_versions = {
    ...(workspace.product_mapping_active_versions ?? {}),
    [checkpoint.output_route_id]: checkpoint.previous_version_id ?? null
  };
  workspace.product_mapping_replacement_checkpoint = { ...checkpoint, rolled_back_at: timestamp };
  workspace.product_mapping_replacement_history = (workspace.product_mapping_replacement_history ?? []).map((entry) =>
    entry.replacement_id === replacementId
      ? { ...entry, actor_id: replacementActorId(actorId), rolled_back_at: timestamp }
      : entry
  );
  workspace.updated_at = timestamp;
  await persistProductMappingReplacement({
    customer,
    workspace,
    expectedWorkspace,
    nextRouteMappings: restoredRouteMappings,
    expectedRouteMappings: currentRouteMappings,
    nextVersionId: checkpoint.previous_version_id ?? null
  });
  return normalizeWorkspace((await readStore()).workspaces[customer.lift_customer_id] ?? workspace);
}

export async function listTargets(maskCredentials = true) {
  const store = await readStore();
  const targets = Object.values(store.targets);
  return maskCredentials ? targets.map(maskTargetConfig) : targets;
}

export class TargetNotFoundError extends Error {
  constructor(targetId: string) {
    super(`Target ${targetId} was not found.`);
    this.name = "TargetNotFoundError";
  }
}

export class TargetInUseError extends Error {
  constructor(targetName: string, customerNames: string[]) {
    const visibleCustomers = customerNames.slice(0, 3).join(", ");
    const remainingCount = Math.max(0, customerNames.length - 3);
    const customerSummary = `${visibleCustomers}${remainingCount ? ` and ${remainingCount} more` : ""}`;
    super(
      `${targetName} is still used by ${customerNames.length} customer workspace${customerNames.length === 1 ? "" : "s"}: ${customerSummary}. Reassign or remove those output routes before deleting this target.`
    );
    this.name = "TargetInUseError";
  }
}

export async function deleteTarget(id: string) {
  const store = await readStore();
  const target = store.targets[id];

  if (!target) {
    throw new TargetNotFoundError(id);
  }

  const referencingCustomers = Object.values(store.workspaces)
    .filter(
      (workspace) =>
        workspace.primary_target_id === id ||
        workspace.output_routes.some((route) => route.target_id === id) ||
        workspace.import_methods.some((method) => method.target_id === id)
    )
    .map((workspace) => workspace.customer.customer_name);

  if (referencingCustomers.length) {
    throw new TargetInUseError(target.name, referencingCustomers);
  }

  delete store.targets[id];
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    await getDynamoClient().send(
      new DeleteItemCommand({
        TableName: tables.targets,
        Key: { target_id: dynamoString(id) },
        ConditionExpression: "attribute_exists(target_id)"
      })
    );
  } else {
    await writeStore(store);
  }
  return Object.values(store.targets).map(maskTargetConfig);
}

export async function getTarget(id = targetId, maskCredentials = true) {
  const store = await readStore();
  const target = normalizeTarget(store.targets[id] ?? createSeedTarget());
  return maskCredentials ? maskTargetConfig(target) : target;
}

function preserveSecret(nextValue: string | undefined, existingValue: string | undefined) {
  return isUsableCredentialValue(nextValue) ? nextValue : existingValue;
}

function preserveCredentialValue(nextValue: string | undefined, existingValue: string | undefined) {
  return isUsableCredentialValue(nextValue) ? nextValue : existingValue;
}

function mergeTargetEnvironments(existing: TargetEnvironment[], patch: TargetEnvironment[] | undefined) {
  if (!patch) {
    return existing;
  }

  return patch.map((environment) => {
    const current = existing.find((candidate) => candidate.environment_id === environment.environment_id);
    return {
      ...(current ?? environment),
      ...environment,
      headers: {
        ...(current?.headers ?? {}),
        ...(environment.headers ?? {}),
        User: preserveCredentialValue(environment.headers?.User, current?.headers?.User) ?? environment.headers?.User ?? "",
        Password: preserveSecret(environment.headers?.Password, current?.headers?.Password) ?? ""
      },
      credentials: {
        ...(current?.credentials ?? {}),
        ...(environment.credentials ?? {}),
        User: preserveCredentialValue(environment.credentials?.User, current?.credentials?.User),
        Password: preserveSecret(environment.credentials?.Password, current?.credentials?.Password),
        token: preserveSecret(environment.credentials?.token, current?.credentials?.token),
        api_key: preserveSecret(environment.credentials?.api_key, current?.credentials?.api_key)
      }
    };
  });
}

export async function updateTarget(id: string, patch: Partial<TargetConfig>) {
  const store = await readStore();
  const existing = normalizeTarget(store.targets[id] ?? createSeedTarget());
  const submittedPassword = patch.lift?.credentials?.Password;
  const submittedUser = patch.lift?.credentials?.User;
  const nextTarget: TargetConfig = {
    ...existing,
    ...patch,
    target_id: id,
    environments: mergeTargetEnvironments(existing.environments, patch.environments),
    output_templates: patch.output_templates ?? existing.output_templates,
    lift: {
      ...existing.lift,
      ...patch.lift,
      environments: {
        ...existing.lift.environments,
        ...patch.lift?.environments
      },
      headers: {
        ...existing.lift.headers,
        ...patch.lift?.headers,
        Ext_ID: {
          ...existing.lift.headers.Ext_ID,
          ...patch.lift?.headers?.Ext_ID
        }
      },
      credentials: {
        ...existing.lift.credentials,
        ...patch.lift?.credentials,
        User: preserveCredentialValue(submittedUser, existing.lift.credentials.User) ?? existing.lift.credentials.User,
        Password:
          isUsableCredentialValue(submittedPassword)
            ? submittedPassword
            : existing.lift.credentials.Password
      }
    },
    updated_at: now()
  };

  await persistTargetSecrets(nextTarget);
  store.targets[id] = nextTarget;
  await writeStore(store);
  return maskTargetConfig(nextTarget);
}

export async function persistPreviewJob(
  customer: LiftCustomer,
  job: ProcessingJobPreview,
  method: ImportMethod,
  options: { persistMethod?: boolean; reserveOrderIdAtomically?: boolean } = {}
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const nextMethod: ImportMethod = {
    ...normalizeImportMethod(method),
    last_run_at: timestamp,
    success_rate: job.state === "Ready" ? "100%" : method.success_rate ?? null,
    updated_at: timestamp
  };

  store.jobs = [job, ...store.jobs.filter((candidate) => candidate.job_id !== job.job_id)];
  workspace.jobs = store.jobs.filter((candidate) => candidate.customer_id === customer.lift_customer_id);
  if (options.persistMethod !== false) {
    workspace.import_methods = [
      nextMethod,
      ...workspace.import_methods.filter((candidate) => candidate.import_method_id !== method.import_method_id)
    ];
  }
  if (options.persistMethod !== false) {
    workspace.updated_at = timestamp;
  }
  store.workspaces[customer.lift_customer_id] = workspace;
  const config = getPathfinderPersistenceRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const tables = getDynamoTableConfig();
    if (options.reserveOrderIdAtomically) {
      if (options.persistMethod !== false) {
        throw new Error("Atomic preview identity persistence cannot update an Import Method.");
      }
      try {
        await getDynamoClient().send(
          new TransactWriteItemsCommand({
            ClientRequestToken: createHash("sha256")
              .update(`${job.customer_id}:${job.job_id}:${job.pathfinder_order_id}`)
              .digest("hex")
              .slice(0, 36),
            TransactItems: [
              {
                Put: {
                  TableName: tables.order_ids,
                  Item: {
                    pathfinder_order_id: dynamoString(job.pathfinder_order_id),
                    created_at: dynamoString(job.created_at)
                  },
                  ConditionExpression: "attribute_not_exists(pathfinder_order_id)"
                }
              },
              {
                Put: {
                  TableName: tables.jobs,
                  Item: dynamoItem(
                    { customer_id: job.customer_id, job_id: job.job_id },
                    compactProcessingJobForDynamo(job)
                  ),
                  ConditionExpression: "attribute_not_exists(customer_id) AND attribute_not_exists(job_id)"
                }
              }
            ]
          })
        );
      } catch (error) {
        const transactionError = error as {
          name?: string;
          CancellationReasons?: Array<{ Code?: string }>;
        };
        const conflict =
          transactionError.name === "TransactionCanceledException" &&
          transactionError.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed") === true;
        throw Object.assign(
          new Error(
            conflict
              ? "Pathfinder could not create this preview because its identity is already in use. Refresh Jobs before trying again."
              : "Pathfinder could not confirm that this preview was saved. Refresh Jobs before trying again; do not recreate or submit it until its status is checked."
          ),
          {
            statusCode: conflict ? 409 : 503,
            reasonCode: conflict ? "preview_identity_conflict" : "preview_persistence_uncertain"
          }
        );
      }
    } else {
      await Promise.all([
        upsertDynamoTableMonotonic(tables.jobs, [
          dynamoItem(
            { customer_id: job.customer_id, job_id: job.job_id },
            compactProcessingJobForDynamo(job)
          )
        ]),
        options.persistMethod === false
          ? Promise.resolve()
          : upsertDynamoTableMonotonic(tables.import_methods, [
              dynamoItem(
                { customer_id: customer.lift_customer_id, import_method_id: nextMethod.import_method_id },
                { ...nextMethod, customer_id: customer.lift_customer_id }
              )
            ])
      ]);
    }
  } else {
    if (options.reserveOrderIdAtomically) {
      if (
        locallyReservedPathfinderOrderNumbers.has(job.pathfinder_order_id) ||
        store.jobs.some(
          (candidate) =>
            candidate.job_id !== job.job_id && candidate.pathfinder_order_id === job.pathfinder_order_id
        )
      ) {
        throw Object.assign(
          new Error("Pathfinder could not create this preview because its identity is already in use. Refresh Jobs before trying again."),
          { statusCode: 409, reasonCode: "preview_identity_conflict" }
        );
      }
    }
    await writeStore(store);
    if (options.reserveOrderIdAtomically) {
      locallyReservedPathfinderOrderNumbers.add(job.pathfinder_order_id);
    }
  }

  return workspace;
}
