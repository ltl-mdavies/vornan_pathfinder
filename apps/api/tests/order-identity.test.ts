import assert from "node:assert/strict";
import test from "node:test";
import { sampleCanonicalOrder } from "@pathfinder/canonical";
import { generateLiftPayload, translateLiftSubmitError } from "@pathfinder/lift-adapter";

test("keeps the customer external order ID as the backward-compatible Lift Ext_ID", () => {
  const payload = generateLiftPayload(sampleCanonicalOrder, {
    jobId: "job_test",
    canonicalOrderId: "co_test",
    pathfinderOrderId: "PFTEST123",
    extIdStrategy: "customer_order_id"
  });

  assert.equal(payload.order.ext_id, sampleCanonicalOrder.order.external_order_id);
});

test("can use a persisted Pathfinder order ID as the Lift Ext_ID", () => {
  const payload = generateLiftPayload(sampleCanonicalOrder, {
    jobId: "job_test",
    canonicalOrderId: "co_test",
    pathfinderOrderId: "PFM123ABC456",
    extIdStrategy: "pathfinder_generated"
  });

  assert.equal(payload.order.ext_id, "PFM123ABC456");
});

test("distinguishes duplicate order names from duplicate Ext_ID failures", () => {
  assert.equal(
    translateLiftSubmitError({ message: "Order name Empirical Web Order must be unique." }).category,
    "duplicate_order_name"
  );
  assert.equal(
    translateLiftSubmitError({ message: "Order with Ext_ID ABC123 already exists." }).category,
    "duplicate_ext_id"
  );
});
