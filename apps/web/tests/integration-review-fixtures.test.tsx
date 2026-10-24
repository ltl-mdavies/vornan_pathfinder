import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canonicalFieldRegistry, canonicalRegistryMetadata } from "@pathfinder/canonical";
import { createIntegrationReview, type IntegrationSeed } from "../../../tests/ux/integration-fixtures";

// Minimal synthetic seed; no generated JSON or provider data required by tests.
const seed = {
  registry: { ...canonicalRegistryMetadata, updated_at: "2026-10-24T12:00:00Z", fields: canonicalFieldRegistry, sections: [], field_count: canonicalFieldRegistry.length },
  targets: [{ target_id: "lift", target_type: "ERP", adapter: "lift-standard-graphics", environments: [{ environment_id: "qa" }] }],
  workspaces: Object.fromEntries(["1249", "284619"].map(customer => [customer, { customer: { lift_customer_id: customer }, output_routes: [{ output_route_id: "shared-route-id", name: "Original", target_id: "lift" }], import_methods: [{ import_method_id: "manual", name: "Manual", source: "XLSX", type: "Manual upload", source_config: {} }], source_connections: [] }]))
} as unknown as IntegrationSeed;
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const url = (path: string) => new URL(path, "http://127.0.0.1:5210");
const field = { path: "order.qa_reference", label: "QA reference", section: "order", data_type: "string", status: "Draft", aliases: [] };

test("integration fixture creates a registry field, retains it over reload, and resets only its own namespace", async () => {
  const storage = memory(), query = new URLSearchParams("reviewCase=persistence");
  storage.setItem("unrelated", "keep");
  const first = createIntegrationReview(seed, query, storage);
  const result = await first.handle(url("/api/canonical-registry/fields"), "POST", field);
  assert.equal(result?.status, 201);
  const reloaded = createIntegrationReview(seed, query, storage);
  const current = await (await reloaded.handle(url("/api/canonical-registry"), "GET"))!.json();
  assert.ok(current.fields.some((item: {path:string}) => item.path === field.path));
  assert.equal(current.history.length, 1);
  assert.equal(current.snapshots[0].field_count, canonicalFieldRegistry.length + 1);
  reloaded.reset();
  assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(storage.getItem(first.storageKey), null);
});

test("registry validation rejects duplicate paths and malformed fields without persisting them", async () => {
  const review = createIntegrationReview(seed, new URLSearchParams());
  assert.equal((await review.handle(url("/api/canonical-registry/fields"), "POST", { ...field, path: "INVALID PATH" }))?.status, 400);
  assert.equal((await review.handle(url("/api/canonical-registry/fields"), "POST", field))?.status, 201);
  assert.equal((await review.handle(url("/api/canonical-registry/fields"), "POST", field))?.status, 409);
  assert.equal((await (await review.handle(url("/api/canonical-registry"), "GET"))!.json()).history.length, 1);
});

test("populated snapshots compare changed metadata against the current registry", async () => {
  const review = createIntegrationReview(seed, new URLSearchParams());
  const created = await (await review.handle(url("/api/canonical-registry/fields"), "POST", field))!.json();
  const id = created.fields.find((item: {path:string}) => item.path === field.path).field_id;
  assert.equal((await review.handle(url(`/api/canonical-registry/fields/${id}`), "PUT", { label: "Updated QA reference", aliases: [], status: "Draft" }))?.status, 200);
  const comparison = await (await review.handle(url("/api/canonical-registry/snapshots/qa-snapshot-1/compare"), "GET"))!.json();
  assert.deepEqual(comparison.counts, { added: 0, removed: 0, changed: 1 });
  assert.equal(comparison.diff.changed[0].after.label, "Updated QA reference");
});

test("save rejection keeps data unchanged and retry succeeds once, including after reload", async () => {
  const storage = memory(), query = new URLSearchParams("saveRecover&reviewCase=retry");
  const review = createIntegrationReview(seed, query, storage);
  assert.equal((await review.handle(url("/api/canonical-registry/fields"), "POST", field))?.status, 503);
  const reloaded = createIntegrationReview(seed, query, storage);
  assert.equal((await reloaded.handle(url("/api/canonical-registry/fields"), "POST", field))?.status, 201);
  assert.equal((await reloaded.handle(url("/api/canonical-registry/fields"), "POST", field))?.status, 409);
});

test("denied writes cannot change metadata and are not simulated user roles", async () => {
  const review = createIntegrationReview(seed, new URLSearchParams("integrationDenied"));
  assert.equal((await review.handle(url("/api/canonical-registry/fields"), "POST", field))?.status, 403);
  assert.equal((await (await review.handle(url("/api/canonical-registry"), "GET"))!.json()).fields.length, canonicalFieldRegistry.length);
});

