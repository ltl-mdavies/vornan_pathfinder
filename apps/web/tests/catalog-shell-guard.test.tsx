import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { customerTabLabel } from "../src/customer-tabs";
import { catalogLeaveDisposition, createCatalogShellGuard, type CatalogShellSnapshot } from "../src/catalog-shell-guard";

function controller(customerId = "synthetic-a") {
  let state: CatalogShellSnapshot = { customerId, dirty: false, busy: false, unconfirmed: false };
  let discards = 0;
  return {
    snapshot: () => ({ ...state }),
    update: (patch: Partial<CatalogShellSnapshot>) => { state = { ...state, ...patch }; },
    discardUnsaved: () => { discards++; state.dirty = false; return true; },
    discards: () => discards
  };
}

test("catalog shell scope includes customer and operator; stale cleanup cannot clear a replacement", () => {
  const guard = createCatalogShellGuard(), old = controller(), next = controller();
  const unregisterOld = guard.register("synthetic-a", "operator-a", old);
  const unregisterNext = guard.register("synthetic-a", "operator-a", next);
  next.update({ dirty: true });
  unregisterOld();
  assert.equal(guard.snapshot("synthetic-a", "operator-a")?.dirty, true);
  assert.equal(guard.snapshot("synthetic-b", "operator-a"), null);
  assert.equal(guard.snapshot("synthetic-a", "operator-b"), null);
  assert.equal(guard.discard("synthetic-a", "operator-b"), false);
  unregisterNext();
  assert.equal(guard.snapshot("synthetic-a", "operator-a"), null);
});

test("pending saves block synchronously; uncertain journals do not trap a clean workspace", () => {
  const guard = createCatalogShellGuard(), draft = controller();
  guard.register("synthetic-a", "operator-a", draft);
  const disposition = () => catalogLeaveDisposition(guard.snapshot("synthetic-a", "operator-a"));
  draft.update({ busy: true });
  assert.equal(disposition(), "pending");
  assert.equal(guard.discard("synthetic-a", "operator-a"), false);
  draft.update({ busy: false, unconfirmed: true, dirty: true });
  assert.equal(disposition(), "recovery-editing");
  assert.equal(guard.discard("synthetic-a", "operator-a"), false);
  draft.update({ dirty: false });
  assert.equal(disposition(), "clear");
  assert.equal(draft.snapshot().unconfirmed, true);
  assert.equal(draft.discards(), 0);
});

test("ordinary explicit discard delegates locally only for the correct workspace", () => {
  const guard = createCatalogShellGuard(), draft = controller();
  guard.register("synthetic-a", "operator-a", draft);
  draft.update({ dirty: true });
  assert.equal(catalogLeaveDisposition(guard.snapshot("synthetic-a", "operator-a")), "dirty");
  assert.equal(guard.discard("synthetic-a", "operator-a"), true);
  assert.equal(draft.discards(), 1);
  assert.equal(catalogLeaveDisposition(guard.snapshot("synthetic-a", "operator-a")), "clear");
});

test("App catalog integration stays gated, operator-keyed and outside unrelated save paths", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /catalogAvailable\(import.meta.env.VITE_ENABLE_CUSTOMER_CATALOG, import.meta.env.VITE_CUSTOMER_CATALOG_IDS, selectedCustomerId, Boolean\(catalogOperatorId\)\)/);
  assert.match(app, /key=\{`\$\{selectedCustomerId\}:\$\{catalogOperatorId\}`\}/);
  assert.match(app, /if \(activeCustomerView === "Catalog" && !customerCatalogAvailable\) setActiveCustomerView\("Overview"\)/);
  assert.match(app, /const catalogState = catalogLeaveDisposition\(catalogShellGuard.current.snapshot\(selectedCustomerId, catalogOperatorId\)\)/);
  assert.match(app, /if \(disposition === "pending" \|\| disposition === "recovery-editing"\) return/);
  assert.match(app, /leavePrompt.scope !== "proof-settings" && leavePrompt.scope !== "catalog"/);
  assert.doesNotMatch(app, /catalogShellGuard[^;]+(?:localStorage|retry\()/);
  assert.match(app, /signOut: async \(\) => requestGuardedNavigation/);
  assert.match(app, /session=\{shellSession\}/);
  assert.match(app, /void shellSession\?\.signOut\(\)/);
  assert.doesNotMatch(app, /expireSession: async/);
});

test("existing artwork catalog label stays unchanged unless both distinct catalog tools are present", () => {
  const labels = (tabs: string[]) => tabs.map(tab => customerTabLabel(tab, tabs));
  assert.deepEqual(labels(["Overview", "Artwork Catalog"]), ["Overview", "Catalog"]);
  assert.deepEqual(labels(["Overview", "Artwork Catalog", "Catalog"]), ["Overview", "Artwork Catalog", "Catalog"]);
});
