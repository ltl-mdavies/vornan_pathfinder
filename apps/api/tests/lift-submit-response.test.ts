import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLiftSubmitResponse } from "@pathfinder/lift-adapter";

test("extracts a Lift order number from an accepted response message", () => {
  const result = normalizeLiftSubmitResponse(200, {
    code: 200,
    message: "Order Number: A0226692"
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.lift_order_id, "A0226692");
});
