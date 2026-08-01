import assert from "node:assert/strict";
import test from "node:test";
import { prepareWrikeManualIntake } from "../src/wrike-manual-intake.js";

test("prepares one preview per captured workbook and preserves replay semantics", async () => {
  const calls: string[] = [];
  const result = await prepareWrikeManualIntake({
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    captureEvidence: async () => ({
      task_id: "task-synthetic",
      evidence: [
        {
          evidence_id: "evidence-one",
          file_name: "order-one.xlsx",
          extension: "xlsx",
          storage_status: "Stored" as const
        },
        {
          evidence_id: "evidence-two",
          file_name: "order-two.xlsx",
          extension: "xlsx",
          storage_status: "Replayed" as const
        }
      ]
    }),
    createPreview: async (record) => {
      calls.push(record.evidence_id);
      return record.evidence_id === "evidence-one"
        ? { preview_status: "Created", job_id: "job-one", job_state: "Ready" }
        : { preview_status: "Replayed", job_id: "job-two", job_state: "Needs Mapping" };
    }
  });

  assert.deepEqual(calls, ["evidence-one", "evidence-two"]);
  assert.equal(result.status, "Prepared");
  assert.equal(result.prepared_at, "2026-07-24T12:00:00.000Z");
  assert.deepEqual(result.summary, {
    workbook_count: 2,
    created_count: 1,
    replayed_count: 1,
    blocked_count: 0
  });
  assert.deepEqual(
    result.workbooks.map(({ evidence_id, evidence_status, preview_status, job_id }) => ({
      evidence_id,
      evidence_status,
      preview_status,
      job_id
    })),
    [
      {
        evidence_id: "evidence-one",
        evidence_status: "Stored",
        preview_status: "Created",
        job_id: "job-one"
      },
      {
        evidence_id: "evidence-two",
        evidence_status: "Replayed",
        preview_status: "Replayed",
        job_id: "job-two"
      }
    ]
  );
  assert.deepEqual(result.capabilities, {
    operator_controlled: true,
    source_evidence_persistence: true,
    preview_job_creation: true,
    polling: false,
    webhook: false,
    wrike_writes: false,
    lift_actions: false
  });
});

test("contains per-workbook failures and never returns provider error details", async () => {
  const result = await prepareWrikeManualIntake({
    captureEvidence: async () => ({
      task_id: "task-synthetic",
      evidence: [
        {
          evidence_id: "evidence-safe",
          file_name: "safe-order.xlsx",
          extension: "xlsx",
          storage_status: "Stored" as const
        },
        {
          evidence_id: "evidence-blocked",
          file_name: "blocked-order.xlsx",
          extension: "xlsx",
          storage_status: "Stored" as const
        }
      ]
    }),
    classifyPreviewError: () => ({
      failure_stage: "document_publication",
      failure_code: "object_write_failed"
    }),
    createPreview: async (record) => {
      if (record.evidence_id === "evidence-blocked") {
        throw new Error("provider-token-and-private-url-must-not-escape");
      }
      return { preview_status: "Created", job_id: "job-safe", job_state: "Ready" };
    }
  });

  assert.equal(result.status, "Partially Prepared");
  assert.equal(result.summary.created_count, 1);
  assert.equal(result.summary.blocked_count, 1);
  assert.equal(result.workbooks[1]?.preview_status, "Blocked");
  assert.equal(result.workbooks[1]?.failure_stage, "document_publication");
  assert.equal(result.workbooks[1]?.failure_code, "object_write_failed");
  assert.match(result.workbooks[1]?.message ?? "", /Review its source evidence/);
  assert.doesNotMatch(JSON.stringify(result), /provider-token|private-url/);
});

test("capture failure stops before any preview callback", async () => {
  let previewCalls = 0;
  await assert.rejects(
    prepareWrikeManualIntake({
      captureEvidence: async () => {
        throw new Error("capture failed");
      },
      createPreview: async () => {
        previewCalls += 1;
        return { preview_status: "Created", job_id: "job-unused", job_state: "Ready" };
      }
    }),
    /capture failed/
  );
  assert.equal(previewCalls, 0);
});
