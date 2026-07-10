import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import { parseLiftCustomerCsv, type LiftCustomer, type LiftCustomerDirectory } from "@pathfinder/customer-directory";
import { sampleCanonicalOrder, validateCanonicalOrder } from "@pathfinder/canonical";
import {
  buildLiftSubmitRequest,
  generateLiftPayload,
  maskLiftSubmitRequest,
  validateLiftPayload
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
  listTargets,
  maskTargetConfig,
  persistPreviewJob,
  updateProductMapping,
  updateImportMethod,
  updateTarget,
  type CustomerProductMapping,
  type ImportMethod,
  type OutputRoute,
  type ProductMappingStatus,
  type ProductResolutionConfig,
  type ProductResolutionResult,
  type ProcessingJobPreview,
  type SubmitProfile,
  type TargetConfig
} from "./store.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const liftCustomerListEndpoint =
  process.env.LIFT_CUSTOMER_LIST_URL ??
  "https://admin.lifterp.com/ords/lifterp/lift/erp/flush/ondemand/91/CustomerContactLIst/LTL-Customer-List?offset=0";
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
    const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload, target.lift));
    const allMessages = [...canonicalValidation, ...liftValidation];
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
      state: unresolvedProducts.length
        ? "Needs Mapping"
        : allMessages.some((message) => message.severity === "FAIL")
          ? "Failed"
          : "Ready",
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
      lift_validation: liftValidation,
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
