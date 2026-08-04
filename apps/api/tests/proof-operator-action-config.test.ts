import assert from "node:assert/strict";
import test from "node:test";
import { getProofOperatorActionQaConfig } from "../src/proof/operator-action-config.js";

const keys = [
  "PATHFINDER_PROOF_OPERATOR_ACTION_SCOPE",
  "PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA",
  "PATHFINDER_PROOF_OPERATOR_ACTION_ALLOWED_ORDERS",
  "PATHFINDER_PROOF_OPERATOR_ACTION_EXPIRES_AT",
  "PATHFINDER_ENABLE_PROOF_ADVANCED_REVIEW"
] as const;

function withEnvironment(
  values: Partial<Record<(typeof keys)[number], string>>,
  callback: () => void
) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    callback();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("reads the bounded Proof operator configuration from one packed value", () => {
  withEnvironment({
    PATHFINDER_PROOF_OPERATOR_ACTION_SCOPE:
      "true|A0226753,a0227641|2026-08-04T20:00:00Z|true"
  }, () => {
    assert.deepEqual(getProofOperatorActionQaConfig(), {
      enabled: true,
      allowed_customer_id: "1249",
      allowed_company_id: "91",
      allowed_order_numbers: ["A0226753", "A0227641"],
      jwt_ttl_seconds: 60,
      activation_expires_at: "2026-08-04T20:00:00.000Z",
      advanced_quantity_allocation_enabled: true
    });
  });
});

test("a malformed packed value fails closed instead of consulting legacy values", () => {
  withEnvironment({
    PATHFINDER_PROOF_OPERATOR_ACTION_SCOPE: "true|A0226753|missing-segment",
    PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA: "true",
    PATHFINDER_PROOF_OPERATOR_ACTION_ALLOWED_ORDERS: "A0226753",
    PATHFINDER_ENABLE_PROOF_ADVANCED_REVIEW: "true"
  }, () => {
    const config = getProofOperatorActionQaConfig();
    assert.equal(config.enabled, false);
    assert.deepEqual(config.allowed_order_numbers, []);
    assert.equal(config.activation_expires_at, null);
    assert.equal(config.advanced_quantity_allocation_enabled, false);
  });
});

test("retains the legacy local-development variables when packed scope is absent", () => {
  withEnvironment({
    PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA: "true",
    PATHFINDER_PROOF_OPERATOR_ACTION_ALLOWED_ORDERS: "A0226753",
    PATHFINDER_PROOF_OPERATOR_ACTION_EXPIRES_AT: "2026-08-04T20:00:00Z",
    PATHFINDER_ENABLE_PROOF_ADVANCED_REVIEW: "false"
  }, () => {
    const config = getProofOperatorActionQaConfig();
    assert.equal(config.enabled, true);
    assert.deepEqual(config.allowed_order_numbers, ["A0226753"]);
    assert.equal(config.activation_expires_at, "2026-08-04T20:00:00.000Z");
    assert.equal(config.advanced_quantity_allocation_enabled, false);
  });
});
