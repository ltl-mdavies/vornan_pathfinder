import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

let testDirectory = "";
let testStorePath = "";
let getOrCreateWorkspace: typeof import("../src/store.ts")["getOrCreateWorkspace"];
let updateImportMethod: typeof import("../src/store.ts")["updateImportMethod"];

const testCustomer = {
  lift_customer_id: "regression-import-methods",
  customer_name: "Import Method Regression Customer",
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
};

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-import-method-test-"));
  testStorePath = join(testDirectory, "store.json");
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_STORE_PATH = testStorePath;
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");
  process.env.PATHFINDER_REQUIRE_AUTH = "false";
  process.env.PATHFINDER_ENABLE_LIFT_SUBMIT = "false";

  const store = await import("../src/store.ts");
  getOrCreateWorkspace = store.getOrCreateWorkspace;
  updateImportMethod = store.updateImportMethod;
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

function importMethod(workspace: any, methodId: string) {
  const method = workspace.import_methods.find((candidate: any) => candidate.import_method_id === methodId);
  assert.ok(method, `Expected import method ${methodId}`);
  return method;
}

test("persists detected schemas and mappings without retaining workbook rows", async () => {
  const initialWorkspace = await getOrCreateWorkspace(testCustomer);
  const initialMethod = importMethod(initialWorkspace, "manual-xlsx");
  const mappings = [
    { sourceColumn: "Order Number", targetField: "order.external_order_id", required: true },
    { sourceColumn: "SKU", targetField: "lines[].customer_sku", required: true }
  ];
  const parserConfig = {
    header_row: null,
    header_row_count: 1,
    quantity_column: "Qty",
    ignore_repeated_headers: true,
    reference_rows_mode: "rows_without_quantity",
    sheet_header_overrides: {
      Catalog: { header_row: 2, header_row_count: 2 }
    }
  };

  const savedWorkspace = await updateImportMethod(
    testCustomer,
    "manual-xlsx",
    {
      mappings,
      source_config: {
        header_row: null,
        header_row_count: 1,
        quantity_column: "Qty",
        ignore_repeated_headers: true,
        reference_rows_mode: "rows_without_quantity",
        sheet_header_overrides: parserConfig.sheet_header_overrides,
        detected_schema: {
          source_file_name: "customer-template.xlsx",
          selected_sheet_name: "Orders",
          columns: ["Order Number", "SKU", "Qty"],
          sheets: [
            {
              sheet_name: "Orders",
              columns: ["Order Number", "SKU", "Qty"],
              order_row_count: 2,
              reference_row_count: 0,
              header_row: 3,
              header_row_count: 1,
              ignored_header_rows: [6],
              parsed_rows: [{ values: { "Order Number": "SHOULD_NOT_PERSIST" } }]
            },
            {
              sheet_name: "Catalog",
              columns: ["SKU", "Description", "Qty"],
              order_row_count: 1,
              reference_row_count: 0,
              header_row: 2,
              header_row_count: 2
            }
          ],
          detected_at: "2026-07-19T12:00:00.000Z",
          parser_config: parserConfig,
          rows: [{ "Order Number": "SHOULD_NOT_PERSIST" }]
        }
      }
    } as any
  );

  const savedMethod = importMethod(savedWorkspace, "manual-xlsx");
  assert.deepEqual(savedMethod.mappings, mappings);
  assert.deepEqual(savedMethod.source_config.sheet_header_overrides, parserConfig.sheet_header_overrides);
  assert.deepEqual(savedMethod.source_config.detected_schema.parser_config, parserConfig);
  assert.equal("rows" in savedMethod.source_config.detected_schema, false);
  assert.equal("parsed_rows" in savedMethod.source_config.detected_schema.sheets[0], false);

  const savedTemplate = savedWorkspace.templates.find(
    (template: any) => template.template_id === initialMethod.template_id
  );
  assert.ok(savedTemplate);
  assert.deepEqual(savedTemplate.mappings, mappings);

  const reloadedWorkspace = await getOrCreateWorkspace(testCustomer);
  const reloadedMethod = importMethod(reloadedWorkspace, "manual-xlsx");
  assert.deepEqual(reloadedMethod.mappings, mappings);
  assert.deepEqual(reloadedMethod.source_config.detected_schema, savedMethod.source_config.detected_schema);
  assert.equal((await readFile(testStorePath, "utf8")).includes("SHOULD_NOT_PERSIST"), false);
});

test("keeps mappings isolated across methods and normalizes legacy parser settings", async () => {
  const secondaryMappings = [{ sourceColumn: "PO", targetField: "order.po_number" }];
  const createdWorkspace = await updateImportMethod(
    testCustomer,
    "legacy-csv",
    {
      name: "Legacy CSV",
      type: "Manual upload",
      source: "XLSX",
      status: "Draft",
      output_route_id: "route-ltl-lift-91-standard-graphics",
      target_id: "lift-standard-graphics",
      target_template: "Lift / 91 Standard Graphics",
      template_id: "template-legacy-csv",
      mappings: secondaryMappings,
      source_config: {
        detected_schema: {
          source_file_name: "legacy.csv",
          selected_sheet_name: "Sheet1",
          columns: ["PO"],
          sheets: [
            {
              sheet_name: "Sheet1",
              columns: ["PO"],
              order_row_count: 1,
              reference_row_count: 0
            }
          ],
          detected_at: "2026-07-19T12:30:00.000Z",
          parser_config: {
            header_row: 1,
            header_row_count: 1,
            quantity_column: null,
            ignore_repeated_headers: true,
            reference_rows_mode: "ignore"
          }
        }
      },
      workbook_sheet_policy: "rows_with_quantity",
      product_resolution_config: {
        strategy: "source_column",
        mode: "normalized_key",
        source_column: "PO",
        prefix: "",
        suffix: "",
        composite_columns: [],
        fallback_strategy: "none"
      },
      created_at: "2026-07-19T12:30:00.000Z"
    } as any
  );

  const legacyMethod = importMethod(createdWorkspace, "legacy-csv");
  assert.deepEqual(legacyMethod.mappings, secondaryMappings);
  assert.deepEqual(legacyMethod.source_config.sheet_header_overrides, {});
  assert.deepEqual(legacyMethod.source_config.detected_schema.parser_config.sheet_header_overrides, {});

  const manualBefore = importMethod(createdWorkspace, "manual-xlsx");
  const updatedWorkspace = await updateImportMethod(testCustomer, "manual-xlsx", {
    source_config: { sample_template_name: "Regression template" }
  } as any);
  const manualAfter = importMethod(updatedWorkspace, "manual-xlsx");
  const legacyAfter = importMethod(updatedWorkspace, "legacy-csv");

  assert.deepEqual(manualAfter.mappings, manualBefore.mappings);
  assert.equal(manualAfter.source_config.sample_template_name, "Regression template");
  assert.deepEqual(legacyAfter.mappings, secondaryMappings);
  assert.equal(legacyAfter.source_config.sample_template_name, undefined);
});
