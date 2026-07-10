import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import { parseLiftCustomerCsv, type LiftCustomer, type LiftCustomerDirectory } from "@pathfinder/customer-directory";
import { sampleCanonicalOrder, validateCanonicalOrder, type ValidationMessage } from "@pathfinder/canonical";
import {
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
  listJobs,
  listSubmitAttemptsForJob,
  listTargets,
  getJob,
  getSubmitAttemptByIdempotencyKey,
  maskTargetConfig,
  persistPreviewJob,
  persistSubmitAttempt,
  updateProductMapping,
  updateImportMethod,
  updateOutputRoute,
  updateTarget,
  type CustomerProductMapping,
  type ImportMethod,
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
  type TargetConfig
} from "./store.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const liftCustomerListEndpoint =
  process.env.LIFT_CUSTOMER_LIST_URL ??
  "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerContactLIst/LTL-Customer-List?offset=0";
const externalLiftSubmitEnabled = process.env.PATHFINDER_ENABLE_LIFT_SUBMIT === "true";
const liftSubmitTransportMode: LiftSubmitTransportMode =
  process.env.PATHFINDER_LIFT_TRANSPORT_MODE === "live" ? "live" : "dry_run";
const localCustomerSeedUrl = new URL("../../../data/lift-customers.sample.csv", import.meta.url);

app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "10mb" }));

