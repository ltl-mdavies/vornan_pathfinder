import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-admin-web.yml", import.meta.url),
  "utf8",
);
const deployScript = readFileSync(
  new URL("../deploy-admin-web.sh", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../../apps/web/src/App.tsx", import.meta.url),
  "utf8",
);

const isInternalPilotEnabled = (repositoryValue) =>
  (repositoryValue || "false") === "true";

test("wires the Artwork Catalog internal pilot into Admin builds with a false default", () => {
  assert.match(
    workflow,
    /VITE_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED:\s*\$\{\{\s*vars\.PATHFINDER_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED\s*\|\|\s*'false'\s*\}\}/,
  );
  assert.doesNotMatch(
    workflow,
    /secrets\.PATHFINDER_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED/,
  );
  assert.doesNotMatch(
    workflow,
    /inputs\.PATHFINDER_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED/,
  );

  assert.match(
    deployScript,
    /VITE_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED="\$\{VITE_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED:-false\}"/,
  );
  assert.match(
    appSource,
    /import\.meta\.env\.VITE_ARTWORK_CATALOG_INTERNAL_PILOT_ENABLED === "true"/,
  );
});

test("enables the internal pilot only for the exact lowercase true value", () => {
  for (const disabledValue of [
    undefined,
    "",
    "false",
    "TRUE",
    "1",
    "yes",
    " true ",
  ]) {
    assert.equal(isInternalPilotEnabled(disabledValue), false);
  }

  assert.equal(isInternalPilotEnabled("true"), true);
});
