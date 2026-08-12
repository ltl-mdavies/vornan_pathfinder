import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

let testDirectory = "";
let testStorePath = "";
let getOrCreateWorkspace: typeof import("../src/store.ts")["getOrCreateWorkspace"];
let updateImportMethod: typeof import("../src/store.ts")["updateImportMethod"];
let reservePathfinderOrderNumber: typeof import("../src/store.ts")["reservePathfinderOrderNumber"];
let persistWrikeOperationsSnapshot: typeof import("../src/store.ts")["persistWrikeOperationsSnapshot"];
let listWrikeOperationsSnapshots: typeof import("../src/store.ts")["listWrikeOperationsSnapshots"];

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
  reservePathfinderOrderNumber = store.reservePathfinderOrderNumber;
  persistWrikeOperationsSnapshot = store.persistWrikeOperationsSnapshot;
  listWrikeOperationsSnapshots = store.listWrikeOperationsSnapshots;
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

function importMethod(workspace: any, methodId: string) {
  const method = workspace.import_methods.find((candidate: any) => candidate.import_method_id === methodId);
  assert.ok(method, `Expected import method ${methodId}`);
  return method;
}

test("reserves compact unique Pathfinder Order Numbers in local development", async () => {
  const orderNumbers = await Promise.all(
    Array.from({ length: 200 }, () => reservePathfinderOrderNumber())
  );

  assert.equal(new Set(orderNumbers).size, orderNumbers.length);
  assert.ok(orderNumbers.every((value) => /^PF[A-Z0-9]{12}$/.test(value)));
});

test("uses the Pathfinder Order Number for newly seeded Import Methods", async () => {
  const workspace = await getOrCreateWorkspace(testCustomer);
  assert.equal(importMethod(workspace, "manual-xlsx").ext_id_strategy, "pathfinder_generated");
});

