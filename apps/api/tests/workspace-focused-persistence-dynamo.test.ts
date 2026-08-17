import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BatchWriteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";

type Command = BatchWriteItemCommand | GetItemCommand | ScanCommand | TransactWriteItemsCommand;
type Item = Record<string, AttributeValue>;

const commands: Command[] = [];
const tableItems = new Map<string, Item[]>();
let forceWorkspaceVersionDrift = false;
let catalogBatchCount = 0;
let failCatalogBatchAt: number | null = null;
let failCatalogReconciliationReads = false;
let injectCatalogCollisionAtWrite = false;
let catalogTransactionWriteCount = 0;
let failProductMappingWrite = false;
const tableNames = {
  customers: "Pathfinder-CUSTOMERS-focused",
  workspaces: "Pathfinder-CUSTOMER_WORKSPACES-focused",
  targets: "Pathfinder-TARGETS-focused",
  importMethods: "Pathfinder-IMPORT_METHODS-focused",
  outputRoutes: "Pathfinder-OUTPUT_ROUTES-focused",
  productMappings: "Pathfinder-PRODUCT_MAPPINGS-focused",
  jobs: "Pathfinder-JOBS-focused",
  orderIds: "Pathfinder-ORDER_IDS-focused",
  submitAttempts: "Pathfinder-SUBMIT_ATTEMPTS-focused",
  liftProductCache: "Pathfinder-LIFT_PRODUCT_CACHE-focused",
  orderStatusTokens: "Pathfinder-ORDER_STATUS_TOKENS-focused",
  orderStatusSnapshots: "Pathfinder-ORDER_STATUS_SNAPSHOTS-focused",
  canonicalRegistry: "Pathfinder-CANONICAL_REGISTRY-focused"
};

const customer = {
  lift_customer_id: "1249",
  customer_name: "LTL Demo",
  customer_number: "0000000152",
  customer_type: "Standard",
  customer_status: "Regular",
  sales_rep: "Pablo Picasso",
  default_invoice_email_address: null,
  created_date: "2016-09-07",
  crm_id: null,
  terms: null,
  terms_status: null,
  credit_limit: null,
  credit_hold: null,
  unpaid_total: null,
  available_credit: null
};

function stringValue(value: string) {
  return { S: value };
}

function dataItem(keys: Record<string, string>, data: unknown): Item {
  return {
    ...Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, stringValue(value)])),
    data: stringValue(JSON.stringify(data)),
    updated_at: stringValue(new Date().toISOString())
  };
}

function keyNamesForTable(tableName: string) {
  if (tableName === tableNames.importMethods) return ["customer_id", "import_method_id"];
  if (tableName === tableNames.outputRoutes) return ["customer_id", "output_route_id"];
  if (tableName === tableNames.liftProductCache) return ["route_environment_id", "product_id"];
  if (tableName === tableNames.productMappings) return ["customer_route_id", "mapping_id"];
  if (tableName === tableNames.targets) return ["target_id"];
  return ["customer_id"];
}

function matchesKey(item: Item, key: Item) {
  return Object.entries(key).every(([name, value]) => item[name]?.S === value.S);
}

const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: Command): Promise<unknown>;
};
const originalSend = clientPrototype.send;

let getOrCreateWorkspace: typeof import("../src/store.ts")["getOrCreateWorkspace"];
let updateImportMethod: typeof import("../src/store.ts")["updateImportMethod"];
let updateOutputRoute: typeof import("../src/store.ts")["updateOutputRoute"];
let updateProductMapping: typeof import("../src/store.ts")["updateProductMapping"];
let upsertCatalogPreset: typeof import("../src/store.ts")["upsertCatalogPreset"];
let deleteCatalogPreset: typeof import("../src/store.ts")["deleteCatalogPreset"];
let upsertLiftProductCatalog: typeof import("../src/store.ts")["upsertLiftProductCatalog"];
let normalizeLiftProductPayloadItems: typeof import("../src/server.ts")["normalizeLiftProductPayloadItems"];

