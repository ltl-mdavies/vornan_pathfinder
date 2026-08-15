import assert from "node:assert/strict";
import {
  DynamoDBClient,
  ScanCommand,
  TransactWriteItemsCommand
} from "@aws-sdk/client-dynamodb";
import test, { after, before, beforeEach } from "node:test";
import type { ImportMethod, ProcessingJobPreview } from "../src/store.ts";

type Command = ScanCommand | TransactWriteItemsCommand;

const commands: Command[] = [];
let transactionFailure: "none" | "conflict" | "uncertain" = "none";
const tableNames = {
  customers: "Pathfinder-CUSTOMERS-preview-atomic",
  workspaces: "Pathfinder-CUSTOMER_WORKSPACES-preview-atomic",
  targets: "Pathfinder-TARGETS-preview-atomic",
  importMethods: "Pathfinder-IMPORT_METHODS-preview-atomic",
  outputRoutes: "Pathfinder-OUTPUT_ROUTES-preview-atomic",
  productMappings: "Pathfinder-PRODUCT_MAPPINGS-preview-atomic",
  jobs: "Pathfinder-JOBS-preview-atomic",
  orderIds: "Pathfinder-ORDER_IDS-preview-atomic",
  submitAttempts: "Pathfinder-SUBMIT_ATTEMPTS-preview-atomic",
  liftProductCache: "Pathfinder-LIFT_PRODUCT_CACHE-preview-atomic",
  orderStatusTokens: "Pathfinder-ORDER_STATUS_TOKENS-preview-atomic",
  orderStatusSnapshots: "Pathfinder-ORDER_STATUS_SNAPSHOTS-preview-atomic",
  canonicalRegistry: "Pathfinder-CANONICAL_REGISTRY-preview-atomic"
};

const clientPrototype = DynamoDBClient.prototype as unknown as {
  send(command: Command): Promise<unknown>;
};
const originalSend = clientPrototype.send;

let persistPreviewJob: typeof import("../src/store.ts")["persistPreviewJob"];

const customer = {
  lift_customer_id: "1249",
  customer_name: "LTL Demo",
  customer_number: "1249",
  customer_status: "Active",
  contacts: []
};

function previewJob(suffix: string): ProcessingJobPreview {
  return {
    customer_id: "1249",
    job_id: `job_preview_${suffix}`,
    pathfinder_order_id: `PFATOMIC${suffix}`,
    created_at: "2026-08-15T04:30:00.000Z",
    updated_at: "2026-08-15T04:30:00.000Z",
    parsed_order_rows: [],
    reference_rows: [],
    source_sheets: []
  } as ProcessingJobPreview;
}

const method = {
  import_method_id: "manual-xlsx",
  name: "Manual XLSX",
  type: "Manual upload",
  source: "XLSX",
  status: "Active",
  output_route_id: "route-ltl-lift-91-standard-graphics",
  target_id: "lift-standard-graphics",
  target_template: "Lift High End Work",
  template_id: "template_manual_xlsx_v1",
  mappings: [],
  source_config: {},
  workbook_sheet_policy: "rows_with_quantity",
  product_resolution_config: {
    strategy: "derived_key",
    mode: "map_to_lift_unit",
    source_column: "",
    prefix: "",
    suffix: "",
    composite_columns: [],
    fallback_strategy: "none",
    direct_unit_number_column: null
  },
  product_resolution_overrides: {},
  order_name_resolution_config: {
    strategy: "source_order_id",
    source_field: "order.external_order_id",
    prefix: "",
    suffix: ""
  },
  ext_id_strategy: "pathfinder_generated",
  public_intake: {
    enabled: false,
    public_key: "",
    headline: "",
    instructions: "",
    require_email: true,
    require_email_verification: false,
    allowed_email_domains: [],
    submit_profile_id: null,
    max_order_rows: 250,
    published_at: null
  },
  last_run_at: null,
  success_rate: null,
  created_at: "2026-08-15T04:00:00.000Z",
  updated_at: "2026-08-15T04:00:00.000Z"
} as ImportMethod;