test("persists a Wrike source contract without retaining credentials or weakening preview review", async () => {
  const initialWorkspace = await getOrCreateWorkspace(testCustomer);
  const basis = importMethod(initialWorkspace, "manual-xlsx");
  const savedWorkspace = await updateImportMethod(testCustomer, "wrike-momentara", {
    ...basis,
    import_method_id: "wrike-momentara",
    name: "Wrike - Momentara",
    type: "Scheduled",
    source: "Wrike",
    status: "Draft",
    template_id: "template-wrike-momentara",
    source_config: {
      ...basis.source_config,
      wrike: {
        enabled: false,
        folder_ids: [" IEABFOLDER ", " IEIBAFOLDER ", "IEABFOLDER"],
        folder_id: " IEABFOLDER ",
        approved_discovery_task_id: " IEABAPPROVEDTASK ",
        trigger_mode: "webhook_with_reconciliation",
        trigger_status_id: " IEABSENTTOPRINTLTL ",
        trigger_status_label: "Sent to Print - LTL",
        contract_number_custom_field_id: " IECONTRACT ",
        artwork_folder_custom_field_id: " IEARTWORK ",
        ltl_exception_custom_field_id: " IEEXCEPTION ",
        print_vendor_custom_field_id: " IEVENDOR ",
        order_task_identity_mode: "custom_item_type",
        order_task_title: " Placard Order ",
        order_task_custom_item_type_id: " IETYPEPLACARD ",
        required_print_vendor_value: " Larger Than Life ",
        reference_proof_intake: {
          enabled: true,
          filename_contains: " Proof ",
          attachment_selection: "all_matching_current_attachments",
          archive_file_name_template: "<contract_number>_referenceProofs.zip"
        },
        shipping_intake: {
          enabled: true,
          task_identity_mode: "custom_item_type",
          task_title: " Shipping Information ",
          custom_item_type_id: " IETYPESHIPPING ",
          trigger_status_id: " IEHAVEADDRESS ",
          trigger_status_label: " Have Address - LTL ",
          attachment_filename_contains: " Ship List ",
          attachment_extensions: ["xlsx", "csv"]
        },
        attachment_filename_contains: "Momentara order",
        attachment_extensions: ["xlsx", "csv"],
        attachment_selection: "newest_matching_workbook",
        poll_interval_minutes: 15,
        idempotency_strategy: "task_attachment_version",
        create_preview_only: true,
        access_token: "must-not-persist"
      } as any
    }
  });
  const saved = importMethod(savedWorkspace, "wrike-momentara");

  assert.equal(saved.source, "Wrike");
  assert.equal(saved.source_config.wrike.folder_id, "IEABFOLDER");
  assert.deepEqual(saved.source_config.wrike.folder_ids, ["IEABFOLDER", "IEIBAFOLDER"]);
  assert.equal(saved.source_config.wrike.approved_discovery_task_id, "IEABAPPROVEDTASK");
  assert.equal(saved.source_config.wrike.trigger_status_id, "IEABSENTTOPRINTLTL");
  assert.equal(saved.source_config.wrike.trigger_status_label, "Sent to Print - LTL");
  assert.equal(saved.source_config.wrike.contract_number_custom_field_id, "IECONTRACT");
  assert.equal(saved.source_config.wrike.artwork_folder_custom_field_id, "IEARTWORK");
  assert.equal(saved.source_config.wrike.ltl_exception_custom_field_id, "IEEXCEPTION");
  assert.equal(saved.source_config.wrike.print_vendor_custom_field_id, "IEVENDOR");
  assert.equal(saved.source_config.wrike.order_task_identity_mode, "custom_item_type");
  assert.equal(saved.source_config.wrike.order_task_title, "Placard Order");
  assert.equal(saved.source_config.wrike.order_task_custom_item_type_id, "IETYPEPLACARD");
  assert.equal(saved.source_config.wrike.required_print_vendor_value, "Larger Than Life");
  assert.deepEqual(saved.source_config.wrike.reference_proof_intake, {
    enabled: true,
    filename_contains: "Proof",
    attachment_extensions: ["pdf"],
    attachment_selection: "all_matching_current_attachments",
    archive_file_name_template: "<contract_number>_referenceProofs.zip"
  });
  assert.deepEqual(saved.source_config.wrike.shipping_intake, {
    enabled: false,
    task_identity_mode: "custom_item_type",
    task_title: "Shipping Information",
    custom_item_type_id: "IETYPESHIPPING",
    trigger_status_id: "IEHAVEADDRESS",
    trigger_status_label: "Have Address - LTL",
    attachment_filename_contains: "Ship List",
    attachment_extensions: ["xlsx", "csv"],
    attachment_selection: "all_matching_current_workbooks"
  });
  assert.equal(saved.source_config.wrike.task_title_rule, "contract_order_ooh");
  assert.equal(saved.source_config.wrike.workbook_name_rule, "contract_order_ooh");
  assert.equal(saved.source_config.wrike.attachment_selection, "all_matching_current_workbooks");
  assert.equal(saved.source_config.wrike.create_preview_only, true);
  assert.equal(saved.source_config.wrike.idempotency_strategy, "task_attachment_version");
  assert.equal("access_token" in saved.source_config.wrike, false);
});

test("persists bounded Wrike operations evidence without changing or losing customer configuration", async () => {
  const before = await getOrCreateWorkspace(testCustomer);
  const methodBefore = importMethod(before, "wrike-momentara");
  const originalUpdatedAt = methodBefore.updated_at;
  const originalFolders = methodBefore.source_config.wrike.folder_ids;
  const snapshot = {
    version: 1 as const,
    run_id: "wrike-run-regression",
    source: "scheduled" as const,
    customer_id: testCustomer.lift_customer_id,
    import_method_id: "wrike-momentara",
    checked_at: "2026-08-12T16:00:00.000Z",
    discovery_summary: {
      task_count: 10,
      scoped_task_count: 8,
      eligible_order_count: 1,
      pending_order_count: 2,
      placard_order_pending_count: 2,
      likely_pending_order_count: 1
    },
    root_scopes: [],
    pending_intake: [],
    prepared_count: 0,
    replayed_count: 0,
    failed_count: 0,
    candidate_failures: [],
    scheduled_submit: { eligible_count: 0, submitted_count: 0, replayed_count: 0, failed_count: 0 },
    status_writeback: { eligible_count: 0, posted_count: 0, replayed_count: 0, failed_count: 0 },
    safety: {
      lift_order_submitted: false,
      wrike_status_changed: false,
      uncertain_lift_retry_allowed: false
    }
  };

  await persistWrikeOperationsSnapshot(testCustomer, "wrike-momentara", snapshot);
  const persisted = await getOrCreateWorkspace(testCustomer);
  const methodAfterSnapshot = importMethod(persisted, "wrike-momentara");
  assert.equal(methodAfterSnapshot.updated_at, originalUpdatedAt);
  assert.deepEqual(methodAfterSnapshot.source_config.wrike.folder_ids, originalFolders);
  assert.equal(methodAfterSnapshot.wrike_operations_snapshot.run_id, snapshot.run_id);

  const staleClientPatch = { ...methodBefore, name: "Wrike - Momentara Saved Again" };
  const updated = await updateImportMethod(testCustomer, "wrike-momentara", staleClientPatch);
  assert.equal(importMethod(updated, "wrike-momentara").wrike_operations_snapshot.run_id, snapshot.run_id);

  const listed = await listWrikeOperationsSnapshots();
  assert.ok(listed.some((entry) =>
    entry.customer_id === testCustomer.lift_customer_id && entry.snapshot.run_id === snapshot.run_id
  ));
});

