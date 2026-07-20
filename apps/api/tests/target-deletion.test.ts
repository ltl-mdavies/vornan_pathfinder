import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

let testDirectory = "";
let deleteTarget: typeof import("../src/store.ts")["deleteTarget"];
let getOrCreateWorkspace: typeof import("../src/store.ts")["getOrCreateWorkspace"];
let listTargets: typeof import("../src/store.ts")["listTargets"];
let updateTarget: typeof import("../src/store.ts")["updateTarget"];
let TargetInUseError: typeof import("../src/store.ts")["TargetInUseError"];

const testCustomer = {
  lift_customer_id: "regression-target-deletion",
  customer_name: "Target Deletion Regression Customer",
  customer_number: null,
  customer_type: null,
  customer_status: "Regular",
  sales_rep: null,
  default_invoice_email_address: null,
  created_date: null,
  crm_id: null,
  terms: null,
  terms_status: null,
  credit_limit: null,
  credit_hold: null,
  unpaid_total: null,
  available_credit: null
};

before(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), "pathfinder-target-deletion-test-"));
  process.env.PATHFINDER_RUNTIME = "lambda";
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_SECRETS_DRIVER = "local";
  process.env.PATHFINDER_LOCAL_STORE_PATH = join(testDirectory, "store.json");
  process.env.PATHFINDER_LOCAL_SECRETS_PATH = join(testDirectory, "secrets.json");
  process.env.PATHFINDER_REQUIRE_AUTH = "false";
  process.env.PATHFINDER_ENABLE_LIFT_SUBMIT = "false";

  const store = await import("../src/store.ts");
  deleteTarget = store.deleteTarget;
  getOrCreateWorkspace = store.getOrCreateWorkspace;
  listTargets = store.listTargets;
  updateTarget = store.updateTarget;
  TargetInUseError = store.TargetInUseError;
});

after(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

test("blocks deletion while a customer workspace references the target", async () => {
  const workspace = await getOrCreateWorkspace(testCustomer);

  await assert.rejects(
    deleteTarget(workspace.primary_target_id),
    (error: unknown) =>
      error instanceof TargetInUseError &&
      error.message.includes(testCustomer.customer_name) &&
      error.message.includes("Reassign or remove those output routes")
  );

  assert.ok((await listTargets()).some((target) => target.target_id === workspace.primary_target_id));
});

test("deletes an unreferenced target", async () => {
  const targetId = "unused-regression-target";
  await updateTarget(targetId, {
    name: "Unused Regression Target",
    status: "Draft"
  });

  assert.ok((await listTargets()).some((target) => target.target_id === targetId));
  const remainingTargets = await deleteTarget(targetId);
  assert.equal(remainingTargets.some((target) => target.target_id === targetId), false);
  assert.equal((await listTargets()).some((target) => target.target_id === targetId), false);
});
