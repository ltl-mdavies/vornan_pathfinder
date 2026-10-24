import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { operationsJobsPageSize } from "../src/operations-model";

const source = (name: string) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");

test("compact Jobs density reserves working controls at approved desktop sizes", () => {
  assert.equal(operationsJobsPageSize(768), 11);
  assert.equal(operationsJobsPageSize(900), 14);
  assert.equal(operationsJobsPageSize(1080), 18);
  assert.equal(operationsJobsPageSize(384), 5);
});
test("shared shell includes all destinations and keeps feature opt-out", async () => {
  const app = await source("App.tsx"), shell = await source("PathfinderShell.tsx");
  assert.match(app, /const operationsShell = operationsWorkspaceEnabled;/);
  assert.match(shell, /if \(!enabled\) return <main className="app-shell">/);
  assert.match(shell, /aria-label="Primary"/);
  assert.match(shell, /href="#pathfinder-content"/);
  assert.match(shell, /vornan-wordmark.svg/);
  assert.match(app, /embedded=\{operationsShell\}/);
});
test("old job reads cannot overwrite a newer scope, and back retains mounted queue state", async () => {
  const app = await source("App.tsx");
  assert.match(app, /const requestId = \+\+jobDetailRequestIdRef.current/);
  assert.equal((app.match(/if \(requestId !== jobDetailRequestIdRef.current\) return/g) ?? []).length, 2);
  assert.match(app, /function closeJobDetail\(\) \{\s*jobDetailRequestIdRef.current\+\+/);
  assert.equal((app.match(/hidden=\{Boolean\(selectedJobDetail\)\}/g) ?? []).length, 2);
  assert.match(app, /allJobsUnfiltered = operationsWorkspaceEnabled \? globalJobs/);
});
test("customer gates remain independent of job count and Catalog keeps its internal key", async () => {
  const app = await source("App.tsx"), customers = await source("OperationsCustomers.tsx");
  assert.match(app, /onIntakeFollowup=\{intakeVisibilityAvailable \?/);
  assert.match(app, /activeCustomerView === "Intake Exceptions" && intakeVisibilityAvailable/);
  assert.match(customers, /tab === "Artwork Catalog" \? "Catalog" : tab/);
  assert.match(customers, /tab === "Jobs" && selected === "Intake Exceptions"/);
});
test("inspector is read-only, named, keyboard-contained when modal, and opens full detail", async () => {
  const inspector = await source("OperationsJobInspector.tsx");
  assert.doesNotMatch(inspector, /fetch\(|apiBaseUrl|setInterval|POST|PUT/);
  assert.match(inspector, /aria-labelledby="job-inspector-title"/);
  assert.match(inspector, /showModal\(\)/);
  assert.match(inspector, /matches\(":modal"\)/);
  assert.match(inspector, /origin\.focus\(\)/);
  assert.match(inspector, /Open full job details/);
});
test("bulk actions use original archive confirmation handlers in both scopes", async () => {
  const app = await source("App.tsx"), jobs = await source("OperationsWorkspace.tsx");
  assert.match(app, /requestJobsArchive\(customerJobsUnfiltered.filter/);
  assert.match(app, /requestJobsArchive\(allJobsUnfiltered.filter/);
  assert.match(jobs, /selectedRows.length && onArchive/);
  assert.match(jobs, /Archive selected/);
  assert.match(jobs, /Restore selected/);
});
