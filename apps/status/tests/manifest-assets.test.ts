import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("every declared Status manifest icon exists as a valid PNG with its declared dimensions", async () => {
  const publicRoot = new URL("../public/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("site.webmanifest", publicRoot), "utf8")) as {
    icons?: Array<{ src?: string; sizes?: string; type?: string }>;
  };

  for (const icon of manifest.icons ?? []) {
    assert.equal(icon.type, "image/png");
    assert.match(icon.src ?? "", /^\/icons\/[A-Za-z0-9._-]+\.png$/);
    assert.match(icon.sizes ?? "", /^\d+x\d+$/);
    const bytes = await readFile(new URL((icon.src ?? "").replace(/^\//, ""), publicRoot));
    assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    const declared = (icon.sizes ?? "").split("x").map(Number);
    assert.equal(bytes.readUInt32BE(16), declared[0]);
    assert.equal(bytes.readUInt32BE(20), declared[1]);
  }
});
