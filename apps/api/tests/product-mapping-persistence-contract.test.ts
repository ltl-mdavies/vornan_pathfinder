import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");

test("single product mapping approval uses a focused conditional Dynamo write", () => {
  const start = storeSource.indexOf("export async function updateProductMapping(");
  const end = storeSource.indexOf("export async function bulkUpsertProductMappings(", start);
  const implementation = storeSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(implementation, /persistFocusedDynamoRecords\(/);
  assert.match(implementation, /getDynamoTableConfig\(\)\.product_mappings/);
  assert.match(implementation, /customer_route_id: customerRouteKey\(/);
  assert.match(implementation, /expected_updated_at: existingMapping\?\.updated_at \?\? null/);
  assert.doesNotMatch(implementation, /await writeStore\(store\);[\s\S]*storage_driver === "dynamodb"/);
  assert.match(implementation, /changed: false/);
});
test("product mapping persistence failures are sanitized and explicitly uncertain", () => {
  const start = serverSource.indexOf('app.put("/api/customers/:liftCustomerId/product-mappings/:mappingId"');
  const end = serverSource.indexOf('app.post("/api/customers/:liftCustomerId/product-mappings/bulk"', start);
  const route = serverSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(route, /product_mapping_persistence_uncertain/);
  assert.match(route, /could not confirm whether this product mapping was saved/);
  assert.match(route, /Reload the page before taking another action/);
  assert.match(route, /external_effects: false/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
});
