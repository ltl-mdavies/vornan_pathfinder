import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/pathfinder-shell.css", import.meta.url), "utf8");
const section = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));

test("Settings sections stay mounted, with inactive controls hidden and native button navigation", () => {
  assert.match(source, /\["Canonical registry", "Transactional email", "Governance"\] as const/);
  assert.match(source, /aria-current=\{activeSettingsSection === section \? "page" : undefined\}/);
  for (const [panel, name] of [["canonical-registry-panel", "Canonical registry"], ["email-health-panel", "Transactional email"], ["canonical-governance-panel", "Governance"]]) {
    assert.ok(source.includes(`className="panel ${panel}" hidden={operationsShell && activeSettingsSection !== "${name}"}`));
  }
  assert.match(css, /\.pf-shell \[hidden\]\{display:none!important\}/);
  for (const handler of ['downloadCanonicalRegistry("json")', 'downloadCanonicalRegistry("csv")', 'openCanonicalSnapshot(latestCanonicalSnapshot.snapshot_id)', 'setNewCanonicalFieldDraft']) assert.ok(source.includes(handler), handler);
});

test("Email unavailable differs from log mode and stale reads retain their last-success time", () => {
  const load = section('async function loadEmailStatus()', 'function updateSourceConnectionPayload');
  assert.match(load, /setEmailStatusReadAt\(new Date\(\).toISOString\(\)\)/);
  const failure = load.slice(load.indexOf('catch (error)'));
  assert.doesNotMatch(failure, /setEmailStatus\(|setEmailStatusReadAt\(/);
  assert.match(source, /emailStatus\?\.mode === "log"\s*\? "Status links are recorded, not sent to customers yet\."/);
  assert.match(source, /Delivery mode is unknown until configuration can be read/);
  assert.match(source, /Last read \{displayTimestamp\(emailStatusReadAt\)\}/);
  assert.match(source, /Showing last loaded email configuration/);
});

test("Targets retain scoped customer saving, shared-save guard and all inner sections", () => {
  assert.match(source, /Customer route context: <strong>\{selectedCustomer.customer_name\}/);
  assert.match(source, /Shared target saving is currently unavailable/);
  for (const name of ['Environments', 'Output Templates', 'Output Routes', 'Value Rules', 'Test & Health']) assert.ok(source.includes(`activeTargetsView === "${name}"`));
  assert.match(source, /selectedTargetHasSharedUnsavedChanges\s*\? "Save unavailable"\s*:\s*"Save Customer Route"/);
  assert.match(source, /onClick=\{\(\) => void saveTarget\(selectedTarget\)\}/);
  assert.match(source, /requestGuardedNavigation\(\(\) => setSelectedTargetId\(null\)\)/);
});

test("Audit describes the existing filtered summary rather than inventing event history", () => {
  const audit = section('{activeGlobalView === "Audit" ? (', '{activeGlobalView === "Settings" ? (');
  assert.match(audit, /event history is not available in this view/);
  assert.match(audit, /Jobs in current view/);
  assert.ok(audit.includes('customerJobReadUnavailable ? "Not available" : `${allJobs.length} loaded`'));
  assert.match(audit, /current global Jobs filters and loaded records/);
});

test("Source setup uses actual origin and sparse source grids grow only to their height cap", () => {
  assert.match(source, /<strong>\{sourceColumnOrigin\}<\/strong>/);
  assert.match(source, /<span>\{sourceColumnOriginDetail\}<\/span>/);
  assert.doesNotMatch(source, /Loaded workbook columns are active/);
  assert.match(source, /className="source-grid" tabIndex=\{0\} role="region" aria-label="Imported source rows"/);
  assert.match(css, /\[data-customer-view="Manual Import"\] \.source-grid \{height:auto;max-height:376px;overflow:auto\}/);
});

test("Administration styles are shell-scoped and preserve customer Proof and Public Status controls", () => {
  assert.match(source, /data-admin-view=\{operationsShell \? activeGlobalView : undefined\}/);
  for (const scope of ['Targets', 'Settings', 'Audit']) assert.ok(css.includes(`[data-admin-view="${scope}"]`));
  const settings = section('{activeCustomerView === "Settings" ? (', '{activeGlobalView === "Targets" ? (');
  for (const capability of ['ProofCustomerCapabilitySetup', 'saveCustomerProofCapability', 'Public Status Access', 'sourceConnections', 'selectedCustomer.customer_name']) assert.ok(settings.includes(capability), capability);
});

test("Registry feedback belongs to its section and receives focus without clearing failed drafts", () => {
  const reporter = section('function reportCanonicalFeedback', '// Focus only newly reported registry feedback');
  assert.match(reporter, /if \(!operationsShell\) setWorkspaceMessage\(message\)/);
  const registry = section('<section className="panel canonical-registry-panel"', '{isCreatingCanonicalField ? (');
  assert.match(registry, /ref=\{canonicalFeedbackRef\} tabIndex=\{-1\}/);
  assert.match(registry, /role=\{canonicalFeedback.error \? "alert" : "status"\}/);
  assert.match(source, /activeSettingsSection === "Canonical registry"\) \{\s*canonicalFeedbackRef.current\?\.focus\(\)/);
  const create = section('async function createCanonicalRegistryField()', 'function deleteCanonicalRegistryField');
  const failure = create.slice(create.indexOf('catch (error)'));
  assert.match(failure, /reportCanonicalFeedback/);
  assert.doesNotMatch(failure, /setNewCanonicalFieldDraft|setIsCreatingCanonicalField/);
  assert.doesNotMatch(source, /operationsShell && workspaceMessage \? <p className=\{workspaceState === "error" \|\| canonicalRegistryState/);
});

test("Source-connection denied reads are unknown and planned templates stay collapsed", () => {
  assert.match(source, /setSourceConnectionsReadState\("ready"\)/);
  assert.match(source, /setSourceConnectionsReadState\("error"\)/);
  assert.match(source, /Connection count is unknown/);
  assert.match(source, /Connections unavailable/);
  assert.match(source, /\) : sourceConnectionsReadState === "ready" \? \(\s*<p className="empty-state source-connections-empty"/);
  assert.match(source, /<details className="pf-planned-connectors">/);
  assert.match(source, /!operationsShell \|\| definition.availability === "Available"/);
  assert.match(source, /aria-label="Saved customer source connections"/);
});

test("Target health describes the existing diagnostics rather than claiming unconditional success", () => {
  assert.match(source, /buildRouteDiagnostics\(\{ target: selectedTarget, route: selectedTargetTestRoute, environment: selectedTargetTestEnvironment, template: selectedTargetTestTemplate \}\)/);
  assert.match(source, /selectedTargetTestDiagnostics.blocking_count/);
  assert.match(source, /selectedTargetTestDiagnostics.warning_count/);
  assert.match(source, /No customer route is configured; readiness has not been established/);
  assert.doesNotMatch(source, /Route diagnostics are passing/);
});

test("Governance failed reads stay scoped, focus the error and offer a retry of the exact snapshot", () => {
  const open = section('async function openCanonicalSnapshot', 'async function loadLiftUnitCatalog');
  assert.match(open, /setCanonicalSnapshotError\(null\)/);
  assert.match(open, /setCanonicalSnapshotError\(\{ snapshotId, message:/);
  assert.doesNotMatch(open, /setWorkspaceMessage/);
  const governance = section('<section className="panel canonical-governance-panel"', '<section className="panel canonical-registry-panel"');
  assert.match(governance, /ref=\{canonicalSnapshotErrorRef\} tabIndex=\{-1\}.*role="alert"/);
  assert.match(governance, /openCanonicalSnapshot\(canonicalSnapshotError.snapshotId\)/);
  assert.match(governance, /Retry snapshot/);
});

test("opening another import method clears feedback from the previous record", () => {
  const open = section('function openImportMethodDetail', 'function createDraftImportMethod');
  assert.match(open, /setWorkspaceMessage\(null\)/);
  assert.match(source, /setIsImportMethodDetailOpen\(false\); setWorkspaceMessage\(null\)/);
});