test("route name saves are customer-scoped even when route identifiers are shared", async () => {
  const storage = memory(), query = new URLSearchParams();
  const review = createIntegrationReview(seed, query, storage);
  assert.equal((await review.handle(url("/api/customers/1249/output-routes/shared-route-id"), "PUT", { name: "Demo QA route" }))?.status, 200);
  const reloaded = createIntegrationReview(seed, query, storage);
  const demo = await (await reloaded.handle(url("/api/customers/1249/workspace"), "GET"))!.json();
  const other = await (await reloaded.handle(url("/api/customers/284619/workspace"), "GET"))!.json();
  assert.equal(demo.output_routes[0].name, "Demo QA route");
  assert.equal(other.output_routes[0].name, "Original");
});

test("fixture saves refuse routing or credentials changes rather than simulate unsupported behavior", async () => {
  const review = createIntegrationReview(seed, new URLSearchParams());
  assert.equal((await review.handle(url("/api/customers/1249/output-routes/shared-route-id"), "PUT", { name: "QA", target_id: "another-target" }))?.status, 423);
  assert.equal(await review.handle(url("/api/targets/lift/environments/qa/proofing-api"), "PUT", { client_secret: "fake" }), null);
  assert.equal(await review.handle(url("/api/customers/1249/jobs/job1/submit"), "POST", {}), null);
});

test("configured connection and source-specific fixtures use real source kinds with provider actions off", async () => {
  const review = createIntegrationReview(seed, new URLSearchParams());
  const workspace = await (await review.handle(url("/api/customers/1249/workspace"), "GET"))!.json();
  assert.ok(workspace.import_methods.some((method: {source:string}) => method.source === "Wrike"));
  assert.ok(workspace.import_methods.some((method: {source:string}) => method.source === "REST API"));
  const connections = await (await review.handle(url("/api/customers/1249/source-connections"), "GET"))!.json();
  assert.equal(connections.connections[0].provider_status.configured, true);
  assert.equal(connections.connections[0].provider_status.capabilities.lift_actions, false);
  assert.equal(connections.connections[0].provider_status.capabilities.wrike_writes, false);
  assert.equal(connections.connections[0].provider_status.connection_test_enabled, false);
});

test("Proofing API reads expose presence, never credential values; denial remains explicit", async () => {
  const path = url("/api/targets/lift/environments/qa/proofing-api");
  const review = createIntegrationReview(seed, new URLSearchParams());
  const config = await (await review.handle(path, "GET"))!.json();
  assert.equal(config.configured, true);
  assert.equal(config.client_secret, undefined);
  assert.equal(config.client_id, undefined);
  assert.equal((await createIntegrationReview(seed, new URLSearchParams("proofingError")).handle(path, "GET"))?.status, 403);
});

test("storage failure cannot report a successful save or alter current data", async () => {
  const review = createIntegrationReview(seed, new URLSearchParams(), { ...memory(), setItem() { throw new Error("quota"); } });
  assert.equal((await review.handle(url("/api/canonical-registry/fields"), "POST", field))?.status, 503);
  assert.equal((await (await review.handle(url("/api/canonical-registry"), "GET"))!.json()).fields.length, canonicalFieldRegistry.length);
});

test("read recovery retries once per resource without writing configuration", async () => {
  const review = createIntegrationReview(seed, new URLSearchParams("proofingRecover&snapshotRecover"));
  const proofing = url("/api/targets/lift/environments/qa/proofing-api");
  assert.equal((await review.handle(proofing, "GET"))?.status, 503);
  assert.equal((await review.handle(proofing, "GET"))?.status, 200);
  await review.handle(url("/api/canonical-registry/fields"), "POST", field);
  for (const suffix of ["", "/compare"]) {
    const snapshot = url(`/api/canonical-registry/snapshots/qa-snapshot-1${suffix}`);
    assert.equal((await review.handle(snapshot, "GET"))?.status, 503);
    assert.equal((await review.handle(snapshot, "GET"))?.status, 200);
  }
  const nonLift = structuredClone(seed);
  nonLift.targets[0].target_type = "Ecommerce";
  assert.equal((await createIntegrationReview(nonLift, new URLSearchParams()).handle(proofing, "GET"))?.status, 409);
});

test("the review adapter remains opt-in and rejects external origins before simulated writes", async () => {
  const entry = await readFile(new URL("../../../tests/ux/src.tsx", import.meta.url), "utf8");
  assert.match(entry, /query.has\("integrationReview"\)/);
  assert.ok(entry.indexOf('url.origin !== location.origin') < entry.indexOf('integration.handle(url'));
  assert.match(entry, /mutations are blocked/);
  assert.match(entry, /Simulated writes · this tab only/);
});