before(async () => {
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = "/tmp/pathfinder-focused-persistence-secrets.json";
  Object.assign(process.env, {
    PATHFINDER_CUSTOMERS_TABLE: tableNames.customers,
    PATHFINDER_CUSTOMER_WORKSPACES_TABLE: tableNames.workspaces,
    PATHFINDER_TARGETS_TABLE: tableNames.targets,
    PATHFINDER_IMPORT_METHODS_TABLE: tableNames.importMethods,
    PATHFINDER_OUTPUT_ROUTES_TABLE: tableNames.outputRoutes,
    PATHFINDER_PRODUCT_MAPPINGS_TABLE: tableNames.productMappings,
    PATHFINDER_JOBS_TABLE: tableNames.jobs,
    PATHFINDER_ORDER_IDS_TABLE: tableNames.orderIds,
    PATHFINDER_SUBMIT_ATTEMPTS_TABLE: tableNames.submitAttempts,
    PATHFINDER_LIFT_PRODUCT_CACHE_TABLE: tableNames.liftProductCache,
    PATHFINDER_ORDER_STATUS_TOKENS_TABLE: tableNames.orderStatusTokens,
    PATHFINDER_ORDER_STATUS_SNAPSHOTS_TABLE: tableNames.orderStatusSnapshots,
    PATHFINDER_CANONICAL_REGISTRY_TABLE: tableNames.canonicalRegistry
  });

  const target = {
    target_id: "lift-standard-graphics",
    updated_at: "2026-08-14T00:00:00.000Z"
  };
  tableItems.set(
    tableNames.targets,
    [dataItem({ target_id: target.target_id }, target)]
  );

  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof ScanCommand) {
      return { Items: structuredClone(tableItems.get(command.input.TableName!) ?? []) };
    }
    if (command instanceof GetItemCommand) {
      if (
        failCatalogReconciliationReads &&
        command.input.TableName === tableNames.liftProductCache &&
        failCatalogBatchAt !== null &&
        catalogBatchCount >= failCatalogBatchAt
      ) {
        throw new Error("simulated cache reconciliation read failure");
      }
      const item = (tableItems.get(command.input.TableName!) ?? []).find((candidate) =>
        matchesKey(candidate, command.input.Key as Item)
      );
      if (item && forceWorkspaceVersionDrift && command.input.TableName === tableNames.workspaces) {
        const drifted = structuredClone(item);
        const data = JSON.parse(drifted.data.S!) as { updated_at?: string };
        data.updated_at = "2099-01-01T00:00:00.000Z";
        drifted.data = stringValue(JSON.stringify(data));
        return { Item: drifted };
      }
      return { Item: item ? structuredClone(item) : undefined };
    }
    if (command instanceof TransactWriteItemsCommand) {
      const productMappingTransactions = (command.input.TransactItems ?? []).filter(
        (transaction) => transaction.Put?.TableName === tableNames.productMappings
      );
      if (failProductMappingWrite && productMappingTransactions.length > 0) {
        const error = new Error("simulated product mapping persistence failure");
        error.name = "ProvisionedThroughputExceededException";
        throw error;
      }
      const catalogTransactions = (command.input.TransactItems ?? []).filter(
        (transaction) => transaction.Put?.TableName === tableNames.liftProductCache
      );
      if (catalogTransactions.length > 0) {
        catalogBatchCount += 1;
        if (injectCatalogCollisionAtWrite) {
          injectCatalogCollisionAtWrite = false;
          const intended = catalogTransactions[0].Put!.Item as Item;
          const conflictingData = JSON.parse(intended.data.S!) as {
            catalog_id?: string;
            catalog_item_id?: string;
          };
          conflictingData.catalog_id = "8102";
          conflictingData.catalog_item_id = "concurrent-different-catalog";
          const conflicting = {
            ...structuredClone(intended),
            data: stringValue(JSON.stringify(conflictingData)),
            catalog_scope: stringValue("8102")
          };
          delete conflicting.catalog_refresh_id;
          const current = tableItems.get(tableNames.liftProductCache) ?? [];
          const key = {
            route_environment_id: intended.route_environment_id,
            product_id: intended.product_id
          } as Item;
          tableItems.set(tableNames.liftProductCache, [
            conflicting,
            ...current.filter((candidate) => !matchesKey(candidate, key))
          ]);
        }
        if (failCatalogBatchAt === catalogBatchCount) {
          const error = new Error("simulated cache persistence failure");
          error.name = "ProvisionedThroughputExceededException";
          throw error;
        }
        const conditionFailed = catalogTransactions.some((transaction) => {
          const put = transaction.Put!;
          const item = put.Item as Item;
          const key = {
            route_environment_id: item.route_environment_id,
            product_id: item.product_id
          } as Item;
          const existing = (tableItems.get(tableNames.liftProductCache) ?? []).find((candidate) =>
            matchesKey(candidate, key)
          );
          if (!existing) return false;
          if (put.ConditionExpression?.includes("attribute_not_exists(#partition_key)")) {
            return true;
          }
          if (put.ConditionExpression === "#catalog_scope = :catalog_scope") {
            return existing.catalog_scope?.S !== put.ExpressionAttributeValues?.[":catalog_scope"]?.S;
          }
          return (
            existing.catalog_scope !== undefined ||
            existing.data?.S !== put.ExpressionAttributeValues?.[":expected_data"]?.S
          );
        });
        if (conditionFailed) {
          const error = new Error("simulated catalog ownership conflict");
          error.name = "TransactionCanceledException";
          throw error;
        }
      }
      for (const transaction of command.input.TransactItems ?? []) {
        const put = transaction.Put;
        if (!put?.TableName || !put.Item) continue;
        const keys = keyNamesForTable(put.TableName);
        const key = Object.fromEntries(keys.map((name) => [name, put.Item![name]])) as Item;
        const current = tableItems.get(put.TableName) ?? [];
        tableItems.set(put.TableName, [
          structuredClone(put.Item as Item),
          ...current.filter((candidate) => !matchesKey(candidate, key))
        ]);
      }
      catalogTransactionWriteCount += catalogTransactions.length;
      return {};
    }
    if (command instanceof BatchWriteItemCommand) {
      const requests = command.input.RequestItems ?? {};
      if (requests[tableNames.liftProductCache]) {
        catalogBatchCount += 1;
        if (failCatalogBatchAt === catalogBatchCount) {
          const error = new Error("simulated cache persistence failure");
          error.name = "ProvisionedThroughputExceededException";
          throw error;
        }
      }
      for (const [tableName, writes] of Object.entries(requests)) {
        const current = tableItems.get(tableName) ?? [];
        const next = [...current];
        for (const write of writes ?? []) {
          const item = write.PutRequest?.Item as Item | undefined;
          if (!item) continue;
          const key = Object.fromEntries(
            keyNamesForTable(tableName).map((name) => [name, item[name]])
          ) as Item;
          const existingIndex = next.findIndex((candidate) => matchesKey(candidate, key));
          if (existingIndex >= 0) next.splice(existingIndex, 1);
          next.push(structuredClone(item));
        }
        tableItems.set(tableName, next);
      }
      return { UnprocessedItems: {} };
    }
    return {};
  };

  ({
    getOrCreateWorkspace,
    updateImportMethod,
    updateOutputRoute,
    updateProductMapping,
    upsertCatalogPreset,
    deleteCatalogPreset,
    upsertLiftProductCatalog
  } =
    await import("../src/store.ts"));
  ({ normalizeLiftProductPayloadItems } = await import("../src/server.ts"));
});

