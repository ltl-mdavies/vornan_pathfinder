import assert from "node:assert/strict";
import test from "node:test";
import { proofOrderDisplayStatus, proofOrderDisplayTitle } from "../src/display-state.ts";

test("uses Lift display metadata when present and deterministic order fallbacks when absent", () => {
  assert.equal(proofOrderDisplayTitle({ order_number: "A0221132", order_title: "Summer retail rollout" }), "Summer retail rollout");
  assert.equal(proofOrderDisplayTitle({ order_number: "A0221132", order_title: "  " }), "Order A0221132");
  assert.equal(proofOrderDisplayStatus("Pending Art Approval"), "Pending Art Approval");
  assert.equal(proofOrderDisplayStatus(""), "Proof review");
});
