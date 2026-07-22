import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_CONNECTOR_DEFINITIONS,
  getSourceConnectorDefinition,
  normalizeCustomerSourceConnection
} from "../src/index.ts";

test("publishes Wrike as available while keeping future providers explicitly planned", () => {
  assert.equal(getSourceConnectorDefinition("wrike")?.availability, "Available");
  assert.equal(getSourceConnectorDefinition("odoo")?.availability, "Planned");
  assert.deepEqual(
    SOURCE_CONNECTOR_DEFINITIONS.filter((definition) => definition.availability === "Planned").map(
      (definition) => definition.provider
    ),
    ["odoo", "asana", "sharepoint", "salesforce", "generic_rest"]
  );
});

test("normalizes customer connection metadata without accepting provider-specific secrets", () => {
  const normalized = normalizeCustomerSourceConnection({
    connection_id: " connection_wrike_1 ",
    name: " Momentara Wrike ",
    provider: "wrike",
    status: "Active",
    environment: "Production",
    auth_strategy: "api_key",
    created_at: "2026-07-22T00:00:00.000Z",
    updated_at: "2026-07-22T01:00:00.000Z"
  });

  assert.equal(normalized.connection_id, "connection_wrike_1");
  assert.equal(normalized.name, "Momentara Wrike");
  assert.equal(normalized.auth_strategy, "oauth2");
  assert.equal("client_secret" in normalized, false);
});
