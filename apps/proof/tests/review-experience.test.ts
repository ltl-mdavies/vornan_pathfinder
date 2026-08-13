import assert from "node:assert/strict";
import test from "node:test";
import { usesAdvancedQuantityAllocation } from "../src/review-experience.ts";

test("keeps simple review quantity-free even when a Lift line has multiple current proofs", () => {
  assert.equal(usesAdvancedQuantityAllocation(3, "simple"), false);
  assert.equal(usesAdvancedQuantityAllocation(1, "advanced"), false);
  assert.equal(usesAdvancedQuantityAllocation(3, "advanced"), true);
});
