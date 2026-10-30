import type { CanonicalFieldDefinition } from "@pathfinder/canonical";
import type { PathfinderCustomerWorkspace, TargetConfig } from "../../apps/api/src/store";
import { SOURCE_CONNECTOR_DEFINITIONS } from "@pathfinder/source-connections";
import { normalizeWrikeSourceConfig } from "@pathfinder/wrike-adapter";

// Test-only contract simulator. It has no transport, credentials or production imports.
// Only the explicit metadata/name writes below can succeed. Everything else stays blocked.
type Field = CanonicalFieldDefinition & { origin?: "core" | "custom"; usage?: Record<string, number> };
type Change = { change_id: string; action: "custom_field_created" | "field_metadata_updated"; summary: string; created_at: string; field_id: string; field_path: string };
type Snapshot = { snapshot_id: string; registry_id: string; version: string; status: string; field_count: number; custom_field_count: number; change_id: string; action: Change["action"]; summary: string; created_at: string; fields: Field[] };
type Registry = { registry_id: string; version: string; status: string; updated_at: string; fields: Field[]; sections: string[]; field_count: number; history?: Change[]; snapshots?: Omit<Snapshot, "fields">[] };
export type IntegrationSeed = { registry: Registry; workspaces: Record<string, PathfinderCustomerWorkspace>; targets: TargetConfig[] };
type State = { version: 1; sequence: number; fields: Field[]; history: Change[]; snapshots: Snapshot[]; routeNames: Record<string, Record<string, string>>; methodNames: Record<string, Record<string, string>>; failures: string[] };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const clone = <T,>(value: T): T => structuredClone(value);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const usage = { import_method_mappings: 0, saved_mapping_templates: 0, output_template_mappings: 0, output_template_tokens: 0, value_rules: 0, total: 0 };
const timestamp = (sequence: number) => new Date(Date.UTC(2026, 9, 24, 12, 0, sequence)).toISOString();
const blocked = () => reply({ error: "Local integration review does not simulate this write. No provider request was made." }, 423);

