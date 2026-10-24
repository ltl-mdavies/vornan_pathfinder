import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { paginateProofLines, sortProofLines, type OperationsProofLine } from "../src/operations-model";

const rows: OperationsProofLine[] = Array.from({length: 45}, (_, i) => ({id: String(i), orderNumber: `A${9000000 + Math.floor(i / 3)}`, orderTitle: "Sample", customerId: String(i % 3), customer: `Customer ${i % 3}`, lineNumber: String(i % 3 + 1), product: "Sample creative", state: "pending", creativeCount: 2, since: null, lastSynced: "2026-10-23T16:20:00Z", stale: false, stateCounts: i % 4 === 0 ? {pending: 1, changes: 1} : undefined}));
test("Proof viewport pagination includes every line once in sorted order", () => {
  for (const grouping of ["order", "customer"] as const) for (const height of [384, 768, 900, 1080]) {
    const sorted = sortProofLines(rows, grouping);
    const pages = paginateProofLines(sorted, grouping, height);
    assert.deepEqual(pages.flat().map(row => row.id), sorted.map(row => row.id));
    assert.ok(pages.every(page => page.length > 0));
  }
  assert.deepEqual(paginateProofLines([], "order", 768), []);
});
test("larger desktops gain capacity while customer headers and mixed states reserve space", () => {
  const repeated = rows.map((row, i) => ({...row, orderNumber: "A9000000", customerId: "1", customer: "One", stateCounts: undefined, id: String(i)}));
  assert.ok(paginateProofLines(repeated, "order", 1080)[0].length > paginateProofLines(repeated, "order", 768)[0].length);
  assert.ok(paginateProofLines(repeated, "order", 768, true)[0].length <= paginateProofLines(repeated, "order", 768)[0].length);
  assert.ok(paginateProofLines(repeated.map(row => ({...row, stateCounts: {pending: 1, changes: 1}})), "order", 768)[0].length < paginateProofLines(repeated, "order", 768)[0].length);
});
test("queue maintains context, read-only opening, bounded customer rows and stale success evidence", async () => {
  const source = await readFile(new URL("../src/OperationsProof.tsx", import.meta.url), "utf8");
  assert.match(source, /generation !== request.current/);
  assert.match(source, /controller.current\?\.abort/);
  assert.match(source, /filter\(row => !customerId \|\| row.customerId === customerId\)/);
  assert.match(source, /wasHidden.current && !hidden/);
  assert.match(source, /origin.current\?\.isConnected/);
  assert.match(source, /checked \? scoped.filter/);
  assert.match(source, /Showing the last successful cache result/);
  assert.match(source, /More cache pages available/);
  assert.match(source, /toolsVisited && !hidden/);
  assert.match(source, /hidden=\{!toolsOpen\}/);
  assert.match(source, /error \? retryButton.current : moreFocus.current/);
  assert.match(source, /moreButton.current \?\? searchInput.current/);
  assert.doesNotMatch(source, /method: "POST"|\/grants|\/sync`/);
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<OperationsProof hidden=\{Boolean\(operationsProofOrder\)\}/);
  assert.match(app, /<OperationsProof key=\{selectedCustomer.lift_customer_id\} hidden=/);
  assert.match(app, /expectedCustomerId=\{selectedCustomer.lift_customer_id\}/);
  assert.match(app, /const shellNavigate = [\s\S]*?setOperationsProofOrder\(null\)/);
});
test("scoped internal tools require verified customer ownership before sync and discovery", async () => {
  const source = await readFile(new URL("../src/ProofOpsPanel.tsx", import.meta.url), "utf8");
  const sync = source.slice(source.indexOf("async function syncOrder()"), source.indexOf("async function loadCustomerOrders()"));
  assert.ok(sync.indexOf("order?.customer_id !== expectedCustomerId") < sync.indexOf("method: \"POST\""));
  assert.match(source, /expectedCustomerId && discovered.customer_id !== expectedCustomerId/);
  assert.match(source, /expectedCustomerId && payload.order.customer_id !== expectedCustomerId/);
  assert.match(source, /if \(initialOrderNumber\) void inspectCachedOrder\(\)/);
});
