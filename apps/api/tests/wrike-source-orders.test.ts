import assert from "node:assert/strict";
import test from "node:test";
import {
  groupWrikeSourceOrders,
  selectWrikeSourceOrderAnchor,
  wrikeSourceOrderHasPossibleTransport,
  wrikeSourceOrderKey
} from "../src/wrike-source-orders.js";

function wrikeJob(overrides: Record<string, unknown> = {}) {
  return {
    customer_id: "284619",
    import_method_id: "method-1",
    job_id: "job-ready",
    state: "Ready",
    target_order_number: null,
    created_at: "2026-08-11T19:43:00.000Z",
    updated_at: "2026-08-12T15:43:00.000Z",
    source_evidence: {
      provider: "wrike",
      account_id: "ACCOUNT-1",
      task_id: "TASK-1"
    },
    ...overrides
  };
}

test("Wrike source-order identity excludes workbook and configuration versions", () => {
  const first = wrikeJob({
    source_evidence: {
      provider: "wrike",
      account_id: "ACCOUNT-1",
      task_id: "TASK-1",
      evidence_id: "evidence-one",
      import_method_fingerprint: "fingerprint-one"
    }
  });
  const second = wrikeJob({
    job_id: "job-second",
    source_evidence: {
      provider: "wrike",
      account_id: "ACCOUNT-1",
      task_id: "TASK-1",
      evidence_id: "evidence-two",
      import_method_fingerprint: "fingerprint-two"
    }
  });
  assert.equal(wrikeSourceOrderKey(first), wrikeSourceOrderKey(second));
});

test("a confirmed Lift order remains the authoritative source-order record", () => {
  const confirmed = wrikeJob({
    job_id: "job-confirmed",
    state: "Order Confirmed",
    target_order_number: "A0228322",
    updated_at: "2026-08-11T18:58:00.000Z"
  });
  const newerReady = wrikeJob({ job_id: "job-newer", updated_at: "2026-08-12T15:43:00.000Z" });
  assert.equal(selectWrikeSourceOrderAnchor([newerReady, confirmed])?.job_id, "job-confirmed");
});

test("grouping keeps unrelated jobs and nests technical Wrike records", () => {
  const confirmed = wrikeJob({
    job_id: "job-confirmed",
    state: "Order Confirmed",
    target_order_number: "A0228322"
  });
  const replacement = wrikeJob({ job_id: "job-replacement" });
  const manual = {
    ...wrikeJob({ job_id: "manual-job" }),
    source_evidence: null
  };
  const groups = groupWrikeSourceOrders([replacement, manual, confirmed]);
  const wrikeGroup = groups.find((group) => group.source_order_key.startsWith("wrike:"));
  assert.equal(wrikeGroup?.anchor.job_id, "job-confirmed");
  assert.deepEqual(wrikeGroup?.related.map((job) => job.job_id), ["job-replacement"]);
  assert.equal(groups.filter((group) => group.source_order_key.startsWith("job:")).length, 1);
});

test("any possible external write protects the source order from regeneration", () => {
  const ready = wrikeJob();
  assert.equal(
    wrikeSourceOrderHasPossibleTransport(
      [ready],
      new Map([[ready.job_id, [{ state: "Blocked" }, { state: "Gate Locked" }]]])
    ),
    false
  );
  assert.equal(
    wrikeSourceOrderHasPossibleTransport(
      [ready],
      new Map([[ready.job_id, [{ state: "Submission Uncertain" }]]])
    ),
    true
  );
  assert.equal(
    wrikeSourceOrderHasPossibleTransport(
      [wrikeJob({ target_order_number: "A0228322" })],
      new Map()
    ),
    true
  );
});
