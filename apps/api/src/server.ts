import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import {
  enrichLiftCustomers,
  parseLiftCustomerCsv,
  parseLiftCustomerStatusJson,
  type LiftCustomer,
  type LiftCustomerDirectory
} from "@pathfinder/customer-directory";
import { sampleCanonicalOrder, validateCanonicalOrder, type ValidationMessage } from "@pathfinder/canonical";
import {
  applyValueNormalizationToLiftPayload,
  buildLiftSubmitRequest,
  generateLiftPayload,
  maskLiftSubmitRequest,
  submitLiftOrder,
  validateLiftPayload,
  type LiftOrderPayload,
  type LiftSubmitRequest,
  type LiftSubmitTransportMode,
  type LiftTargetConfig
} from "@pathfinder/lift-adapter";
import {
  mapSourceRowsToCanonicalOrder,
  sampleSourceGrid,
  type FieldMapping,
  type ParsedSourceRow,
  type ParsedWorkbookSheet,
  type SourceGrid
} from "@pathfinder/templates";
import {
  archiveImportMethod,
  bulkUpsertProductMappings,
  createDefaultProductResolutionConfig,
  getOrCreateWorkspace,
  getTarget,
  listProductMappings,
  listLiftUnitCatalog,
  listJobs,
  listSubmitAttemptsForJob,
  listTargets,
  getJob,
  getSubmitAttemptByIdempotencyKey,
  maskTargetConfig,
  persistJobSnapshot,
  persistPreviewJob,
  persistSubmitAttempt,
  updateProductMapping,
  updateImportMethod,
  updateOutputRoute,
  updateTarget,
  upsertLiftProductCatalog,
  type CustomerProductMapping,
  type ImportMethod,
  type LiftUnitCatalogItem,
  type OutputRoute,
  type ProductMappingStatus,
  type ProductResolutionConfig,
  type ProductResolutionResult,
  type ProcessingJobPreview,
  type SubmitCertificationActionKey,
  type SubmitCertification,
  type SubmitCertificationItem,
  type SubmitAttempt,
  type SubmitAttemptStatus,
  type SubmitProfile,
  type TargetConfig,
  type TargetEnvironment
} from "./store.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const liftCustomerListEndpoint =
  process.env.LIFT_CUSTOMER_LIST_URL ??
  "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerContactLIst/LTL-Customer-List?offset=0";
const liftCustomerStatusEndpoint =
  process.env.LIFT_CUSTOMER_STATUS_URL ??
  "https://ltlco.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerStatusJSON/CustomerStatusJSON?";
const liftProductCatalogBaseUrl =
  process.env.LIFT_PRODUCT_CATALOG_BASE_URL ?? "https://ltlco.lifterp.com/ords/api/lift/erp";
const externalLiftSubmitEnabled = process.env.PATHFINDER_ENABLE_LIFT_SUBMIT === "true";
const liftSubmitTransportMode: LiftSubmitTransportMode =
  process.env.PATHFINDER_LIFT_TRANSPORT_MODE === "live" ? "live" : "dry_run";
const liveCustomerSubmitAllowed = process.env.PATHFINDER_ALLOW_LIVE_CUSTOMER_SUBMIT === "true";
const localCustomerSeedUrl = new URL("../../../data/lift-customers.sample.csv", import.meta.url);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "10mb" }));

async function readLocalCustomerSeed(): Promise<LiftCustomerDirectory> {
  const csv = await readFile(localCustomerSeedUrl, "utf8");
  return {
    customers: parseLiftCustomerCsv(csv),
    source: "local-seed",
    endpoint_url: liftCustomerListEndpoint,
    status_endpoint_url: liftCustomerStatusEndpoint,
    loaded_at: new Date().toISOString()
  };
}