test("persists detected schemas and mappings without retaining workbook rows", async () => {
  const initialWorkspace = await getOrCreateWorkspace(testCustomer);
  const initialMethod = importMethod(initialWorkspace, "manual-xlsx");
  const mappings = [
    {
      sourceColumn: "Order Number",
      targetField: "order.external_order_id",
      scopeId: "Orders::orders-print-3",
      required: true
    },
    {
      sourceColumn: "SKU",
      targetField: "lines[].customer_sku",
      scopeId: "Orders::orders-print-3",
      required: true
    },
    {
      sourceColumn: "Description",
      targetField: "lines[].description",
      scopeId: "Orders::orders-print-3",
      ignored: true
    },
    {
      sourceColumn: "",
      targetField: "lines[].description",
      scopeId: "Orders::orders-print-3",
      valueExpression: {
        kind: "composite",
        sourceColumns: ["Description", "Creative"],
        separator: " — ",
        prefix: "",
        suffix: "",
        skipEmpty: true,
        fallback: null,
        maxLength: 250
      }
    }
  ];
  const workbookStructure = {
    Orders: {
      role: "order_lines",
      enabled: true,
      sections: [
        {
          section_id: "orders-print-3",
          label: "Printed products",
          line_kind: "print",
          header_row: 3,
          header_row_count: 1,
          header_signature: ["Order Number", "SKU", "Qty"],
          quantity_column: "Qty",
          quantity_value_rules: [{ source_value: "TBD", output_quantity: 0.5 }],
          missing_quantity_behavior: "block",
          required: true
        }
      ]
    },
    "Ship List": {
      role: "shipping_attachment",
      enabled: true,
      sections: []
    }
  } as const;
  const parserConfig = {
    header_row: null,
    header_row_count: 1,
    quantity_column: "Qty",
    ignore_repeated_headers: true,
    reference_rows_mode: "rows_without_quantity",
    sheet_header_overrides: {
      Catalog: { header_row: 2, header_row_count: 2 }
    },
    workbook_structure: workbookStructure
  };

  const savedWorkspace = await updateImportMethod(
    testCustomer,
    "manual-xlsx",
    {
      mappings,
      product_resolution_overrides: {
        "Orders::orders-print-3": {
          strategy: "direct_lift_unit_number",
          mode: "map_to_lift_unit",
          source_column: "SKU",
          direct_unit_number_column: "SKU",
          prefix: "",
          suffix: "",
          composite_columns: [],
          fallback_strategy: "none"
        }
      },
      source_config: {
        header_row: null,
        header_row_count: 1,
        quantity_column: "Qty",
        ignore_repeated_headers: true,
        reference_rows_mode: "rows_without_quantity",
        sheet_header_overrides: parserConfig.sheet_header_overrides,
        workbook_structure: workbookStructure,
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
              incomplete_row_count: 0,
              role: "order_lines",
              sections: [
                {
                  scope_id: "Orders::orders-print-3",
                  section_id: "orders-print-3",
                  label: "Printed products",
                  line_kind: "print",
                  columns: ["Order Number", "SKU", "Qty"],
                  header_row: 3,
                  header_row_count: 1,
                  quantity_column: "Qty",
                  quantity_value_rules: [{ source_value: "TBD", output_quantity: 0.5 }],
                  missing_quantity_behavior: "block",
                  order_row_count: 2,
                  reference_row_count: 0,
                  incomplete_row_count: 0
                }
              ],
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
  assert.deepEqual(savedMethod.source_config.workbook_structure, workbookStructure);
  assert.equal(
    savedMethod.product_resolution_overrides["Orders::orders-print-3"].direct_unit_number_column,
    "SKU"
  );
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

test("persists order name resolution independently for each import method", async () => {
  const before = await getOrCreateWorkspace(testCustomer);
  const secondaryBefore = importMethod(before, "legacy-csv").order_name_resolution_config;
  const orderNameConfig = {
    enabled: true,
    strategy: "provided_then_composite",
    provided_field: "order.order_title",
    components: [
      { field: "order.external_order_id", format: "none", optional: false },
      { kind: "text", field: "", value: "Empirical Web Order", format: "none", optional: false },
      { field: "source.submitted_at", format: "yyyyMMdd", optional: false }
    ],
    prefix: "REG",
    suffix: "",
    separator: "-",
    case: "upper",
    max_length: 80,
    duplicate_behavior: "block"
  };

  const saved = await updateImportMethod(testCustomer, "manual-xlsx", {
    order_name_resolution_config: orderNameConfig,
    ext_id_strategy: "pathfinder_generated"
  } as any);
  assert.deepEqual(importMethod(saved, "manual-xlsx").order_name_resolution_config, orderNameConfig);
  assert.equal(importMethod(saved, "manual-xlsx").ext_id_strategy, "pathfinder_generated");
  assert.deepEqual(importMethod(saved, "legacy-csv").order_name_resolution_config, secondaryBefore);
  assert.equal(importMethod(saved, "legacy-csv").ext_id_strategy, "pathfinder_generated");

  const reloaded = await getOrCreateWorkspace(testCustomer);
  assert.deepEqual(importMethod(reloaded, "manual-xlsx").order_name_resolution_config, orderNameConfig);
  assert.equal(importMethod(reloaded, "manual-xlsx").ext_id_strategy, "pathfinder_generated");
});

test("retains only the five most recent structural schema versions", async () => {
  const historyCustomer = {
    ...testCustomer,
    lift_customer_id: "regression-schema-history",
    customer_name: "Schema History Regression Customer"
  };
  await getOrCreateWorkspace(historyCustomer);

  const detectedSchema = (fileName: string, changingColumn: string, detectedAt: string) => ({
    source_file_name: fileName,
    selected_sheet_name: "Orders",
    columns: ["Order Number", changingColumn, "Qty"],
    sheets: [
      {
        sheet_name: "Orders",
        columns: ["Order Number", changingColumn, "Qty"],
        order_row_count: 1,
        reference_row_count: 0,
        header_row: 1,
        header_row_count: 1,
        parsed_rows: [{ values: { [changingColumn]: "HISTORY_RAW_VALUE" } }]
      }
    ],
    detected_at: detectedAt,
    parser_config: {
      header_row: 1,
      header_row_count: 1,
      quantity_column: "Qty",
      ignore_repeated_headers: true,
      reference_rows_mode: "rows_without_quantity",
      sheet_header_overrides: {}
    }
  });

  await updateImportMethod(historyCustomer, "manual-xlsx", {
    source_config: {
      detected_schema: detectedSchema("initial.xlsx", "SKU", "2026-07-19T13:00:00.000Z")
    }
  } as any);
  const sameStructureWorkspace = await updateImportMethod(historyCustomer, "manual-xlsx", {
    source_config: {
      detected_schema: detectedSchema("renamed-only.xlsx", "SKU", "2026-07-19T13:01:00.000Z")
    }
  } as any);
  assert.deepEqual(importMethod(sameStructureWorkspace, "manual-xlsx").source_config.detected_schema_history, []);

  let workspace = sameStructureWorkspace;
  for (let version = 1; version <= 6; version += 1) {
    workspace = await updateImportMethod(historyCustomer, "manual-xlsx", {
      source_config: {
        detected_schema: detectedSchema(
          `structure-${version}.xlsx`,
          `Customer Field ${version}`,
          `2026-07-19T13:0${version + 1}:00.000Z`
        )
      }
    } as any);
  }

  const method = importMethod(workspace, "manual-xlsx");
  assert.equal(method.source_config.detected_schema.source_file_name, "structure-6.xlsx");
  assert.equal(method.source_config.detected_schema_history.length, 5);
  assert.deepEqual(
    method.source_config.detected_schema_history.map((schema: any) => schema.source_file_name),
    ["structure-5.xlsx", "structure-4.xlsx", "structure-3.xlsx", "structure-2.xlsx", "structure-1.xlsx"]
  );
  assert.equal((await readFile(testStorePath, "utf8")).includes("HISTORY_RAW_VALUE"), false);
});
