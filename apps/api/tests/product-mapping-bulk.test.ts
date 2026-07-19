import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

let testDirectory = "";
let getOrCreateWorkspace: typeof import("../src/store.ts")["getOrCreateWorkspace"];
let bulkUpsertProductMappings: typeof import("../src/store.ts")["bulkUpsertProductMappings"];

const testCustomer = {
  lift_customer_id: "regression-bulk-product-map",
  customer_name: "Bulk Product Map Regression Customer",
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
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-bulk-product-map-test-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_STORE_PATH = join(testDirectory, "store.json");
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");
  process.env.PATHFINDER_ENABLE_LIFT_SUBMIT = "false";

  const store = await import("../src/store.ts");
  getOrCreateWorkspace = store.getOrCreateWorkspace;
  bulkUpsertProductMappings = store.bulkUpsertProductMappings;
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("updates the reviewed bulk rows without changing their neighbor", async () => {
  const workspace = await getOrCreateWorkspace(testCustomer);
  const route = workspace.output_routes[0];
  const timestamp = "2026-07-19T15:00:00.000Z";
  const mapping = (mappingId: string, key: string) => ({
    mapping_id: mappingId,
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    target_template: route.output_template,
    customer_product_key: key,
    display_label: key,
    source_columns: ["SKU"],
    product_identifier_type: route.product_identifier_type,
    product_identifier_value: null,
    lift_unit_number: null,
    lift_product_id: null,
    product_name: null,
    status: "Unmapped",
    mapping_source: "Manual entry",
    source_file_name: null,
    last_seen_examples: [],
    created_at: timestamp,
    updated_at: timestamp
  });
  const seeded = await bulkUpsertProductMappings(testCustomer, [
    mapping("mapping-one", "CUSTOMER-ONE"),
    mapping("mapping-two", "CUSTOMER-TWO"),
    mapping("mapping-neighbor", "CUSTOMER-NEIGHBOR")
  ] as any);
  const reviewedIds = new Set(["mapping-one", "mapping-two"]);
  const reviewedMappings = seeded
    .filter((candidate) => reviewedIds.has(candidate.mapping_id))
    .map((candidate) => ({
      ...candidate,
      product_identifier_value: "LIFT-BULK-001",
      lift_unit_number: "LIFT-BULK-001",
      product_name: "Reviewed Lift Product",
      status: "Mapped"
    }));

  const saved = await bulkUpsertProductMappings(testCustomer, reviewedMappings);
  const first = saved.find((candidate) => candidate.mapping_id === "mapping-one");
  const second = saved.find((candidate) => candidate.mapping_id === "mapping-two");
  const neighbor = saved.find((candidate) => candidate.mapping_id === "mapping-neighbor");

  assert.equal(first?.product_identifier_value, "LIFT-BULK-001");
  assert.equal(second?.product_identifier_value, "LIFT-BULK-001");
  assert.equal(first?.product_name, "Reviewed Lift Product");
  assert.equal(second?.product_name, "Reviewed Lift Product");
  assert.equal(neighbor?.product_identifier_value, null);
  assert.equal(neighbor?.status, "Unmapped");
});
