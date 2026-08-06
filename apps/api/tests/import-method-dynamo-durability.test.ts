import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Dynamo persistence never deletes core lifecycle records during a whole-store save", async () => {
  const source = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  for (const table of ["customers", "workspaces", "import_methods", "output_routes", "jobs"]) {
    const persistence = source.match(
      new RegExp(`(?:await )?(upsertDynamoTable|replaceDynamoTable)\\(\\s*tables\\.${table},[\\s\\S]*?\\n\\s*\\);`)
    );
    assert.ok(persistence, `Expected a dedicated ${table} persistence call.`);
    assert.equal(persistence[1], "upsertDynamoTable", `${table} must never use delete/rewrite persistence.`);
    assert.doesNotMatch(persistence[0], /DeleteRequest|scanDynamoTable/);
  }
  assert.match(
    source,
    /Import methods are lifecycle records:[\s\S]*concurrent writer holding an older workspace snapshot cannot erase/
  );
});