before(async () => {
  Object.assign(process.env, {
    PATHFINDER_RUNTIME: "lambda",
    PATHFINDER_STORAGE_DRIVER: "dynamodb",
    PATHFINDER_SECRETS_DRIVER: "local",
    PATHFINDER_LOCAL_SECRETS_PATH: "/tmp/pathfinder-preview-atomic-secrets.json",
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

  clientPrototype.send = async (command) => {
    commands.push(command);
    if (command instanceof ScanCommand) {
      return {
        Items:
          command.input.TableName === tableNames.targets
            ? [
                {
                  target_id: { S: "lift-standard-graphics" },
                  data: {
                    S: JSON.stringify({
                      target_id: "lift-standard-graphics",
                      updated_at: "2026-08-15T04:00:00.000Z"
                    })
                  },
                  updated_at: { S: "2026-08-15T04:00:00.000Z" }
                }
              ]
            : []
      };
    }
    if (command instanceof TransactWriteItemsCommand) {
      if (transactionFailure !== "none") {
        const error = new Error("simulated transaction conflict");
        error.name = "TransactionCanceledException";
        Object.assign(error, {
          CancellationReasons:
            transactionFailure === "conflict"
              ? [{ Code: "ConditionalCheckFailed" }, { Code: "None" }]
              : [{ Code: "TransactionConflict" }, { Code: "None" }]
        });
        throw error;
      }
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  };

  ({ persistPreviewJob } = await import("../src/store.ts"));
});

beforeEach(() => {
  commands.length = 0;
  transactionFailure = "none";
});

after(() => {
  clientPrototype.send = originalSend;
});

test("request-local preview atomically writes only its OrderId and exact Job", async () => {
  const job = previewJob("SUCCESS");
  await persistPreviewJob(customer, job, method, {
    persistMethod: false,
    reserveOrderIdAtomically: true
  });

  const writes = commands.filter(
    (command): command is TransactWriteItemsCommand => command instanceof TransactWriteItemsCommand
  );
  assert.equal(writes.length, 1);
  const transaction = writes[0].input;
  assert.equal(transaction.TransactItems?.length, 2);
  assert.deepEqual(
    transaction.TransactItems?.map((item) => item.Put?.TableName),
    [tableNames.orderIds, tableNames.jobs]
  );
  assert.equal(
    transaction.TransactItems?.[0]?.Put?.Item?.pathfinder_order_id?.S,
    job.pathfinder_order_id
  );
  assert.equal(transaction.TransactItems?.[1]?.Put?.Item?.customer_id?.S, "1249");
  assert.equal(transaction.TransactItems?.[1]?.Put?.Item?.job_id?.S, job.job_id);
  assert.match(transaction.TransactItems?.[0]?.Put?.ConditionExpression ?? "", /attribute_not_exists/);
  assert.match(transaction.TransactItems?.[1]?.Put?.ConditionExpression ?? "", /attribute_not_exists/);
  assert.ok(transaction.ClientRequestToken);
  assert.equal(
    commands.some(
      (command) =>
        command instanceof TransactWriteItemsCommand &&
        command.input.TransactItems?.some((item) =>
          [
            tableNames.customers,
            tableNames.workspaces,
            tableNames.targets,
            tableNames.importMethods,
            tableNames.outputRoutes,
            tableNames.productMappings,
            tableNames.submitAttempts,
            tableNames.liftProductCache,
            tableNames.orderStatusTokens,
            tableNames.orderStatusSnapshots,
            tableNames.canonicalRegistry
          ].includes(item.Put?.TableName ?? "")
        )
    ),
    false
  );
});

test("failed atomic preview persistence leaves no separate OrderId or Job write", async () => {
  transactionFailure = "conflict";
  await assert.rejects(
    persistPreviewJob(customer, previewJob("FAILURE"), method, {
      persistMethod: false,
      reserveOrderIdAtomically: true
    }),
    /identity is already in use/
  );

  const writes = commands.filter(
    (command): command is TransactWriteItemsCommand => command instanceof TransactWriteItemsCommand
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].input.TransactItems?.map((item) => item.Put?.TableName),
    [tableNames.orderIds, tableNames.jobs]
  );
});

test("ambiguous atomic preview persistence requires reconciliation instead of retry", async () => {
  transactionFailure = "uncertain";
  await assert.rejects(
    persistPreviewJob(customer, previewJob("UNCERTAIN"), method, {
      persistMethod: false,
      reserveOrderIdAtomically: true
    }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 503);
      assert.equal((error as { reasonCode?: string }).reasonCode, "preview_persistence_uncertain");
      assert.match((error as Error).message, /do not recreate or submit/);
      return true;
    }
  );

  assert.equal(
    commands.filter((command) => command instanceof TransactWriteItemsCommand).length,
    1
  );
});
