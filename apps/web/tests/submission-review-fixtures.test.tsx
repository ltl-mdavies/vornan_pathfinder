import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createSubmissionReview, type SubmissionSeed } from "../../../tests/ux/submission-fixtures";

const seed = {
  jobs: [{ job_id: "qa-job", customer_id: "1249", customer_name: "LTL Demo", source_file_name: "Synthetic.xlsx", state: "Ready", canonical_order: { order: {} }, lift_payload: { order: { ext_id: "QA-ONLY" }, lines: [] } }],
  workspaces: { "1249": { jobs: [] }, "284619": { jobs: [] } }
} as unknown as SubmissionSeed;
const url = (path = "") => new URL(`/api/customers/1249/jobs/qa-job${path}`, "http://127.0.0.1:5210");
const reviewed = { reviewed_submit_fingerprint: "a".repeat(64) };
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};

test("simulated timeout reserves one immutable attempt, replay does not submit twice, and reload retains it", async () => {
  const storage = memory(), query = new URLSearchParams("submissionReview=ready&reviewCase=one");
  const review = createSubmissionReview(seed, query, storage);
  const first = await (await review.handle(url("/submit"), "POST", reviewed))!.json();
  assert.equal(first.job.state, "Submitted");
  assert.equal(first.attempt.state, "Submission Uncertain");
  const reloaded = createSubmissionReview(seed, query, storage);
  const replay = await (await reloaded.handle(url("/submit"), "POST", reviewed))!.json();
  assert.equal(replay.reused, true);
  assert.deepEqual(replay.attempt, first.attempt);
  const detail = await (await reloaded.handle(url(), "GET"))!.json();
  assert.equal(detail.submit_attempts.length, 1);
  assert.equal(detail.job.target_order_number, null);
  assert.equal(storage.getItem(review.storageKey), "uncertain");
});

test("simulated reconciliation confirms the job without overwriting the historical uncertain response", async () => {
  const review = createSubmissionReview(seed, new URLSearchParams("submissionReview=uncertain"));
  const before = await (await review.handle(url(), "GET"))!.json();
  review.simulateReconciliation();
  const after = await (await review.handle(url(), "GET"))!.json();
  assert.equal(after.job.target_order_number, "A9000999");
  assert.equal(after.job.state, "Order Confirmed");
  assert.deepEqual(after.submit_attempts, before.submit_attempts);
  const list = await (await review.handle(new URL("/api/jobs", url()), "GET"))!.json();
  assert.equal(list.jobs[0].target_order_number, after.job.target_order_number);
});

test("certification and changed-review failures create no attempt or confirmation", async () => {
  for (const scenario of ["blocked", "changed"]) {
    const review = createSubmissionReview(seed, new URLSearchParams(`submissionReview=${scenario}`));
    assert.equal((await review.handle(url("/submit"), "POST", reviewed))!.status, 409);
    const detail = await (await review.handle(url(), "GET"))!.json();
    assert.equal(detail.submit_attempts.length, 0);
    assert.equal(detail.job.target_order_number, null);
    assert.equal(detail.job.state, "Ready");
  }
  const review = createSubmissionReview(seed, new URLSearchParams("submissionReview=ready"));
  assert.equal((await review.handle(url("/submit"), "POST", {}))!.status, 409);
});

test("customer boundaries, unknown writes, off-origin requests and unrelated storage stay closed", async () => {
  const storage = memory(); storage.setItem("other", "keep");
  const review = createSubmissionReview(seed, new URLSearchParams("submissionReview=uncertain"), storage);
  assert.equal((await review.handle(new URL("https://example.invalid/api/jobs"), "GET"))!.status, 423);
  assert.equal((await review.handle(new URL("/api/customers/284619/jobs/qa-job/submit", url()), "POST", reviewed))!.status, 404);
  assert.equal((await review.handle(new URL("/api/proof/approve", url()), "POST"))!.status, 423);
  const other = await (await review.handle(new URL("/api/customers/284619/workspace", url()), "GET"))!.json();
  assert.deepEqual(other.jobs, []); assert.deepEqual(other.submit_attempts, []);
  review.reset(); assert.equal(storage.getItem("other"), "keep");
  assert.equal(seed.jobs[0].state, "Ready");
});

test("Admin does not equate a missing Lift confirmation with evidence that no order exists", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"Not in Lift"/);
  assert.match(source, /job\.state === "Submitted" \? "Awaiting confirmation"/);
  assert.match(source, /Historical timeout retained for audit/);
  assert.match(source, /latestJobAttempt\.request_fingerprint === selectedJobDetail\.submit_integrity\?\.fingerprint/);
});

