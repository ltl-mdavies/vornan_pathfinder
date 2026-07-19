import assert from "node:assert/strict";
import test from "node:test";
import { sampleCanonicalOrder } from "@pathfinder/canonical";
import {
  applyOrderNameResolution,
  createLegacyOrderNameResolutionConfig,
  findDuplicateOrderNames,
  resolveOrderName,
  validateOrderNameResolution,
  type OrderNameResolutionConfig
} from "../src/index.ts";

function canonicalOrder(overrides: {
  orderTitle?: string | null;
  destinationCustomerId?: string;
  externalOrderId?: string;
  shipDate?: string | null;
} = {}) {
  return {
    ...sampleCanonicalOrder,
    customer: {
      ...sampleCanonicalOrder.customer,
      destination_customer_id: overrides.destinationCustomerId ?? "1249"
    },
    order: {
      ...sampleCanonicalOrder.order,
      external_order_id: overrides.externalOrderId ?? "30904511",
      order_title: overrides.orderTitle === undefined ? sampleCanonicalOrder.order.order_title : overrides.orderTitle,
      ship_date: overrides.shipDate === undefined ? "2026-06-23" : overrides.shipDate
    }
  };
}

const fallbackConfig: OrderNameResolutionConfig = {
  enabled: true,
  strategy: "provided_then_composite",
  provided_field: "order.order_title",
  components: [
    { field: "customer.destination_customer_id", format: "none", optional: false },
    { field: "order.external_order_id", format: "none", optional: false },
    { field: "order.ship_date", format: "yyyyMMdd", optional: true }
  ],
  prefix: "MOM",
  suffix: "",
  separator: "-",
  case: "upper",
  max_length: null,
  duplicate_behavior: "block"
};

test("prefers a customer-provided title and writes it to the existing canonical field", () => {
  const resolution = applyOrderNameResolution(canonicalOrder({ orderTitle: "Customer Spring Launch" }), fallbackConfig);

  assert.equal(resolution.result.source, "provided");
  assert.equal(resolution.result.value, "MOM-CUSTOMER SPRING LAUNCH");
  assert.equal(resolution.canonical_order.order.order_title, "MOM-CUSTOMER SPRING LAUNCH");
  assert.equal(validateOrderNameResolution(resolution.result, fallbackConfig)[0]?.severity, "PASS");
});

test("builds a stable composite fallback from canonical values and formats dates", () => {
  const first = resolveOrderName(canonicalOrder({ orderTitle: null }), fallbackConfig);
  const retry = resolveOrderName(canonicalOrder({ orderTitle: null }), fallbackConfig);

  assert.equal(first.source, "composite");
  assert.equal(first.value, "MOM-1249-30904511-20260623");
  assert.equal(retry.value, first.value);
});

test("blocks a composite when a required canonical component is missing", () => {
  const result = resolveOrderName(
    canonicalOrder({ orderTitle: null, externalOrderId: "" }),
    fallbackConfig
  );
  const validation = validateOrderNameResolution(result, fallbackConfig);

  assert.equal(result.value, null);
  assert.deepEqual(result.missing_required_fields, ["order.external_order_id"]);
  assert.equal(validation[0]?.severity, "FAIL");
  assert.equal(validation[0]?.code, "ORDER_NAME_MISSING");
});

test("preserves legacy provided-title behavior without generating a fallback", () => {
  const legacyConfig = { ...createLegacyOrderNameResolutionConfig(), prefix: "IGNORED", case: "upper" as const };
  const order = canonicalOrder({ orderTitle: "Legacy Customer Title" });
  const resolution = applyOrderNameResolution(order, legacyConfig);

  assert.equal(legacyConfig.strategy, "provided");
  assert.equal(legacyConfig.enabled, false);
  assert.equal(resolution.result.value, "Legacy Customer Title");
  assert.equal(resolution.result.source, "provided");
  assert.equal(resolution.canonical_order.order.order_title, "Legacy Customer Title");
  assert.deepEqual(validateOrderNameResolution(resolution.result, legacyConfig), []);
});

test("flags configured length limits and duplicate names within a batch", () => {
  const limitedConfig = { ...fallbackConfig, max_length: 12 };
  const first = resolveOrderName(canonicalOrder({ orderTitle: "Shared Name" }), limitedConfig);
  const second = resolveOrderName(canonicalOrder({ orderTitle: "shared name" }), limitedConfig);

  assert.equal(first.exceeds_max_length, true);
  assert.equal(validateOrderNameResolution(first, limitedConfig)[0]?.code, "ORDER_NAME_TOO_LONG");
  assert.deepEqual(findDuplicateOrderNames([first, second]), [
    { normalized_name: "mom-shared name", indexes: [0, 1] }
  ]);
});
