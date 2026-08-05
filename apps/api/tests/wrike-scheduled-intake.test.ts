import assert from "node:assert/strict";
import test from "node:test";
import {
  getWrikeScheduledIntakeConfig,
  runWrikeScheduledIntake,
  runWrikeScheduledStatusWritebacks
} from "../src/wrike-scheduled-intake.js";

test("scheduled intake is default-disabled and prepare-only", () => {
  assert.deepEqual(getWrikeScheduledIntakeConfig({}), {
    enabled: false,
    status_writeback_enabled: false,
    customer_id: "",
    import_method_id: "",
    max_candidates: 25,
    prepare_only: true
  });
});

test("scheduled intake accepts the bounded packed deployment configuration", () => {
  assert.deepEqual(
    getWrikeScheduledIntakeConfig({
      PATHFINDER_WRIKE_SCHEDULED_INTAKE:
        "true|284619|method-1784901795973|4|true"
    }),
    {
      enabled: true,
      status_writeback_enabled: true,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 4,
      prepare_only: true
    }
  );
});

test("scheduled intake prepares every candidate independently in deterministic order", async () => {
  const prepared: string[] = [];
  const result = await runWrikeScheduledIntake({
    config: {
      enabled: true,
      status_writeback_enabled: false,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 4,
      prepare_only: true
    },
    discover: async () => [
      { task_id: "TASK-B", contract_number: "C2" },
      { task_id: "TASK-A", contract_number: "C1" }
    ],
    prepare: async (candidate) => {
      prepared.push(candidate.task_id);
      if (candidate.task_id === "TASK-A") {
        return { task_id: candidate.task_id, status: "Created", job_ids: ["job-a"] };
      }
      return { task_id: candidate.task_id, status: "Replayed", job_ids: ["job-b"] };
    },
    now: () => new Date("2026-08-05T20:00:00.000Z")
  });

  assert.deepEqual(prepared, ["TASK-A", "TASK-B"]);
  assert.equal(result.prepared_count, 1);
  assert.equal(result.replayed_count, 1);
  assert.equal(result.failed_count, 0);
  assert.equal(result.capabilities.wrike_writes, false);
  assert.equal(result.capabilities.lift_actions, false);
});

test("one candidate failure does not block another order", async () => {
  const result = await runWrikeScheduledIntake({
    config: {
      enabled: true,
      status_writeback_enabled: false,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 4,
      prepare_only: true
    },
    discover: async () => [
      { task_id: "TASK-A", contract_number: "C1" },
      { task_id: "TASK-B", contract_number: "C2" }
    ],
    prepare: async (candidate) => {
      if (candidate.task_id === "TASK-A") throw new TypeError("private provider detail");
      return { task_id: candidate.task_id, status: "Created", job_ids: ["job-b"] };
    }
  });

  assert.equal(result.prepared_count, 1);
  assert.equal(result.failed_count, 1);
  assert.deepEqual(result.results[0], {
    task_id: "TASK-A",
    contract_number: "C1",
    outcome: "failed",
    job_count: 0,
    failure_category: "TypeError"
  });
});

test("bounded discovery stops before preparing an oversized batch", async () => {
  let prepares = 0;
  await assert.rejects(
    runWrikeScheduledIntake({
      config: {
        enabled: true,
        status_writeback_enabled: false,
        customer_id: "284619",
        import_method_id: "method-1784901795973",
        max_candidates: 1,
        prepare_only: true
      },
      discover: async () => [
        { task_id: "TASK-A", contract_number: "C1" },
        { task_id: "TASK-B", contract_number: "C2" }
      ],
      prepare: async (candidate) => {
        prepares += 1;
        return { task_id: candidate.task_id, status: "Created", job_ids: [] };
      }
    }),
    /bounded candidate limit/
  );
  assert.equal(prepares, 0);
});

test("scheduled status writeback posts each confirmed job independently and replays safely", async () => {
  const calls: string[] = [];
  const result = await runWrikeScheduledStatusWritebacks({
    candidates: [{ job_id: "JOB-B" }, { job_id: "JOB-A" }, { job_id: "JOB-C" }],
    writeBack: async ({ job_id }) => {
      calls.push(job_id);
      if (job_id === "JOB-B") return { reused: true };
      if (job_id === "JOB-C") throw new Error("private provider detail");
      return { reused: false };
    }
  });

  assert.deepEqual(calls, ["JOB-A", "JOB-B", "JOB-C"]);
  assert.equal(result.posted_count, 1);
  assert.equal(result.replayed_count, 1);
  assert.equal(result.failed_count, 1);
  assert.equal(result.outcomes[2]?.failure_category, "Error");
});
