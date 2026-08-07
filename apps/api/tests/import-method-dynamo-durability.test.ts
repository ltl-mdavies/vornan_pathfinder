import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Dynamo persistence never deletes core lifecycle records during a whole-store save", async () => {
  const source = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  for (const table of ["customers", "workspaces", "import_methods", "output_routes", "product_mappings", "jobs"]) {
    const persistence = source.match(
      new RegExp(`(?:await )?(upsertDynamoTable(?:Monotonic)?|replaceDynamoTable)\\(\\s*tables\\.${table},[\\s\\S]*?\\n\\s*\\);`)
    );
    assert.ok(persistence, `Expected a dedicated ${table} persistence call.`);
    assert.match(persistence[1], /^upsertDynamoTable/, `${table} must never use delete/rewrite persistence.`);
    assert.doesNotMatch(persistence[0], /DeleteRequest|scanDynamoTable/);
  }
  assert.match(
    source,
    /Import methods are lifecycle records:[\s\S]*concurrent writer holding an older workspace snapshot cannot erase/
  );
  assert.match(
    source,
    /Product-list replacement has its own conditional persistence boundary[\s\S]*preserve that durable version pointer/
  );
  assert.match(
    source,
    /Versioned product mappings are durable lifecycle records[\s\S]*must never delete a[\s\S]*complete prior version/
  );
});

test("Dynamo configuration persistence rejects stale whole-store snapshots", async () => {
  const source = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");

  for (const table of ["targets", "workspaces", "import_methods", "output_routes", "jobs", "canonical_registry"]) {
    assert.match(
      source,
      new RegExp(`upsertDynamoTableMonotonic\\(\\s*tables\\.${table},`),
      `${table} must use monotonic persistence.`
    );
  }

  assert.match(source, /record_updated_at/);
  assert.match(source, /#recordUpdatedAt <= :recordUpdatedAt/);
  assert.match(source, /ConditionalCheckFailedException/);
  assert.doesNotMatch(
    source,
    /replaceDynamoTable\(\s*tables\.(?:targets|canonical_registry),/
  );
});

test("read-only target and existing workspace access never persists the whole store", async () => {
  const source = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const getTarget = source.match(/export async function getTarget[\s\S]*?\n}\n\nfunction preserveSecret/);
  const getWorkspace = source.match(/export async function getOrCreateWorkspace[\s\S]*?\n}\n\nexport class SourceConnectionNotFoundError/);

  assert.ok(getTarget);
  assert.ok(getWorkspace);
  assert.doesNotMatch(getTarget[0], /writeStore\(/);
  assert.match(getWorkspace[0], /if \(existing\)[\s\S]*?return normalized;/);
  const existingBranch = getWorkspace[0].match(/if \(existing\) \{[\s\S]*?return normalized;\n  }/);
  assert.ok(existingBranch);
  assert.doesNotMatch(existingBranch[0], /writeStore\(/);
});

test("seeded Lift configuration uses the current High End Work naming and product identifier", async () => {
  const apiSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const webSource = await readFile(new URL("../../web/src/App.tsx", import.meta.url), "utf8");

  for (const source of [apiSource, webSource]) {
    assert.match(source, /Lift High End Work/);
    assert.match(source, /Larger Than Life · Lift \/ 91 · High End Work/);
    assert.match(source, /product_identifier_type: "lift_product_id"/);
    assert.match(source, /product_identifier_label: "Lift product_id"/);
    assert.doesNotMatch(source, /Lift Standard Graphics Order/);
    assert.doesNotMatch(source, /Larger Than Life · Lift \/ 91 · Standard Graphics/);
  }
});
