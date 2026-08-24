import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWrikeScheduledCandidatePreparationError,
  filterPreviouslyConfirmedWrikeScheduledCandidates,
  findWrikeSourceTaskSiblingJobs,
  getWrikeScheduledIntakeConfig,
  runWrikeScheduledIntake,
  runWrikeScheduledSubmits,
  runWrikeScheduledStatusWritebacks,
  WrikeScheduledCandidatePreparationError,
  wrikeMappingReevaluationBlockReason
} from "../src/wrike-scheduled-intake.js";

test("scheduled intake removes only already-confirmed tasks before applying its bounded budget", () => {
  const candidates = [
    { task_id: "TASK-CONFIRMED", contract_number: "C1", trigger_status_id: "READY" },
    { task_id: "TASK-UNRESOLVED", contract_number: "C2", trigger_status_id: "READY" },
    { task_id: "TASK-NEW", contract_number: "C3", trigger_status_id: "READY" }
  ];
  const completed = {
    customer_id: "284619",
    job_id: "confirmed-job",
    import_method_id: "method-1",
    target_order_number: "A0229999",
    source_evidence: { provider: "wrike", task_id: "TASK-CONFIRMED" },
    scheduled_wrike_intake: {
      source: "scheduled_polling",
      task_id: "TASK-CONFIRMED",
      import_method_id: "method-1"
    }
  };
  const unresolved = {
    ...completed,
    job_id: "unresolved-job",
    target_order_number: null,
    source_evidence: { provider: "wrike", task_id: "TASK-UNRESOLVED" },
    scheduled_wrike_intake: {
      source: "scheduled_polling" as const,
      task_id: "TASK-UNRESOLVED",
      import_method_id: "method-1"
    }
  };
  const otherMethod = {
    ...completed,
    job_id: "other-method-job",
    import_method_id: "method-2"
  };

  assert.deepEqual(
    filterPreviouslyConfirmedWrikeScheduledCandidates({
      candidates,
      jobs: [completed, unresolved, otherMethod],
      customer_id: "284619",
      import_method_id: "method-1"
    }).map((candidate) => candidate.task_id),
    ["TASK-UNRESOLVED", "TASK-NEW"]
  );
});

test("scheduled submit finds an earlier manual job for the same Wrike task", () => {
  const current = {
    customer_id: "284619",
    job_id: "scheduled-preview",
    import_method_id: "method-1",
    source_evidence: { provider: "wrike", task_id: "TASK-1" },
    scheduled_wrike_intake: { source: "scheduled_polling" }
  };
  const manualSubmitted = {
    customer_id: "284619",
    job_id: "manual-submitted",
    import_method_id: "method-1",
    source_evidence: { provider: "wrike", task_id: "TASK-1" }
  };
  const unrelated = {
    customer_id: "284619",
    job_id: "other-task",
    import_method_id: "method-1",
    source_evidence: { provider: "wrike", task_id: "TASK-2" }
  };

  assert.deepEqual(
    findWrikeSourceTaskSiblingJobs({ current, jobs: [current, manualSubmitted, unrelated] }),
    [manualSubmitted]
  );
});

test("Wrike source-task siblings stay isolated by customer, method, and provider", () => {
  const current = {
    customer_id: "284619",
    job_id: "current",
    import_method_id: "method-1",
    source_evidence: { provider: "wrike", task_id: "TASK-1" }
  };
  const candidates = [
    { ...current, job_id: "other-customer", customer_id: "1249" },
    { ...current, job_id: "other-method", import_method_id: "method-2" },
    {
      ...current,
      job_id: "other-provider",
      source_evidence: { provider: "manual", task_id: "TASK-1" }
    }
  ];

  assert.deepEqual(findWrikeSourceTaskSiblingJobs({ current, jobs: candidates }), []);
});

