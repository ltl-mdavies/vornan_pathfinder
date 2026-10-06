import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("mapping scope shows full source values and uninterrupted Pathfinder keys", () => {
  const rule = css.match(/\.unit-catalog-focus strong\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /white-space: normal/);
  assert.match(rule, /overflow-wrap: anywhere/);
  assert.doesNotMatch(rule, /ellipsis|overflow: hidden/);
});

test("mapping candidates wrap product names and descriptions instead of hiding suffixes", () => {
  const rule = css.match(/\.unit-catalog-table td:first-child strong,\s*\.unit-catalog-table td:first-child span\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /white-space: normal/);
  assert.match(rule, /overflow-wrap: anywhere/);
  assert.match(rule, /overflow: visible/);
  assert.match(rule, /text-overflow: clip/);
});
