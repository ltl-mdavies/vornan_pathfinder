import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Actual size gets overflow-safe centering without changing native scale or other fitting modes", async () => {
  const source = await readFile(new URL("../src/proof-document-viewer.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /fitMode === "actual" \? " actual-size" : ""/);
  assert.match(source, /fitMode === "actual" \? 1 : fitPageScale/);
  assert.match(css, /\.proof-document-viewport\.actual-size \{ display: flex; \}/);
  assert.match(css, /\.proof-document-viewport\.actual-size \.proof-document-canvas \{ flex: none; margin: auto; \}/);
  assert.match(css, /\.proof-document-viewport\.zoomed \{ place-items: start center; \}/);
  assert.match(css, /\.proof-image-viewport\.zoomed \{ place-items: start start; \}/);
});