test("mapping re-evaluation is safe only before any possible Lift transport", () => {
  const current = {
    customer_id: "284619",
    job_id: "current",
    import_method_id: "method-1",
    state: "Needs Mapping",
    target_order_number: null,
    source_evidence: { provider: "wrike", task_id: "TASK-1" }
  };
  assert.equal(
    wrikeMappingReevaluationBlockReason({
      current,
      siblings: [],
      attemptsByJobId: new Map([[current.job_id, [{ state: "Blocked" }, { state: "Gate Locked" }]]])
    }),
    null
  );

  const uncertainReason = wrikeMappingReevaluationBlockReason({
    current,
    siblings: [],
    attemptsByJobId: new Map([[current.job_id, [{ state: "Submission Uncertain" }]]])
  });
  assert.match(uncertainReason ?? "", /will not retry it automatically/);
});

test("mapping re-evaluation refuses a sibling order for the same Wrike source task", () => {
  const current = {
    customer_id: "284619",
    job_id: "current",
    import_method_id: "method-1",
    state: "Failed",
    target_order_number: null,
    source_evidence: { provider: "wrike", task_id: "TASK-1" }
  };
  const sibling = {
    ...current,
    job_id: "earlier",
    target_order_number: "A0219609"
  };
  assert.match(
    wrikeMappingReevaluationBlockReason({
      current,
      siblings: [sibling],
      attemptsByJobId: new Map()
    }) ?? "",
    /already associated/
  );
});

test("scheduled intake and each mutating capability are default-disabled", () => {
  assert.deepEqual(getWrikeScheduledIntakeConfig({}), {
    enabled: false,
    lift_submit_enabled: false,
    status_writeback_enabled: false,
    customer_id: "",
    import_method_id: "",
    max_candidates: 25
  });
});

test("scheduled intake accepts the bounded packed deployment configuration", () => {
  assert.deepEqual(
    getWrikeScheduledIntakeConfig({
      PATHFINDER_WRIKE_SCHEDULED_INTAKE:
        "true|284619|method-1784901795973|4|true|true"
    }),
    {
      enabled: true,
      lift_submit_enabled: true,
      status_writeback_enabled: true,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 4
    }
  );
});

test("scheduled intake prepares every candidate independently in deterministic order", async () => {
  const prepared: string[] = [];
  const result = await runWrikeScheduledIntake({
    config: {
      enabled: true,
      lift_submit_enabled: false,
      status_writeback_enabled: false,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 4
    },
    discover: async () => [
      { task_id: "TASK-B", contract_number: "C2", trigger_status_id: "STATUS-B" },
      { task_id: "TASK-A", contract_number: "C1", trigger_status_id: "STATUS-A" }
    ],
    prepare: async (candidate) => {
      prepared.push(`${candidate.task_id}:${candidate.trigger_status_id}`);
      if (candidate.task_id === "TASK-A") {
        return { task_id: candidate.task_id, status: "Created", job_ids: ["job-a"] };
      }
      return { task_id: candidate.task_id, status: "Replayed", job_ids: ["job-b"] };
    },
    now: () => new Date("2026-08-05T20:00:00.000Z")
  });

  assert.deepEqual(prepared, ["TASK-A:STATUS-A", "TASK-B:STATUS-B"]);
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
      lift_submit_enabled: false,
      status_writeback_enabled: false,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 4
    },
    discover: async () => [
      { task_id: "TASK-A", contract_number: "C1", trigger_status_id: "STATUS-A" },
      { task_id: "TASK-B", contract_number: "C2", trigger_status_id: "STATUS-B" }
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
    job_ids: [],
    failure_category: "TypeError",
    failure_details: [{
      failure_stage: "prepare",
      reason_code: "TypeError",
      evidence_ids: [],
      job_ids: []
    }]
  });
});

