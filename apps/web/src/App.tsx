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
import {
  buildDefaultMappings,
  canonicalTargetFields,
  mapSourceRowsToCanonicalOrder,
  parseWorkbookArrayBuffer,
  sampleSourceGrid,
  type FieldMapping,
  type ParsedSourceRow,
  type ParsedWorkbookSheet,
  type SourceGrid
} from "@pathfinder/templates";

type GlobalView = "Dashboard" | "Customers" | "Targets" | "Jobs" | "Audit" | "Settings";
type CustomerView = "Overview" | "Import Methods" | "Output Product Map" | "Manual Import" | "Jobs" | "Settings";

type ImportMethodStatus = "Active" | "Inactive" | "Draft" | "Paused" | "Archived";
type ImportMethodSource = "XLSX" | "Google Sheet" | "PDF PO" | "REST API" | "Clipboard" | "SFTP";
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
type SubmitProfileMode = "live_customer" | "sandbox_customer";
type SubmitCertificationStatus = "Passed" | "Warning" | "Blocked";
type RouteDiagnosticStatus = "Passed" | "Warning" | "Blocked";
type SubmitAttemptStatus = "Blocked" | "Gate Locked" | "Dry Run" | "Submitted" | "Failed";
type SubmitCertificationActionKey =
  | "manual-import"
  | "field-mapping"
  | "product-map"
  | "target-environments"
  | "target-output-routes"
  | "target-output-templates"
  | "target-health";

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
  }>;
  created_at: string;
  updated_at: string;
}

interface LiftUnitCatalogItem {
  catalog_item_id: string;
  product_id: string | null;
  unit_number: string | null;
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
  material_id?: string | null;
  image_url?: string | null;
  status: "Active" | "Inactive";
  category?: string | null;
  description?: string | null;
  source?: "Local seed" | "Lift import" | "Manual";
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
  };
  workbook_sheet_policy: "rows_with_quantity";
  product_resolution_config: ProductResolutionConfig;
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

interface PathfinderCustomerWorkspace {
  customer: LiftCustomer;
  import_methods: ImportMethod[];
  output_routes: OutputRoute[];
  templates: SavedFieldMappingTemplate[];
  jobs: ProcessingJobPreview[];
  submit_attempts?: SubmitAttempt[];
  product_mappings: CustomerProductMapping[];
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
  header: LiftOrderPayload["order"];
  lines: Array<{
    line_number: number;
    order_line_id: string | number | null;
    product_name?: string | null;
    description?: string | null;
    quantity: number;
    unit_number?: string | null;
    product_id?: string | number | null;
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
const importMethodSourceOptions: ImportMethodSource[] = [
  "XLSX",
  "Google Sheet",
  "PDF PO",
  "Clipboard",
  "REST API",
  "SFTP"
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
  order_lookup_url: null,
  proof_report_url: null,
  package_details_url: null,
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

const fallbackJobs: Array<{
  id: string;
  customer: string;
  source: string;
  state: ProcessingState;
  extId: string;
  updated: string;
  orders: number;
  started: string;
  duration: string;
}> = [
  {
    id: "job_20260709_000001",
    customer: "Empirical - Momentara",
    source: "Manual XLSX",
    state: "Ready",
    extId: "AS360-30904511",
    updated: "2 min ago",
    orders: 24,
    started: "Today 9:41 AM",
    duration: "1m 52s"
  },
  {
    id: "job_20260709_000000",
    customer: "Empirical - Momentara",
    source: "Wrike Intake",
    state: "Validated",
    extId: "AS360-30904492",
    updated: "18 min ago",
    orders: 18,
    started: "Today 7:22 AM",
    duration: "2m 18s"
  },
  {
    id: "job_20260708_000118",
    customer: "Empirical - Momentara",
    source: "Manual XLSX",
    state: "Failed",
    extId: "AS360-30904110",
    updated: "1 hr ago",
    orders: 5,
    started: "Yesterday 4:31 PM",
    duration: "45s"
  }
];

const fallbackImportMethods: ImportMethod[] = [
  {
    import_method_id: "manual-xlsx",
    name: "Manual XLSX",
    type: "Manual upload",
    source: "XLSX",
    status: "Active",
    output_route_id: defaultOutputRoute.output_route_id,
    target_id: "lift-standard-graphics",
    target_template: "Lift Standard Graphics Order",
    template_id: "template_manual_xlsx_v1",
    mappings: buildDefaultMappings(sampleSourceGrid.columns),
    source_config: {},
    workbook_sheet_policy: "rows_with_quantity",
    product_resolution_config: defaultProductResolutionConfig,
    last_run_at: seedTimestamp,
    success_rate: "100%",
    created_at: seedTimestamp,
    updated_at: seedTimestamp
  },
  {
    import_method_id: "wrike-intake",
    name: "Wrike Intake",
    type: "API import",
    source: "REST API",
    status: "Draft",
    output_route_id: defaultOutputRoute.output_route_id,
    target_id: "lift-standard-graphics",
    target_template: "Lift Standard Graphics Order",
    template_id: "template_wrike_intake_v1",
    mappings: [],
    source_config: {
      api_endpoint_url: ""
    },
    workbook_sheet_policy: "rows_with_quantity",
    product_resolution_config: defaultProductResolutionConfig,
    last_run_at: null,
    success_rate: "98.7%",
    created_at: seedTimestamp,
    updated_at: seedTimestamp
  },
  {
    import_method_id: "paste-grid",
    name: "Paste Grid",
    type: "Manual paste",
    source: "Clipboard",
    status: "Draft",
    output_route_id: defaultOutputRoute.output_route_id,
    target_id: "lift-standard-graphics",
    target_template: "Lift Standard Graphics Order",
    template_id: "template_paste_grid_v1",
    mappings: [],
    source_config: {},
    workbook_sheet_policy: "rows_with_quantity",
    product_resolution_config: defaultProductResolutionConfig,
    last_run_at: null,
    success_rate: null,
    created_at: seedTimestamp,
    updated_at: seedTimestamp
  }
];

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

const apiBaseUrl = "http://127.0.0.1:3000";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || `Request failed with HTTP ${response.status}.`);
  }

  if (!contentType.includes("application/json")) {
    throw new Error("Pathfinder API returned a non-JSON response. Confirm the API server is running on port 3000.");
  }

