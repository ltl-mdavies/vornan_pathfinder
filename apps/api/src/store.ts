import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
  buildLiftOrderLookupUrl,
  defaultLiftTargetConfig,
  type LiftSubmitErrorTranslation,
  type LiftOrderPayload,
  type LiftSubmitRequest,
  type LiftTargetConfig,
  type ValueNormalizationRule
} from "@pathfinder/lift-adapter";
import {
  buildDefaultMappings,
  sampleSourceGrid,
  type FieldMapping,
  type ParsedSourceRow,
  type ParsedWorkbookSheet,
  type SourceGrid
} from "@pathfinder/templates";

export type ImportMethodStatus = "Active" | "Inactive" | "Draft" | "Paused" | "Archived";
export type ImportMethodSource = "XLSX" | "Google Sheet" | "PDF PO" | "REST API" | "Clipboard" | "SFTP";
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
export type SubmitCertificationActionKey =
  | "manual-import"
  | "field-mapping"
  | "product-map"
  | "target-environments"
  | "target-output-routes"
  | "target-output-templates"
  | "target-health";
export type SubmitAttemptStatus = "Blocked" | "Gate Locked" | "Dry Run" | "Submitted" | "Failed";
export type SubmitAttemptTransportMode = "dry_run" | "mock" | "live";

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

export interface CustomerProductMapping {
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
  };
  workbook_sheet_policy: "rows_with_quantity";
  product_resolution_config: ProductResolutionConfig;
  last_run_at?: string | null;
  success_rate?: string | null;
  created_at: string;
  updated_at: string;
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

