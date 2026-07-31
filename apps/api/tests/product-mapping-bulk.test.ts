import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

let testDirectory = "";
let getOrCreateWorkspace: typeof import("../src/store.ts")["getOrCreateWorkspace"];
let bulkUpsertProductMappings: typeof import("../src/store.ts")["bulkUpsertProductMappings"];
let previewProductMappingReplacement: typeof import("../src/store.ts")["previewProductMappingReplacement"];
let applyProductMappingReplacement: typeof import("../src/store.ts")["applyProductMappingReplacement"];
let rollbackProductMappingReplacement: typeof import("../src/store.ts")["rollbackProductMappingReplacement"];

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
  previewProductMappingReplacement = store.previewProductMappingReplacement;
  applyProductMappingReplacement = store.applyProductMappingReplacement;
  rollbackProductMappingReplacement = store.rollbackProductMappingReplacement;
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

test("previews, atomically applies, and rolls back an authoritative route product list", async () => {
  const customer = { ...testCustomer, lift_customer_id: "replacement-product-map" };
  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes[0];
  const timestamp = "2026-07-31T13:00:00.000Z";
  const mapping = (mappingId: string, key: string, status: "Mapped" | "Unmapped" = "Unmapped") => ({
    mapping_id: mappingId,
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    target_template: route.output_template,
    customer_product_key: key,
    display_label: key,
    source_columns: ["Description"],
    product_identifier_type: route.product_identifier_type,
    product_identifier_value: status === "Mapped" ? "LIFT-OLD" : null,
    lift_unit_number: status === "Mapped" ? "LIFT-OLD" : null,
    lift_product_id: null,
    product_name: status === "Mapped" ? "Old Lift product" : null,
    status,
    mapping_source: "Observed order" as const,
    source_file_name: "old.xlsx",
    last_seen_examples: [],
    created_at: timestamp,
    updated_at: timestamp
  });
  await bulkUpsertProductMappings(customer, [
    mapping("mapping-keep", "KEEP", "Mapped"),
    mapping("mapping-omit", "OMIT"),
    mapping("mapping-already-inactive", "OLD")
  ] as any);
  await bulkUpsertProductMappings(customer, [{ ...mapping("mapping-already-inactive", "OLD"), status: "Inactive" }] as any);

  const candidate = (key: string) => ({
    ...mapping(`candidate-${key.toLowerCase()}`, key),
    display_label: `${key} updated`,
    source_file_name: "momentara-authoritative.xlsx",
    last_seen_examples: [{ sheet_name: "momentara-authoritative.xlsx", row_number: key === "KEEP" ? 2 : 3 }]
  });
  const input = {
    output_route_id: route.output_route_id,
    source_file_name: "momentara-authoritative.xlsx",
    clear_existing_assignments: true,
    product_mappings: [candidate("KEEP"), candidate("NEW")]
  };
  const preview = await previewProductMappingReplacement(customer, input as any);
  assert.equal(preview.imported_count, 2);
  assert.equal(preview.new_count, 1);
  assert.equal(preview.updated_count, 1);
  assert.equal(preview.deactivated_count, 1);
  assert.equal(preview.rows.find((row) => row.customer_product_key === "OMIT")?.action, "Deactivate");

  const applied = await applyProductMappingReplacement(customer, input as any, preview.preview_token, "operator-test");
  const keep = applied.product_mappings.find((entry) => entry.customer_product_key === "KEEP");
  const omitted = applied.product_mappings.find((entry) => entry.customer_product_key === "OMIT");
  const introduced = applied.product_mappings.find((entry) => entry.customer_product_key === "NEW");
  assert.equal(keep?.status, "Unmapped");
  assert.equal(keep?.product_identifier_value, null);
  assert.equal(omitted?.status, "Inactive");
  assert.equal(introduced?.status, "Unmapped");
  assert.equal(applied.product_mapping_replacement_checkpoint?.source_file_name, "momentara-authoritative.xlsx");
  assert.equal(applied.product_mapping_replacement_history?.length, 1);

  const rolledBack = await rollbackProductMappingReplacement(
    customer,
    applied.product_mapping_replacement_checkpoint!.replacement_id,
    "operator-test"
  );
  assert.equal(rolledBack.product_mappings.find((entry) => entry.customer_product_key === "KEEP")?.status, "Mapped");
  assert.equal(rolledBack.product_mappings.find((entry) => entry.customer_product_key === "OMIT")?.status, "Unmapped");
  assert.equal(rolledBack.product_mappings.find((entry) => entry.customer_product_key === "NEW")?.status, "Inactive");
  assert.ok(rolledBack.product_mapping_replacement_checkpoint?.rolled_back_at);
});

test("rejects an authoritative replacement when the reviewed product map has changed", async () => {
  const customer = { ...testCustomer, lift_customer_id: "replacement-conflict" };
  const workspace = await getOrCreateWorkspace(customer);
  const route = workspace.output_routes[0];
  const base = {
    mapping_id: "mapping-existing",
    output_route_id: route.output_route_id,
    target_id: route.target_id,
    target_template: route.output_template,
    customer_product_key: "EXISTING",
    display_label: "Existing",
    source_columns: ["Description"],
    product_identifier_type: route.product_identifier_type,
    product_identifier_value: null,
    lift_unit_number: null,
    lift_product_id: null,
    product_name: null,
    status: "Unmapped" as const,
    mapping_source: "Observed order" as const,
    source_file_name: null,
    last_seen_examples: [],
    created_at: "2026-07-31T13:00:00.000Z",
    updated_at: "2026-07-31T13:00:00.000Z"
  };
  await bulkUpsertProductMappings(customer, [base]);
  const input = {
    output_route_id: route.output_route_id,
    source_file_name: "authoritative.xlsx",
    clear_existing_assignments: true,
    product_mappings: [base]
  };
  const preview = await previewProductMappingReplacement(customer, input);
  await bulkUpsertProductMappings(customer, [{ ...base, display_label: "Changed after preview" }]);
  await assert.rejects(
    applyProductMappingReplacement(customer, input, preview.preview_token, "operator-test"),
    /changed after this replacement preview/
  );
});
