import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
test("public header freshness requires an opened payload; loaded refresh still reaches StatusView", () => {
  assert.match(source, /refreshState=\{payload \? refreshState : undefined\}/);
  assert.match(source, /payload \? <StatusView payload=\{payload\} refreshState=\{refreshState\}/);
});
test("entry and recovery do not promise an email was already sent", () => {
  assert.match(source, /<strong>Delivery by email<\/strong>/);
  assert.doesNotMatch(source, /<strong>Sent by email<\/strong>/);
  assert.match(source, /!checking && contactEmail/);
  assert.match(source, /Please contact your Vornan representative/);
});
test("initial loading skeleton respects reduced motion", () => {
  const css = readFileSync(new URL("../../../packages/ui/src/vornan-foundation.css", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.status-shell \.status-skeleton span \{ animation: none; \}/);
});
