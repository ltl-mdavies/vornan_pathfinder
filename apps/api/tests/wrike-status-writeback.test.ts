import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Wrike status writeback is replay-safe and claims transport exactly once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pathfinder-wrike-status-writeback-"));
  try {
    const storeModuleUrl = new URL("../src/store.ts", import.meta.url).href;
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const {
        WrikeStatusWritebackConflictError,
        getJob,
        persistJobSnapshot,
        prepareWrikeStatusWriteback,
        transitionWrikeStatusWriteback
      } = await import(${JSON.stringify(storeModuleUrl)});
      const customer = {
        lift_customer_id: "284619",
        customer_name: "Empirical - Momentara",
        customer_number: "0000000960",
        customer_status: "Active",
        contacts: []
      };
      await persistJobSnapshot(customer, {
        job_id: "JOB-081930",
        customer_id: "284619",
        customer_name: "Empirical - Momentara",
        output_route_id: "route",
        state: "Order Confirmed",
        created_at: "2026-08-03T18:00:00.000Z",
        updated_at: "2026-08-03T18:00:00.000Z"
      });
      const args = {
        job_id: "JOB-081930",
        task_id: "MAAAAAENlV9Z",
        connection_id: "source-wrike",
        order_number: "A0227641",
        contract_number: "C316870",
        comment_sha256: "a".repeat(64),
        status_url_sha256: "b".repeat(64),
        prepared_by_email: "operator@vornan.co"
      };
      const prepared = await prepareWrikeStatusWriteback(customer, args);
      assert.equal(prepared.record.state, "prepared");
      assert.match(prepared.record.writeback_id, /^wsw_[a-f0-9]{64}$/);
      const replay = await prepareWrikeStatusWriteback(customer, args);
      assert.equal(replay.record.writeback_id, prepared.record.writeback_id);
      assert.equal(replay.job.wrike_status_writebacks.length, 1);
      await assert.rejects(
        prepareWrikeStatusWriteback(customer, { ...args, comment_sha256: "c".repeat(64) }),
        (error) => error instanceof WrikeStatusWritebackConflictError
      );
      const claimed = await transitionWrikeStatusWriteback(customer, {
        job_id: args.job_id,
        writeback_id: prepared.record.writeback_id,
        expected_state: "prepared",
        next_state: "submission_uncertain"
      });
      assert.equal(claimed.record.state, "submission_uncertain");
      await assert.rejects(
        transitionWrikeStatusWriteback(customer, {
          job_id: args.job_id,
          writeback_id: prepared.record.writeback_id,
          expected_state: "prepared",
          next_state: "submission_uncertain"
        }),
        (error) => error instanceof WrikeStatusWritebackConflictError && /will not be posted again/.test(error.message)
      );
      const posted = await transitionWrikeStatusWriteback(customer, {
        job_id: args.job_id,
        writeback_id: prepared.record.writeback_id,
        expected_state: "submission_uncertain",
        next_state: "posted",
        comment_id: "IECOMMENT"
      });
      assert.equal(posted.record.state, "posted");
      assert.equal(posted.record.comment_id, "IECOMMENT");
      const finalJob = await getJob(customer, args.job_id);
      const serialized = JSON.stringify(finalJob.wrike_status_writebacks);
      assert.equal(serialized.includes("status.vornan.co"), false);
      assert.equal(serialized.includes("Larger Than Life"), false);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATHFINDER_LOCAL_STORE_PATH: join(directory, "store.json"),
        PATHFINDER_STORAGE_DRIVER: "local"
      },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Wrike status writeback remains inside the authenticated admin boundary", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const authenticationBoundary = source.indexOf('app.use("/api", requirePathfinderAuth)');
  const writebackRoute = source.indexOf(
    'app.post("/api/customers/:liftCustomerId/jobs/:jobId/wrike-status-writeback"'
  );

  assert.ok(authenticationBoundary >= 0);
  assert.ok(writebackRoute > authenticationBoundary);
  assert.match(
    source,
    /job\.source_evidence\.provider !== "wrike" \|\|[\s\S]*?job\.source_evidence\.task_id !== wrikeStatusWritebackTaskId/
  );
  assert.match(source, /oauth\.scope !== "wsReadWrite"/);
  assert.match(source, /scheduled_wrike_intake[\s\S]*?source: "scheduled_polling"/);
  assert.match(
    source,
    /const config = normalizeWrikeSourceConfig\(method\.source_config\.wrike\);[\s\S]*?if \(!config\.connection_id\)/
  );
  assert.doesNotMatch(source, /if \(!config\.enabled \|\| !config\.connection_id\)/);
  assert.match(
    source,
    /discoverScopedWrikeIntakeTasks\(oauth, config, \{[\s\S]*?max_pages: 10,[\s\S]*?max_tasks: 10_000/
  );
  assert.match(source, /discovery_summary: discoverySummary/);
  assert.match(source, /order_status_and_identity_match_count/);
  assert.match(source, /order_contract_ready_count/);
  assert.doesNotMatch(source, /app\.(?:post|put|patch)\("\/public\/[^"']*wrike-status-writeback/);
});