beforeEach(() => {
  commands.length = 0;
  forceWorkspaceVersionDrift = false;
  catalogBatchCount = 0;
  failCatalogBatchAt = null;
  failCatalogReconciliationReads = false;
  injectCatalogCollisionAtWrite = false;
  catalogTransactionWriteCount = 0;
  failProductMappingWrite = false;
});

after(() => {
  clientPrototype.send = originalSend;
});

function transactionTables() {
  return commands
    .filter((command): command is TransactWriteItemsCommand => command instanceof TransactWriteItemsCommand)
    .flatMap((command) => command.input.TransactItems ?? [])
    .map((item) => item.Put?.TableName)
    .filter((name): name is string => Boolean(name));
}

function catalogItem(index: number, catalogId: string, status: "Active" | "Inactive" = "Active") {
  return {
    catalog_item_id: `lift-standard-graphics-91-env-lift-${catalogId}-product-${catalogId}-${index}`,
    product_id: `${catalogId}${String(index).padStart(3, "0")}`,
    unit_number: `UNIT-${catalogId}-${index}`,
    unit_numbers: [`UNIT-${catalogId}-${index}`],
    product_name: `Catalog ${catalogId} Product ${index}`,
    company_id: "91",
    target_id: "lift-standard-graphics",
    environment_id: "env-lift-qa1",
    catalog_id: catalogId,
    status,
    source: "Lift import" as const,
    updated_at: "2026-08-14T00:00:00.000Z"
  };
}

function seedCatalogBaseline() {
  const baseline = [
    ...Array.from({ length: 334 }, (_, index) => catalogItem(index, "8102")),
    ...Array.from({ length: 3 }, (_, index) => catalogItem(index, "other"))
  ];
  tableItems.set(
    tableNames.liftProductCache,
    baseline.map((item) =>
      dataItem(
        {
          route_environment_id: `${item.target_id}#${item.environment_id}#${item.company_id}`,
          product_id: item.product_id
        },
        item
      )
    )
  );
  return baseline;
}