async function findLiftCustomer(liftCustomerId: string) {
  const directory = await readLocalCustomerSeed();
  return (
    directory.customers.find((customer) => customer.lift_customer_id === liftCustomerId) ?? {
      lift_customer_id: liftCustomerId,
      customer_name: `Lift Customer ${liftCustomerId}`,
      customer_number: null,
      customer_type: null,
      customer_status: "Regular",
      sales_rep: null,
      default_invoice_email_address: null,
      created_date: null,
      crm_id: null,
      terms: null,
      terms_status: null,
      credit_limit: null,
      credit_hold: null,
      unpaid_total: null,
      available_credit: null
    }
  );
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

function mappingIdFromKey(key: string) {
  return `product_${normalizeProductKey(key).toLowerCase() || "unmapped"}`;
}

function rowValue(row: ParsedSourceRow, column: string) {
  return row.values[column];
}

function buildCompositeValue(row: ParsedSourceRow, columns: string[]) {
  return columns.map((column) => valueAsString(rowValue(row, column))).filter(Boolean).join("__");
}

function buildDisplayLabel(row: ParsedSourceRow, config: ProductResolutionConfig) {
  return (
    valueAsString(rowValue(row, "DESCRIPTION")) ||
    valueAsString(rowValue(row, config.source_column)) ||
    buildCompositeValue(row, config.composite_columns) ||
    `Row ${row.row_number}`
  );
}

function productKeyForRow(row: ParsedSourceRow, config: ProductResolutionConfig) {
  if (config.strategy === "direct_lift_unit_number") {
    return valueAsString(rowValue(row, config.direct_unit_number_column ?? config.source_column));
  }

  if (config.strategy === "composite_key") {
    return normalizeProductKey(buildCompositeValue(row, config.composite_columns));
  }

  const derived = normalizeProductKey(valueAsString(rowValue(row, config.source_column)));
  if (derived) {
    return `${config.prefix ?? ""}${derived}${config.suffix ?? ""}`;
  }

  return "";
}

function liftProductValue(value: unknown) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function liftProductNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeLiftProductPayloadItem(
  item: Record<string, unknown>,
  context: {
    targetId: string;
    environmentId?: string;
    companyId?: string | null;
  }
): LiftUnitCatalogItem {
  const productId = liftProductValue(item.productId ?? item.product_id);
  const unitNumber = liftProductValue(item.unitNumber ?? item.unit_number);
  const catalogId = liftProductValue(item.catalogId ?? item.catalog_id);
  const productName = liftProductValue(item.productName ?? item.product_name) ?? productId ?? unitNumber ?? "Unnamed Lift product";
  return {
    catalog_item_id: [
      context.targetId,
      context.companyId ?? "91",
      context.environmentId ?? "any-env",
      productId ? `product-${productId}` : unitNumber ? `unit-${unitNumber}` : `catalog-${catalogId ?? "unknown"}`,
      productName
    ]
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    product_id: productId,
    unit_number: unitNumber,
    product_name: productName,
    company_id: context.companyId ?? "91",
    target_id: context.targetId,
    environment_id: context.environmentId ?? null,
    catalog_id: catalogId,
    catalog_name: liftProductValue(item.catalogName ?? item.catalog_name),
    accounting_item_code: liftProductValue(item.accountingItemCode ?? item.accounting_item_code),
    product_type: liftProductValue(item.productType ?? item.product_type),
    parent_product_id: liftProductValue(item.parentProductId ?? item.parent_product_id),
    unit_price: liftProductNumber(item.unitPrice ?? item.unit_price),
    quantity: liftProductNumber(item.quantity),
    material_id: liftProductValue(item.materialId ?? item.material_id),
    image_url: liftProductValue(item.imageUrl ?? item.image_url),
    status: liftProductValue(item.status) === "I" ? "Inactive" : "Active",
    category: liftProductValue(item.catalogName ?? item.catalog_name ?? item.productType ?? item.product_type),
    description: liftProductValue(item.productDescription ?? item.product_description),
    source: "Lift import",
    updated_at: new Date().toISOString()
  };
}

function liftProductQueryParams(reqQuery: Record<string, unknown>) {
  const allowedParams = [
    "product_id",
    "accounting_item_code",
    "product_type",
    "parent_product_id",
    "status",
    "catalog_id"
  ];
  const params = new URLSearchParams();

  allowedParams.forEach((key) => {
    const value = reqQuery[key];
    if (typeof value === "string" && value.trim()) {
      params.set(key, value.trim());
    }
  });

  return params;
}

async function fetchLiftProductsFromTarget(target: TargetConfig, route: OutputRoute, query: Record<string, unknown>) {
  const environment =
    target.environments.find((candidate) => candidate.environment_id === route.environment_id) ??
    target.environments.find((candidate) => candidate.name === target.lift.active_environment);
  const user = environment?.credentials.User ?? target.lift.credentials.User;
  const password = environment?.credentials.Password ?? target.lift.credentials.Password;

  if (!user || !password || password === "********") {
    throw new Error("Lift product catalog refresh requires saved import credentials for the selected environment.");
  }

  const url = new URL(`${liftProductCatalogBaseUrl.replace(/\/+$/, "")}/api/v1/product-management/products`);
  const params = liftProductQueryParams(query);
  params.forEach((value, key) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
    }
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Lift product catalog refresh failed (${response.status}).`);
  }

  if (!Array.isArray(body)) {
    throw new Error("Lift product catalog response was not an array.");
  }

  return body.map((item) =>
    normalizeLiftProductPayloadItem(item as Record<string, unknown>, {
      targetId: target.target_id,
      environmentId: environment?.environment_id,
      companyId: route.company_id ?? environment?.headers.Company ?? target.lift.headers.Company
    })
  );
}

function synthesizeParsedRows(sourceGrid: SourceGrid): ParsedSourceRow[] {
  return sourceGrid.rows.map((values, index) => ({
    sheet_name: "Imported Grid",
    row_number: index + 2,
    row_type: "order",
    values
  }));
}

function sourceSheetsFromGrid(sourceGrid: SourceGrid): ParsedWorkbookSheet[] {
  return [
    {
      sheet_name: "Imported Grid",
      columns: sourceGrid.columns,
      order_row_count: sourceGrid.rows.length,
      reference_row_count: 0,
      parsed_rows: synthesizeParsedRows(sourceGrid)
    }
  ];
}

function buildMappingFromRow(
  row: ParsedSourceRow,
  config: ProductResolutionConfig,
  timestamp: string,
  route: OutputRoute
) {
  const customerProductKey = productKeyForRow(row, config);
  const sendsGeneratedIdentifier = config.mode === "send_derived_unit" || config.strategy === "direct_lift_unit_number";
  const sourceColumns =
    config.strategy === "composite_key"
      ? config.composite_columns
      : config.strategy === "direct_lift_unit_number"
        ? [config.direct_unit_number_column ?? config.source_column]
        : [config.source_column];

  return {
    mapping_id: mappingIdFromKey(customerProductKey),
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    target_template: route.output_template,
    customer_product_key: customerProductKey,
    display_label: buildDisplayLabel(row, config),
    source_columns: sourceColumns.filter(Boolean),
    product_identifier_type: route.product_identifier_type,
    product_identifier_value: sendsGeneratedIdentifier ? customerProductKey : null,
    lift_unit_number:
      route.product_identifier_type === "lift_unit_number" && sendsGeneratedIdentifier ? customerProductKey : null,
    lift_product_id:
      route.product_identifier_type === "lift_product_id" && sendsGeneratedIdentifier ? customerProductKey : null,
    product_name: valueAsString(rowValue(row, "DESCRIPTION")) || valueAsString(rowValue(row, "SIGN TYPE")) || null,
    status: ((config.mode === "send_derived_unit" || config.strategy === "direct_lift_unit_number") && customerProductKey
      ? "Mapped"
      : "Unmapped") as ProductMappingStatus,
    mapping_source: "Observed order",
    source_file_name: null,
    last_seen_examples: [
      {
        sheet_name: row.sheet_name,
        row_number: row.row_number,
        description: valueAsString(rowValue(row, "DESCRIPTION")) || null,
        sign_type: valueAsString(rowValue(row, "SIGN TYPE")) || null,
        media_type: valueAsString(rowValue(row, "Media Type")) || null
      }
    ],
    created_at: timestamp,
    updated_at: timestamp
  } satisfies CustomerProductMapping;
}

function resolvedIdentifierForRoute(mapping: CustomerProductMapping, route: OutputRoute) {
  if (route.product_identifier_type === "lift_product_id") {
    return mapping.product_identifier_value ?? mapping.lift_product_id ?? null;
  }
  if (route.product_identifier_type === "lift_unit_number") {
    return mapping.product_identifier_value ?? mapping.lift_unit_number ?? null;
  }
  return mapping.product_identifier_value ?? mapping.lift_unit_number ?? mapping.lift_product_id ?? null;
}

function detectAmbiguousKeys(rows: ParsedSourceRow[], config: ProductResolutionConfig) {
  const signaturesByKey = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const key = productKeyForRow(row, config);
    const signature = buildCompositeValue(row, config.composite_columns);
    if (!key || !signature) {
      return;
    }
    const signatures = signaturesByKey.get(key) ?? new Set<string>();
    signatures.add(signature);
    signaturesByKey.set(key, signatures);
  });

  return new Set(
    Array.from(signaturesByKey.entries())
      .filter(([, signatures]) => signatures.size > 1)
      .map(([key]) => key)
  );
}

function resolveProducts(
  rows: ParsedSourceRow[],
  existingMappings: CustomerProductMapping[],
  config: ProductResolutionConfig,
  route: OutputRoute
) {
  const mappingsByKey = new Map(
    existingMappings
      .filter((mapping) => mapping.output_route_id === route.output_route_id)
      .map((mapping) => [mapping.customer_product_key, mapping])
  );
  const ambiguousKeys = config.strategy === "derived_key" ? detectAmbiguousKeys(rows, config) : new Set<string>();

  return rows.map((row, index) => {
    const key = productKeyForRow(row, config);
    const savedMapping = mappingsByKey.get(key);
    const fallbackMapping = buildMappingFromRow(row, config, new Date().toISOString(), route);
    const mapping = savedMapping ?? fallbackMapping;
    const directUnitNumber =
      config.strategy === "direct_lift_unit_number"
        ? valueAsString(rowValue(row, config.direct_unit_number_column ?? config.source_column))
        : key;
    let status: ProductMappingStatus = mapping.status;
    let resolvedProductIdentifier = resolvedIdentifierForRoute(mapping, route);
    let message = `Resolved to approved ${route.product_identifier_label}.`;

    if (config.strategy === "direct_lift_unit_number") {
      resolvedProductIdentifier = directUnitNumber;
      status = resolvedProductIdentifier ? "Mapped" : "Unmapped";
      message = resolvedProductIdentifier
        ? `Using source value as ${route.product_identifier_label}.`
        : "Source product identifier is blank.";
    } else if (config.mode === "send_derived_unit") {
      resolvedProductIdentifier = directUnitNumber;
      status = resolvedProductIdentifier ? "Mapped" : "Unmapped";
      message = resolvedProductIdentifier
        ? `Using generated value as ${route.product_identifier_label}.`
        : "Generated product identifier is blank.";
    } else if (ambiguousKeys.has(key) && !resolvedIdentifierForRoute(mapping, route)) {
      status = "Ambiguous";
      resolvedProductIdentifier = null;
      message = "Generated key matches multiple product signatures; use composite fallback or approve a mapping.";
    } else if (!resolvedIdentifierForRoute(mapping, route) || mapping.status !== "Mapped") {
      status = key ? "Unmapped" : "Unmapped";
      resolvedProductIdentifier = null;
      message = `Product key needs a ${route.product_identifier_label} mapping for this output route.`;
    }

    return {
      output_route_id: route.output_route_id,
      source_sheet_name: row.sheet_name,
      source_row_number: row.row_number,
      line_number: index + 1,
      strategy: config.strategy,
      mode: config.mode,
      customer_product_key: key,
      display_label: mapping.display_label,
      source_columns: mapping.source_columns,
      resolved_product_identifier: resolvedProductIdentifier,
      resolved_unit_number:
        route.product_identifier_type === "lift_unit_number"
          ? resolvedProductIdentifier
          : mapping.lift_unit_number ?? null,
      resolved_product_id:
        route.product_identifier_type === "lift_product_id"
          ? resolvedProductIdentifier
          : mapping.lift_product_id ?? null,
      product_name: mapping.product_name,
      status,
      message
    } satisfies ProductResolutionResult;
  });
}

function submitProfileForRoute(route: OutputRoute, requestedProfileId?: string): SubmitProfile {
  const enabledProfiles = route.submit_profiles.filter((profile) => profile.enabled);
  return (
    enabledProfiles.find((profile) => profile.profile_id === requestedProfileId) ??
    enabledProfiles.find((profile) => profile.mode === "sandbox_customer") ??
    enabledProfiles.find((profile) => profile.mode === "live_customer") ??
    route.submit_profiles[0]
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

function routeEnvironmentForTarget(target: TargetConfig, route: OutputRoute) {
  return target.environments.find((candidate) => candidate.environment_id === route.environment_id) ?? null;
}

function submitProfileFromJob(route: OutputRoute, job: ProcessingJobPreview): SubmitProfile {
  const profile = route.submit_profiles.find((candidate) => candidate.profile_id === job.submit_profile_id);
  if (profile) {
    return profile;
  }

  return {
    profile_id: job.submit_profile_id,
    name: job.submit_profile_name,
    mode: job.submit_mode,
    enabled: true,
    customer_override: job.sandbox
      ? {
          lift_customer_id: job.submit_customer_id,
          customer_name: job.submit_customer_name
        }
      : null
  };
}

async function refreshJobSubmitCertification(customer: LiftCustomer, job: ProcessingJobPreview) {
  const workspace = await getOrCreateWorkspace(customer);
  const outputRoute = workspace.output_routes.find((route) => route.output_route_id === job.output_route_id);

  if (!outputRoute) {
    throw new Error("Preview job output route could not be found.");
  }

  const target = (await getTarget(outputRoute.target_id, false)) as TargetConfig | null;
  if (!target) {
    throw new Error("Preview job target could not be found.");
  }

  const submitProfile = submitProfileFromJob(outputRoute, job);
  const routeEnvironment = routeEnvironmentForTarget(target, outputRoute);
  const unmaskedSubmitRequest = buildLiftSubmitRequest(job.lift_payload, liftConfigForRoute(target, outputRoute));
  const submitRequestMasked = maskLiftSubmitRequest(unmaskedSubmitRequest);
  const submitValidation = validateSubmitReadiness(unmaskedSubmitRequest, job.lift_payload, submitProfile, outputRoute);
  const liftPayloadValidation = job.lift_validation.filter((message) => !message.code.startsWith("SUBMIT-"));
  const certification = buildSubmitCertification({
    state: job.state,
    canonicalValidation: job.canonical_validation,
    liftValidation: liftPayloadValidation,
    submitValidation,
    unresolvedProducts: job.unresolved_products,
    request: unmaskedSubmitRequest,
    payload: job.lift_payload,
    profile: submitProfile,
    route: outputRoute,
    environment: routeEnvironment
  });

  return persistJobSnapshot(customer, {
    ...job,
    lift_validation: [...liftPayloadValidation, ...submitValidation],
    submit_certification: certification,
    submit_request_masked: submitRequestMasked
  });
}

function isPlaceholderSecret(value?: string | null) {
  if (!value) {
    return true;
  }
  return /TBD|SECRET|REFERENCE|^\*+$/i.test(value);
}

function environmentRoleKey(environmentName: string, role?: string): LiftTargetConfig["active_environment"] {
  const normalized = `${role ?? ""} ${environmentName}`.toUpperCase();
  return normalized.includes("PROD") ? "PROD" : "QA1";
}

function liftConfigForRoute(target: TargetConfig, route: OutputRoute): LiftTargetConfig {
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

function validateSubmitReadiness(
  request: LiftSubmitRequest,
  payload: LiftOrderPayload,
  profile: SubmitProfile,
  route: OutputRoute
): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  if (!request.endpoint_url?.trim()) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-ENDPOINT",
      object: "submit.request",
      field: "endpoint_url",
      message: "Output route has no endpoint URL for the selected environment.",
      suggested_action: "Open Targets, choose the route target, and configure the selected environment endpoint."
    });
  }

  if (request.headers.Ext_ID !== payload.order.ext_id) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-EXT-ID",
      object: "submit.headers",
      field: "headers.Ext_ID",
      message: "Submit header Ext_ID must match body.order.ext_id.",
      suggested_action: "Map the header Ext_ID and body order.ext_id to the same canonical order field."
    });
  }

  if (!request.headers.Company?.trim()) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-COMPANY",
      object: "submit.headers",
      field: "headers.Company",
      message: "Lift Company header is required for this output route.",
      suggested_action: "Set the route Company ID or environment Company header."
    });
  }

  if (!request.headers.User?.trim() || isPlaceholderSecret(request.headers.User)) {
    messages.push({
      severity: "WARNING",
      code: "SUBMIT-USER",
      object: "submit.headers",
      field: "headers.User",
      message: "Submit username is still a placeholder.",
      suggested_action: "Add the Lift import username before enabling real submission."
    });
  }

  if (!request.headers.Password?.trim() || isPlaceholderSecret(request.headers.Password)) {
    messages.push({
      severity: "WARNING",
      code: "SUBMIT-PASSWORD",
      object: "submit.headers",
      field: "headers.Password",
      message: "Submit password is still a placeholder or masked value.",
      suggested_action: "Add the Lift import password before enabling real submission."
    });
  }

  if (
    profile.mode === "sandbox_customer" &&
    profile.customer_override?.lift_customer_id &&
    payload.customer.lift_customer_id !== profile.customer_override.lift_customer_id
  ) {
    messages.push({
      severity: "FAIL",
      code: "SUBMIT-CUSTOMER-MISMATCH",
      object: "submit.profile",
      field: "customer.lift_customer_id",
      message: "Lift payload customer does not match the selected sandbox submit profile.",
      suggested_action: "Regenerate the preview after choosing the correct submit profile."
    });
  }

  messages.push({
    severity: "PASS",
    code: profile.mode === "sandbox_customer" ? "SUBMIT-SANDBOX" : "SUBMIT-CUSTOMER",
    object: "submit.profile",
    field: "submit_profile",
    message:
      profile.mode === "sandbox_customer"
        ? `Sandbox submit will use ${profile.customer_override?.customer_name ?? "the sandbox customer"} while preserving the source customer in audit fields.`
        : "Submit preview will use the selected customer identity.",
    suggested_action:
      profile.mode === "sandbox_customer"
        ? "Use this for test orders even when targeting the production Lift endpoint."
        : "Use sandbox submit profile for non-customer-facing test orders."
  });

  messages.push({
    severity: "PASS",
    code: "SUBMIT-ROUTE",
    object: "submit.route",
    field: "output_route_id",
    message: `Submit preview uses output route ${route.name}.`
  });

  return messages;
}

function certificationItem(
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

function buildSubmitCertification(args: {
  state: ProcessingJobPreview["state"];
  canonicalValidation: ValidationMessage[];
  liftValidation: ValidationMessage[];
  submitValidation: ValidationMessage[];
  unresolvedProducts: CustomerProductMapping[];
  request: LiftSubmitRequest;
  payload: LiftOrderPayload;
  profile: SubmitProfile;
  route: OutputRoute;
  environment: TargetEnvironment | null;
}): SubmitCertification {
  const canonicalFailures = args.canonicalValidation.filter((message) => message.severity === "FAIL");
  const liftFailures = args.liftValidation.filter((message) => message.severity === "FAIL");
  const submitFailures = args.submitValidation.filter((message) => message.severity === "FAIL");
  const placeholderCredentialWarnings = args.submitValidation.filter((message) =>
    ["SUBMIT-USER", "SUBMIT-PASSWORD"].includes(message.code)
  );
  const sandboxSubmitAllowed = args.profile.mode === "sandbox_customer" || liveCustomerSubmitAllowed;
  const items: SubmitCertificationItem[] = [
    certificationItem(
      "preview-state",
      "Preview state",
      args.state === "Ready",
      `Preview is ${args.state}, not Ready.`,
      "Preview job is Ready.",
      "Resolve blocking preview validation or product mapping issues.",
      args.unresolvedProducts.length ? "product-map" : "manual-import"
    ),
    certificationItem(
      "canonical-validation",
      "Canonical Order validation",
      canonicalFailures.length === 0,
      `${canonicalFailures.length} Canonical Order failure${canonicalFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Canonical Order has no blocking failures.",
      canonicalFailures[0]?.suggested_action,
      "field-mapping"
    ),
    certificationItem(
      "lift-validation",
      "Lift payload validation",
      liftFailures.length === 0,
      `${liftFailures.length} Lift payload failure${liftFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Lift payload has no blocking failures.",
      liftFailures[0]?.suggested_action,
      liftFailures.some((message) => message.code === "LIFT-UNIT") ? "product-map" : "manual-import"
    ),
    certificationItem(
      "submit-readiness",
      "Submit request validation",
      submitFailures.length === 0,
      `${submitFailures.length} submit request failure${submitFailures.length === 1 ? "" : "s"} must be resolved.`,
      "Submit request has no blocking failures.",
      submitFailures[0]?.suggested_action,
      submitFailures.some((message) => message.code === "SUBMIT-CUSTOMER-MISMATCH") ? "manual-import" : "target-environments"
    ),
    certificationItem(
      "product-resolution",
      "Product resolution",
      args.unresolvedProducts.length === 0,
      `${args.unresolvedProducts.length} product key${args.unresolvedProducts.length === 1 ? "" : "s"} need mapping.`,
      "Every order line has an approved product identifier.",
      "Approve unresolved product keys in Output Product Map.",
      "product-map"
    ),
    certificationItem(
      "route-status",
      "Output route status",
      args.route.status === "Active",
      `Output route is ${args.route.status}.`,
      "Output route is Active.",
      "Set the route status to Active before submitting.",
      "target-output-routes"
    ),
    certificationItem(
      "environment-status",
      "Target environment status",
      args.environment?.status === "Active",
      args.environment
        ? `Target environment ${args.environment.name} is ${args.environment.status}.`
        : "Output route target environment could not be found.",
      args.environment ? `Target environment ${args.environment.name} is Active.` : "Target environment is Active.",
      "Set the selected Target Environment to Active before submitting.",
      "target-environments"
    ),
    certificationItem(
      "endpoint",
      "Endpoint configured",
      Boolean(args.request.endpoint_url?.trim()),
      "Selected route environment has no endpoint URL.",
      `Endpoint is ${args.request.endpoint_url}.`,
      "Configure the selected Target Environment endpoint.",
      "target-environments"
    ),
    certificationItem(
      "ext-id",
      "Ext_ID equality",
      args.request.headers.Ext_ID === args.payload.order.ext_id && Boolean(args.payload.order.ext_id?.trim()),
      "Header Ext_ID must match body.order.ext_id.",
      "Header Ext_ID matches body.order.ext_id.",
      "Map both values to the same canonical order id.",
      "target-output-templates"
    ),
    certificationItem(
      "company",
      "Company header",
      Boolean(args.request.headers.Company?.trim()),
      "Company header is missing.",
      `Company header is ${args.request.headers.Company}.`,
      "Set the route Company ID or environment Company header.",
      "target-output-routes"
    ),
    certificationItem(
      "credentials",
      "Lift credentials",
      placeholderCredentialWarnings.length === 0,
      "Lift import credentials are placeholders or masked values.",
      "Lift import credentials are configured.",
      "Enter the Lift import username and password in Target Environment settings.",
      "target-environments"
    ),
    {
      item_id: "submit-profile",
      label: "Submit profile",
      status: sandboxSubmitAllowed ? "Passed" : "Blocked",
      blocking: !sandboxSubmitAllowed,
      message:
        args.profile.mode === "sandbox_customer"
          ? `Sandbox profile selected: ${args.profile.customer_override?.customer_name ?? args.profile.name}.`
          : liveCustomerSubmitAllowed
            ? `Live customer profile selected: ${args.profile.name}; live customer submits are explicitly allowed.`
            : `Live customer profile selected: ${args.profile.name}. Sandbox submit is required by default.`,
      suggested_action:
        args.profile.mode === "sandbox_customer"
          ? "This is the preferred profile for first production-endpoint tests."
          : liveCustomerSubmitAllowed
            ? undefined
            : "Choose Sandbox · LTL Demo for first production-endpoint tests, or explicitly allow live customer submits.",
      action_key: args.profile.mode === "sandbox_customer" || liveCustomerSubmitAllowed ? undefined : "manual-import"
    },
    certificationItem(
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
      status: liftSubmitTransportMode === "live" ? "Passed" : "Blocked",
      blocking: liftSubmitTransportMode !== "live",
      message:
        liftSubmitTransportMode === "live"
          ? "Lift transport mode is live; Pathfinder will make the external POST when all other gates pass."
          : "Lift transport mode is dry_run; Pathfinder will record a dry run instead of calling Lift.",
      suggested_action:
        liftSubmitTransportMode === "live" ? undefined : "Set PATHFINDER_LIFT_TRANSPORT_MODE=live for the first real sandbox-lane submit.",
      action_key: liftSubmitTransportMode === "live" ? undefined : "target-health"
    },
    {
      item_id: "external-submit-gate",
      label: "External submit feature gate",
      status: externalLiftSubmitEnabled ? "Passed" : "Blocked",
      blocking: !externalLiftSubmitEnabled,
      message: externalLiftSubmitEnabled
        ? "External Lift submit is enabled for this environment."
        : "External Lift submit is still disabled in Pathfinder.",
      suggested_action: externalLiftSubmitEnabled
        ? undefined
        : "Enable the explicit submit gate only after credentials and response handling are approved.",
      action_key: externalLiftSubmitEnabled ? undefined : "target-health"
    }
  ];
  const blockingCount = items.filter((item) => item.blocking).length;
  const canSubmit = blockingCount === 0;

  return {
    can_submit: canSubmit,
    external_submit_enabled: externalLiftSubmitEnabled,
    live_transport_enabled: liftSubmitTransportMode === "live",
    live_customer_submit_allowed: liveCustomerSubmitAllowed,
    summary: canSubmit
      ? "Certified for external Lift submit."
      : `${blockingCount} submit certification item${blockingCount === 1 ? "" : "s"} blocking external submit.`,
    items
  };
}

function submitIdempotencyKey(job: ProcessingJobPreview, requestedKey?: string) {
  if (requestedKey?.trim()) {
    return requestedKey.trim();
  }
  return [
    job.job_id,
    job.output_route_id,
    job.submit_profile_id,
    job.submit_request_masked.headers.Ext_ID,
    job.submit_request_masked.headers.Company
  ].join(":");
}

function createSubmitAttempt(args: {
  job: ProcessingJobPreview;
  idempotencyKey: string;
  state: SubmitAttemptStatus;
  blockingItems: SubmitCertificationItem[];
  message: string;
  certification?: SubmitCertification;
  response?: SubmitAttempt["response"];
  submitRequestMasked?: ProcessingJobPreview["submit_request_masked"];
}): SubmitAttempt {
  const timestamp = new Date().toISOString();
  const certification =
    args.certification ??
    args.job.submit_certification ??
    ({
      can_submit: false,
      external_submit_enabled: externalLiftSubmitEnabled,
      live_transport_enabled: liftSubmitTransportMode === "live",
      live_customer_submit_allowed: liveCustomerSubmitAllowed,
      summary: "Preview job has no submit certification.",
      items: []
    } satisfies SubmitCertification);

  return {
    attempt_id: `submit_${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`,
    idempotency_key: args.idempotencyKey,
    customer_id: args.job.customer_id,
    customer_name: args.job.customer_name,
    job_id: args.job.job_id,
    output_route_id: args.job.output_route_id,
    output_route_name: args.job.output_route_name,
    submit_profile_id: args.job.submit_profile_id,
    submit_profile_name: args.job.submit_profile_name,
    submit_mode: args.job.submit_mode,
    sandbox: args.job.sandbox,
    state: args.state,
    external_submit_enabled: externalLiftSubmitEnabled,
    endpoint_url: (args.submitRequestMasked ?? args.job.submit_request_masked).endpoint_url,
    ext_id: (args.submitRequestMasked ?? args.job.submit_request_masked).headers.Ext_ID,
    company_id: (args.submitRequestMasked ?? args.job.submit_request_masked).headers.Company,
    submit_request_masked: args.submitRequestMasked ?? args.job.submit_request_masked,
    certification,
    blocking_items: args.blockingItems,
    response: args.response ?? {
      status: "not_sent",
      http_status: null,
      lift_order_id: null,
      message: args.message,
      raw_body: null,
      received_at: timestamp
    },
    created_at: timestamp,
    updated_at: timestamp
  };
}

async function fetchLiftCustomerDirectory(): Promise<LiftCustomerDirectory> {
  const response = await fetch(liftCustomerListEndpoint, {
    headers: { Accept: "text/csv,*/*" },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`Lift customer import failed with HTTP ${response.status}.`);
  }

  const csv = await response.text();
  const customers = parseLiftCustomerCsv(csv);
  let warning: string | undefined;
  let enrichedCustomers = customers;

  try {
    const statusResponse = await fetch(liftCustomerStatusEndpoint, {
      headers: { Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(10000)
    });

    if (!statusResponse.ok) {
      throw new Error(`Lift customer status import failed with HTTP ${statusResponse.status}.`);
    }

    const statusPayload = await statusResponse.json();
    enrichedCustomers = enrichLiftCustomers(customers, parseLiftCustomerStatusJson(statusPayload));
  } catch (error) {
    warning = error instanceof Error ? error.message : "Lift customer status import failed.";
  }

  return {
    customers: enrichedCustomers,
    source: "lift-endpoint",
    endpoint_url: liftCustomerListEndpoint,
    status_endpoint_url: liftCustomerStatusEndpoint,
    loaded_at: new Date().toISOString(),
    warning
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "pathfinder-api",
    version: "0.1.0"
  });
});

app.get("/api/sample-order", (_req, res) => {
  const canonicalValidation = validateCanonicalOrder(sampleCanonicalOrder);
  const liftPayload = generateLiftPayload(sampleCanonicalOrder, {
    jobId: "job_20260618_000001",
    canonicalOrderId: "co_20260618_000001"
  });
  const liftValidation = validateLiftPayload(liftPayload);
  const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload));

  res.json({
    canonicalOrder: sampleCanonicalOrder,
    canonicalValidation,
    liftPayload,
    liftValidation,
    submitRequest
  });
});

app.get("/api/lift/customers", async (req, res) => {
  const shouldRefresh = req.query.refresh === "1" || req.query.refresh === "true";

  try {
    const directory = shouldRefresh ? await fetchLiftCustomerDirectory() : await readLocalCustomerSeed();
    res.json(directory);
  } catch (error) {
    const fallbackDirectory = await readLocalCustomerSeed();
    res.json({
      ...fallbackDirectory,
      warning: error instanceof Error ? error.message : "Lift customer import failed; served local seed instead."
    });
  }
});

app.get("/api/customers/:liftCustomerId/workspace", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await getOrCreateWorkspace(customer);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Workspace load failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/import-methods/:methodId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await updateImportMethod(customer, req.params.methodId, req.body as Partial<ImportMethod>);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Import method save failed."
    });
  }
});

app.delete("/api/customers/:liftCustomerId/import-methods/:methodId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await archiveImportMethod(customer, req.params.methodId);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Import method delete failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/output-routes/:routeId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await updateOutputRoute(customer, req.params.routeId, req.body as Partial<OutputRoute>);
    const target = await getTarget(workspace.primary_target_id);

    res.json({
      ...workspace,
      primary_target: target
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Output route save failed."
    });
  }
});

app.get("/api/customers/:liftCustomerId/product-mappings", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      product_mappings: await listProductMappings(customer)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Product mapping load failed."
    });
  }
});

app.get("/api/lift/unit-catalog", async (req, res) => {
  try {
    res.json({
      units: await listLiftUnitCatalog({
        target_id: req.query.target_id ? String(req.query.target_id) : undefined,
        environment_id: req.query.environment_id ? String(req.query.environment_id) : undefined,
        company_id: req.query.company_id ? String(req.query.company_id) : undefined,
        q: req.query.q ? String(req.query.q) : undefined,
        product_id: req.query.product_id ? String(req.query.product_id) : undefined,
        catalog_id: req.query.catalog_id ? String(req.query.catalog_id) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        include_inactive: req.query.include_inactive === "1" || req.query.include_inactive === "true"
      })
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift unit catalog load failed."
    });
  }
});

app.put("/api/customers/:liftCustomerId/product-mappings/:mappingId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      product_mappings: await updateProductMapping(customer, req.params.mappingId, req.body as Partial<CustomerProductMapping>)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Product mapping save failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/product-mappings/bulk", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    res.json({
      product_mappings: await bulkUpsertProductMappings(customer, (req.body?.product_mappings ?? []) as CustomerProductMapping[])
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Bulk product mapping save failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/jobs/preview", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await getOrCreateWorkspace(customer);
    const sourceGrid = (req.body?.source_grid ?? sampleSourceGrid) as SourceGrid;
    const sourceSheets = (req.body?.source_sheets ?? sourceSheetsFromGrid(sourceGrid)) as ParsedWorkbookSheet[];
    const requestIncludedParsedRows = Array.isArray(req.body?.parsed_order_rows);
    const parsedOrderRows = (requestIncludedParsedRows
      ? ((req.body.parsed_order_rows as ParsedSourceRow[]) ?? [])
      : synthesizeParsedRows(sourceGrid)
    ).filter((row) => row.row_type === "order");
    const referenceRows = ((req.body?.reference_rows as ParsedSourceRow[] | undefined) ?? []) as ParsedSourceRow[];
    const sourceFileName = String(req.body?.source_file_name ?? "Sample workbook");
    const sheetName = req.body?.sheet_name ? String(req.body.sheet_name) : null;
    const requestedMethodId = String(req.body?.import_method_id ?? "manual-xlsx");
    const existingMethod =
      workspace.import_methods.find((method) => method.import_method_id === requestedMethodId) ??
      workspace.import_methods[0];
    const mappings = (req.body?.mappings ?? existingMethod?.mappings ?? []) as FieldMapping[];
    const method = {
      ...existingMethod,
      mappings,
      product_resolution_config: {
        ...createDefaultProductResolutionConfig(),
        ...(existingMethod?.product_resolution_config ?? {}),
        ...(req.body?.product_resolution_config ?? {})
      }
    };
    const outputRoute =
      workspace.output_routes.find((route) => route.output_route_id === method.output_route_id) ??
      workspace.output_routes.find((route) => route.output_route_id === workspace.primary_output_route_id) ??
      workspace.output_routes[0];
    if (!outputRoute) {
      throw new Error("No output route is configured for this customer.");
    }
    const submitProfile = submitProfileForRoute(outputRoute, req.body?.submit_profile_id ? String(req.body.submit_profile_id) : undefined);
    const submitCustomer = submitCustomerForProfile(customer, submitProfile);
    const orderRows = parsedOrderRows.length || requestIncludedParsedRows ? parsedOrderRows : synthesizeParsedRows(sourceGrid);
    const mappingRows = orderRows.map((row) => row.values);
    const existingProductMappings = await listProductMappings(customer);
    const productResolutionResults = resolveProducts(
      orderRows,
      existingProductMappings,
      method.product_resolution_config,
      outputRoute
    );
    const timestamp = new Date().toISOString();
    const jobId = `job_${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
    const canonicalOrderId = `co_${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
    const seenMappings = productResolutionResults.map((result, index) => {
      const row = orderRows[index];
      const existing = existingProductMappings.find(
        (mapping) =>
          mapping.output_route_id === outputRoute.output_route_id &&
          mapping.customer_product_key === result.customer_product_key
      );
      const nextSeenExample = {
        sheet_name: result.source_sheet_name,
        row_number: result.source_row_number,
        description: valueAsString(rowValue(row, "DESCRIPTION")) || null,
        sign_type: valueAsString(rowValue(row, "SIGN TYPE")) || null,
        media_type: valueAsString(rowValue(row, "Media Type")) || null
      };
      return {
        ...(existing ?? buildMappingFromRow(row, method.product_resolution_config, timestamp, outputRoute)),
        output_route_id: outputRoute.output_route_id,
        target_id: outputRoute.target_id,
        target_template: outputRoute.output_template,
        product_identifier_type: outputRoute.product_identifier_type,
        product_identifier_value: result.resolved_product_identifier,
        status: result.status,
        lift_unit_number:
          outputRoute.product_identifier_type === "lift_unit_number"
            ? result.resolved_product_identifier
            : existing?.lift_unit_number ?? null,
        lift_product_id:
          outputRoute.product_identifier_type === "lift_product_id"
            ? result.resolved_product_identifier
            : existing?.lift_product_id ?? null,
        product_name: result.product_name,
        last_seen_examples: [
          nextSeenExample,
          ...(existing?.last_seen_examples ?? []).filter(
            (example) =>
              example.sheet_name !== nextSeenExample.sheet_name || example.row_number !== nextSeenExample.row_number
          )
        ].slice(0, 8),
        updated_at: timestamp
      } satisfies CustomerProductMapping;
    });
    const nextProductMappings = await bulkUpsertProductMappings(customer, seenMappings);
    const unresolvedProducts = nextProductMappings.filter(
      (mapping) =>
        mapping.output_route_id === outputRoute.output_route_id &&
        productResolutionResults.some((result) => result.customer_product_key === mapping.customer_product_key) &&
        mapping.status !== "Mapped"
    );
    const target = (await getTarget(outputRoute.target_id, false)) as TargetConfig | null;
    if (!target) {
      throw new Error(`Output route target ${outputRoute.target_id} could not be found.`);
    }
    const canonicalOrder = mapSourceRowsToCanonicalOrder(mappingRows, mappings, {
      customerId: `lift:${customer.lift_customer_id}`,
      customerName: submitCustomer.customer_name,
      customerCrmId: customer.crm_id ?? null,
      destinationCustomerId: submitCustomer.lift_customer_id,
      sourceSystem: method.source === "XLSX" ? "Manual XLSX Upload" : method.source,
      sourceCustomer: customer.customer_name,
      sourceTemplate: method.name,
      targetSystem: target.template
    });
    canonicalOrder.lines = canonicalOrder.lines.map((line, index) => ({
      ...line,
      unit_number:
        outputRoute.product_identifier_type === "lift_unit_number"
          ? productResolutionResults[index]?.resolved_product_identifier ?? ""
          : line.unit_number ?? "",
      product_id:
        outputRoute.product_identifier_type === "lift_product_id"
          ? productResolutionResults[index]?.resolved_product_identifier ?? line.product_id ?? null
          : line.product_id ?? null,
      product_name: productResolutionResults[index]?.product_name ?? line.product_name,
      customer_sku: productResolutionResults[index]?.customer_product_key ?? line.customer_sku
    }));
    const canonicalValidation = validateCanonicalOrder(canonicalOrder, {
      product_identifier_type: outputRoute.product_identifier_type
    });
    const rawLiftPayload = generateLiftPayload(canonicalOrder, {
      jobId,
      canonicalOrderId
    });
    const normalizedLift = applyValueNormalizationToLiftPayload(rawLiftPayload, outputRoute.value_normalization_rules);
    const liftPayload = normalizedLift.payload;
    const baseLiftValidation = validateLiftPayload(liftPayload, {
      product_identifier_type: outputRoute.product_identifier_type,
      product_identifier_label: outputRoute.product_identifier_label
    });
    const liftValidation = [
      ...(normalizedLift.validation.length
        ? baseLiftValidation.filter((message) => message.severity !== "PASS")
        : baseLiftValidation),
      ...normalizedLift.validation
    ];
    const routeLiftConfig = liftConfigForRoute(target, outputRoute);
    const routeEnvironment = routeEnvironmentForTarget(target, outputRoute);
    const unmaskedSubmitRequest = buildLiftSubmitRequest(liftPayload, routeLiftConfig);
    const submitValidation = validateSubmitReadiness(unmaskedSubmitRequest, liftPayload, submitProfile, outputRoute);
    const submitRequest = maskLiftSubmitRequest(unmaskedSubmitRequest);
    const allMessages = [...canonicalValidation, ...liftValidation, ...submitValidation];
    const jobState: ProcessingJobPreview["state"] = unresolvedProducts.length
      ? "Needs Mapping"
      : allMessages.some((message) => message.severity === "FAIL")
        ? "Failed"
        : "Ready";
    const submitCertification = buildSubmitCertification({
      state: jobState,
      canonicalValidation,
      liftValidation,
      submitValidation,
      unresolvedProducts,
      request: unmaskedSubmitRequest,
      payload: liftPayload,
      profile: submitProfile,
      route: outputRoute,
      environment: routeEnvironment
    });
    const job: ProcessingJobPreview = {
      job_id: jobId,
      customer_id: customer.lift_customer_id,
      customer_name: customer.customer_name,
      source_customer_id: customer.lift_customer_id,
      source_customer_name: customer.customer_name,
      submit_customer_id: submitCustomer.lift_customer_id,
      submit_customer_name: submitCustomer.customer_name,
      submit_profile_id: submitProfile.profile_id,
      submit_profile_name: submitProfile.name,
      submit_mode: submitProfile.mode,
      sandbox: submitProfile.mode === "sandbox_customer",
      import_method_id: method.import_method_id,
      import_method_name: method.name,
      output_route_id: outputRoute.output_route_id,
      output_route_name: outputRoute.name,
      target_order_number: null,
      target_order_lookup_url: null,
      state: jobState,
      source_file_name: sourceFileName,
      sheet_name: sheetName,
      source_grid: sourceGrid,
      source_sheets: sourceSheets,
      parsed_order_rows: orderRows,
      reference_rows: referenceRows,
      mappings,
      product_resolution_results: productResolutionResults,
      unresolved_products: unresolvedProducts,
      canonical_order: canonicalOrder,
      canonical_validation: canonicalValidation,
      lift_payload: liftPayload,
      lift_validation: [...liftValidation, ...submitValidation],
      submit_certification: submitCertification,
      submit_request_masked: submitRequest,
      created_at: timestamp,
      updated_at: timestamp
    };
    const nextWorkspace = await persistPreviewJob(customer, job, method);

    res.json({
      job,
      workspace: {
        ...nextWorkspace,
        primary_target: maskTargetConfig(target)
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Preview job failed."
    });
  }
});

app.get("/api/jobs", async (_req, res) => {
  res.json({
    jobs: await listJobs()
  });
});

app.get("/api/customers/:liftCustomerId/jobs/:jobId", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    res.json({
      job,
      submit_attempts: await listSubmitAttemptsForJob(customer, req.params.jobId)
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Job detail failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/jobs/:jobId/certification", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    const refreshedJob = await refreshJobSubmitCertification(customer, job);
    res.json({
      job: refreshedJob,
      certification: refreshedJob.submit_certification,
      submit_request_masked: refreshedJob.submit_request_masked
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Submit certification refresh failed."
    });
  }
});

app.post("/api/customers/:liftCustomerId/jobs/:jobId/submit", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const job = await getJob(customer, req.params.jobId);

    if (!job) {
      res.status(404).json({
        error: "Preview job not found."
      });
      return;
    }

    const idempotencyKey = submitIdempotencyKey(job, req.header("Idempotency-Key") ?? req.body?.idempotency_key);
    const existingAttempt = await getSubmitAttemptByIdempotencyKey(customer, idempotencyKey);
    if (existingAttempt) {
      res.status(200).json({
        attempt: existingAttempt,
        reused: true,
        message: "Existing submit attempt returned for idempotency key."
      });
      return;
    }

    const workspace = await getOrCreateWorkspace(customer);
    const outputRoute = workspace.output_routes.find((route) => route.output_route_id === job.output_route_id);

    if (!outputRoute) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems: [],
          message: "Preview job output route could not be found."
        })
      );
      res.status(409).json({
        error: "Preview job output route could not be found.",
        attempt,
        certification: job.submit_certification
      });
      return;
    }

    const target = (await getTarget(outputRoute.target_id, false)) as TargetConfig | null;
    if (!target) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems: [],
          message: "Preview job target could not be found."
        })
      );
      res.status(409).json({
        error: "Preview job target could not be found.",
        attempt,
        certification: job.submit_certification
      });
      return;
    }

    const submitProfile = submitProfileFromJob(outputRoute, job);
    const routeEnvironment = routeEnvironmentForTarget(target, outputRoute);
    const unmaskedSubmitRequest = buildLiftSubmitRequest(job.lift_payload, liftConfigForRoute(target, outputRoute));
    const submitRequestMasked = maskLiftSubmitRequest(unmaskedSubmitRequest);
    const submitValidation = validateSubmitReadiness(unmaskedSubmitRequest, job.lift_payload, submitProfile, outputRoute);
    const certification = buildSubmitCertification({
      state: job.state,
      canonicalValidation: job.canonical_validation,
      liftValidation: job.lift_validation,
      submitValidation,
      unresolvedProducts: job.unresolved_products,
      request: unmaskedSubmitRequest,
      payload: job.lift_payload,
      profile: submitProfile,
      route: outputRoute,
      environment: routeEnvironment
    });

    const blockingItems = certification.items.filter((item) => item.blocking);
    const nonGateBlockers = blockingItems.filter((item) => item.item_id !== "external-submit-gate");
    if (nonGateBlockers.length) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems,
          certification,
          submitRequestMasked,
          message: "Preview job is not certified for Lift submit."
        })
      );
      res.status(409).json({
        error: "Preview job is not certified for Lift submit.",
        attempt,
        certification,
        blocking_items: nonGateBlockers,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    if (!externalLiftSubmitEnabled) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Gate Locked",
          blockingItems,
          certification,
          submitRequestMasked,
          message: "External Lift submit is disabled by Pathfinder feature gate."
        })
      );
      res.status(423).json({
        error: "External Lift submit is disabled by Pathfinder feature gate.",
        attempt,
        certification,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    if (!certification.can_submit) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems,
          certification,
          submitRequestMasked,
          message: "Preview job is not certified for Lift submit."
        })
      );
      res.status(409).json({
        error: "Preview job is not certified for Lift submit.",
        attempt,
        certification,
        blocking_items: blockingItems,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    const transportResult = await submitLiftOrder(unmaskedSubmitRequest, { mode: liftSubmitTransportMode });
    const attemptState: SubmitAttemptStatus =
      transportResult.status === "accepted"
        ? "Submitted"
        : transportResult.status === "not_sent"
          ? "Dry Run"
          : "Failed";
    const attempt = await persistSubmitAttempt(
      customer,
      createSubmitAttempt({
        job,
        idempotencyKey,
        state: attemptState,
        blockingItems: [],
        certification,
        message: transportResult.message,
        response: transportResult,
        submitRequestMasked
      })
    );
    const submittedJob = await getJob(customer, job.job_id);

    if (transportResult.status === "rejected" || transportResult.status === "error") {
      res.status(502).json({
        error: transportResult.message,
        attempt,
        job: submittedJob ?? job,
        certification,
        transport_mode: liftSubmitTransportMode,
        submit_request_masked: submitRequestMasked
      });
      return;
    }

    res.status(202).json({
      attempt,
      job: submittedJob ?? job,
      certification,
      transport_mode: liftSubmitTransportMode,
      submit_request_masked: submitRequestMasked
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift submit failed."
    });
  }
});

app.get("/api/targets", async (_req, res) => {
  res.json({
    targets: await listTargets()
  });
});

app.put("/api/targets/:targetId", async (req, res) => {
  try {
    const target = await updateTarget(req.params.targetId, req.body as Partial<TargetConfig>);
    res.json(target);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Target save failed."
    });
  }
});

app.get("/api/lift/product-catalog", async (req, res) => {
  try {
    const targetId = req.query.target_id ? String(req.query.target_id) : undefined;
    const routeId = req.query.output_route_id ? String(req.query.output_route_id) : undefined;
    const companyId = req.query.company_id ? String(req.query.company_id) : undefined;
    const customerId = req.query.customer_id ? String(req.query.customer_id) : undefined;
    let refreshed = false;
    let refreshedCount = 0;

    if (req.query.refresh === "1" || req.query.refresh === "true") {
      if (!targetId || !routeId || !customerId) {
        throw new Error("Refresh requires target_id, output_route_id, and customer_id.");
      }
      const customer = await findLiftCustomer(customerId);
      const workspace = await getOrCreateWorkspace(customer);
      const route = workspace.output_routes.find((candidate) => candidate.output_route_id === routeId);
      const target = (await getTarget(targetId, false)) as TargetConfig | null;

      if (!route || !target) {
        throw new Error("Could not find the selected target or output route for product catalog refresh.");
      }

      const liftedProducts = await fetchLiftProductsFromTarget(target, route, req.query);
      await upsertLiftProductCatalog(liftedProducts);
      refreshed = true;
      refreshedCount = liftedProducts.length;
    }

    const products = await listLiftUnitCatalog({
      target_id: targetId,
      environment_id: req.query.environment_id ? String(req.query.environment_id) : undefined,
      company_id: companyId,
      q: req.query.q ? String(req.query.q) : undefined,
      product_id: req.query.product_id ? String(req.query.product_id) : undefined,
      catalog_id: req.query.catalog_id ? String(req.query.catalog_id) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      include_inactive: req.query.include_inactive === "1" || req.query.include_inactive === "true"
    });

    res.json({
      products,
      refreshed,
      refreshed_count: refreshedCount,
      source: refreshed ? "lift-api" : "local-cache"
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Lift product catalog load failed."
    });
  }
});

app.post("/api/lift/preview", (req, res) => {
  const canonicalOrder = req.body?.canonicalOrder ?? sampleCanonicalOrder;
  const canonicalValidation = validateCanonicalOrder(canonicalOrder);
  const liftPayload = generateLiftPayload(canonicalOrder);
  const liftValidation = validateLiftPayload(liftPayload);
  const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload));

  res.json({
    canonicalValidation,
    liftValidation,
    liftPayload,
    submitRequest
  });
});

app.listen(port, () => {
  console.log(`Pathfinder API listening on http://127.0.0.1:${port}`);
});