async function readLocalCustomerSeed(): Promise<LiftCustomerDirectory> {
  const csv = await readFile(localCustomerSeedUrl, "utf8");
  return {
    customers: parseLiftCustomerCsv(csv),
    source: "local-seed",
    endpoint_url: liftCustomerListEndpoint,
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
      created_date: null
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
    product_identifier_value: config.mode === "send_derived_unit" ? customerProductKey : null,
    lift_unit_number:
      route.product_identifier_type === "lift_unit_number" && config.mode === "send_derived_unit"
        ? customerProductKey
        : null,
    product_name: valueAsString(rowValue(row, "DESCRIPTION")) || valueAsString(rowValue(row, "SIGN TYPE")) || null,
    status: (config.mode === "send_derived_unit" && customerProductKey ? "Mapped" : "Unmapped") as ProductMappingStatus,
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
    let resolvedUnitNumber = mapping.product_identifier_value ?? mapping.lift_unit_number;
    let message = `Resolved to approved ${route.product_identifier_label}.`;

    if (config.mode === "send_derived_unit") {
      resolvedUnitNumber = directUnitNumber;
      status = resolvedUnitNumber ? "Mapped" : "Unmapped";
      message = resolvedUnitNumber
        ? `Using generated value as ${route.product_identifier_label}.`
        : "Generated product identifier is blank.";
    } else if (ambiguousKeys.has(key) && !(mapping.product_identifier_value ?? mapping.lift_unit_number)) {
      status = "Ambiguous";
      resolvedUnitNumber = null;
      message = "Generated key matches multiple product signatures; use composite fallback or approve a mapping.";
    } else if (!(mapping.product_identifier_value ?? mapping.lift_unit_number) || mapping.status !== "Mapped") {
      status = key ? "Unmapped" : "Unmapped";
      resolvedUnitNumber = null;
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
      resolved_unit_number: resolvedUnitNumber,
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
}): SubmitCertification {
  const canonicalFailures = args.canonicalValidation.filter((message) => message.severity === "FAIL");
  const liftFailures = args.liftValidation.filter((message) => message.severity === "FAIL");
  const placeholderCredentialWarnings = args.submitValidation.filter((message) =>
    ["SUBMIT-USER", "SUBMIT-PASSWORD"].includes(message.code)
  );
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
      status: "Passed",
      blocking: false,
      message:
        args.profile.mode === "sandbox_customer"
          ? `Sandbox profile selected: ${args.profile.customer_override?.customer_name ?? args.profile.name}.`
          : `Live customer profile selected: ${args.profile.name}.`,
      suggested_action:
        args.profile.mode === "sandbox_customer"
          ? "This is the preferred profile for first production-endpoint tests."
          : "Use Sandbox · LTL Demo for non-customer-facing tests.",
      action_key: "manual-import"
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
  response?: SubmitAttempt["response"];
  submitRequestMasked?: ProcessingJobPreview["submit_request_masked"];
}): SubmitAttempt {
  const timestamp = new Date().toISOString();
  const certification =
    args.job.submit_certification ??
    ({
      can_submit: false,
      external_submit_enabled: externalLiftSubmitEnabled,
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
  return {
    customers: parseLiftCustomerCsv(csv),
    source: "lift-endpoint",
    endpoint_url: liftCustomerListEndpoint,
    loaded_at: new Date().toISOString()
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
    const parsedOrderRows = ((req.body?.parsed_order_rows as ParsedSourceRow[] | undefined) ?? synthesizeParsedRows(sourceGrid)).filter(
      (row) => row.row_type === "order"
    );
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
    const orderRows = parsedOrderRows.length ? parsedOrderRows : synthesizeParsedRows(sourceGrid);
    const mappingRows = orderRows.map((row) => row.values);
    const existingProductMappings = await listProductMappings(customer);
    const productResolutionResults = resolveProducts(
      orderRows,
      existingProductMappings,
      method.product_resolution_config,
      outputRoute
    );
    const timestamp = new Date().toISOString();
    const seenMappings = productResolutionResults.map((result, index) => {
      const row = orderRows[index];
      const existing = existingProductMappings.find(
        (mapping) =>
          mapping.output_route_id === outputRoute.output_route_id &&
          mapping.customer_product_key === result.customer_product_key
      );
      return {
        ...(existing ?? buildMappingFromRow(row, method.product_resolution_config, timestamp, outputRoute)),
        output_route_id: outputRoute.output_route_id,
        target_id: outputRoute.target_id,
        target_template: outputRoute.output_template,
        product_identifier_type: outputRoute.product_identifier_type,
        product_identifier_value: result.resolved_unit_number,
        status: result.status,
        lift_unit_number:
          outputRoute.product_identifier_type === "lift_unit_number"
            ? result.resolved_unit_number
            : existing?.lift_unit_number ?? null,
        product_name: result.product_name,
        last_seen_examples: [
          {
            sheet_name: result.source_sheet_name,
            row_number: result.source_row_number,
            description: valueAsString(rowValue(row, "DESCRIPTION")) || null,
            sign_type: valueAsString(rowValue(row, "SIGN TYPE")) || null,
            media_type: valueAsString(rowValue(row, "Media Type")) || null
          }
        ],
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
    const target = (await getTarget(outputRoute.target_id, false)) as TargetConfig;
    const canonicalOrder = mapSourceRowsToCanonicalOrder(mappingRows, mappings, {
      customerId: `lift:${customer.lift_customer_id}`,
      customerName: submitCustomer.customer_name,
      destinationCustomerId: submitCustomer.lift_customer_id,
      sourceSystem: method.source === "XLSX" ? "Manual XLSX Upload" : method.source,
      sourceCustomer: customer.customer_name,
      sourceTemplate: method.name,
      targetSystem: target.template
    });
    canonicalOrder.lines = canonicalOrder.lines.map((line, index) => ({
      ...line,
      unit_number: productResolutionResults[index]?.resolved_unit_number ?? "",
      product_name: productResolutionResults[index]?.product_name ?? line.product_name,
      customer_sku: productResolutionResults[index]?.customer_product_key ?? line.customer_sku
    }));
    const canonicalValidation = validateCanonicalOrder(canonicalOrder);
    const liftPayload = generateLiftPayload(canonicalOrder);
    const liftValidation = validateLiftPayload(liftPayload);
    const routeLiftConfig = liftConfigForRoute(target, outputRoute);
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
      route: outputRoute
    });
    const job: ProcessingJobPreview = {
      job_id: `job_${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
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

    const certification = job.submit_certification;
    if (!certification) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems: [],
          message: "Preview job has no submit certification. Regenerate the preview before submitting."
        })
      );
      res.status(409).json({
        error: "Preview job has no submit certification. Regenerate the preview before submitting.",
        attempt,
        job
      });
      return;
    }

    const blockingItems = certification.items.filter((item) => item.blocking);
    const nonGateBlockers = blockingItems.filter((item) => item.item_id !== "external-submit-gate");
    if (nonGateBlockers.length) {
      const attempt = await persistSubmitAttempt(
        customer,
        createSubmitAttempt({
          job,
          idempotencyKey,
          state: "Blocked",
          blockingItems: nonGateBlockers,
          message: "Preview job is not certified for Lift submit."
        })
      );
      res.status(409).json({
        error: "Preview job is not certified for Lift submit.",
        attempt,
        certification,
        blocking_items: nonGateBlockers
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
          message: "External Lift submit is disabled by Pathfinder feature gate."
        })
      );
      res.status(423).json({
        error: "External Lift submit is disabled by Pathfinder feature gate.",
        attempt,
        certification,
        submit_request_masked: job.submit_request_masked
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
          message: "Preview job is not certified for Lift submit."
        })
      );
      res.status(409).json({
        error: "Preview job is not certified for Lift submit.",
        attempt,
        certification,
        blocking_items: blockingItems
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
        certification
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
        certification
      });
      return;
    }

    const unmaskedSubmitRequest = buildLiftSubmitRequest(job.lift_payload, liftConfigForRoute(target, outputRoute));
    const submitRequestMasked = maskLiftSubmitRequest(unmaskedSubmitRequest);
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