function storedCatalogItems() {
  return (tableItems.get(tableNames.liftProductCache) ?? []).map((item) =>
    JSON.parse(item.data.S!) as ReturnType<typeof catalogItem>
  );
}

test("creates one isolated customer workspace without rewriting Jobs or cache tables", async () => {
  const workspace = await getOrCreateWorkspace(customer);

  assert.equal(workspace.customer.lift_customer_id, "1249");
  assert.deepEqual(workspace.import_methods[0].product_resolution_config, {
    strategy: "derived_key",
    mode: "map_to_lift_unit",
    source_column: "",
    prefix: "",
    suffix: "",
    composite_columns: [],
    fallback_strategy: "none",
    direct_unit_number_column: null
  });
  assert.deepEqual(workspace.catalog_presets, []);
  assert.deepEqual(new Set(transactionTables()), new Set([
    tableNames.customers,
    tableNames.workspaces,
    tableNames.importMethods,
    tableNames.outputRoutes
  ]));
  assert.ok(!transactionTables().includes(tableNames.jobs));
  assert.ok(!transactionTables().includes(tableNames.liftProductCache));

  commands.length = 0;
  const existing = await getOrCreateWorkspace(customer);
  assert.equal(existing.customer.lift_customer_id, "1249");
  assert.equal(transactionTables().length, 0, "idempotent retry must not write setup again");
});

test("saves an Import Method through only its workspace and method records", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  const templateBefore = workspace.templates.find(
    (template) => template.template_id === "template_manual_xlsx_v1"
  );
  assert.ok(templateBefore);
  assert.equal(templateBefore.status, "Draft");
  commands.length = 0;

  const saved = await updateImportMethod(customer, "manual-xlsx", {
    ...workspace.import_methods.find((method) => method.import_method_id === "manual-xlsx")!,
    name: "LTL Demo Manual XLSX"
  });

  const templateAfter = saved.templates.find(
    (template) => template.template_id === "template_manual_xlsx_v1"
  );
  assert.ok(templateAfter);
  assert.deepEqual(templateAfter, templateBefore);

  assert.deepEqual(new Set(transactionTables()), new Set([
    tableNames.workspaces,
    tableNames.importMethods
  ]));
  assert.ok(!transactionTables().includes(tableNames.jobs));
  assert.ok(!transactionTables().includes(tableNames.liftProductCache));
});

test("creates a missing legacy template mirror as Draft through the focused method save", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  const workspaceItem = (tableItems.get(tableNames.workspaces) ?? []).find(
    (item) => item.customer_id?.S === customer.lift_customer_id
  );
  assert.ok(workspaceItem?.data.S);
  const workspaceWithoutTemplate = JSON.parse(workspaceItem.data.S);
  workspaceWithoutTemplate.templates = workspaceWithoutTemplate.templates.filter(
    (template: { template_id?: string }) => template.template_id !== "template_manual_xlsx_v1"
  );
  workspaceItem.data = stringValue(JSON.stringify(workspaceWithoutTemplate));
  commands.length = 0;

  const methodBefore = workspace.import_methods.find(
    (method) => method.import_method_id === "manual-xlsx"
  );
  assert.ok(methodBefore);
  const saved = await updateImportMethod(customer, "manual-xlsx", {
    product_resolution_config: {
      ...methodBefore.product_resolution_config,
      source_column: ""
    }
  });

  const methodAfter = saved.import_methods.find(
    (method) => method.import_method_id === "manual-xlsx"
  );
  const templateAfter = saved.templates.find(
    (template) => template.template_id === "template_manual_xlsx_v1"
  );
  assert.ok(methodAfter);
  assert.ok(templateAfter);
  assert.equal(templateAfter.status, "Draft");
  assert.deepEqual(templateAfter.mappings, methodAfter.mappings);
  assert.deepEqual(new Set(transactionTables()), new Set([
    tableNames.workspaces,
    tableNames.importMethods
  ]));
  assert.ok(!transactionTables().includes(tableNames.jobs));
  assert.ok(!transactionTables().includes(tableNames.liftProductCache));
});

test("saves an Output Route through only its workspace, route, and linked method records", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes[0];
  commands.length = 0;

  await updateOutputRoute(customer, route.output_route_id, {
    ...route,
    name: "LTL Demo Isolated Route"
  });

  assert.deepEqual(new Set(transactionTables()), new Set([
    tableNames.workspaces,
    tableNames.outputRoutes,
    tableNames.importMethods
  ]));
  assert.ok(!transactionTables().includes(tableNames.jobs));
  assert.ok(!transactionTables().includes(tableNames.liftProductCache));
});