export interface ProcessingJobPreview {
  job_id: string;
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
  import_methods: ImportMethod[];
  output_routes: OutputRoute[];
  templates: SavedFieldMappingTemplate[];
  jobs: ProcessingJobPreview[];
  submit_attempts?: SubmitAttempt[];
  product_mappings: CustomerProductMapping[];
  catalog_presets: LiftCatalogPreset[];
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
  canonical_registry?: {
    overrides: Record<string, CanonicalFieldOverride>;
    custom_fields: CanonicalFieldDefinition[];
    snapshots: CanonicalRegistrySnapshot[];
    history: CanonicalRegistryChangeEntry[];
    updated_at: string;
  };
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

const storePath = fileURLToPath(new URL("../../../data/pathfinder-store.local.json", import.meta.url));
const secretsPath = fileURLToPath(new URL("../../../data/pathfinder-secrets.local.json", import.meta.url));
const targetId = "lift-standard-graphics";
const ecommerceTargetId = "thinkdifferentprint-ecommerce";
const outputRouteId = "route-ltl-lift-91-standard-graphics";
const manualImportMethodId = "manual-xlsx";
const defaultLiftOrderLookupUrl = "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360Orders/N?offset=0";
const defaultLiftProofReportUrl = "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/AS360ProofReport/N?offset=0";
const defaultLiftPackageDetailsUrl = "https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/PackageDetails/package_details?offset=0";

interface LocalTargetSecrets {
  environments?: Record<
    string,
    {
      credentials?: Partial<TargetEnvironment["credentials"]>;
      headers?: Record<string, string>;
    }
  >;
  lift?: {
    credentials?: Partial<LiftTargetConfig["credentials"]>;
  };
}

interface LocalSecretsStore {
  version: 1;
  targets: Record<string, LocalTargetSecrets>;
}

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
    name: "Lift Standard Graphics Order",
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
          requested_ship_date: "2026-06-23",
          due_date: "2026-06-24",
          order_attachment: "https://example.com/imports/momentara-order.xlsx",
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

export function createDefaultProductResolutionConfig(): ProductResolutionConfig {
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

function createSeedTarget(): TargetConfig {
  const lift = cloneDefaultLiftConfig();
  const timestamp = now();
  return {
    target_id: targetId,
    name: "Lift ERP",
    target_type: "ERP",
    adapter: "lift-standard-graphics",
    format: "JSON",
    template: "Lift Standard Graphics Order",
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
  const currentMappings = template.canonical_mappings.filter((mapping) => !lineShippingTemplateFields.has(mapping.sourceColumn));
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
    name: "Larger Than Life · Lift / 91 · Standard Graphics",
    target_id: targetId,
    environment_id: "env-lift-qa1",
    output_template_id: "template-lift-standard-graphics",
    target_system: "Lift ERP",
    destination_account_name: "Larger Than Life",
    destination_account_id: lift.headers.Company,
    company_id: lift.headers.Company,
    output_template: "Lift Standard Graphics Order",
    product_identifier_type: "lift_unit_number",
    product_identifier_label: "Lift unit_number",
    submit_profiles: createDefaultSubmitProfiles(),
    value_normalization_rules: createDefaultValueNormalizationRules(),
    order_lookup_url: defaultLiftOrderLookupUrl,
    proof_report_url: defaultLiftProofReportUrl,
    package_details_url: defaultLiftPackageDetailsUrl,
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

function createSeedMethod(timestamp: string): ImportMethod {
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
    product_resolution_config: createDefaultProductResolutionConfig(),
    last_run_at: null,
    success_rate: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

function createSeedCatalogPresets(customer: LiftCustomer, route: OutputRoute, timestamp = now()): LiftCatalogPreset[] {
  return customer.customer_name.toLowerCase().includes("momentara")
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

function createWorkspace(customer: LiftCustomer): PathfinderCustomerWorkspace {
  const timestamp = now();
  const method = createSeedMethod(timestamp);
  const route = createSeedOutputRoute(timestamp);
  const catalogPresets = createSeedCatalogPresets(customer, route, timestamp);

  return {
    customer,
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
    canonical_registry: {
      overrides: {},
      custom_fields: [],
      snapshots: [],
      history: [],
      updated_at: timestamp
    }
  };
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
  const lift = {
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
    }
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

function normalizeImportMethod(method: ImportMethod): ImportMethod {
  const route = createSeedOutputRoute();
  return {
    ...method,
    status: method.status ?? "Draft",
    output_route_id: method.output_route_id ?? route.output_route_id,
    target_id: method.target_id ?? route.target_id,
    target_template: method.target_template ?? route.output_template,
    source_config: method.source_config ?? {},
    workbook_sheet_policy: method.workbook_sheet_policy ?? "rows_with_quantity",
    product_resolution_config: {
      ...createDefaultProductResolutionConfig(),
      ...(method.product_resolution_config ?? {})
    }
  };
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

function matchesSearch(item: LiftUnitCatalogItem, query: string) {
  if (!query) {
    return true;
  }

  return [
    item.unit_number,
    ...(item.unit_numbers ?? []),
    item.product_id ?? "",
    item.product_name,
    item.catalog_id ?? "",
    item.catalog_name ?? "",
    item.accounting_item_code ?? "",
    item.product_type ?? "",
    item.category ?? "",
    item.description ?? ""
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
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
  const outputRoutes = (workspace.output_routes?.length ? workspace.output_routes : [route]).map((candidate) => ({
    ...route,
    ...candidate,
    environment_id: candidate.environment_id ?? route.environment_id,
    output_template_id: candidate.output_template_id ?? route.output_template_id,
    submit_profiles: normalizeSubmitProfiles(candidate),
    value_normalization_rules: candidate.value_normalization_rules?.length
      ? candidate.value_normalization_rules
      : route.value_normalization_rules,
    order_lookup_url: candidate.order_lookup_url ?? route.order_lookup_url ?? null,
    proof_report_url: candidate.proof_report_url ?? route.proof_report_url ?? null,
    package_details_url: candidate.package_details_url ?? route.package_details_url ?? null
  }));
  const primaryOutputRouteId = workspace.primary_output_route_id ?? outputRoutes[0]?.output_route_id ?? route.output_route_id;
  const catalogPresets = workspace.catalog_presets?.length
    ? workspace.catalog_presets
    : createSeedCatalogPresets(workspace.customer, outputRoutes[0] ?? route);

  return {
    ...workspace,
    import_methods: (workspace.import_methods ?? []).map(normalizeImportMethod),
    output_routes: outputRoutes,
    product_mappings: (workspace.product_mappings ?? []).map(normalizeProductMapping),
    catalog_presets: catalogPresets.map((preset) =>
      normalizeCatalogPreset(preset, { ...workspace, output_routes: outputRoutes })
    ),
    primary_target_id: workspace.primary_target_id ?? route.target_id,
    primary_output_route_id: primaryOutputRouteId,
    submit_attempts: workspace.submit_attempts ?? [],
    jobs: workspace.jobs ?? []
  };
}

async function writeStore(store: PathfinderStore) {
  await mkdir(dirname(storePath), { recursive: true });
  const sanitizedStore: PathfinderStore = {
    ...store,
    targets: Object.fromEntries(
      Object.entries(store.targets).map(([id, target]) => [id, maskTargetConfig(target)])
    ) as Record<string, TargetConfig>
  };
  await writeFile(storePath, `${JSON.stringify(sanitizedStore, null, 2)}\n`, "utf8");
}

async function readLocalSecrets(): Promise<LocalSecretsStore> {
  try {
    const content = await readFile(secretsPath, "utf8");
    const parsed = JSON.parse(content) as LocalSecretsStore;
    return {
      version: 1,
      targets: parsed.targets ?? {}
    };
  } catch {
    return { version: 1, targets: {} };
  }
}

async function writeLocalSecrets(secrets: LocalSecretsStore) {
  await mkdir(dirname(secretsPath), { recursive: true });
  await writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, "utf8");
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

function hydrateTargetWithSecrets(target: TargetConfig, secrets: LocalSecretsStore): TargetConfig {
  const targetSecrets = secrets.targets[target.target_id];
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
  const secrets = await readLocalSecrets();
  return Object.fromEntries(
    Object.entries(targets).map(([id, target]) => [id, hydrateTargetWithSecrets(target, secrets)])
  ) as Record<string, TargetConfig>;
}

async function persistTargetSecrets(target: TargetConfig) {
  const secrets = await readLocalSecrets();
  const targetSecrets: LocalTargetSecrets = secrets.targets[target.target_id] ?? { environments: {}, lift: {} };
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

  secrets.targets[target.target_id] = {
    ...targetSecrets,
    environments,
    lift: {
      ...(targetSecrets.lift ?? {}),
      credentials: liftCredentials
    }
  };
  await writeLocalSecrets(secrets);
}

export async function readStore(): Promise<PathfinderStore> {
  try {
    const content = await readFile(storePath, "utf8");
    const parsed = JSON.parse(content) as PathfinderStore;
    let normalizedTargets = Object.fromEntries(
      Object.entries(parsed.targets ?? {}).map(([id, target]) => [id, normalizeTarget(target as TargetConfig)])
    );
    if (!normalizedTargets[ecommerceTargetId]) {
      normalizedTargets[ecommerceTargetId] = createSeedEcommerceTarget();
    }
    normalizedTargets = await hydrateTargetsWithSecrets(normalizedTargets);

    return {
      ...parsed,
      targets: normalizedTargets,
      workspaces: Object.fromEntries(
        Object.entries(parsed.workspaces ?? {}).map(([id, workspace]) => [
          id,
          normalizeWorkspace(workspace as PathfinderCustomerWorkspace)
        ])
      ),
      jobs: parsed.jobs ?? [],
      submit_attempts: parsed.submit_attempts ?? [],
      lift_unit_catalog: normalizeLiftUnitCatalog(parsed.lift_unit_catalog),
      canonical_registry: normalizeCanonicalRegistry(parsed.canonical_registry)
    };
  } catch {
    const seed = createSeedStore();
    seed.targets = await hydrateTargetsWithSecrets(seed.targets);
    await writeStore(seed);
    return seed;
  }
}

export async function getOrCreateWorkspace(customer: LiftCustomer) {
  const store = await readStore();
  const existing = store.workspaces[customer.lift_customer_id];

  if (existing) {
    const normalized = normalizeWorkspace(existing);
    normalized.customer = customer;
    normalized.jobs = store.jobs.filter((job) => job.customer_id === customer.lift_customer_id);
    normalized.submit_attempts = store.submit_attempts.filter((attempt) => attempt.customer_id === customer.lift_customer_id);
    store.workspaces[customer.lift_customer_id] = normalized;
    await writeStore(store);
    return normalized;
  }

  const workspace = createWorkspace(customer);
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
  const timestamp = now();
  const existingMethod =
    workspace.import_methods.find((method) => method.import_method_id === methodId) ?? createSeedMethod(timestamp);
  const nextMethod: ImportMethod = {
    ...normalizeImportMethod(existingMethod),
    ...methodPatch,
    import_method_id: methodId,
    source_config: {
      ...(existingMethod.source_config ?? {}),
      ...(methodPatch.source_config ?? {})
    },
    workbook_sheet_policy: methodPatch.workbook_sheet_policy ?? existingMethod.workbook_sheet_policy ?? "rows_with_quantity",
    product_resolution_config: {
      ...createDefaultProductResolutionConfig(),
      ...(existingMethod.product_resolution_config ?? {}),
      ...(methodPatch.product_resolution_config ?? {})
    },
    updated_at: timestamp
  };

  workspace.import_methods = [
    nextMethod,
    ...workspace.import_methods.filter((method) => method.import_method_id !== methodId)
  ];
  workspace.templates = [
    {
      template_id: nextMethod.template_id,
      name: `${nextMethod.name} Field Mapping`,
      version: "1.0.0",
      status: nextMethod.status === "Active" ? "Published" : "Draft",
      mappings: nextMethod.mappings,
      updated_at: timestamp
    },
    ...workspace.templates.filter((template) => template.template_id !== nextMethod.template_id)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);

  return workspace;
}

export async function archiveImportMethod(customer: LiftCustomer, methodId: string) {
  return updateImportMethod(customer, methodId, { status: "Archived" });
}

export async function updateOutputRoute(customer: LiftCustomer, routeId: string, routePatch: Partial<OutputRoute>) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const existingRoute =
    workspace.output_routes.find((route) => route.output_route_id === routeId) ?? createSeedOutputRoute(timestamp);
  const nextRoute: OutputRoute = {
    ...existingRoute,
    ...routePatch,
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
  await writeStore(store);

  return workspace;
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
  await writeStore(store);

  return nextJob;
}

export async function getSubmitAttemptByIdempotencyKey(customer: LiftCustomer, idempotencyKey: string) {
  const store = await readStore();
  return (
    store.submit_attempts.find(
      (attempt) => attempt.customer_id === customer.lift_customer_id && attempt.idempotency_key === idempotencyKey
    ) ?? null
  );
}

export async function listSubmitAttemptsForJob(customer: LiftCustomer, jobId: string) {
  const store = await readStore();
  return store.submit_attempts.filter(
    (attempt) => attempt.customer_id === customer.lift_customer_id && attempt.job_id === jobId
  );
}

export async function persistSubmitAttempt(customer: LiftCustomer, attempt: SubmitAttempt) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const submitJobState: ProcessingState | null =
    attempt.state === "Submitted" ? "Submitted" : attempt.state === "Failed" ? "Submit Failed" : null;
  const targetOrderNumber = attempt.response.lift_order_id ?? null;
  const timestamp = attempt.updated_at;
  const submittedJob = store.jobs.find(
    (job) => job.job_id === attempt.job_id && job.customer_id === customer.lift_customer_id
  );
  const submittedRoute = submittedJob
    ? workspace.output_routes.find((route) => route.output_route_id === submittedJob.output_route_id)
    : null;
  const targetOrderLookupUrl = buildLiftOrderLookupUrl(submittedRoute?.order_lookup_url, targetOrderNumber);

  store.submit_attempts = [
    attempt,
    ...(store.submit_attempts ?? []).filter((candidate) => candidate.attempt_id !== attempt.attempt_id)
  ];
  if (submitJobState) {
    store.jobs = store.jobs.map((job) =>
      job.job_id === attempt.job_id && job.customer_id === customer.lift_customer_id
        ? {
            ...job,
            state: submitJobState,
            target_order_number: targetOrderNumber ?? job.target_order_number ?? null,
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

  return attempt;
}

export async function listProductMappings(customer: LiftCustomer) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace.product_mappings;
}

export async function listCatalogPresets(customer: LiftCustomer) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace.catalog_presets;
}

export async function upsertCatalogPreset(customer: LiftCustomer, patch: Partial<LiftCatalogPreset>) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const route =
    workspace.output_routes.find((candidate) => candidate.output_route_id === patch.output_route_id) ??
    workspace.output_routes.find((candidate) => candidate.output_route_id === workspace.primary_output_route_id) ??
    workspace.output_routes[0];
  const catalogId = String(patch.catalog_id ?? "").trim();

  if (!catalogId) {
    throw new Error("Catalog ID is required.");
  }

  const presetId =
    patch.preset_id ??
    `catalog-preset-${customer.lift_customer_id}-${route.output_route_id}-${catalogId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const existing = workspace.catalog_presets.find((preset) => preset.preset_id === presetId);
  const preset = normalizeCatalogPreset(
    {
      ...(existing ?? {
        preset_id: presetId,
        output_route_id: route.output_route_id,
        target_id: route.target_id,
        catalog_id: catalogId,
        catalog_name: patch.catalog_name ?? catalogId,
        status: "Active",
        created_at: timestamp,
        updated_at: timestamp
      }),
      ...patch,
      preset_id: presetId,
      output_route_id: route.output_route_id,
      target_id: route.target_id,
      catalog_id: catalogId,
      updated_at: timestamp
    } as LiftCatalogPreset,
    workspace
  );

  workspace.catalog_presets = [
    preset,
    ...workspace.catalog_presets.filter((candidate) => candidate.preset_id !== preset.preset_id)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace.catalog_presets;
}

export async function deleteCatalogPreset(customer: LiftCustomer, presetId: string) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  workspace.catalog_presets = workspace.catalog_presets.filter((preset) => preset.preset_id !== presetId);
  workspace.updated_at = now();
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace.catalog_presets;
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
    .filter((item) => matchesSearch(item, query))
    .sort(
      (first, second) =>
        first.product_name.localeCompare(second.product_name) ||
        (first.unit_number ?? "").localeCompare(second.unit_number ?? "") ||
        (first.product_id ?? "").localeCompare(second.product_id ?? "")
    );

  return fetchSize === null ? filtered : filtered.slice(fetchOffset, fetchOffset + fetchSize);
}

export async function upsertLiftProductCatalog(items: LiftUnitCatalogItem[]) {
  const store = await readStore();
  const timestamp = now();
  const nextById = new Map(store.lift_unit_catalog.map((item) => [item.catalog_item_id, item]));

  items.forEach((item) => {
    const normalized = normalizeLiftCatalogItem({ ...item, updated_at: timestamp }, timestamp);
    nextById.set(normalized.catalog_item_id, normalized);
  });

  store.lift_unit_catalog = Array.from(nextById.values());
  await writeStore(store);
  return store.lift_unit_catalog;
}

export async function updateProductMapping(
  customer: LiftCustomer,
  mappingId: string,
  patch: Partial<CustomerProductMapping>
) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const route =
    workspace.output_routes.find((candidate) => candidate.output_route_id === patch.output_route_id) ??
    workspace.output_routes.find((candidate) => candidate.output_route_id === workspace.primary_output_route_id) ??
    createSeedOutputRoute(timestamp);
  const existing =
    workspace.product_mappings.find((mapping) => mapping.mapping_id === mappingId) ??
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
      last_seen_examples: [],
      created_at: timestamp,
      updated_at: timestamp
    } satisfies CustomerProductMapping);
  const nextMapping: CustomerProductMapping = {
    ...existing,
    ...patch,
    mapping_id: mappingId,
    output_route_id: patch.output_route_id ?? existing.output_route_id ?? route.output_route_id,
    target_id: patch.target_id ?? existing.target_id ?? route.target_id,
    target_template: patch.target_template ?? existing.target_template ?? route.output_template,
    product_identifier_type:
      patch.product_identifier_type ?? existing.product_identifier_type ?? route.product_identifier_type,
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

  workspace.product_mappings = [
    nextMapping,
    ...workspace.product_mappings.filter((mapping) => mapping.mapping_id !== mappingId)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace.product_mappings;
}

export async function bulkUpsertProductMappings(customer: LiftCustomer, mappings: CustomerProductMapping[]) {
  const store = await readStore();
  const workspace = normalizeWorkspace(store.workspaces[customer.lift_customer_id] ?? createWorkspace(customer));
  const timestamp = now();
  const nextById = new Map(workspace.product_mappings.map((mapping) => [mapping.mapping_id, mapping]));
  const fallbackRoute =
    workspace.output_routes.find((route) => route.output_route_id === workspace.primary_output_route_id) ??
    createSeedOutputRoute(timestamp);

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
        mapping.product_identifier_value ?? mapping.lift_unit_number ?? mapping.lift_product_id ?? null
    });
    nextById.set(mapping.mapping_id, {
      ...(nextById.get(mapping.mapping_id) ?? normalizedMapping),
      ...normalizedMapping,
      updated_at: timestamp
    });
  });

  workspace.product_mappings = Array.from(nextById.values());
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);
  return workspace.product_mappings;
}

export async function listTargets(maskCredentials = true) {
  const store = await readStore();
  const targets = Object.values(store.targets);
  return maskCredentials ? targets.map(maskTargetConfig) : targets;
}

export async function getTarget(id = targetId, maskCredentials = true) {
  const store = await readStore();
  const target = normalizeTarget(store.targets[id] ?? createSeedTarget());
  store.targets[id] = target;
  await writeStore(store);
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

export async function persistPreviewJob(customer: LiftCustomer, job: ProcessingJobPreview, method: ImportMethod) {
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
  workspace.import_methods = [
    nextMethod,
    ...workspace.import_methods.filter((candidate) => candidate.import_method_id !== method.import_method_id)
  ];
  workspace.updated_at = timestamp;
  store.workspaces[customer.lift_customer_id] = workspace;
  await writeStore(store);

  return workspace;
}
