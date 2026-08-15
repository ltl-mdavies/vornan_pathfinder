import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { FieldMapping } from "@pathfinder/templates";

import {
  manualPreviewDerivedProductKey,
  manualPreviewIdentityIsMapped,
  manualPreviewMappings,
  manualPreviewProductConfig
} from "../src/manual-preview-draft";

const neutralConfig = {
  strategy: "derived_key" as const,
  mode: "map_to_lift_unit" as const,
  source_column: "",
  prefix: "",
  suffix: "",
  composite_columns: [],
  fallback_strategy: "none" as const,
  direct_unit_number_column: null
};

test("a request-local product column resolves the frozen pilot keys without changing the saved config", () => {
  const effective = manualPreviewProductConfig(neutralConfig, "DESCRIPTION");

  assert.deepEqual(neutralConfig, {
    strategy: "derived_key",
    mode: "map_to_lift_unit",
    source_column: "",
    prefix: "",
    suffix: "",
    composite_columns: [],
    fallback_strategy: "none",
    direct_unit_number_column: null
  });
  assert.equal(effective.source_column, "DESCRIPTION");
  assert.equal(effective.prefix, "");
  assert.equal(effective.suffix, "");
  assert.deepEqual(
    ["2-Sheet_Penn", "3-Sheet_Penn", "DirClock_Penn"].map((value) =>
      manualPreviewDerivedProductKey(value, effective)
    ),
    ["2_SHEET_PENN", "3_SHEET_PENN", "DIRCLOCK_PENN"]
  );
  const savedLiftProducts = new Map([
    ["2_SHEET_PENN", "138667"],
    ["3_SHEET_PENN", "138666"],
    ["DIRCLOCK_PENN", "138664"]
  ]);
  assert.deepEqual(
    ["2-Sheet_Penn", "3-Sheet_Penn", "DirClock_Penn"].map((value) =>
      savedLiftProducts.get(manualPreviewDerivedProductKey(value, effective))
    ),
    ["138667", "138666", "138664"]
  );
});

test("the request-local identity column fans out to external order identity and contract number", () => {
  const savedMappings: FieldMapping[] = [
    { sourceColumn: "Quantity", targetField: "lines[].quantity" },
    { sourceColumn: "Old ID", targetField: "order.external_order_id", required: true },
    { sourceColumn: "Old Contract", targetField: "order.contract_number" }
  ];

  const effective = manualPreviewMappings(savedMappings, "ContractNumber");

  assert.equal(
    manualPreviewIdentityIsMapped(effective, ["ContractNumber", "Quantity"], [
      { ContractNumber: "777-88-99-00", Quantity: 10 }
    ]),
    true
  );
  assert.deepEqual(
    effective.filter((mapping) => mapping.targetField.startsWith("order.")).map((mapping) => ({
      sourceColumn: mapping.sourceColumn,
      targetField: mapping.targetField,
      required: mapping.required ?? false
    })),
    [
      { sourceColumn: "ContractNumber", targetField: "order.external_order_id", required: true },
      { sourceColumn: "ContractNumber", targetField: "order.contract_number", required: false }
    ]
  );
  assert.equal(savedMappings[1]?.sourceColumn, "Old ID");
});

test("a stale saved identity column cannot enable preview for a different upload", () => {
  const staleMappings: FieldMapping[] = [
    { sourceColumn: "Order Number", targetField: "order.external_order_id", required: true },
    { sourceColumn: "Order Number", targetField: "order.contract_number" }
  ];

  assert.equal(
    manualPreviewIdentityIsMapped(staleMappings, ["ContractNumber", "DESCRIPTION"], [
      { ContractNumber: "777-88-99-00", DESCRIPTION: "2-Sheet_Penn" }
    ]),
    false
  );
  assert.equal(
    manualPreviewIdentityIsMapped(
      manualPreviewMappings(staleMappings, "ContractNumber"),
      ["ContractNumber", "DESCRIPTION"],
      [{ ContractNumber: "777-88-99-00", DESCRIPTION: "2-Sheet_Penn" }]
    ),
    true
  );
});

test("Manual Import uses the same local drafts for review and the single atomic preview request", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /aria-label="Product key for this upload"/);
  assert.match(appSource, /aria-label="Order identity for this upload"/);
  assert.match(appSource, /product_resolution_config: effectiveManualProductConfig/);
  assert.match(appSource, /mappings: effectiveManualMappings/);
  assert.match(appSource, /manualPreviewCreationBlocked \|\| workspaceState === "saving"/);
  assert.match(appSource, /Saved Import Method and product mappings will not change\./);
  assert.match(appSource, /manualPreviewIdentityReady/);
  assert.match(appSource, /Choose the order identity column for this upload/);
  assert.match(appSource, /canonicalOrder\.order\.external_order_id === "UNMAPPED-ORDER"/);
  assert.doesNotMatch(
    appSource,
    /setManualPreviewProductKeyColumn\([^)]*\)[\s\S]{0,180}method:\s*"PUT"/
  );
  assert.doesNotMatch(
    appSource,
    /setManualPreviewIdentityColumn\([^)]*\)[\s\S]{0,180}method:\s*"PUT"/
  );
});
