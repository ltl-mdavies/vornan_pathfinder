import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("jobs can be archived and restored without changing operational state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-job-archive-"));
  const storePath = join(directory, "pathfinder.json");

  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const { getJob, persistJobSnapshot, setJobsArchived } = await import(${JSON.stringify(storeModuleUrl)});
      const customer = {
        lift_customer_id: "archive-test-customer",
        customer_name: "Archive Test Customer",
        customer_number: "100",
        customer_status: "Active",
        contacts: []
      };
      const baseJob = {
        customer_id: customer.lift_customer_id,
        customer_name: customer.customer_name,
        state: "Order Confirmed",
        created_at: "2026-07-21T12:00:00.000Z",
        updated_at: "2026-07-21T12:00:00.000Z"
      };
      await persistJobSnapshot(customer, { ...baseJob, job_id: "job-one" });
      await persistJobSnapshot(customer, { ...baseJob, job_id: "job-two" });

      const archived = await setJobsArchived(customer, ["job-one", "job-two"], true, "operator@vornan.co");
      assert.equal(archived.jobs.length, 2);
      assert.ok(archived.jobs.every((job) => job.archived_at));
      assert.ok(archived.jobs.every((job) => job.archived_by_email === "operator@vornan.co"));
      assert.ok(archived.jobs.every((job) => job.state === "Order Confirmed"));

      const restored = await setJobsArchived(customer, ["job-one"], false, "operator@vornan.co");
      assert.equal(restored.jobs[0].archived_at, null);
      assert.equal(restored.jobs[0].archived_by_email, null);
      assert.equal(restored.jobs[0].state, "Order Confirmed");

      const stillArchived = await getJob(customer, "job-two");
      assert.ok(stillArchived.archived_at);
      assert.equal(stillArchived.state, "Order Confirmed");
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
