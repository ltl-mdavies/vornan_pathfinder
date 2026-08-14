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
        command.input.TableName === tableNames.liftProductCache
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

  ({ getOrCreateWorkspace, updateImportMethod, updateOutputRoute, upsertLiftProductCatalog } =
    await import("../src/store.ts"));
  ({ normalizeLiftProductPayloadItems } = await import("../src/server.ts"));
});

beforeEach(() => {
  commands.length = 0;
  forceWorkspaceVersionDrift = false;
  catalogBatchCount = 0;
  failCatalogBatchAt = null;
  failCatalogReconciliationReads = false;
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
  commands.length = 0;

  await updateImportMethod(customer, "manual-xlsx", {
    ...workspace.import_methods.find((method) => method.import_method_id === "manual-xlsx")!,
    name: "LTL Demo Manual XLSX"
  });

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

  const writtenTables = commands
    .filter((command): command is BatchWriteItemCommand => command instanceof BatchWriteItemCommand)
    .flatMap((command) => Object.keys(command.input.RequestItems ?? {}));
  assert.deepEqual(new Set(writtenTables), new Set([tableNames.liftProductCache]));
  const writtenCacheRows = commands
    .filter((command): command is BatchWriteItemCommand => command instanceof BatchWriteItemCommand)
    .flatMap((command) => command.input.RequestItems?.[tableNames.liftProductCache] ?? [])
    .map((write) => write.PutRequest?.Item as Item);
  assert.equal(writtenCacheRows.length, 18);
  assert.equal(new Set(writtenCacheRows.map((item) => item.catalog_refresh_id.S)).size, 1);
  assert.match(writtenCacheRows[0].catalog_refresh_id.S!, /^[a-f0-9]{32}$/);
  writtenCacheRows.forEach((item) => {
    const data = JSON.parse(item.data.S!) as ReturnType<typeof catalogItem>;
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
  const writtenTables = commands
    .filter((command): command is BatchWriteItemCommand => command instanceof BatchWriteItemCommand)
    .flatMap((command) => Object.keys(command.input.RequestItems ?? {}));
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
  assert.match(route, /const workspace = await getWorkspace\(customerId\)/);
  assert.match(route, /targetId = selectedRoute\.target_id/);
  assert.match(route, /environmentIdFilter = selectedRoute\.environment_id/);
  assert.match(route, /companyId = selectedRoute\.company_id/);
  assert.doesNotMatch(route, /getOrCreateWorkspace\(customer\)/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
});
