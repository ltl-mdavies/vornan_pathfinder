import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { defaultOperationsFilters, filterOperationsJobs, operationsMetrics, proofLineHasState, sortProofLines, proofOrderGroupKey, type OperationsJob, type OperationsProofLine } from "../src/operations-model";
import { filterCustomers } from "../src/customer-directory";
// Components are browser-verified through tests/operations; model has no styling/runtime dependency.
const now = new Date("2026-10-23T14:20:00Z");
const job = (patch: Partial<OperationsJob> = {}): OperationsJob => ({ id: "j1", label: "JOB-1", customerId: "1", customer: "One", sourceOrder: "source1", intake: "Wrike", liftOrder: null, processing: "Submitted", production: "—", createdAt: now.toISOString(), confirmedAt: null, activityAt: now.toISOString(), archived: false, ...patch });
test("mixed Proof lines match each relevant filter without conflating reference and approval", () => {
  const row = { state: "pending", stateCounts: { pending: 1, changes: 1, reference: 1 } } as OperationsProofLine;
  assert.equal(proofLineHasState(row, "pending"), true);
  assert.equal(proofLineHasState(row, "changes"), true);
  assert.equal(proofLineHasState(row, "reference"), true);
  assert.equal(proofLineHasState(row, "approved"), false);
});
test("Proof grouping sorts before pagination, keeps numeric lines and customer-safe order keys", () => {
  const row = (id: string, customer: string, customerId: string, orderNumber: string, lineNumber: string) => ({ id, customer, customerId, orderNumber, lineNumber }) as OperationsProofLine;
  const rows = [row("b10", "Beta", "2", "A001", "10"), row("a2", "Alpha", "1", "A002", "2"), row("b2", "Beta", "2", "A001", "2"), row("a1", "Alpha", "1", "A001", "1")];
  assert.deepEqual(sortProofLines(rows, "customer").map(row => row.id), ["a1", "a2", "b2", "b10"]);
  assert.deepEqual(sortProofLines(rows, "order").map(row => row.id), ["a1", "b2", "b10", "a2"]);
  assert.notEqual(proofOrderGroupKey(rows[0]), proofOrderGroupKey(rows[3]));
  assert.equal(rows[0].id, "b10");
});
test("default jobs scope covers all customers and intake methods", () => {
  const jobs = [job(), job({ id: "j2", customerId: "2", intake: "JSON API" })];
  assert.equal(filterOperationsJobs(jobs, defaultOperationsFilters).length, 2);
  assert.equal(filterOperationsJobs(jobs, { ...defaultOperationsFilters, customer: "2" })[0]?.intake, "JSON API");
});
test("search, intake, archive and date filters compose without mutating source rows", () => {
  const jobs = [job(), job({ id: "j2", sourceOrder: "SP-100147", intake: "JSON API", archived: true })];
  assert.equal(filterOperationsJobs(jobs, { ...defaultOperationsFilters, archived: "all", search: "sp-", intake: "JSON API" }).length, 1);
  assert.equal(jobs[1]?.archived, true);
  assert.equal(filterOperationsJobs(jobs, { ...defaultOperationsFilters, days: "1" }, now.getTime() + 2 * 86_400_000).length, 0);
});
test("confirmed Lift association prevents historical submit state becoming an attention item", () => {
  assert.equal(filterOperationsJobs([job({ liftOrder: "A0233914", processing: "Submit Failed" })], { ...defaultOperationsFilters, attention: true }).length, 0);
});
test("today metrics use distinct creation and confirmation timestamps; backlog is not date scoped", () => {
  const metrics = operationsMetrics([job(), job({ id: "old", createdAt: "2026-10-20T12:00:00Z", liftOrder: "A0233914", confirmedAt: now.toISOString() }), job({ id: "unknown", liftOrder: "A0233886", confirmedAt: null })], now);
  assert.equal(metrics.receivedToday, 2); assert.equal(metrics.confirmedToday, 1); assert.equal(metrics.confirming, 1);
});

test("Admin integration keeps the new workspace opt-in and exceptions bound to their selected customer", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /VITE_ENABLE_OPERATIONS_WORKSPACE === "true"/);
  assert.match(source, /const operationsJobs: OperationsJob\[\] = globalJobs\.map/);
  assert.match(source, /const operationsIntakeVisibilityAvailable = isIntakeVisibilityAvailable\([^;]*operationsExceptionCustomer/);
  assert.match(source, /operationsExceptionCustomer && operationsIntakeVisibilityAvailable/);
  assert.match(source, /!operationsWorkspaceEnabled \? <ProofOpsPanel/);
});

test("customer navigation search matches names and identifiers without changing directory order", () => {
  const customers = [
    { lift_customer_id: "284619", customer_name: "Empirical – Momentara", customer_number: "MOM-1" },
    { lift_customer_id: "174094", customer_name: "Silicon Pasture", customer_number: "SP-1" }
  ];
  for (const query of [" silicon ", "174094", "sp-1"]) {
    assert.equal(filterCustomers(customers, query)[0]?.lift_customer_id, "174094");
  }
  assert.equal(filterCustomers(customers, "missing").length, 0);
  assert.equal(filterCustomers(customers, "").length, 2);
  assert.equal(customers[0]?.lift_customer_id, "284619");
});