test("approves exactly one customer-route product mapping without rewriting any other table", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes[0];
  commands.length = 0;

  const saved = await updateProductMapping(customer, "mapping-1249-one-sheet", {
    output_route_id: route.output_route_id,
    customer_product_key: "ONE_SHEET_30_375X46_375",
    display_label: "One Sheet",
    source_columns: ["Product"],
    product_identifier_value: "348390",
    lift_product_id: "348390",
    product_name: "One Sheet",
    status: "Mapped",
    mapping_source: "Observed order"
  });

  assert.equal(saved.changed, true);
  assert.equal(saved.product_mapping.product_identifier_value, "348390");
  assert.deepEqual(new Set(transactionTables()), new Set([tableNames.productMappings]));
  assert.ok(!transactionTables().includes(tableNames.jobs));
  assert.ok(!transactionTables().includes(tableNames.workspaces));
  assert.ok(!transactionTables().includes(tableNames.outputRoutes));
  assert.ok(!transactionTables().includes(tableNames.importMethods));
  assert.ok(!transactionTables().includes(tableNames.liftProductCache));

  commands.length = 0;
  const repeated = await updateProductMapping(customer, "mapping-1249-one-sheet", {
    output_route_id: route.output_route_id,
    customer_product_key: "ONE_SHEET_30_375X46_375",
    display_label: "One Sheet",
    source_columns: ["Product"],
    product_identifier_value: "348390",
    lift_product_id: "348390",
    product_name: "One Sheet",
    status: "Mapped",
    mapping_source: "Observed order"
  });
  assert.equal(repeated.changed, false);
  assert.equal(transactionTables().length, 0, "an identical approval must be a no-op");
});

test("a failed focused product mapping write never falls through to another table", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes[0];
  commands.length = 0;
  failProductMappingWrite = true;

  await assert.rejects(
    updateProductMapping(customer, "mapping-1249-failed", {
      output_route_id: route.output_route_id,
      customer_product_key: "PUMP_TOPPER_CHEVRON",
      display_label: "Pump Topper Chevron",
      source_columns: ["Product"],
      product_identifier_value: "348392",
      lift_product_id: "348392",
      product_name: "Pump Topper Chevron",
      status: "Mapped"
    }),
    { name: "ProvisionedThroughputExceededException" }
  );

  assert.deepEqual(new Set(transactionTables()), new Set([tableNames.productMappings]));
  assert.ok(!transactionTables().includes(tableNames.jobs));
  assert.ok(!transactionTables().includes(tableNames.workspaces));
  assert.ok(!transactionTables().includes(tableNames.liftProductCache));
});

test("fails closed before a transaction when the selected workspace changed concurrently", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  commands.length = 0;
  forceWorkspaceVersionDrift = true;

  await assert.rejects(
    updateImportMethod(customer, "manual-xlsx", {
      ...workspace.import_methods.find((method) => method.import_method_id === "manual-xlsx")!,
      name: "Stale update must not persist"
    }),
    { name: "WorkspacePersistenceConflictError" }
  );

  assert.equal(transactionTables().length, 0);
});

test("saves and deletes catalog presets through only the selected workspace record", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes[0];
  commands.length = 0;

  const saved = await upsertCatalogPreset(
    customer,
    {
      preset_id: "catalog-preset-1249-6338",
      output_route_id: route.output_route_id,
      target_id: route.target_id,
      catalog_id: "6338",
      catalog_name: "LTL Demo catalog",
      status: "Active"
    },
    workspace.updated_at
  );

  assert.equal(saved.changed, true);
  assert.deepEqual(new Set(transactionTables()), new Set([tableNames.workspaces]));
  assert.ok(!transactionTables().includes(tableNames.jobs));
  assert.ok(!transactionTables().includes(tableNames.liftProductCache));
  assert.ok(!transactionTables().includes(tableNames.productMappings));
  assert.ok(!transactionTables().includes(tableNames.importMethods));
  assert.ok(!transactionTables().includes(tableNames.outputRoutes));

  commands.length = 0;
  const repeatedSave = await upsertCatalogPreset(
    customer,
    {
      preset_id: "catalog-preset-1249-6338",
      output_route_id: route.output_route_id,
      target_id: route.target_id,
      catalog_id: "6338",
      catalog_name: "LTL Demo catalog",
      status: "Active"
    },
    workspace.updated_at
  );
  assert.equal(repeatedSave.changed, false);
  assert.equal(transactionTables().length, 0);

  commands.length = 0;
  const deleted = await deleteCatalogPreset(customer, "catalog-preset-1249-6338", {
    output_route_id: route.output_route_id,
    expected_workspace_updated_at: saved.workspace.updated_at
  });
  assert.equal(deleted.changed, true);
  assert.deepEqual(new Set(transactionTables()), new Set([tableNames.workspaces]));

  commands.length = 0;
  const repeatedDelete = await deleteCatalogPreset(customer, "catalog-preset-1249-6338", {
    output_route_id: route.output_route_id,
    expected_workspace_updated_at: saved.workspace.updated_at
  });
  assert.equal(repeatedDelete.changed, false);
  assert.equal(transactionTables().length, 0);
});

