import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
test("desktop and mobile empty-state success icons depend on actual completion", () => {
  const guarded = source.match(/completionEmpty \? <CheckCircle2 aria-hidden="true" \/> : <Search aria-hidden="true" \/>/g);
  assert.equal(guarded?.length, 2);
});
test("access styling does not remove terminal semantics or generic error state", () => {
  assert.match(source, /loadState.kind === "session_ended" \|\| loadState.kind === "link_unavailable" \? " access-recovery-state" : ""/);
  assert.match(source, /ref=\{terminalStateElement\}/);
  assert.match(source, /aria-labelledby="proof-terminal-heading"/);
  assert.match(source, /tabIndex=\{-1\}/);
});