test("customer switching preserves the selected tab and guards unsaved work and stale reads", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const switchHandler = source.slice(source.indexOf("const operationsSelectCustomer ="), source.indexOf("const operationsOpenDirectory ="));
  assert.match(switchHandler, /requestGuardedNavigation/);
  assert.doesNotMatch(switchHandler, /setActiveCustomerView\(/);
  for (const clear of ["setWorkspace(null)", "setSourceConnections([])", "setSelectedJobDetail(null)", "setOperationsProofOrder(null)"]) {
    assert.ok(switchHandler.includes(clear), `switch clears ${clear}`);
  }
  assert.match(switchHandler, /workspaceRequestIdRef\.current\+\+/);
  assert.match(switchHandler, /sourceConnectionsRequestIdRef\.current\+\+/);
  assert.match(source, /await loadSourceConnections\([^;]+;\s*if \(workspaceRequestIdRef\.current !== requestId\) return/);
  assert.match(source, /requestId !== sourceConnectionsRequestIdRef\.current \|\| liftCustomerId !== selectedCustomerIdRef\.current/);
  assert.match(source, /!visibleCustomerNavItems\.some\(item => item\.label === activeCustomerView\)/);
  assert.match(source, /<OperationsCustomers[^>]+currentTab=\{activeCustomerView\}/);
});

test("directory uses the full Lift list and preserves explicit workspace setup", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch\(`\$\{apiBaseUrl\}\/api\/lift\/customers\?refresh=1`\)/);
  assert.match(source, /<OperationsCustomers customers=\{customers\}/);
  assert.match(source, /if \(response.status === 404\)[\s\S]*?setWorkspaceSetupRequiredCustomerId\(liftCustomerId\)/);
  assert.match(source, /actionLabel=\{startup.setupRequired \? "Set up workspace" : "Try again"\}/);
  assert.match(source, /if \(startup.setupRequired && workspaceSetupRequiredCustomerId\)/);
  const selection = source.slice(source.indexOf("const operationsSelectCustomer ="), source.indexOf("const operationsOpenDirectory ="));
  assert.doesNotMatch(selection, /setupCustomerWorkspace|method: "POST"|customer_status/);
});

test("Pathfinder setup is sourced separately and lookup failures never imply missing workspace", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const directory = await readFile(new URL("../src/OperationsCustomers.tsx", import.meta.url), "utf8");
  assert.match(app, /api\/operations\/customer-workspaces/);
  assert.match(app, /workspaceIds=\{operationsWorkspaceIds\}/);
  assert.match(directory, /workspaceIds === null \? "unknown"/);
  assert.match(directory, /state === "ready" \? <span className="ops-customer-active"/);
  assert.match(directory, /state === "missing" \? "Not set up" : setupError \? "Setup unknown"/);
  assert.doesNotMatch(directory, /customer_status[^\n]*(?:===|==) "Active"/);
});

test("customer name and open chevron remain keyboard-accessible navigation, not setup actions", async () => {
  const source = await readFile(new URL("../src/OperationsCustomers.tsx", import.meta.url), "utf8");
  const directory = source.slice(source.indexOf("export function OperationsCustomers"));
  assert.match(directory, /className="ops-customer-name" onClick=\{\(\) => onSelect\(customer.lift_customer_id\)\}/);
  assert.match(directory, /aria-label=\{`Open \$\{customer.customer_name\}`\}/);
  assert.doesNotMatch(directory, /Set up workspace →|Open \$\{currentTab\}/);
  assert.match(directory, /rows.length > size \? <OperationsPagination/);
  assert.match(directory, /aria-label="Customer directory view"/);
  assert.match(directory, /value=\{view\}/);
});

test("new page typography inherits the production font families instead of mock-specific overrides", async () => {
  const css = await readFile(new URL("../src/operations-workspace.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /font-family\s*:|Georgia|Times New Roman/);
  const baseline = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(baseline, /h1,\s*h2\s*\{[^}]*font-family: "Plus Jakarta Sans", Inter, sans-serif/);
  assert.match(baseline, /button,\s*input,\s*select,\s*textarea\s*\{\s*font: inherit/);
});

test("customer directory defaults to Pathfinder customers with only an All Lift customers alternative", async () => {
  const source = await readFile(new URL("../src/OperationsCustomers.tsx", import.meta.url), "utf8");
  const directory = source.slice(source.indexOf("export function OperationsCustomers"));
  assert.match(directory, /useState<"pathfinder" \| "lift">\("pathfinder"\)/);
  assert.match(directory, /view === "lift" \|\| configured.has\(c.lift_customer_id\)/);
  assert.match(directory, /<option value="pathfinder">Pathfinder Customers<\/option>/);
  assert.match(directory, /<option value="lift">All Lift Customers<\/option>/);
  assert.doesNotMatch(directory, /customer_status|All setup states/);
});