test("catalog preset writes fail closed when the selected workspace changed concurrently", async () => {
  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes[0];
  commands.length = 0;
  forceWorkspaceVersionDrift = true;

  await assert.rejects(
    upsertCatalogPreset(
      customer,
      {
        preset_id: "catalog-preset-stale-6338",
        output_route_id: route.output_route_id,
        target_id: route.target_id,
        catalog_id: "6338",
        catalog_name: "Stale preset",
        status: "Active"
      },
      workspace.updated_at
    ),
    { name: "WorkspacePersistenceConflictError" }
  );
  assert.equal(transactionTables().length, 0);
});

test("API workspace failures are sanitized and state that no external order effect occurred", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(source, /workspace_setup_required/);
  assert.match(source, /workspace_temporarily_unavailable/);
  assert.match(source, /No preview or Lift order was submitted/);
  assert.match(source, /app\.post\("\/api\/customers\/:liftCustomerId\/workspace"/);
  assert.doesNotMatch(
    source,
    /app\.get\("\/api\/customers\/:liftCustomerId\/workspace"[\s\S]{0,900}error instanceof Error \? error\.message/
  );
});

test("catalog preset API failures are sanitized and report no external effect", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(source, /catalog_preset_persistence_complete/);
  assert.match(source, /catalog_preset_save_conflict/);
  assert.match(source, /catalog_preset_temporarily_unavailable/);
  assert.match(source, /Existing customer settings were preserved/);
  assert.match(source, /external_effects: false/);
  assert.doesNotMatch(
    source,
    /app\.put\("\/api\/customers\/:liftCustomerId\/catalog-presets\/:presetId"[\s\S]{0,2400}error instanceof Error \? error\.message/
  );
});

test("normalizes the observed camelCase Lift product shape including unitNumber arrays", () => {
  const [active] = normalizeLiftProductPayloadItems(
    {
      productId: 6338001,
      productName: "LTL Demo Active Product",
      catalogId: 6338,
      catalogName: "LTL Demo",
      unitNumber: ["LTL-DEMO-1", "LTL-DEMO-1-ALT"],
      status: "A"
    },
    { targetId: "lift-standard-graphics", environmentId: "env-lift-qa1", companyId: "91" }
  );
  const [inactive] = normalizeLiftProductPayloadItems(
    {
      productId: 6338002,
      productName: "LTL Demo Inactive Product",
      catalogId: 6338,
      unitNumber: ["LTL-DEMO-2"],
      status: "I"
    },
    { targetId: "lift-standard-graphics", environmentId: "env-lift-qa1", companyId: "91" }
  );

  assert.equal(active.product_id, "6338001");
  assert.equal(active.catalog_id, "6338");
  assert.equal(active.unit_number, "LTL-DEMO-1");
  assert.deepEqual(active.unit_numbers, ["LTL-DEMO-1", "LTL-DEMO-1-ALT"]);
  assert.equal(active.status, "Active");
  assert.equal(inactive.status, "Inactive");
});

test("upserts only exact Lift product-cache rows and preserves the existing 337-row baseline", async () => {
  const baseline = seedCatalogBaseline();
  const baselineById = new Map(baseline.map((item) => [item.product_id, item]));
  const demoProducts = Array.from(
    { length: 18 },
    (_, index) => catalogItem(index, "6338", index === 17 ? "Inactive" : "Active")
  );
  commands.length = 0;

  const persisted = await upsertLiftProductCatalog(demoProducts);
  const stored = storedCatalogItems();

  assert.equal(persisted.length, 18);
  assert.equal(stored.length, 355);
  assert.equal(stored.filter((item) => item.catalog_id === "8102").length, 334);
  assert.equal(stored.filter((item) => item.catalog_id === "6338").length, 18);
  assert.equal(stored.filter((item) => item.catalog_id === "6338" && item.status === "Inactive").length, 1);
  baselineById.forEach((expected, productId) => {
    assert.deepEqual(stored.find((item) => item.product_id === productId), expected);
  });

  const writtenTables = transactionTables();
  assert.deepEqual(new Set(writtenTables), new Set([tableNames.liftProductCache]));
  const writtenCacheRows = commands
    .filter((command): command is TransactWriteItemsCommand => command instanceof TransactWriteItemsCommand)
    .flatMap((command) => command.input.TransactItems ?? [])
    .filter((transaction) => transaction.Put?.TableName === tableNames.liftProductCache)
    .map((transaction) => transaction.Put?.Item as Item);
  assert.equal(writtenCacheRows.length, 18);
  assert.equal(new Set(writtenCacheRows.map((item) => item.catalog_refresh_id.S)).size, 1);
  assert.match(writtenCacheRows[0].catalog_refresh_id.S!, /^[a-f0-9]{32}$/);
  writtenCacheRows.forEach((item) => {
    const data = JSON.parse(item.data.S!) as ReturnType<typeof catalogItem>;
    assert.equal(item.catalog_scope.S, data.catalog_id);
    assert.equal(
      item.route_environment_id.S,
      `${data.target_id}#${data.environment_id}#${data.company_id}`
    );
    assert.equal(item.product_id.S, data.product_id);
  });
  assert.ok(!writtenTables.includes(tableNames.jobs));
  assert.ok(!writtenTables.includes(tableNames.productMappings));
  assert.equal(commands.some((command) => command instanceof ScanCommand), false);

  commands.length = 0;
  const replayed = await upsertLiftProductCatalog(demoProducts);
  assert.equal(replayed.length, 18);
  assert.equal(storedCatalogItems().length, 355, "a repeated refresh must overwrite exact keys, not duplicate rows");
});

test("a cross-catalog cache identity collision writes nothing", async () => {
  seedCatalogBaseline();
  const existing = catalogItem(0, "8102");
  const incoming = {
    ...catalogItem(0, "6338"),
    product_id: existing.product_id,
    catalog_item_id: "incoming-cross-catalog-collision"
  };
  const before = structuredClone(tableItems.get(tableNames.liftProductCache));
  commands.length = 0;

  let collisionError: unknown;
  try {
    await upsertLiftProductCatalog([incoming]);
  } catch (error) {
    collisionError = error;
  }

  assert.equal((collisionError as { name?: string }).name, "LiftProductCatalogCollisionError");
  assert.equal((collisionError as { collision_count?: number }).collision_count, 1);
  assert.equal((collisionError as { requested_count?: number }).requested_count, 1);
  assert.deepEqual(tableItems.get(tableNames.liftProductCache), before);
  assert.equal(
    commands.some((command) => command instanceof BatchWriteItemCommand),
    false,
    "collision detection must complete before the first cache write"
  );
  const collisionReads = commands.filter(
    (command): command is GetItemCommand => command instanceof GetItemCommand
  );
  assert.equal(collisionReads.length, 1);
  assert.equal(collisionReads[0].input.ConsistentRead, true);
  assert.deepEqual(new Set(transactionTables()), new Set());
});

test("a write-time cross-catalog race is rejected atomically before the cache transaction writes", async () => {
  seedCatalogBaseline();
  const incoming = catalogItem(75, "6338");
  injectCatalogCollisionAtWrite = true;
  commands.length = 0;

  let collisionError: unknown;
  try {
    await upsertLiftProductCatalog([incoming]);
  } catch (error) {
    collisionError = error;
  }

  assert.equal((collisionError as { name?: string }).name, "LiftProductCatalogCollisionError");
  assert.equal((collisionError as { collision_count?: number }).collision_count, 1);
  assert.equal(
    (collisionError as { definitely_persisted_count?: number }).definitely_persisted_count,
    0
  );
  assert.equal(catalogTransactionWriteCount, 0);
  const stored = storedCatalogItems().find((item) => item.product_id === incoming.product_id);
  assert.equal(stored?.catalog_id, "8102");
  assert.notEqual(stored?.catalog_item_id, incoming.catalog_item_id);
});

test("the same product identity remains isolated between QA1 and PROD", async () => {
  seedCatalogBaseline();
  const qa1 = catalogItem(0, "8102");
  const prod = {
    ...catalogItem(0, "6338"),
    product_id: qa1.product_id,
    catalog_item_id: "prod-same-product-id",
    environment_id: "env-lift-prod"
  };
  commands.length = 0;

  const persisted = await upsertLiftProductCatalog([prod]);
  const stored = storedCatalogItems();

  assert.equal(persisted.length, 1);
  assert.equal(stored.length, 338);
  assert.equal(
    stored.filter((item) => item.product_id === qa1.product_id && item.environment_id === "env-lift-qa1").length,
    1
  );
  assert.equal(
    stored.filter((item) => item.product_id === qa1.product_id && item.environment_id === "env-lift-prod").length,
    1
  );
});

test("conflicting catalogs inside one provider response are rejected before cache reads or writes", async () => {
  seedCatalogBaseline();
  const first = { ...catalogItem(50, "6338"), product_id: "shared-provider-product" };
  const second = { ...catalogItem(51, "8102"), product_id: "shared-provider-product" };
  commands.length = 0;

  await assert.rejects(
    () => upsertLiftProductCatalog([first, second]),
    (error: unknown) =>
      (error as { name?: string }).name === "LiftProductCatalogCollisionError" &&
      (error as { collision_count?: number }).collision_count === 1
  );

  assert.equal(commands.length, 0);
});

test("a partial cache write failure cannot remove or rewrite existing catalog rows", async () => {
  const baseline = seedCatalogBaseline();
  const baselineById = new Map(baseline.map((item) => [item.product_id, item]));
  const nextProducts = Array.from({ length: 30 }, (_, index) => catalogItem(index, "6338"));
  failCatalogBatchAt = 2;

  let persistenceError: unknown;
  try {
    await upsertLiftProductCatalog(nextProducts);
  } catch (error) {
    persistenceError = error;
  }

  assert.equal((persistenceError as { name?: string }).name, "LiftProductCatalogPersistenceError");
  assert.equal((persistenceError as { persistence_outcome?: string }).persistence_outcome, "partial");
  assert.equal((persistenceError as { definitely_persisted_count?: number }).definitely_persisted_count, 25);
  assert.equal((persistenceError as { requested_count?: number }).requested_count, 30);

  const stored = storedCatalogItems();
  baselineById.forEach((expected, productId) => {
    assert.deepEqual(stored.find((item) => item.product_id === productId), expected);
  });
  assert.equal(stored.filter((item) => item.catalog_id === "8102").length, 334);
  assert.equal(stored.length, 362, "only the first additive batch may persist before a later batch fails");
  const writtenTables = transactionTables();
  assert.deepEqual(new Set(writtenTables), new Set([tableNames.liftProductCache]));
});

test("a failed exact-key reconciliation reports only definitely completed batches as uncertain", async () => {
  const baseline = seedCatalogBaseline();
  const nextProducts = Array.from({ length: 30 }, (_, index) => catalogItem(index, "6338"));
  failCatalogBatchAt = 2;
  failCatalogReconciliationReads = true;

  let persistenceError: unknown;
  try {
    await upsertLiftProductCatalog(nextProducts);
  } catch (error) {
    persistenceError = error;
  }

  assert.equal((persistenceError as { name?: string }).name, "LiftProductCatalogPersistenceError");
  assert.equal((persistenceError as { persistence_outcome?: string }).persistence_outcome, "uncertain");
  assert.equal((persistenceError as { definitely_persisted_count?: number }).definitely_persisted_count, 25);
  assert.equal((persistenceError as { requested_count?: number }).requested_count, 30);
  assert.equal(storedCatalogItems().length, baseline.length + 25);
});

test("catalog refresh failures use bounded telemetry and never return raw provider or Dynamo errors", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const route = source.slice(
    source.indexOf('app.get("/api/lift/product-catalog"'),
    source.indexOf('app.post("/api/lift/preview"')
  );

  assert.match(source, /Namespace: "Pathfinder\/LiftProductCatalog"/);
  assert.match(source, /table_class: "lift_product_cache"/);
  assert.match(route, /Existing cached products were preserved/);
  assert.match(route, /No preview or Lift order was submitted/);
  assert.match(route, /error instanceof LiftProductCatalogPersistenceError/);
  assert.match(route, /persisted_count: persistedCount/);
  assert.match(route, /"partially_persisted"/);
  assert.match(route, /"persistence_uncertain"/);
  assert.match(route, /"catalog_identity_collision"/);
  assert.match(route, /lift_catalog_cross_catalog_identity_collision/);
  assert.match(route, /Nothing was saved/);
  assert.match(source, /CatalogIdentityCollision/);
  assert.match(source, /collision_count/);
  assert.match(route, /const workspace = await getWorkspace\(customerId\)/);
  assert.match(route, /targetId = selectedRoute\.target_id/);
  assert.match(route, /environmentIdFilter = selectedRoute\.environment_id/);
  assert.match(route, /companyId = selectedRoute\.company_id/);
  assert.doesNotMatch(route, /getOrCreateWorkspace\(customer\)/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
});
