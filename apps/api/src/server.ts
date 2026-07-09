import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import { parseLiftCustomerCsv, type LiftCustomerDirectory } from "@pathfinder/customer-directory";
import { sampleCanonicalOrder, validateCanonicalOrder } from "@pathfinder/canonical";
import {
  buildLiftSubmitRequest,
  generateLiftPayload,
  maskLiftSubmitRequest,
  validateLiftPayload
} from "@pathfinder/lift-adapter";
import { mapSourceRowsToCanonicalOrder, sampleSourceGrid, type FieldMapping, type SourceGrid } from "@pathfinder/templates";
import {
  getOrCreateWorkspace,
  getTarget,
  listJobs,
  listTargets,
  maskTargetConfig,
  persistPreviewJob,
  updateImportMethod,
  updateTarget,
  type ImportMethod,
  type ProcessingJobPreview,
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

app.post("/api/customers/:liftCustomerId/jobs/preview", async (req, res) => {
  try {
    const customer = await findLiftCustomer(req.params.liftCustomerId);
    const workspace = await getOrCreateWorkspace(customer);
    const sourceGrid = (req.body?.source_grid ?? sampleSourceGrid) as SourceGrid;
    const sourceFileName = String(req.body?.source_file_name ?? "Sample workbook");
    const sheetName = req.body?.sheet_name ? String(req.body.sheet_name) : null;
    const requestedMethodId = String(req.body?.import_method_id ?? "manual-xlsx");
    const existingMethod =
      workspace.import_methods.find((method) => method.import_method_id === requestedMethodId) ??
      workspace.import_methods[0];
    const mappings = (req.body?.mappings ?? existingMethod?.mappings ?? []) as FieldMapping[];
    const method = {
      ...existingMethod,
      mappings
    };
    const target = (await getTarget(workspace.primary_target_id, false)) as TargetConfig;
    const canonicalOrder = mapSourceRowsToCanonicalOrder(sourceGrid.rows, mappings, {
      customerId: `lift:${customer.lift_customer_id}`,
      customerName: customer.customer_name,
      destinationCustomerId: customer.lift_customer_id,
      sourceSystem: method.source === "XLSX" ? "Manual XLSX Upload" : method.type,
      sourceCustomer: customer.customer_name,
      sourceTemplate: method.name,
      targetSystem: target.template
    });
    const canonicalValidation = validateCanonicalOrder(canonicalOrder);
    const liftPayload = generateLiftPayload(canonicalOrder);
    const liftValidation = validateLiftPayload(liftPayload);
    const submitRequest = maskLiftSubmitRequest(buildLiftSubmitRequest(liftPayload, target.lift));
    const allMessages = [...canonicalValidation, ...liftValidation];
    const timestamp = new Date().toISOString();
    const job: ProcessingJobPreview = {
      job_id: `job_${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
      customer_id: customer.lift_customer_id,
      customer_name: customer.customer_name,
      import_method_id: method.import_method_id,
      import_method_name: method.name,
      state: allMessages.some((message) => message.severity === "FAIL") ? "Failed" : "Ready",
      source_file_name: sourceFileName,
      sheet_name: sheetName,
      source_grid: sourceGrid,
      mappings,
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

app.put("/api/targets/lift-standard-graphics", async (req, res) => {
  try {
    const target = await updateTarget("lift-standard-graphics", req.body as Partial<TargetConfig>);
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
