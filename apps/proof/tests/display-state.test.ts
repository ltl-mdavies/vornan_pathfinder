import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { proofOrderDisplayStatus, proofOrderDisplayTitle } from "../src/display-state.ts";

test("uses Lift display metadata when present and deterministic order fallbacks when absent", () => {
  assert.equal(proofOrderDisplayTitle({ order_number: "A0221132", order_title: "Summer retail rollout" }), "Summer retail rollout");
  assert.equal(proofOrderDisplayTitle({ order_number: "A0221132", order_title: "  " }), "Order A0221132");
  assert.equal(proofOrderDisplayStatus("Pending Art Approval"), "Pending Art Approval");
  assert.equal(proofOrderDisplayStatus(""), "Proof review");
});

test("distinguishes Prepress feedback from line-associated production messages", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /Prepress team feedback/);
  assert.match(source, /function decisionStateDetail\(task: ProofTask\) \{\n  return proofStatePresentation\(task\.state\)\.detail;/);
  assert.equal(source.includes("> Feedback<"), false);
});