test("lost-response simulation retains the reserved attempt when the operator reopens the job", async () => {
  const review = createSubmissionReview(seed, new URLSearchParams("submissionReview=network"));
  await assert.rejects(() => review.handle(url("/submit"), "POST", reviewed), /Synthetic lost response/);
  const detail = await (await review.handle(url(), "GET"))!.json();
  assert.equal(detail.submit_attempts.length, 1);
  assert.equal(detail.job.state, "Submitted");
  const replay = await (await review.handle(url("/submit"), "POST", reviewed))!.json();
  assert.equal(replay.reused, true);
});

test("job submit feedback is scoped, accessible, and guarded against late detail updates", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /jobSubmitFeedback\?\.jobId === selectedJobDetail\.job_id/);
  assert.match(source, /role=\{jobSubmitFeedback\.error \? "alert" : "status"\}/);
  assert.match(source, /jobSubmitFeedbackRef\.current\?\.focus\(\)/);
  assert.match(source, /detailRequestId === jobDetailRequestIdRef\.current && selectedJobDetail\?\.job_id === submitAttempt\.job_id/);
  assert.match(source, /current\?\.customer\.lift_customer_id === submitJob\.customer_id/);
  assert.match(source, /Refresh this job to check its latest attempt/);
});

test("unknown responses and known certification blockers replace Submit with a safe reread", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /selectedJobCertificationBlocked \|\| Boolean\(activeJobSubmitFeedback\?\.error\)/);
  assert.match(source, /selectedJobNeedsSubmitReview \? \([\s\S]*?openJobDetail\(selectedJobDetail\)[\s\S]*?Refresh job[\s\S]*?\) : canRetrySelectedJob/);
  assert.match(source, /"Response unknown" : "Review required"/);
  assert.match(source, /The last loaded record may be out of date/);
  assert.match(source, /Resolve the blocking items/);
});

test("late submit completion cannot attach feedback or preview attempts to a new customer workspace", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /const submitWorkspaceRequestId = workspaceRequestIdRef\.current/);
  assert.match(source, /if \(submitContextCurrent\(\)\) setWorkspaceMessage\(payload\.error/);
  assert.match(source, /submitContextCurrent\(\) && selectedCustomerIdRef\.current === submitJob\.customer_id\) setLastSubmitAttempt/);
  assert.match(source, /if \(submitWorkspaceRequestId === workspaceRequestIdRef\.current && \(jobOverride \|\| previewEpoch === manualPreviewEpochRef\.current\)\) setWorkspaceState/);
  assert.match(source, /setLastPreviewJob\(current => current\?\.job_id === submittedJob\.job_id \? submittedJob : current\)/);
});

test("manual preview persists through simulated loss, failed read, retry and reconciliation", async () => {
  const review = createSubmissionReview(seed, new URLSearchParams("submissionReview=network&manualImport"));
  const previewUrl = new URL("/api/customers/1249/jobs/preview", url());
  const preview = await (await review.handle(previewUrl, "POST", {}))!.json();
  assert.equal(preview.job.job_id, "qa-job");
  await assert.rejects(() => review.handle(url("/submit"), "POST", reviewed));
  review.failNextRead();
  assert.equal((await review.handle(url(), "GET"))!.status, 503);
  assert.equal((await (await review.handle(url(), "GET"))!.json()).job.state, "Submitted");
  review.simulateReconciliation();
  assert.equal((await (await review.handle(url(), "GET"))!.json()).job.target_order_number, "A9000999");
  assert.equal(review.counts().submitRequests, 1);
  assert.equal(review.counts().previewRequests, 1);
});

test("manual explicit rejection and immediate success have distinct responses", async () => {
  for (const scenario of ["rejected", "success"]) {
    const review = createSubmissionReview(seed, new URLSearchParams(`submissionReview=${scenario}&manualImport`));
    const result = (await review.handle(url("/submit"), "POST", reviewed))!;
    const payload = await result.json();
    if (scenario === "rejected") { assert.equal(result.status, 422); assert.equal(payload.certification.can_submit, false); }
    else { assert.equal(payload.job.state, "Order Confirmed"); assert.equal(payload.job.target_order_number, "A9000999"); }
  }
});

test("a replacement manual preview has a different identity and isolated outcome", async () => {
  const review = createSubmissionReview(seed, new URLSearchParams("submissionReview=network&manualImport"));
  const previewUrl = new URL("/api/customers/1249/jobs/preview", url());
  await review.handle(previewUrl, "POST", {});
  await assert.rejects(() => review.handle(url("/submit"), "POST", reviewed));
  const next = await (await review.handle(previewUrl, "POST", {}))!.json();
  assert.notEqual(next.job.job_id, "qa-job"); assert.equal(next.job.state, "Ready");
  assert.equal((await (await review.handle(url(), "GET"))!.json()).job.state, "Submitted");
});
