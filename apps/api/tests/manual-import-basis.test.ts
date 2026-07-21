import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("ad-hoc previews persist the job without creating or changing a saved Import Method", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-manual-basis-"));
  const storePath = join(directory, "pathfinder.json");

  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const { getOrCreateWorkspace, persistPreviewJob } = await import(${JSON.stringify(storeModuleUrl)});
      const customer = {
        lift_customer_id: "manual-basis-customer",
        customer_name: "Manual Basis Customer",
        customer_number: "100",
        customer_status: "Active",
        contacts: []
      };
      const before = await getOrCreateWorkspace(customer);
      const originalMethodIds = before.import_methods.map((method) => method.import_method_id);
      const originalLastRunAt = before.import_methods[0].last_run_at;
      const baseMethod = before.import_methods[0];
      const adHocMethod = {
        ...baseMethod,
        import_method_id: "ad-hoc",
        name: "Ad-hoc Manual Import",
        mappings: []
      };
      const job = {
        job_id: "job-ad-hoc-preview",
        customer_id: customer.lift_customer_id,
        customer_name: customer.customer_name,
        state: "Ready",
        created_at: "2026-07-21T20:00:00.000Z",
        updated_at: "2026-07-21T20:00:00.000Z"
      };

      const afterAdHoc = await persistPreviewJob(customer, job, adHocMethod, { persistMethod: false });
      assert.deepEqual(afterAdHoc.import_methods.map((method) => method.import_method_id), originalMethodIds);
      assert.equal(afterAdHoc.import_methods[0].last_run_at, originalLastRunAt);
      assert.deepEqual(afterAdHoc.import_methods[0].mappings, before.import_methods[0].mappings);
      assert.equal(afterAdHoc.jobs[0].job_id, job.job_id);
      assert.equal(afterAdHoc.import_methods.some((method) => method.import_method_id === "ad-hoc"), false);

      const savedJob = { ...job, job_id: "job-saved-preview" };
      const afterSaved = await persistPreviewJob(customer, savedJob, baseMethod);
      assert.equal(afterSaved.import_methods.length, before.import_methods.length);
      assert.equal(afterSaved.import_methods[0].import_method_id, baseMethod.import_method_id);
      assert.ok(afterSaved.import_methods[0].last_run_at);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATHFINDER_LOCAL_STORE_PATH: storePath,
        PATHFINDER_STORAGE_DRIVER: "local"
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
