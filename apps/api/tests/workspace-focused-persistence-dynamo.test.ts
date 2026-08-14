import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";

type Command = GetItemCommand | ScanCommand | TransactWriteItemsCommand;
type Item = Record<string, AttributeValue>;

const commands: Command[] = [];
const tableItems = new Map<string, Item[]>();
let forceWorkspaceVersionDrift = false;
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
    return {};
  };

  ({ getOrCreateWorkspace, updateImportMethod, updateOutputRoute } = await import("../src/store.ts"));
});

beforeEach(() => {
  commands.length = 0;
  forceWorkspaceVersionDrift = false;
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