export function createIntegrationReview(seed: IntegrationSeed, query: URLSearchParams, storage?: Storage) {
  const caseName = (query.get("reviewCase") ?? "default").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const storageKey = `pathfinder-ux-integration-v1:${caseName}`;
  const initial = (): State => ({ version: 1, sequence: 0, fields: clone(seed.registry.fields).map(field => ({ ...field, origin: "core", usage: { ...usage } })), history: [], snapshots: [], routeNames: {}, methodNames: {}, failures: [] });
  let state = initial();
  const failedReads = new Set<string>();
  function failReadOnce(flag: string, path: string) {
    if (!query.has(flag) || failedReads.has(path)) return false;
    failedReads.add(path);
    return true;
  }
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) ?? "null") as State | null;
    if (saved?.version === 1 && Number.isInteger(saved.sequence) && Array.isArray(saved.fields) && Array.isArray(saved.history) && Array.isArray(saved.snapshots) && Array.isArray(saved.failures) && saved.routeNames && saved.methodNames) state = saved;
  } catch { /* A corrupt test session starts fresh; never reach another storage or API. */ }
  function commit(next: State) { storage?.setItem(storageKey, JSON.stringify(next)); state = next; }
  function registry() {
    return { ...clone(seed.registry), updated_at: timestamp(state.sequence), fields: clone(state.fields), field_count: state.fields.length, sections: [...new Set(state.fields.map(field => field.section))], history: clone(state.history), snapshots: state.snapshots.map(({ fields: _fields, ...summary }) => clone(summary)) };
  }
  function record(next: State, field: Field, action: Change["action"]) {
    next.sequence++;
    const change: Change = { change_id: `qa-change-${next.sequence}`, action, summary: `${action === "custom_field_created" ? "Created" : "Updated"} ${field.path}.`, created_at: timestamp(next.sequence), field_id: field.field_id, field_path: field.path };
    next.history = [change, ...next.history].slice(0, 50);
    next.snapshots = [{ snapshot_id: `qa-snapshot-${next.sequence}`, registry_id: seed.registry.registry_id, version: `${seed.registry.version}+local.${next.sequence}`, status: seed.registry.status, field_count: next.fields.length, custom_field_count: next.fields.filter(item => item.origin === "custom").length, change_id: change.change_id, action, summary: change.summary, created_at: change.created_at, fields: clone(next.fields) }, ...next.snapshots].slice(0, 20);
  }
  function connection(customer: string) {
    return {
      connection_id: `qa-wrike-${customer}`, name: "Synthetic Wrike workspace", provider: "wrike" as const, status: "Active" as const, environment: "Sandbox" as const, auth_strategy: "oauth2" as const, created_at: timestamp(0), updated_at: timestamp(0), definition: SOURCE_CONNECTOR_DEFINITIONS.find(item => item.provider === "wrike"),
      provider_status: { configured: true, oauth_connect_ready: false, oauth_redirect_uri: "https://example.invalid/disabled", authorization_pending: false, authorization_expires_at: null, connection_test_enabled: false, custom_field_discovery_enabled: false, discovery_preview_enabled: false, workbook_evidence_enabled: false, evidence_preview_enabled: false, manual_intake_enabled: false, status_writeback_enabled: false, host: "www.wrike.com", credentials: { client_id_configured: true, client_secret_configured: true, refresh_token_configured: true, access_token_cached: false, access_token_expires_at: null }, health: { status: "Not tested", host: "www.wrike.com", checked_at: null, identity_confirmed: false, message: "Synthetic configured connection. No provider test has run." }, capabilities: { oauth_authorization: false, oauth_refresh: false, identity_check: false, requested_scope: "wsReadWrite", custom_field_metadata: false, task_discovery: false, attachment_metadata: false, attachment_download: false, source_evidence_persistence: false, preview_job_creation: false, manual_intake: false, webhook: false, polling: false, wrike_writes: false, lift_actions: false } }
    };
  }
  function workspace(customer: string) {
    const source = seed.workspaces[customer];
    if (!source) return null;
    const result = clone(source);
    result.output_routes.forEach(route => { route.name = state.routeNames[customer]?.[route.output_route_id] ?? route.name; });
    const sample = result.import_methods[0];
    result.import_methods.push(
      { ...clone(sample), import_method_id: "qa-real-wrike", name: "Wrike source editor", source: "Wrike", type: "Scheduled", status: "Paused", source_config: { ...sample.source_config, wrike: normalizeWrikeSourceConfig({ enabled: false, connection_id: `qa-wrike-${customer}` }) } },
      { ...clone(sample), import_method_id: "qa-real-rest", name: "REST source editor", source: "REST API", type: "API import", status: "Draft", source_config: { ...sample.source_config, api_endpoint_url: "https://example.invalid/qa-only" } }
    );
    result.import_methods.forEach(method => { method.name = state.methodNames[customer]?.[method.import_method_id] ?? method.name; });
    result.source_connections = [connection(customer)];
    return result;
  }
  const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>) => Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  function saveGate(path: string) {
    if (query.has("integrationDenied")) return reply({ error: "Synthetic denied write. This fixture does not represent a new Pathfinder role." }, 403);
    if (query.has("saveRecover") && !state.failures.includes(path)) {
      const next = clone(state); next.failures.push(path); commit(next);
      return reply({ error: "Synthetic temporary save failure. Nothing was saved; retry is safe in this local review." }, 503);
    }
    return null;
  }
  async function handle(url: URL, method: string, body?: unknown): Promise<Response | null> {
    const path = url.pathname;
    const customer = path.match(/^\/api\/customers\/([^/]+)\//)?.[1];
    if (method === "GET" && path === "/api/canonical-registry") return reply(registry());
    const snapshotMatch = path.match(/^\/api\/canonical-registry\/snapshots\/([^/]+)(\/compare)?$/);
    if (method === "GET" && snapshotMatch) {
      if (query.has("snapshotError") || failReadOnce("snapshotRecover", path)) return reply({ error: "Synthetic snapshot read unavailable." }, 503);
      const snapshot = state.snapshots.find(item => item.snapshot_id === snapshotMatch[1]);
      if (!snapshot) return reply({ error: "Canonical registry snapshot not found." }, 404);
      if (!snapshotMatch[2]) return reply({ snapshot });
      const before = new Map(snapshot.fields.map(field => [field.path, field]));
      const current = new Map(state.fields.map(field => [field.path, field]));
      const added = state.fields.filter(field => !before.has(field.path));
      const removed = snapshot.fields.filter(field => !current.has(field.path));
      const changed = state.fields.filter(field => before.has(field.path) && JSON.stringify(before.get(field.path)) !== JSON.stringify(field)).map(field => ({ path: field.path, before: before.get(field.path), after: field }));
      return reply({ snapshot_id: snapshot.snapshot_id, snapshot_version: snapshot.version, current_version: seed.registry.version, counts: { added: added.length, removed: removed.length, changed: changed.length }, diff: { added, removed, changed } });
    }
    if (method === "GET" && customer && path.endsWith("/workspace")) {
      if (query.has("verifyDelay") && state.failures.some(item => item.includes(`/customers/${customer}/import-methods/`))) await new Promise(resolve => setTimeout(resolve, 2500));
      return reply(workspace(customer) ?? { error: "Workspace not found." }, workspace(customer) ? 200 : 404);
    }
    if (method === "GET" && customer && path.endsWith("/source-connections")) return query.has("connectionsError") ? reply({ error: "Synthetic source-connection read denied." }, 403) : reply({ definitions: SOURCE_CONNECTOR_DEFINITIONS, connections: seed.workspaces[customer] ? [connection(customer)] : [] });
    const proofing = path.match(/^\/api\/targets\/([^/]+)\/environments\/([^/]+)\/proofing-api$/);
    if (method === "GET" && proofing) {
      if (query.has("proofingError")) return reply({ error: "Synthetic Proofing API configuration read denied." }, 403);
      if (failReadOnce("proofingRecover", path)) return reply({ error: "Synthetic temporary Proofing API configuration read failure." }, 503);
      const target = seed.targets.find(item => item.target_id === proofing[1]);
      if (!target) return reply({ error: "Target was not found." }, 404);
      if (target.target_type !== "ERP" || target.adapter !== "lift-standard-graphics") return reply({ error: "Proofing API setup is available only for Lift ERP targets." }, 409);
      if (!target?.environments.some(item => item.environment_id === proofing[2])) return reply({ error: "Target environment was not found." }, 404);
      return reply({ base_url: "https://example.invalid/ords/api/lift/erp", company_id: "91", action_user_name: "VORNAN_PROOF", client_id_configured: true, client_secret_configured: true, configured: true, updated_at: timestamp(0), audit_events: [{ event_id: "qa-proofing-read", action: "configured", actor_id: "qa-only", occurred_at: timestamp(0) }] });
    }
    const fieldMatch = path.match(/^\/api\/canonical-registry\/fields(?:\/([^/]+))?$/);
    if (fieldMatch && ((method === "POST" && !fieldMatch[1]) || (method === "PUT" && fieldMatch[1]))) {
      const gate = saveGate(path); if (gate) return gate;
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid JSON object." }, 400);
      const input = body as Record<string, unknown>;
      const label = typeof input.label === "string" ? input.label.trim() : "";
      if (!label) return reply({ error: "Label is required." }, 400);
      const next = clone(state);
      const aliases = Array.isArray(input.aliases) ? input.aliases.map(String).map(item => item.trim()).filter(Boolean) : typeof input.aliases === "string" ? input.aliases.split(",").map(item => item.trim()).filter(Boolean) : [];
      let field: Field;
      if (method === "POST") {
        const fieldPath = typeof input.path === "string" ? input.path.trim() : "";
        if (!/^[a-z][a-z0-9_]*(\[\])?(\.[a-z][a-z0-9_]*(\[\])?)*$/.test(fieldPath)) return reply({ error: "Path must use dot notation, lowercase words, underscores, and optional [] arrays." }, 400);
        if (state.fields.some(item => item.path === fieldPath)) return reply({ error: "A canonical field with this path already exists." }, 409);
        if (!["customer", "contacts", "source", "target", "order", "shipping", "lines"].includes(String(input.section)) || !["string", "number", "integer", "boolean", "datetime", "url", "object"].includes(String(input.data_type))) return reply({ error: "Choose a valid section and data type." }, 400);
        field = { field_id: `qa.custom.${state.sequence + 1}`, path: fieldPath, label, section: input.section as Field["section"], data_type: input.data_type as Field["data_type"], required: Boolean(input.required), repeatable: typeof input.repeatable === "boolean" ? input.repeatable : fieldPath.includes("[]"), status: ["Active", "Draft", "Deprecated"].includes(String(input.status)) ? input.status as Field["status"] : "Draft", aliases, description: typeof input.description === "string" ? input.description.trim() : undefined, origin: "custom", usage: { ...usage } };
        next.fields.push(field);
      } else {
        const existing = next.fields.find(item => item.field_id === decodeURIComponent(fieldMatch[1]));
        if (!existing) return reply({ error: "Canonical field not found." }, 404);
        if (input.status && !["Active", "Draft", "Deprecated"].includes(String(input.status))) return reply({ error: "Status must be Active, Draft, or Deprecated." }, 400);
        field = Object.assign(existing, { label, aliases, ...(input.status ? { status: input.status } : {}), ...(typeof input.description === "string" ? { description: input.description.trim() } : {}) });
      }
      record(next, field, method === "POST" ? "custom_field_created" : "field_metadata_updated"); commit(next);
      return reply(registry(), method === "POST" ? 201 : 200);
    }
    const nameMatch = path.match(/^\/api\/customers\/([^/]+)\/(output-routes|import-methods)\/([^/]+)$/);
    if (method === "PUT" && nameMatch) {
      if (query.has("saveDelay")) await new Promise(resolve => setTimeout(resolve, 2500));
      const gate = saveGate(path); if (gate) return gate;
      const current = workspace(nameMatch[1]);
      const collection = nameMatch[2] === "output-routes" ? current?.output_routes : current?.import_methods;
      const existing = collection?.find(item => ("output_route_id" in item && nameMatch[2] === "output-routes" ? item.output_route_id : (item as { import_method_id: string }).import_method_id) === nameMatch[3]);
      if (!existing) return reply({ error: "Customer-scoped record not found." }, 404);
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "Invalid JSON object." }, 400);
      const input = body as Record<string, unknown>;
      if (changedKeys(existing as unknown as Record<string, unknown>, input).some(key => key !== "name")) return blocked();
      if (typeof input.name !== "string" || !input.name.trim()) return reply({ error: "Name is required in this local scenario." }, 400);
      const next = clone(state), key = nameMatch[2] === "output-routes" ? "routeNames" : "methodNames";
      next[key][nameMatch[1]] = { ...next[key][nameMatch[1]], [nameMatch[3]]: input.name.trim() }; next.sequence++; commit(next);
      if (query.has("saveUncertain") && !state.failures.includes(path)) {
        next.failures.push(path); commit(next);
        return reply({ error: "Local QA: saved response interrupted." }, 503);
      }
      return reply(workspace(nameMatch[1]));
    }
    return null;
  }
  return {
    storageKey,
    reset() { storage?.removeItem(storageKey); state = initial(); },
    async handle(url: URL, method: string, body?: unknown) {
      try { return await handle(url, method, body); }
      catch { return reply({ error: "Local fixture storage is unavailable. No change was committed." }, 503); }
    }
  };
}
