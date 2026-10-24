import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/pathfinder-shell.css", import.meta.url), "utf8");
const section = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));
const overview = section('{activeCustomerView === "Overview" ? (', '{activeCustomerView === "Artwork Catalog"');
const mapping = section('{activeCustomerView === "Output Product Map" ? (', '{activeCustomerView === "Manual Import" ? (');
const manual = section('{activeCustomerView === "Manual Import" ? (', '{operationsShell && activeCustomerView === "Jobs"');

test("Overview leads with operational metrics and jobs, retaining account/route controls", () => {
  assert.ok(overview.indexOf('aria-label="Customer KPIs"') < overview.indexOf('className="customer-overview"'));
  assert.ok(overview.indexOf('className="panel jobs-panel"') < overview.indexOf('className="panel method-panel"'));
  for (const capability of ['Customer record details', 'Account Status', 'Credit Hold', 'View target setup', 'customerDirectory.warning', 'workspaceMessage', 'createDraftImportMethod', 'openJobDetail(job)']) assert.ok(overview.includes(capability), capability);
  assert.match(source, /rankRecentOperationalJobs\(activeCustomerJobs\)/);
  assert.match(source, /activeCustomerJobs = customerJobsUnfiltered.filter\(\(job\) => !job.archived_at\)/);
  assert.match(overview, /customerJobReadUnavailable \? "—" : value/);
  assert.match(overview, /Counts are unavailable until job activity loads/);
  assert.match(overview, /Counts use loaded, non-archived jobs/);
});

test("Mapping retains scoped diagnostics, individual assignment and guarded bulk review", () => {
  assert.match(mapping, /<details className="pf-route-diagnostics">/);
  assert.match(mapping, /selectedUnitMappings.length > 0 \? <div className="unit-map-bulkbar">/);
  for (const capability of ['selectedOutputMapEnvironment', 'product_mapping_replacement_checkpoint', 'Review Assignment', 'openCatalogForMapping(mapping)', 'saveProductMapping(mapping)', 'Select all visible unit mappings', 'source_scope_id']) assert.ok(mapping.includes(capability), capability);
  assert.match(mapping, /disabled=\{workspaceState === "saving" \|\| selectedUnitMappings.length < 2\}/);
  assert.match(mapping, /aria-label="Search output product mappings"/);
  assert.ok(mapping.indexOf('className="unit-map-panel-header"') < mapping.indexOf('className="pf-route-diagnostics"'));
  assert.match(mapping, /<details className="pf-catalog-shortcuts">/);
  assert.ok(mapping.indexOf('className="unit-map-table-wrap"') < mapping.indexOf('className="pf-map-selection-hint"'));
  assert.match(css, /\.unit-map-table \{table-layout:fixed;width:100%;min-width:1050px\}/);
});

test("Manual Import moves source/validation before diagnostics without changing submission gates", () => {
  assert.ok(manual.indexOf('className="panel upload-panel"') < manual.indexOf('className="submit-readiness-grid"'));
  assert.ok(manual.indexOf('className="panel validation-panel"') < manual.indexOf('className="panel submit-preflight-panel"'));
  assert.ok(manual.indexOf('className="panel submit-preflight-panel"') < manual.indexOf('className="panel certification-panel"'));
  for (const capability of ['prodSandboxConfirmationRequired', 'prodSandboxSubmitConfirmed', 'manualPreviewCreationBlocked', 'submitCertification.summary', 'downloadSubmitPacket', 'requestLiftSubmit()', 'lastSubmitAttempt', 'displayedProductResolutionRows', 'Field Mapping']) assert.ok(manual.includes(capability), capability);
  assert.match(manual, /!lastPreviewJob.submit_integrity\?\.fingerprint/);
  assert.match(manual, /!submitCertification.external_submit_enabled/);
  assert.doesNotMatch(source, /Upload the Momentara workbook/);
  assert.equal((manual.match(/<details className="panel code-panel pf-raw-evidence">/g) ?? []).length, 2);
  assert.match(manual, /className="panel code-panel source-panel"/);
});

test("Credential preflight reports the certification decision, not placeholder presence", () => {
  assert.match(source, /credentialCertificationItem = submitCertification.items.find\(\(item\) => item.item_id === "credentials"\)/);
  const preflight = section('label: "Credentials",', 'label: "Submit Customer",');
  assert.match(preflight, /credentialCertificationItem\?\.message/);
  assert.match(preflight, /status: credentialCertificationItem\?\.status \?\? "Warning"/);
  assert.doesNotMatch(preflight, /activeRouteUserSaved|activeRoutePasswordSaved/);
  assert.match(source, /configuredSecret\(args.request.headers.User\) && configuredSecret\(args.request.headers.Password\)/);
});

test("Customer styling remains scoped to the shared Admin shell", () => {
  assert.match(source, /workspaceMessage && \["Import Methods", "Output Product Map", "Manual Import"\].includes\(activeCustomerView\)/);
  assert.match(source, /role=\{workspaceState === "error" \? "alert" : "status"\}/);
  assert.match(source, /data-customer-view=\{operationsShell && activeGlobalView === "Customers" \? activeCustomerView : undefined\}/);
  assert.match(css, /\.pf-shell \[data-customer-view="Overview"\]/);
  assert.match(css, /\.pf-shell \[data-customer-view="Import Methods"\]/);
  assert.match(css, /\.pf-shell \[data-customer-view="Output Product Map"\]/);
  assert.match(css, /\.pf-shell \[data-customer-view="Manual Import"\]/);
});
