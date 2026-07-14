import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalOrder, ProcessingState, ValidationMessage } from "@pathfinder/canonical";
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
}

const storePath = fileURLToPath(new URL("../../../data/pathfinder-store.local.json", import.meta.url));
const targetId = "lift-standard-graphics";
const ecommerceTargetId = "thinkdifferentprint-ecommerce";
const outputRouteId = "route-ltl-lift-91-standard-graphics";
const manualImportMethodId = "manual-xlsx";

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
    order_lookup_url: null,
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
      material_id: null,
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
      material_id: null,
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
      material_id: null,
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

function createWorkspace(customer: LiftCustomer): PathfinderCustomerWorkspace {
  const timestamp = now();
  const method = createSeedMethod(timestamp);
  const route = createSeedOutputRoute(timestamp);

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
    lift_unit_catalog: createSeedLiftUnitCatalog(timestamp)
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

function normalizeLiftCatalogItem(item: Partial<LiftUnitCatalogItem>, timestamp = now()): LiftUnitCatalogItem {
  const unitNumber = item.unit_number ?? null;
  const productId = item.product_id ?? null;
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
    material_id: item.material_id ?? null,
    image_url: item.image_url ?? null,
    status: item.status ?? "Active",
    category: item.category ?? item.catalog_name ?? item.product_type ?? null,
    description: item.description ?? null,
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
    order_lookup_url: candidate.order_lookup_url ?? route.order_lookup_url ?? null
  }));
  const primaryOutputRouteId = workspace.primary_output_route_id ?? outputRoutes[0]?.output_route_id ?? route.output_route_id;

  return {
    ...workspace,
    import_methods: (workspace.import_methods ?? []).map(normalizeImportMethod),
    output_routes: outputRoutes,
    product_mappings: (workspace.product_mappings ?? []).map(normalizeProductMapping),
    primary_target_id: workspace.primary_target_id ?? route.target_id,
    primary_output_route_id: primaryOutputRouteId,
    submit_attempts: workspace.submit_attempts ?? [],
    jobs: workspace.jobs ?? []
  };
}

async function writeStore(store: PathfinderStore) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function readStore(): Promise<PathfinderStore> {
  try {
    const content = await readFile(storePath, "utf8");
    const parsed = JSON.parse(content) as PathfinderStore;
    const normalizedTargets = Object.fromEntries(
      Object.entries(parsed.targets ?? {}).map(([id, target]) => [id, normalizeTarget(target as TargetConfig)])
    );
    if (!normalizedTargets[ecommerceTargetId]) {
      normalizedTargets[ecommerceTargetId] = createSeedEcommerceTarget();
    }

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
      lift_unit_catalog: normalizeLiftUnitCatalog(parsed.lift_unit_catalog)
    };
  } catch {
    const seed = createSeedStore();
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

export async function listLiftUnitCatalog(filters: {
  target_id?: string;
  environment_id?: string;
  company_id?: string;
  q?: string;
  product_id?: string;
  catalog_id?: string;
  status?: string;
  include_inactive?: boolean;
} = {}) {
  const store = await readStore();
  const query = filters.q?.trim().toLowerCase() ?? "";
  return store.lift_unit_catalog
    .filter((item) => !filters.target_id || item.target_id === filters.target_id)
    .filter((item) => !filters.environment_id || !item.environment_id || item.environment_id === filters.environment_id)
    .filter((item) => !filters.company_id || item.company_id === filters.company_id)
    .filter((item) => !filters.product_id || item.product_id === filters.product_id)
    .filter((item) => !filters.catalog_id || item.catalog_id === filters.catalog_id)
    .filter((item) => !filters.status || item.status === filters.status)
    .filter((item) => filters.include_inactive || item.status === "Active")
    .filter((item) => matchesSearch(item, query))
    .sort(
      (first, second) =>
        first.product_name.localeCompare(second.product_name) ||
        (first.unit_number ?? "").localeCompare(second.unit_number ?? "") ||
        (first.product_id ?? "").localeCompare(second.product_id ?? "")
    );
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
  return nextValue && nextValue !== "********" ? nextValue : existingValue;
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
        Password: preserveSecret(environment.headers?.Password, current?.headers?.Password) ?? ""
      },
      credentials: {
        ...(current?.credentials ?? {}),
        ...(environment.credentials ?? {}),
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
        Password:
          submittedPassword && submittedPassword !== "********"
            ? submittedPassword
            : existing.lift.credentials.Password
      }
    },
    updated_at: now()
  };

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
