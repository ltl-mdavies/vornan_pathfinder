import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceLoading } from "../src/WorkspaceLoading";
import { workspaceLoadingState } from "../src/workspace-loading-state";

const ready = {
  operations: true, view: "Dashboard", customerCount: 3, customersLoading: false,
  selectedCustomerId: "284619", workspaceMatches: true, workspaceState: "idle",
  targetsPending: false, registryPending: false
};
const initial = { ...ready, customerCount: 0, customersLoading: true, selectedCustomerId: "", workspaceMatches: false, workspaceState: "loading", targetsPending: true, registryPending: true };

test("root startup and reload stay application-scoped through slow bootstrap phases", () => {
  const states = [initial, { ...initial, customerCount: 3, customersLoading: false, selectedCustomerId: "284619" }, { ...ready, targetsPending: true }, { ...ready, registryPending: true }];
  for (const state of [...states, ...states]) {
    const result = workspaceLoadingState(state);
    assert.equal(result.pending, true);
    assert.equal(result.scope, "application");
    assert.equal(result.showDirectory, false);
    assert.equal(result.setupRequired, false);
    assert.equal(result.error, null);
  }
  assert.equal(workspaceLoadingState(ready).pending, false);
});

test("a background customer's missing workspace never becomes a Dashboard setup action", () => {
  const state = { ...ready, workspaceMatches: false, workspaceState: "error", setupCustomerId: "284619", workspaceError: "Setup required" };
  for (const view of ["Dashboard", "Jobs", "Proof", "Customer Directory", "Targets", "Settings", "Audit"]) {
    assert.deepEqual(workspaceLoadingState({ ...state, view }), { pending: false, error: null, scope: "application", showDirectory: false, setupRequired: false });
  }
});

test("customer deep-link loading, error, retry and explicit setup remain scoped", () => {
  const customer = { ...ready, view: "Customers", selectedCustomerId: "1249", workspaceMatches: false, workspaceState: "loading" };
  assert.equal(workspaceLoadingState(customer).scope, "customer");
  assert.equal(workspaceLoadingState(customer).showDirectory, false);
  const error = workspaceLoadingState({ ...customer, workspaceState: "error", workspaceError: "Access denied" });
  assert.equal(error.error, "Access denied");
  assert.equal(error.showDirectory, true);
  assert.equal(error.setupRequired, false);
  assert.equal(workspaceLoadingState({ ...customer, workspaceState: "error", setupCustomerId: "1249" }).setupRequired, true);
  assert.equal(workspaceLoadingState({ ...customer, workspaceState: "error", setupCustomerId: "284619" }).setupRequired, false);
  assert.equal(workspaceLoadingState(customer).pending, true); // retry
  assert.equal(workspaceLoadingState({ ...customer, workspaceMatches: true, workspaceState: "idle" }).pending, false);
});

test("directory failure has priority over a customer return path and retains retry feedback", () => {
  const state = workspaceLoadingState({ ...initial, view: "Customers", selectedCustomerId: "1249", customersLoading: false, directoryError: "Directory unavailable" });
  assert.equal(state.error, "Directory unavailable");
  assert.equal(state.scope, "application");
  assert.equal(state.showDirectory, false);
  assert.equal(state.pending, false);
});

test("embedded pending rendering never flashes legacy panels or customer recovery actions", () => {
  for (const scope of ["application", "customer"] as const) {
    const markup = renderToStaticMarkup(<WorkspaceLoading embedded scope={scope} onChooseCustomer={() => {}}/>);
    assert.match(markup, /role="status"/);
    assert.doesNotMatch(markup, /Back to customer directory|Loading your current Pathfinder workspace|workspace-skeleton|workspace-loading-shell/);
    assert.doesNotMatch(markup, /<button/);
  }
});

test("error recovery stays accessible, compact and limited to its actual scope", () => {
  const customer = renderToStaticMarkup(<WorkspaceLoading embedded scope="customer" error="Confirm setup" setupRequired onRetry={() => {}} actionLabel="Set up workspace" onChooseCustomer={() => {}}/>);
  assert.match(customer, /role="alert"/);
  assert.match(customer, /Set up workspace/);
  assert.match(customer, /Back to customer directory/);
  assert.doesNotMatch(customer, /workspace-loading-spinner/);
  const global = renderToStaticMarkup(<WorkspaceLoading embedded scope="application" error="Unavailable" onRetry={() => {}} onChooseCustomer={() => {}}/>);
  assert.match(global, /Try again/);
  assert.doesNotMatch(global, /Back to customer directory/);
});

test("legacy opt-out keeps its existing loading treatment", () => {
  assert.match(renderToStaticMarkup(<WorkspaceLoading/>), /Loading your current Pathfinder workspace/);
  assert.equal(workspaceLoadingState({ ...ready, operations: false, workspaceMatches: false, workspaceState: "loading" }).pending, true);
});

test("lazy fallback stays inside AuthGate and existing OAuth return routing is preserved", async () => {
  const source = (name: string) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
  const main = await source("main.tsx"), app = await source("App.tsx"), startup = await source("PathfinderStartup.tsx");
  assert.match(main, /<AuthGate>[\s\S]*<Suspense fallback=\{<PathfinderStartup session=\{authSession\}/);
  assert.match(main, /VITE_ENABLE_OPERATIONS_WORKSPACE === "true"/);
  assert.match(startup, /<PathfinderShell enabled/);
  assert.doesNotMatch(startup, /fetch\(|localStorage|setTimeout|setInterval/);
  assert.match(app, /currentUrl.searchParams.get\("wrike_customer_id"\)/);
  assert.match(app, /setActiveCustomerView\("Settings"\)/);
  assert.match(app, /onChooseCustomer=\{startup.showDirectory \? operationsOpenDirectory : undefined\}/);
});