  return JSON.parse(body) as T;
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
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
      : state === "Ready" || state === "Completed"
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

function RouteDiagnosticPill({ status }: { status: RouteDiagnostics["status"] | RouteDiagnosticStatus }) {
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
  return `${route.target_system} · ${route.destination_account_name} · ${route.output_template}`;
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

function isPlaceholderSecret(value?: string | null) {
  if (!value) {
    return true;
  }
  return /TBD|SECRET|REFERENCE|^\*+$/i.test(value);
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
}): SubmitCertification {
  const canonicalFailures = args.canonicalValidation.filter((message) => message.severity === "FAIL");
  const liftFailures = args.liftValidation.filter((message) => message.severity === "FAIL");
  const items: SubmitCertificationItem[] = [
    submitCertificationItem(
      "preview-state",
      "Preview state",
      args.state === "Ready",
      `Preview is ${args.state}, not Ready.`,
      "Preview job is Ready.",
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
      !isPlaceholderSecret(args.request.headers.User) && !isPlaceholderSecret(args.request.headers.Password),
      "Lift import credentials are placeholders or masked values.",
      "Lift import credentials are configured.",
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
      status: "Blocked",
      blocking: true,
      message: "Lift transport mode is dry_run; Pathfinder will not call Lift until the API is started in live transport mode.",
      suggested_action: "Set PATHFINDER_LIFT_TRANSPORT_MODE=live for the first real sandbox-lane submit.",
      action_key: "target-health"
    },
    {
      item_id: "external-submit-gate",
      label: "External submit feature gate",
      status: "Blocked",
      blocking: true,
      message: "External Lift submit is still disabled in Pathfinder.",
      suggested_action: "Enable the explicit submit gate only after credentials and response handling are approved.",
      action_key: "target-health"
    }
  ];
  const blockingCount = items.filter((item) => item.blocking).length;

  return {
    can_submit: blockingCount === 0,
    external_submit_enabled: false,
    live_transport_enabled: false,
    live_customer_submit_allowed: false,
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
  if (source === "SFTP" || source === "Google Sheet") {
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

function productMappingSourceLabel(mapping: CustomerProductMapping) {
  return mapping.mapping_source ?? (mapping.last_seen_examples.length ? "Observed order" : "Manual entry");
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const productPreloadFileRef = useRef<HTMLInputElement>(null);
  const [activeGlobalView, setActiveGlobalView] = useState<GlobalView>("Customers");
  const [activeCustomerView, setActiveCustomerView] = useState<CustomerView>("Overview");
  const [sourceGrid, setSourceGrid] = useState<SourceGrid>(sampleSourceGrid);
  const [sourceSheets, setSourceSheets] = useState<ParsedWorkbookSheet[]>(() => sampleSourceSheets(sampleSourceGrid));
  const [parsedOrderRows, setParsedOrderRows] = useState<ParsedSourceRow[]>(() => sampleParsedRows(sampleSourceGrid));
  const [referenceRows, setReferenceRows] = useState<ParsedSourceRow[]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>(() => buildDefaultMappings(sampleSourceGrid.columns));
  const [sourceName, setSourceName] = useState("Sample workbook");
  const [sheetName, setSheetName] = useState("Sample");
  const [importError, setImportError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<LiftCustomer[]>([fallbackCustomer]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(fallbackCustomer.lift_customer_id);
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const [customerDirectory, setCustomerDirectory] = useState<Omit<LiftCustomerDirectory, "customers">>({
    source: "local-seed",
    endpoint_url: "",
    status_endpoint_url: "",
    loaded_at: "",
    warning: undefined
  });
  const [customerImportState, setCustomerImportState] = useState<"idle" | "loading">("idle");
  const [workspace, setWorkspace] = useState<PathfinderCustomerWorkspace | null>(null);
  const [targets, setTargets] = useState<TargetConfig[]>([]);
  const [canonicalRegistry, setCanonicalRegistry] = useState<CanonicalRegistryPayload | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [activeTargetsView, setActiveTargetsView] = useState<TargetDetailView>("Environments");
  const [activeOutputTemplateId, setActiveOutputTemplateId] = useState<string | null>(null);
  const [globalJobs, setGlobalJobs] = useState<ProcessingJobPreview[]>([]);
  const [activeMethodId, setActiveMethodId] = useState("manual-xlsx");
  const [workspaceState, setWorkspaceState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
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
  const [certificationRefreshState, setCertificationRefreshState] = useState<"idle" | "loading" | "error">("idle");
  const certificationRefreshKeyRef = useRef("");
  const [selectedSubmitProfileId, setSelectedSubmitProfileId] = useState("sandbox-ltl-demo-1249");
  const [productMappingDrafts, setProductMappingDrafts] = useState<Record<string, { unit: string; product: string }>>({});
  const [compositeColumnToAdd, setCompositeColumnToAdd] = useState("");
  const [productExampleTestValue, setProductExampleTestValue] = useState("");
  const [unitMapSearch, setUnitMapSearch] = useState("");
  const [unitMapStatusFilter, setUnitMapStatusFilter] = useState<ProductMappingStatus | "All">("All");
  const [outputMapRouteFilter, setOutputMapRouteFilter] = useState("All");
  const [selectedUnitMapIds, setSelectedUnitMapIds] = useState<string[]>([]);
  const [bulkUnitNumber, setBulkUnitNumber] = useState("");
  const [bulkProductName, setBulkProductName] = useState("");
  const [preloadText, setPreloadText] = useState("");
  const [preloadSourceName, setPreloadSourceName] = useState("Customer product list");
  const [preloadGrid, setPreloadGrid] = useState<SourceGrid>({ columns: [], rows: [] });
  const [preloadSourceColumn, setPreloadSourceColumn] = useState("");
  const [preloadProductNameColumn, setPreloadProductNameColumn] = useState("");
  const [preloadUnitColumn, setPreloadUnitColumn] = useState("");
  const [preloadDefaultUnit, setPreloadDefaultUnit] = useState("");
  const [preloadSelectedIds, setPreloadSelectedIds] = useState<string[]>([]);
  const [liftUnitCatalog, setLiftUnitCatalog] = useState<LiftUnitCatalogItem[]>([]);
  const [unitCatalogSearch, setUnitCatalogSearch] = useState("");
  const [unitCatalogStatusFilter, setUnitCatalogStatusFilter] = useState<"Active" | "Inactive" | "All">("Active");
  const [unitCatalogProductTypeFilter, setUnitCatalogProductTypeFilter] = useState("All");
  const [unitCatalogCatalogFilter, setUnitCatalogCatalogFilter] = useState("All");
  const [activeCatalogMappingId, setActiveCatalogMappingId] = useState<string | null>(null);
  const [unitCatalogState, setUnitCatalogState] = useState<"idle" | "loading" | "error">("idle");
  const [openTopbarMenu, setOpenTopbarMenu] = useState<"environment" | "notifications" | "actions" | null>(null);
  const [openProductMapTool, setOpenProductMapTool] = useState<"preload" | "unit-library" | null>(null);

  async function loadCustomers(refresh = false) {
    setCustomerImportState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/lift/customers${refresh ? "?refresh=1" : ""}`);
      const directory = await readJsonResponse<LiftCustomerDirectory>(response);
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
        return momentara?.lift_customer_id ?? directory.customers[0]?.lift_customer_id ?? fallbackCustomer.lift_customer_id;
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
    setWorkspaceState("loading");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${liftCustomerId}/workspace`);
      const loadedWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      setWorkspace(loadedWorkspace);
      setLastSubmitAttempt(loadedWorkspace.submit_attempts?.[0] ?? null);
      setActiveMethodId(
        loadedWorkspace.import_methods.find((method) => method.status !== "Archived")?.import_method_id ?? "manual-xlsx"
      );
      setWorkspaceMessage(null);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Workspace load failed.");
      setWorkspaceState("error");
      return;
    }
    setWorkspaceState("idle");
  }

  async function loadTargetsAndJobs() {
    try {
      const [targetsResponse, jobsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/targets`),
        fetch(`${apiBaseUrl}/api/jobs`)
      ]);
      const targetsPayload = await readJsonResponse<{ targets: TargetConfig[] }>(targetsResponse);
      const jobsPayload = await readJsonResponse<{ jobs: ProcessingJobPreview[] }>(jobsResponse);
      setTargets(targetsPayload.targets);
      setGlobalJobs(jobsPayload.jobs);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Target/job load failed.");
    }
  }

  async function loadCanonicalRegistry() {
    try {
      const response = await fetch(`${apiBaseUrl}/api/canonical-registry`);
      const registry = await readJsonResponse<CanonicalRegistryPayload>(response);
      setCanonicalRegistry(registry);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Canonical registry load failed.");
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
      if (unitCatalogSearch.trim()) {
        params.set("q", unitCatalogSearch.trim());
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
      if (unitCatalogSearch.trim()) {
        params.set("q", unitCatalogSearch.trim());
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
      const response = await fetch(`${apiBaseUrl}/api/lift/product-catalog?${params.toString()}`);
      const payload = await readJsonResponse<{
        products: LiftUnitCatalogItem[];
        refreshed_count: number;
        source: string;
      }>(response);
      setLiftUnitCatalog(payload.products);
      setWorkspaceMessage(`Lift product catalog refreshed. ${payload.refreshed_count} product${payload.refreshed_count === 1 ? "" : "s"} received.`);
      setUnitCatalogState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Lift product catalog refresh failed.");
      setUnitCatalogState("error");
    }
  }

  async function openJobDetail(job: ProcessingJobPreview) {
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
      const payload = await readJsonResponse<{ snapshot: PathfinderOrderSnapshot }>(response);
      setOrderSnapshotResult(payload.snapshot);
      setWorkspaceMessage(`Order snapshot loaded for ${payload.snapshot.order_number}.`);
      setOrderSnapshotState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Pathfinder order snapshot failed.");
      setOrderSnapshotState("error");
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
    setWorkspaceState("saving");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/import-methods/${method.import_method_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...method, mappings: nextMappings })
        }
      );
      const nextWorkspace = await readJsonResponse<PathfinderCustomerWorkspace>(response);
      setWorkspace(nextWorkspace);
      setWorkspaceMessage("Import method saved.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Import method save failed.");
      setWorkspaceState("error");
    }
  }

  async function createPreviewJob() {
    const availableMethods = workspace?.import_methods.length ? workspace.import_methods : fallbackImportMethods;
    const method = availableMethods.find((candidate) => candidate.import_method_id === activeMethodId) ?? availableMethods[0];
    if (!method) {
      setWorkspaceMessage("Choose an import method before generating a preview job.");
      return;
    }
    if (method.status !== "Active") {
      setWorkspaceMessage("Activate this import method before generating a preview job.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/jobs/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_method_id: method.import_method_id,
          source_file_name: sourceName,
          sheet_name: sheetName,
          source_grid: sourceGrid,
          source_sheets: sourceSheets,
          parsed_order_rows: parsedOrderRows,
          reference_rows: referenceRows,
          mappings,
          submit_profile_id: selectedSubmitProfile.profile_id,
          product_resolution_config: method.product_resolution_config
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
      const activeEnvironment = savedTarget.environments.find(
        (environment) => environment.name === savedTarget.lift.active_environment
      );
      const routesToSync =
        activeEnvironment && workspace?.output_routes
          ? workspace.output_routes.filter(
              (route) => route.target_id === savedTarget.target_id && route.environment_id !== activeEnvironment.environment_id
            )
          : [];
      let syncedWorkspace: PathfinderCustomerWorkspace | null = null;

      for (const route of routesToSync) {
        syncedWorkspace = await persistOutputRoute({
          ...route,
          environment_id: activeEnvironment!.environment_id
        });
      }

      setTargets((current) => [savedTarget, ...current.filter((candidate) => candidate.target_id !== savedTarget.target_id)]);
      setWorkspace((current) => {
        const nextWorkspace = syncedWorkspace ?? current;
        return nextWorkspace ? { ...nextWorkspace, primary_target: savedTarget } : nextWorkspace;
      });
      setWorkspaceMessage(
        routesToSync.length
          ? `Target settings saved. ${routesToSync.length} route${routesToSync.length === 1 ? "" : "s"} now use ${activeEnvironment?.name}.`
          : "Target settings saved."
      );
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Target save failed.");
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

  const selectedCustomer =
    customers.find((customer) => customer.lift_customer_id === selectedCustomerId) ?? fallbackCustomer;
  useEffect(() => {
    void loadWorkspace(selectedCustomer.lift_customer_id);
  }, [selectedCustomer.lift_customer_id]);

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
  const allImportMethods = workspace?.import_methods.length ? workspace.import_methods : fallbackImportMethods;
  const importMethods = allImportMethods.filter((method) => method.status !== "Archived");
  const activeImportMethod =
    importMethods.find((method) => method.import_method_id === activeMethodId) ?? importMethods[0] ?? allImportMethods[0];
  const activeProductConfig = activeImportMethod?.product_resolution_config ?? defaultProductResolutionConfig;
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
  const addableCompositeColumns = availableInputColumns.filter(
    (column) => !activeProductConfig.composite_columns.includes(column)
  );
  const customerJobs = workspace?.jobs ?? [];
  const overviewJobs = customerJobs.slice(0, 5);
  const allJobs = globalJobs.length ? globalJobs : customerJobs;
  const visibleJobDetailAttempts = selectedJobAttempts.length
    ? selectedJobAttempts
    : (workspace?.submit_attempts ?? []).filter((attempt) => attempt.job_id === selectedJobDetail?.job_id);
  const latestJobAttempt = visibleJobDetailAttempts[0] ?? null;
  const canRetrySelectedJob =
    selectedJobDetail?.state === "Ready" || selectedJobDetail?.state === "Submit Failed";
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
    activeImportMethod
      ? outputRouteForMethod(activeImportMethod, outputRoutes)
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
    unitCatalogSearch,
    unitCatalogStatusFilter,
    unitCatalogProductTypeFilter,
    unitCatalogCatalogFilter
  ]);

  const selectedOutputMapTarget =
    targetRows.find((target) => target.target_id === selectedOutputMapRoute.target_id) ?? primaryTarget ?? null;
  const selectedOutputMapEnvironment =
    selectedOutputMapTarget?.environments.find(
      (environment) => environment.environment_id === selectedOutputMapRoute.environment_id
    ) ??
    selectedOutputMapTarget?.environments.find((environment) => environment.name === selectedOutputMapTarget.lift.active_environment) ??
    null;
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
  const filteredProductMappings = useMemo(() => {
    const query = unitMapSearch.trim().toLowerCase();
    return productMappings
      .filter((mapping) => mapping.output_route_id === selectedOutputMapRouteId)
      .filter((mapping) => unitMapStatusFilter === "All" || mapping.status === unitMapStatusFilter)
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
          statusWeight[first.status] - statusWeight[second.status] ||
          second.updated_at.localeCompare(first.updated_at)
        );
      });
  }, [productMappings, selectedOutputMapRouteId, unitMapSearch, unitMapStatusFilter]);
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
  const routeMappedCount = routeProductMappings.filter((mapping) => mapping.status === "Mapped").length;
  const routeUnmappedCount = routeProductMappings.filter((mapping) => mapping.status === "Unmapped").length;
  const routeBlockingCount = routeProductMappings.filter(
    (mapping) => mapping.status === "Unmapped" || mapping.status === "Ambiguous"
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
    if (activeImportMethod?.mappings.length) {
      setMappings(activeImportMethod.mappings);
    }
  }, [activeImportMethod?.import_method_id, workspace?.updated_at]);

  useEffect(() => {
    setSelectedUnitMapIds([]);
  }, [selectedOutputMapRouteId]);

  const canonicalOrder = useMemo(
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

  const canonicalMessages = validateCanonicalOrder(canonicalOrder, {
    product_identifier_type: activeOutputRoute.product_identifier_type
  });
  const rawLiftPayload = generateLiftPayload(canonicalOrder, {
    jobId: "job_preview",
    canonicalOrderId: "co_preview"
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
  const localCertificationState: ProcessingState = lastPreviewJob?.state ?? (hasBlockingFailure ? "Failed" : routeBlockingCount ? "Needs Mapping" : "Ready");
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
      unresolvedProductCount: lastPreviewJob?.unresolved_products.length ?? routeBlockingCount
    });
  const submitCertificationBlockingCount = submitCertification.items.filter((item) => item.blocking).length;
  const manualSourceReady = sourceGrid.rows.length > 0;
  const manualPreviewReady = Boolean(lastPreviewJob);
  const manualFixesNeeded = submitCertificationBlockingCount > 0 || routeBlockingCount > 0;
  const manualSubmitReady = Boolean(lastPreviewJob && submitCertification.can_submit && submitCertification.external_submit_enabled);
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
    (job) => job.state === "Submitted" || job.state === "Completed" || Boolean(job.target_order_number)
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
    if (!environment) {
      setWorkspaceMessage("Choose a valid target environment.");
      setWorkspaceState("error");
      return;
    }

    const nextRoute = {
      ...primaryOutputRoute,
      environment_id: environment.environment_id
    };
    setOpenTopbarMenu(null);
    await saveOutputRoute(nextRoute);
    setWorkspaceMessage(`Primary route environment set to ${environment.name}. Regenerate preview jobs to apply it.`);
  }

  function runHeaderAction(action: "manual-import" | "preview" | "product-map" | "import-methods" | "jobs" | "target") {
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
      return;
    }
    if (action === "jobs") {
      setActiveCustomerView("Jobs");
      return;
    }

    setActiveGlobalView("Targets");
    setSelectedTargetId(primaryOutputRoute.target_id);
    setActiveTargetsView("Output Routes");
  }

  async function importWorkbook(file: File) {
    try {
      const parsed = await parseWorkbookArrayBuffer(await file.arrayBuffer());
      setSourceGrid({ columns: parsed.columns, rows: parsed.rows });
      setSourceSheets(parsed.source_sheets);
      setParsedOrderRows(parsed.parsed_order_rows);
      setReferenceRows(parsed.reference_rows);
      setMappings(buildDefaultMappings(parsed.columns));
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
    setMappings(buildDefaultMappings(sampleSourceGrid.columns));
    setSourceName("Sample workbook");
    setSheetName("Sample");
    setLastPreviewJob(null);
    setLastSubmitAttempt(null);
    setImportError(null);
  }

  function updateActiveMethodDraft(patch: Partial<ImportMethod>) {
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
      setWorkspaceMessage("Output route saved.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Output route save failed.");
      setWorkspaceState("error");
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
        ? mapping.product_identifier_value ?? mapping.lift_unit_number ?? mapping.lift_product_id
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

  async function requestLiftSubmit(jobOverride?: ProcessingJobPreview, forceNewAttempt = false) {
    const submitJob = jobOverride ?? lastPreviewJob;
    if (!submitJob) {
      setWorkspaceMessage("Generate a persisted preview job before requesting Lift submit.");
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

  async function bulkUpdateProductMappings(patch: Partial<CustomerProductMapping>, successMessage: string) {
    if (selectedUnitMappings.length === 0) {
      setWorkspaceMessage("Select one or more customer keys before applying a bulk action.");
      return;
    }

    setWorkspaceState("saving");
    try {
      const response = await fetch(`${apiBaseUrl}/api/customers/${selectedCustomer.lift_customer_id}/product-mappings/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_mappings: selectedUnitMappings.map((mapping) => ({
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
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Bulk product mapping save failed.");
      setWorkspaceState("error");
    }
  }

  async function bulkAssignUnitNumber() {
    if (!bulkUnitNumber.trim()) {
      setWorkspaceMessage(`Enter a ${selectedOutputMapRoute.product_identifier_label} before assigning selected customer keys.`);
      return;
    }
    await bulkUpdateProductMappings(
      {
        output_route_id: selectedOutputMapRouteId,
        target_id: selectedOutputMapRoute.target_id,
        target_template: selectedOutputMapRoute.output_template,
        product_identifier_type: selectedOutputMapRoute.product_identifier_type,
        product_identifier_value: bulkUnitNumber.trim(),
        lift_unit_number: selectedOutputMapRoute.product_identifier_type === "lift_unit_number" ? bulkUnitNumber.trim() : null,
        lift_product_id: selectedOutputMapRoute.product_identifier_type === "lift_product_id" ? bulkUnitNumber.trim() : null,
        product_name: bulkProductName.trim() || selectedUnitMappings[0]?.product_name || null,
        status: "Mapped"
      },
      `${selectedUnitMappings.length} customer key${selectedUnitMappings.length === 1 ? "" : "s"} mapped to ${bulkUnitNumber.trim()}.`
    );
  }

  function catalogIdentifierForRoute(item: LiftUnitCatalogItem, route: OutputRoute) {
    if (route.product_identifier_type === "lift_product_id") {
      return item.product_id ?? item.unit_number ?? "";
    }
    return item.unit_number ?? item.product_id ?? "";
  }

  function catalogIdentifierLabel(item: LiftUnitCatalogItem) {
    return item.unit_number ?? (item.product_id ? `Product ID ${item.product_id}` : "No identifier");
  }

  function setBulkValueFromCatalog(item: LiftUnitCatalogItem) {
    const identifier = catalogIdentifierForRoute(item, selectedOutputMapRoute);
    setBulkUnitNumber(identifier);
    setBulkProductName(item.product_name);
    setWorkspaceMessage(`${identifier || item.product_name} selected for bulk assignment.`);
  }

  async function assignCatalogItemToSelectedMappings(item: LiftUnitCatalogItem) {
    if (!selectedUnitMappings.length) {
      setBulkValueFromCatalog(item);
      return;
    }

    await bulkUpdateProductMappings(
      {
        output_route_id: selectedOutputMapRouteId,
        target_id: selectedOutputMapRoute.target_id,
        target_template: selectedOutputMapRoute.output_template,
        product_identifier_type: selectedOutputMapRoute.product_identifier_type,
        product_identifier_value: catalogIdentifierForRoute(item, selectedOutputMapRoute),
        lift_unit_number: item.unit_number,
        lift_product_id: item.product_id,
        product_name: item.product_name,
        status: "Mapped"
      },
      `${selectedUnitMappings.length} customer key${selectedUnitMappings.length === 1 ? "" : "s"} mapped to ${catalogIdentifierForRoute(item, selectedOutputMapRoute) || item.product_name}.`
    );
    if (activeCatalogMappingId) {
      setOpenProductMapTool(null);
      setActiveCatalogMappingId(null);
      setSelectedUnitMapIds([]);
    }
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

    setPreloadGrid(parsed);
    setPreloadSourceColumn(defaultSourceColumn);
    setPreloadProductNameColumn(guessedProductColumn);
    setPreloadUnitColumn(guessedUnitColumn === defaultSourceColumn ? "" : guessedUnitColumn);
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

      setPreloadGrid(grid);
      setPreloadSourceName(file.name);
      setPreloadSourceColumn(defaultSourceColumn);
      setPreloadProductNameColumn(guessedProductColumn);
      setPreloadUnitColumn(guessedUnitColumn === defaultSourceColumn ? "" : guessedUnitColumn);
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
              last_seen_examples: row.existing_mapping?.last_seen_examples?.length
                ? row.existing_mapping.last_seen_examples
                : [
                    {
                      sheet_name: preloadSourceName.trim() || "Preloaded catalog",
                      row_number: row.row_number,
                      description: row.product_name || row.display_label,
                      sign_type: row.source_value || null,
                      media_type: null
                    }
                  ]
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
      mappings: buildDefaultMappings(sourceGrid.columns),
      source_config: {},
      workbook_sheet_policy: "rows_with_quantity",
      product_resolution_config: defaultProductResolutionConfig,
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
    setActiveCustomerView("Import Methods");
  }

  async function duplicateImportMethod(method: ImportMethod) {
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
    await saveImportMethod(duplicate, duplicate.mappings);
  }

  async function deleteImportMethod(method: ImportMethod) {
    if (!workspace || importMethods.length <= 1) {
      setWorkspaceMessage("Keep at least one import method for this customer.");
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
      setActiveMethodId(nextMethod?.import_method_id ?? "manual-xlsx");
      setWorkspaceMessage("Import method archived.");
      setWorkspaceState("idle");
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Import method delete failed.");
      setWorkspaceState("error");
    }
  }

  function updateTargetDraft(targetId: string, updater: (target: TargetConfig) => TargetConfig) {
    setTargets((current) => current.map((target) => (target.target_id === targetId ? updater(target) : target)));
    setWorkspace((current) =>
      current?.primary_target?.target_id === targetId
        ? { ...current, primary_target: updater(current.primary_target) }
        : current
    );
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

      const nextEnvironments = target.environments.filter((candidate) => candidate.environment_id !== environmentId);
      const fallbackEnvironmentId = nextEnvironments[0]?.environment_id;
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
              onClick={() => setActiveGlobalView(item.label)}
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
                    onClick={() => {
                      setSelectedCustomerId(customer.lift_customer_id);
                      setCustomerSearch("");
                      setIsCustomerPickerOpen(false);
                      setActiveGlobalView("Customers");
                      setActiveCustomerView("Overview");
                    }}
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
                onClick={() => {
                  setActiveGlobalView("Customers");
                  setActiveCustomerView(item.label);
                }}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </section>

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
                <div className="topbar-menu-wrap">
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
                        onClick={() => {
                          setOpenTopbarMenu(null);
                          setActiveGlobalView("Targets");
                          setSelectedTargetId(primaryOutputRoute.target_id);
                          setActiveTargetsView("Environments");
                        }}
                      >
                        Manage environments
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="topbar-menu-wrap">
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

                <div className="topbar-menu-wrap">
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
                            <tr key={method.import_method_id} onClick={() => setActiveCustomerView("Import Methods")}>
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
                    <button className="table-footer-link" onClick={() => setActiveCustomerView("Import Methods")}>
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
                <section className="panel method-panel">
                  <div className="table-panel-header">
                    <PanelHeader icon={Workflow} title="Import Methods" detail="Source intake definitions" />
                    <button className="primary-button table-header-action" onClick={createDraftImportMethod}>
                      <Plus size={15} />
                      New Import Method
                    </button>
                  </div>
                  <div className="method-table">
                    {importMethods.map((method) => (
                      <div
                        className={activeMethodId === method.import_method_id ? "method-row method-row-active" : "method-row"}
                        key={method.import_method_id}
                      >
                        <button className="method-select-area" onClick={() => setActiveMethodId(method.import_method_id)}>
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
                          <button title="Edit import method" onClick={() => setActiveMethodId(method.import_method_id)}>
                            <Edit3 size={15} />
                          </button>
                          <button title="Duplicate import method" onClick={() => void duplicateImportMethod(method)}>
                            <Copy size={15} />
                          </button>
                          <button title="Delete import method" onClick={() => void deleteImportMethod(method)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                {activeImportMethod ? (
                  <section className="panel setup-panel">
                    <PanelHeader icon={SlidersHorizontal} title="Method Setup" detail={activeImportMethod.import_method_id} />
                    <div className="setup-grid">
                      <label className="setup-control">
                        <span>Name</span>
                        <input
                          value={activeImportMethod.name}
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
                              type: sourceTypeToMethodType(source)
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
                      <div className="setup-actions">
                        <button className="secondary-button" onClick={() => setActiveCustomerView("Manual Import")}>
                          Open Manual Import
                        </button>
                        <button className="primary-button" onClick={() => void saveImportMethod(activeImportMethod)}>
                          Save Method
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}
                {activeImportMethod ? (
                  <section className="panel setup-panel product-resolution-setup">
                    <PanelHeader icon={Database} title="Product Resolution" detail="Customer key to route product" />
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
                    <div className="resolver-action-row">
                      <div className="setup-actions">
                        <button className="primary-button" onClick={() => void saveImportMethod(activeImportMethod)}>
                          Save Resolver
                        </button>
                      </div>
                    </div>
                  </section>
                ) : null}
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
                    <span>{mappedColumnCount} of {sourceGrid.columns.length} source columns mapped</span>
                    {activeImportMethod ? (
                      <button className="primary-button" onClick={() => void saveImportMethod(activeImportMethod)}>
                        Save Field Mapping
                      </button>
                    ) : null}
                  </div>
                </section>
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
                        placeholder="Search key, source value, unit number, or product"
                        onChange={(event) => setUnitMapSearch(event.target.value)}
                      />
                    </label>
                    <label className="setup-control unit-map-filter">
                      <span>Output Route</span>
                      <select
                        value={outputMapRouteFilter}
                        onChange={(event) => setOutputMapRouteFilter(event.target.value)}
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
                          placeholder={"SIGN TYPE\tDESCRIPTION\tLift unit_number\n2 Sheet Poster\t2 Sheet Poster\t2SHEET_46x60_48PT"}
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
                    <div className="product-map-modal-backdrop" role="presentation" onClick={() => setOpenProductMapTool(null)}>
                      <section
                        className="unit-catalog-panel product-map-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Lift Product Catalog"
                        onClick={(event) => event.stopPropagation()}
                      >
                    <div className="unit-catalog-header">
                      <div>
                        <strong>Lift Product Catalog</strong>
                        <span>
                          {activeCatalogMapping
                            ? `Map ${activeCatalogMapping.customer_product_key} to an approved Lift product.`
                            : "Search cached Lift products, refresh from Lift, then map customer keys to product_id or unitNumber."}
                        </span>
                      </div>
                      <label className="unit-map-search unit-catalog-search">
                        <Search size={16} />
                        <input
                          value={unitCatalogSearch}
                          placeholder="Search product name, product ID, unit number, catalog"
                          onChange={(event) => setUnitCatalogSearch(event.target.value)}
                        />
                      </label>
                      <div className="unit-catalog-header-actions">
                        <button className="secondary-button" onClick={() => void refreshLiftProductCatalog(selectedOutputMapRoute)} disabled={unitCatalogState === "loading"}>
                          <RefreshCw size={15} />
                          Refresh from Lift
                        </button>
                        <button
                          className="modal-close-button"
                          onClick={() => {
                            setOpenProductMapTool(null);
                            setActiveCatalogMappingId(null);
                          }}
                          aria-label="Close Lift product catalog"
                        >
                          <X size={17} />
                        </button>
                      </div>
                    </div>
                    {activeCatalogMapping ? (
                      <div className="unit-catalog-focus">
                        <span>Mapping target</span>
                        <strong>{activeCatalogMapping.customer_product_key}</strong>
                        <small>{activeCatalogMapping.display_label}</small>
                      </div>
                    ) : null}
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
                        <span>Catalog</span>
                        <select
                          value={unitCatalogCatalogFilter}
                          onChange={(event) => setUnitCatalogCatalogFilter(event.target.value)}
                        >
                          <option value="All">All catalogs</option>
                          {unitCatalogCatalogOptions.map(([catalogId, catalogName]) => (
                            <option key={catalogId} value={catalogId}>
                              {catalogName} / {catalogId}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="unit-catalog-results">
                      {liftUnitCatalog.map((item) => (
                        <article className="unit-catalog-card" key={item.catalog_item_id}>
                          <div>
                            <strong>{item.product_name}</strong>
                            <span>{catalogIdentifierLabel(item)}</span>
                            <small>
                              Product ID {item.product_id ?? "pending"} · Catalog {item.catalog_name ?? item.catalog_id ?? "pending"} · {item.product_type ?? "Product"} · {item.source ?? "Catalog"}
                            </small>
                          </div>
                          <div className="unit-catalog-actions">
                            <button className="secondary-button" onClick={() => setBulkValueFromCatalog(item)}>
                              Use Value
                            </button>
                            <button
                              className="primary-button"
                              onClick={() => void assignCatalogItemToSelectedMappings(item)}
                              disabled={workspaceState === "saving"}
                            >
                              {activeCatalogMapping
                                ? "Map Product"
                                : selectedUnitMappings.length
                                  ? `Assign ${selectedUnitMappings.length}`
                                  : "Set Bulk"}
                            </button>
                            <button className="secondary-button" onClick={() => setPreloadDefaultFromCatalog(item)}>
                              Preload Default
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    {unitCatalogState === "loading" ? (
                      <p className="empty-state">Loading Lift product catalog...</p>
                    ) : null}
                    {unitCatalogState !== "loading" && liftUnitCatalog.length === 0 ? (
                      <p className="empty-state">No Lift products match this route and search. Refresh from Lift when credentials are configured.</p>
                    ) : null}
                      </section>
                    </div>
                  ) : null}

                  <div className="unit-map-bulkbar">
                    <div>
                      <strong>{selectedUnitMappings.length} selected</strong>
                      <span>Assign several customer values to one route-specific product identifier.</span>
                    </div>
                    <input
                      value={bulkUnitNumber}
                      placeholder={outputIdentifierPlaceholder(selectedOutputMapRoute)}
                      onChange={(event) => setBulkUnitNumber(event.target.value)}
                    />
                    <input
                      value={bulkProductName}
                      placeholder="Product name optional"
                      onChange={(event) => setBulkProductName(event.target.value)}
                    />
                    <button className="primary-button" onClick={() => void bulkAssignUnitNumber()} disabled={workspaceState === "saving"}>
                      Bulk Assign
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void bulkUpdateProductMappings({ status: "Inactive" }, "Selected customer keys marked inactive.")}
                      disabled={workspaceState === "saving"}
                    >
                      Mark Inactive
                    </button>
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
                            unit: mapping.product_identifier_value ?? mapping.lift_unit_number ?? mapping.lift_product_id ?? "",
                            product: mapping.product_name ?? ""
                          };
                          return (
                            <tr key={mapping.mapping_id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedUnitMapIds.includes(mapping.mapping_id)}
                                  onChange={() => toggleUnitMapping(mapping.mapping_id)}
                                  aria-label={`Select ${mapping.customer_product_key}`}
                                />
                              </td>
                              <td>
                                <span className={productMappingStatusClass(mapping.status)}>{mapping.status}</span>
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
                                  onClick={() => {
                                    setSelectedUnitMapIds([mapping.mapping_id]);
                                    setActiveCatalogMappingId(mapping.mapping_id);
                                    setUnitCatalogSearch(mapping.product_name ?? mapping.display_label ?? mapping.customer_product_key);
                                    setOpenProductMapTool("unit-library");
                                  }}
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
                        No customer keys match this view. Generate a preview job to capture source values, or clear the filters.
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

                <section className="manual-import-grid">
                  <div className="panel upload-panel">
                    <PanelHeader icon={FileSpreadsheet} title="1. Upload Order Source" detail={sheetName} />
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
                        onClick={() => activeImportMethod ? void saveImportMethod(activeImportMethod, mappings) : undefined}
                        disabled={!activeImportMethod}
                      >
                        Save Mapping
                      </button>
                      <button className="primary-button" onClick={() => void createPreviewJob()} disabled={workspaceState === "saving"}>
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
                      <DetailItem label="Ext_ID" value={displayedSubmitRequest.headers.Ext_ID} />
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
                        disabled={!lastPreviewJob || workspaceState === "saving"}
                      >
                        {submitCertification.external_submit_enabled ? "Submit to Lift" : "Submit gate locked"}
                      </button>
                      <span>
                        {submitCertification.external_submit_enabled
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
                    <button className="primary-button" onClick={() => void createPreviewJob()} disabled={workspaceState === "saving"}>
                      Persist Preview Job
                    </button>
                  </div>
                </section>

                <section className="panel jobs-panel product-resolution-panel">
                  <PanelHeader
                    icon={Database}
                    title="Product Resolution Review"
                    detail={`${productResolutionRows.length || parsedOrderRows.length} order rows · ${referenceRowCount} reference rows`}
                  />
                  <table>
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Generated Key</th>
                        <th>Status</th>
                        <th>{activeOutputRoute.product_identifier_label}</th>
                        <th>Product Name</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(productResolutionRows.length
                        ? productResolutionRows
                        : parsedOrderRows.slice(0, 8).map((row, index) => ({
                            source_sheet_name: row.sheet_name,
                            source_row_number: row.row_number,
                            output_route_id: activeOutputRoute.output_route_id,
                            line_number: index + 1,
                            strategy: activeProductConfig.strategy,
                            mode: activeProductConfig.mode,
                            customer_product_key: "Generate preview to resolve",
                            display_label: String(row.values.DESCRIPTION ?? row.values["SIGN TYPE"] ?? `Row ${row.row_number}`),
                            source_columns: [activeProductConfig.source_column],
                            resolved_product_identifier: null,
                            resolved_unit_number: null,
                            resolved_product_id: null,
                            product_name: String(row.values.DESCRIPTION ?? ""),
                            status: "Unmapped" as ProductMappingStatus,
                            message: "Generate a preview job to create product resolution results."
                          }))
                      ).map((result) => {
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
                    <p className="empty-state">Generate a preview job to create durable product keys and mapping results.</p>
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

            {activeCustomerView === "Jobs" ? (
              <section className="panel jobs-panel">
                <PanelHeader icon={Archive} title="Customer Jobs" detail={selectedCustomer.customer_name} />
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Source</th>
                      <th>Ext ID</th>
                      <th>Lift Order</th>
                      <th>State</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerJobs.map((job) => (
                      <tr key={job.job_id}>
                        <td>
                          <button className="link-button" onClick={() => void openJobDetail(job)}>
                            {displayJobId(job.job_id)}
                          </button>
                        </td>
                        <td>{job.import_method_name}</td>
                        <td>{jobExtId(job)}</td>
                        <td>{job.target_order_number ?? "—"}</td>
                        <td>
                          <StatePill state={job.state} />
                        </td>
                        <td>{displayTimestamp(job.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {customerJobs.length === 0 ? <p className="empty-state">No persisted jobs for this customer yet.</p> : null}
              </section>
            ) : null}

            {activeCustomerView === "Settings" ? (
              <section className="customer-overview">
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
                  <button className="primary-button" onClick={addTargetDraft}>
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
                              <button className="secondary-button table-inline-button" onClick={() => selectTargetForEdit(target)}>
                                <Edit3 size={14} />
                                Edit
                              </button>
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
                  <button className="secondary-button" onClick={() => setSelectedTargetId(null)}>
                    <ArrowLeft size={16} />
                    All targets
                  </button>
                  <div>
                    <p className="eyebrow">Target setup</p>
                    <h1>{selectedTarget.name}</h1>
                    <span>{selectedTarget.target_type} · {selectedTarget.status}</span>
                  </div>
                  <div className="target-header-status">
                    <span className={`health-chip health-chip-${selectedTarget.health_status.toLowerCase()}`}>
                      <i />
                      {selectedTarget.health_status}
                    </span>
                    <button className="primary-button" onClick={() => void saveTarget(selectedTarget)} disabled={workspaceState === "saving"}>
                      {workspaceState === "saving" ? "Saving" : "Save Target"}
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
                              updateTargetDraft(selectedTarget.target_id, (target) => ({
                                ...target,
                                lift: { ...target.lift, active_environment: event.target.value as "QA1" | "PROD" }
                              }))
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
                                title={
                                  targetEnvironments.length <= 1
                                    ? "A target needs at least one environment"
                                    : environment.name === selectedTarget.lift.active_environment
                                      ? "Choose a different active environment before removing this one"
                                      : `Remove ${environment.name}`
                                }
                                onClick={() => removeTargetEnvironmentDraft(selectedTarget.target_id, environment.environment_id)}
                                disabled={targetEnvironments.length <= 1 || environment.name === selectedTarget.lift.active_environment}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
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
                                value={environment.credentials.Password ?? ""}
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
                        </div>
                      ))}
                    </div>
                    <div className="panel-action-footer">
                      <span>Secrets are saved locally and returned masked by the API.</span>
                      <button className="primary-button" onClick={() => void saveTarget(selectedTarget)} disabled={workspaceState === "saving"}>
                        Save Environments
                      </button>
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
                      <span>Template edits update preview configuration only in this slice.</span>
                      <button className="primary-button" onClick={() => void saveTarget(selectedTarget)} disabled={workspaceState === "saving"}>
                        Save Output Templates
                      </button>
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
                                    updateOutputRouteDraft(route.output_route_id, {
                                      product_identifier_type: nextType,
                                      product_identifier_label: outputIdentifierLabel(nextType)
                                    });
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
                              <button
                                className="primary-button"
                                onClick={() => void saveOutputRoute(route)}
                                disabled={workspaceState === "saving"}
                              >
                                Save Route
                              </button>
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
                            <span>Strict rules can block submit when Lift requires an exact controlled value.</span>
                            <button
                              className="primary-button"
                              onClick={() => void saveOutputRoute(route)}
                              disabled={workspaceState === "saving"}
                            >
                              Save Value Rules
                            </button>
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
                    <PanelHeader icon={Activity} title="Test & Health" detail="Local preview checks only" />
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
                      <span>Connection testing will be enabled after credentials and submission rules are finalized.</span>
                      <button className="secondary-button" disabled>
                        Test Output gated
                      </button>
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {activeGlobalView === "Jobs" ? (
          <section className="panel jobs-panel">
            <PanelHeader icon={Archive} title="Processing Jobs" detail="Global history" />
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Source</th>
                  <th>Ext ID</th>
                  <th>Lift Order</th>
                  <th>State</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {allJobs.map((job) => (
                  <tr key={job.job_id}>
                    <td>
                      <button className="link-button" onClick={() => void openJobDetail(job)}>
                        {displayJobId(job.job_id)}
                      </button>
                    </td>
                    <td>{job.customer_name}</td>
                    <td>{job.import_method_name}</td>
                    <td>{jobExtId(job)}</td>
                    <td>{job.target_order_number ?? "—"}</td>
                    <td>
                      <StatePill state={job.state} />
                    </td>
                    <td>{displayTimestamp(job.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allJobs.length === 0 ? <p className="empty-state">No persisted jobs yet.</p> : null}
          </section>
        ) : null}

        {selectedJobDetail && ["Customers", "Dashboard", "Jobs"].includes(activeGlobalView) ? (
          <section className="job-detail-layout">
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
                    {selectedJobDetail.import_method_name} · {selectedJobDetail.source_file_name} · {jobExtId(selectedJobDetail)}
                  </span>
                </div>
                <div className="job-detail-actions">
                  <StatePill state={selectedJobDetail.state} />
                  <button
                    className="primary-button"
                    onClick={() => void requestLiftSubmit(selectedJobDetail, true)}
                    disabled={!canRetrySelectedJob || workspaceState === "saving"}
                  >
                    <Send size={16} />
                    Retry Submit
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void lookupLiftOrder(selectedJobDetail)}
                    disabled={
                      orderLookupState === "loading" ||
                      !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                    }
                  >
                    <Search size={16} />
                    {orderLookupState === "loading" ? "Looking up" : "Lookup Lift Order"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void loadOrderSnapshot(selectedJobDetail)}
                    disabled={
                      orderSnapshotState === "loading" ||
                      !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                    }
                  >
                    <ClipboardList size={16} />
                    {orderSnapshotState === "loading" ? "Building snapshot" : "Order Snapshot"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void lookupLiftProofs(selectedJobDetail)}
                    disabled={
                      proofReportState === "loading" ||
                      !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                    }
                  >
                    <FileText size={16} />
                    {proofReportState === "loading" ? "Loading proofs" : "Lookup Proofs"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => void lookupLiftPackages(selectedJobDetail)}
                    disabled={
                      packageDetailsState === "loading" ||
                      !(selectedJobDetail.target_order_number ?? latestJobAttempt?.response.lift_order_id)
                    }
                  >
                    <Archive size={16} />
                    {packageDetailsState === "loading" ? "Loading packages" : "Lookup Packages"}
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setSelectedJobDetail(null);
                      setOrderLookupResult(null);
                      setOrderLookupState("idle");
                      setProofReportResult(null);
                      setProofReportState("idle");
                      setPackageDetailsResult(null);
                      setPackageDetailsState("idle");
                      setOrderSnapshotResult(null);
                      setOrderSnapshotState("idle");
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
              <dl className="customer-details job-detail-summary">
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
              {orderSnapshotResult ? (
                <div className="code-panel order-lookup-panel order-snapshot-panel">
                  <PanelHeader
                    icon={ClipboardList}
                    title="Pathfinder Order Snapshot"
                    detail={`${orderSnapshotResult.order_number} · ${orderSnapshotResult.lines.length} line${orderSnapshotResult.lines.length === 1 ? "" : "s"} · ${orderSnapshotResult.packages.length} package${orderSnapshotResult.packages.length === 1 ? "" : "s"}`}
                  />
                  <dl className="customer-details job-detail-summary">
                    <DetailItem label="Source Order" value={orderSnapshotResult.source_order_id} />
                    <DetailItem label="Submit Customer" value={`${orderSnapshotResult.customer.submit_customer_name} / ${orderSnapshotResult.customer.submit_customer_id}`} />
                    <DetailItem label="Route" value={orderSnapshotResult.route.name} />
                    <DetailItem label="Proofs" value={`${orderSnapshotResult.proofs.length}`} />
                    <DetailItem label="Packages" value={`${orderSnapshotResult.packages.length}`} />
                    <DetailItem label="Redacted" value={orderSnapshotResult.visibility_policy.redacted_fields.join(", ") || "None"} />
                  </dl>
                  {orderSnapshotResult.issues.length ? (
                    <div className="template-warning-strip">
                      <AlertTriangle size={16} />
                      <span>
                        {orderSnapshotResult.issues.length} snapshot issue{orderSnapshotResult.issues.length === 1 ? "" : "s"}:
                        {" "}
                        {orderSnapshotResult.issues.map((issue) => issue.message).join(" ")}
                      </span>
                    </div>
                  ) : null}
                  <table>
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Product</th>
                        <th>Qty</th>
                        <th>Proofs</th>
                        <th>Packages</th>
                        <th>Latest Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderSnapshotResult.lines.map((line) => (
                        <tr key={`${line.line_number}-${line.order_line_id ?? "line"}`}>
                          <td>{line.line_number}</td>
                          <td>
                            <strong>{line.product_name ?? line.description ?? "Unknown product"}</strong>
                            <span className="cell-meta">
                              {line.product_id ? `Product ID ${line.product_id}` : line.unit_number ? `Unit ${line.unit_number}` : "No product identifier"}
                            </span>
                          </td>
                          <td>{line.quantity}</td>
                          <td>{line.proof_count}</td>
                          <td>{line.package_count}</td>
                          <td>{line.latest_tracking_message ?? line.latest_proof_status ?? "No external status yet"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <pre>{formatJson(orderSnapshotResult)}</pre>
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
      </section>
    </main>
  );
}
