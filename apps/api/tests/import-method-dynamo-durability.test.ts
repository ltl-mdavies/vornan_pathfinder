import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Dynamo persistence never deletes import methods during a whole-store save", async () => {
  const source = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const importMethodPersistence = source.match(
    /(?:await )?(upsertDynamoTable|replaceDynamoTable)\(\s*tables\.import_methods,[\s\S]*?\n\s*\);/
  );

  assert.ok(importMethodPersistence, "Expected a dedicated import-method persistence call.");
  assert.equal(importMethodPersistence[1], "upsertDynamoTable");
  assert.doesNotMatch(importMethodPersistence[0], /DeleteRequest|scanDynamoTable/);
  assert.match(
    source,
    /Import methods are lifecycle records:[\s\S]*concurrent writer holding an older workspace snapshot cannot erase/
  );
});