test("scheduled intake keeps only sanitized preparation failure identities and reason codes", async () => {
  const result = await runWrikeScheduledIntake({
    config: {
      enabled: true,
      lift_submit_enabled: false,
      status_writeback_enabled: false,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 1
    },
    discover: async () => [
      { task_id: "TASK-A", contract_number: "C1", trigger_status_id: "STATUS-A" }
    ],
    prepare: async () => {
      throw new WrikeScheduledCandidatePreparationError([{
        failure_stage: "preview_creation",
        reason_code: "preview_failed",
        evidence_ids: ["evidence-safe", "unsafe evidence value"],
        job_ids: ["job-safe", "unsafe job value"]
      }]);
    }
  });

  assert.equal(result.results[0]?.failure_category, "preview_failed");
  assert.deepEqual(result.results[0]?.failure_details, [{
    failure_stage: "preview_creation",
    reason_code: "preview_failed",
    evidence_ids: ["evidence-safe"],
    job_ids: ["job-safe"]
  }]);
});

test("scheduled intake prefers a bounded provider error code without retaining its message", async () => {
  const providerError = new Error("private provider detail") as Error & { code: string };
  providerError.name = "WrikeConnectionError";
  providerError.code = "attachment_validation_failed";
  const result = await runWrikeScheduledIntake({
    config: {
      enabled: true,
      lift_submit_enabled: false,
      status_writeback_enabled: false,
      customer_id: "284619",
      import_method_id: "method-1784901795973",
      max_candidates: 1
    },
    discover: async () => [
      { task_id: "TASK-A", contract_number: "C1", trigger_status_id: "STATUS-A" }
    ],
    prepare: async () => {
      throw providerError;
    }
  });

  assert.equal(result.results[0]?.failure_category, "attachment_validation_failed");
  assert.equal(result.results[0]?.failure_details[0]?.reason_code, "attachment_validation_failed");
  assert.doesNotMatch(JSON.stringify(result.results[0]), /private provider detail/);
});

test("blocked workbook telemetry retains only its evidence and existing candidate jobs", () => {
  const error = buildWrikeScheduledCandidatePreparationError([
    {
      evidence_id: "evidence-blocked",
      preview_status: "Blocked",
      failure_stage: "preview_creation",
      failure_code: "preview_failed",
      reason_code: "ValidationError"
    },
    {
      evidence_id: "evidence-ready",
      preview_status: "Created",
      job_id: "job-ready"
    }
  ]);

  assert.deepEqual(error.failure_details, [{
    failure_stage: "preview_creation",
    reason_code: "ValidationError",
    evidence_ids: ["evidence-blocked"],
    job_ids: ["job-ready"]
  }]);
});

test("bounded discovery stops before preparing an oversized batch", async () => {
  let prepares = 0;
  await assert.rejects(
    runWrikeScheduledIntake({
      config: {
        enabled: true,
        lift_submit_enabled: false,
        status_writeback_enabled: false,
        customer_id: "284619",
        import_method_id: "method-1784901795973",
        max_candidates: 1
      },
      discover: async () => [
        { task_id: "TASK-A", contract_number: "C1", trigger_status_id: "STATUS-A" },
        { task_id: "TASK-B", contract_number: "C2", trigger_status_id: "STATUS-B" }
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

test("scheduled submit processes each certified job independently with replay safety", async () => {
  const calls: string[] = [];
  const result = await runWrikeScheduledSubmits({
    candidates: [{ job_id: "JOB-B" }, { job_id: "JOB-A" }, { job_id: "JOB-C" }],
    submit: async ({ job_id }) => {
      calls.push(job_id);
      if (job_id === "JOB-B") return { reused: true };
      if (job_id === "JOB-C") throw new TypeError("private transport detail");
      return { reused: false };
    }
  });

  assert.deepEqual(calls, ["JOB-A", "JOB-B", "JOB-C"]);
  assert.equal(result.submitted_count, 1);
  assert.equal(result.replayed_count, 1);
  assert.equal(result.failed_count, 1);
  assert.equal(result.outcomes[2]?.failure_category, "TypeError");
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
