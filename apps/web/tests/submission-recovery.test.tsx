import assert from "node:assert/strict";
import test from "node:test";
import { createSubmissionGuard, submissionDisposition } from "../src/submission-recovery";

const ready = { customer_id: "1249", job_id: "preview-one", state: "Ready", target_order_number: null, submit_integrity: { fingerprint: "reviewed" }, submit_certification: { can_submit: true, external_submit_enabled: true } };
const attempt = { job_id: ready.job_id, request_fingerprint: "reviewed", state: "Submission Uncertain" };

test("handler guard rejects rapid repeats and remains locked after response loss", () => {
  const guard = createSubmissionGuard();
  assert.equal(guard.begin(ready), true);
  assert.equal(guard.begin(ready), false);
  guard.finish(ready, true);
  assert.equal(guard.begin(ready), false);
  assert.equal(submissionDisposition(ready, [], guard.isUnknown(ready)), "pending");
});

test("empty, unrelated and blocked-only rereads cannot unlock unknown response", () => {
  const guard = createSubmissionGuard(); guard.begin(ready); guard.finish(ready, true);
  for (const attempts of [[], [{ ...attempt, job_id: "other" }], [{ ...attempt, request_fingerprint: "old" }], [{ ...attempt, state: "Blocked" }], [{ ...attempt, state: "Gate Locked" }]]) {
    guard.reconcile(ready, attempts);
    assert.equal(guard.isUnknown(ready), true);
    assert.equal(guard.begin(ready, attempts), false);
  }
});

test("authoritative uncertain/confirmed reads stay non-submittable despite positive certification", () => {
  const guard = createSubmissionGuard(); guard.begin(ready); guard.finish(ready, true);
  const submitted = { ...ready, state: "Submitted" };
  guard.reconcile(submitted, [attempt]);
  assert.equal(guard.isUnknown(submitted), false);
  assert.equal(guard.begin(submitted, [attempt]), false);
  assert.equal(guard.begin(ready, [attempt]), false);
  const confirmed = { ...ready, target_order_number: "A9000999", state: "Order Confirmed" };
  guard.reconcile(confirmed, [attempt]);
  assert.equal(submissionDisposition(confirmed, [attempt]), "confirmed");
  assert.equal(guard.begin(confirmed, [attempt]), false);
});

test("known rejection releases in-flight latch but never bypasses certification or gates", () => {
  const guard = createSubmissionGuard(); guard.begin(ready); guard.finish(ready, false);
  const rejected = { ...ready, submit_certification: { can_submit: false, external_submit_enabled: true } };
  assert.equal(guard.begin(rejected), false);
  assert.equal(guard.begin({ ...ready, submit_certification: { can_submit: true, external_submit_enabled: false } }), false);
  assert.equal(guard.begin({ ...ready, submit_integrity: null }), false);
  assert.equal(guard.begin(ready, [{ ...attempt, state: "Blocked" }]), true);
});

test("late old-job completion cannot unlock or lock another preview or customer", () => {
  const guard = createSubmissionGuard();
  const next = { ...ready, job_id: "preview-two" }, other = { ...ready, customer_id: "284619" };
  assert.equal(guard.begin(ready), true);
  assert.equal(guard.begin(next), true);
  assert.equal(guard.begin(other), true);
  guard.finish(ready, true);
  assert.equal(guard.isUnknown(next), false); assert.equal(guard.isUnknown(other), false);
  assert.equal(guard.isPending(next), true); assert.equal(guard.isPending(other), true);
  guard.reconcile({ ...next, state: "Order Confirmed" }, []);
  assert.equal(guard.isUnknown(ready), true);
});
