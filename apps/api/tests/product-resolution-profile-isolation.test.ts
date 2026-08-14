import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDefaultProductResolutionConfig,
  createMomentaraProductResolutionConfig,
  createNeutralProductResolutionConfig
} from "../src/store.ts";

const momentaraConfig = {
  strategy: "derived_key",
  mode: "map_to_lift_unit",
  source_column: "SIGN TYPE",
  prefix: "MOMENTARA__",
  suffix: "",
  composite_columns: [
    "DESCRIPTION",
    "Media Type",
    "Final Size Width",
    "Final Size Length",
    "STOCK",
    "FINISHING"
  ],
  fallback_strategy: "none",
  direct_unit_number_column: null
} as const;

const neutralConfig = {
  strategy: "derived_key",
  mode: "map_to_lift_unit",
  source_column: "",
  prefix: "",
  suffix: "",
  composite_columns: [],
  fallback_strategy: "none",
  direct_unit_number_column: null
} as const;

test("keeps the exact Momentara product recipe as an explicit legacy compatibility profile", () => {
  assert.deepEqual(createMomentaraProductResolutionConfig(), momentaraConfig);
  assert.deepEqual(createDefaultProductResolutionConfig(), momentaraConfig);
});

test("constructs neutral product resolution without Momentara source semantics", () => {
  const config = createNeutralProductResolutionConfig();
  assert.deepEqual(config, neutralConfig);
  assert.equal(JSON.stringify(config).includes("MOMENTARA"), false);
  assert.equal(JSON.stringify(config).includes("SIGN TYPE"), false);
});

test("uses neutral construction only for future workspaces and ad-hoc imports", async () => {
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const webSource = await readFile(new URL("../../web/src/App.tsx", import.meta.url), "utf8");

  assert.match(storeSource, /function createSeedMethod\(timestamp: string, profile: WorkspaceSeedProfile = "neutral"\)/);
  assert.match(storeSource, /function createWorkspace\([\s\S]{0,140}profile: WorkspaceSeedProfile = "neutral"/);
  assert.match(serverSource, /product_resolution_config: createNeutralProductResolutionConfig\(\)/);
  assert.match(serverSource, /\.\.\.createNeutralProductResolutionConfig\(\)/);

  const neutralWebDefault = webSource.match(
    /const neutralProductResolutionConfig: ProductResolutionConfig = \{[\s\S]*?\n\};/
  );
  assert.ok(neutralWebDefault);
  assert.doesNotMatch(neutralWebDefault[0], /MOMENTARA__|SIGN TYPE|Media Type|STOCK|FINISHING/);
});

test("does not synthesize presets when a neutral workspace explicitly stores an empty list", async () => {
  const source = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  assert.match(source, /const catalogPresets = Array\.isArray\(workspace\.catalog_presets\)/);
  assert.match(source, /createSeedCatalogPresets\([\s\S]*?"momentara_legacy"[\s\S]*?: "neutral"/);
  assert.doesNotMatch(
    source.match(/function createSeedCatalogPresets[\s\S]*?\n}\n/)?.[0] ?? "",
    /customer_name/
  );
});
