import assert from "node:assert/strict";
import test from "node:test";
import { createIntakeAttempt, transitionIntake, type IntakeLedger } from "../src/intake-assurance.js";
import { prepareIntakeDelivery, claimIntakeDelivery, acknowledgeIntakeDelivery, type IntakeDeliveryLedger, type IntakeDeliveryReceipt } from "../src/intake-delivery.js";
import { dispatchWrikeIntakeFeedback } from "../src/wrike-intake-feedback.js";
import { WrikeConnectionError, type WrikeOAuthCredentials } from "@pathfinder/wrike-adapter";
import type { ProcessingJobPreview, SubmitAttempt, readWrikeIntakeFeedbackScope } from "../src/store.js";
const time = "2026-09-10T12:00:00Z";
const scope = { customer_id: "synthetic", provider: "wrike", connection_id: "connection", import_method_id: "method" };
const credentials: WrikeOAuthCredentials = { client_id: "synthetic", client_secret: "synthetic", refresh_token: "synthetic", host: "www.wrike.com", scope: "wsReadWrite" };
function fixture() {
  const fresh = createIntakeAttempt({ schema_version: 1, ...scope, source_id: "TASK123", intent_key: "Sent to Print - LTL", intent_occurrence: "initial", observed_at: "2026-09-10T10:00:00Z" }, "2026-09-10T11:00:00Z");
  let attempt = transitionIntake(fresh, { event_id: "needs-mapping", expected_revision: 0, occurred_at: "2026-09-10T10:00:00Z", state: "customer_action_required", reason: "unmapped_product", job_id: "job", next_action_at: fresh.next_action_at });
  let receipt: IntakeDeliveryReceipt | null = null; let posts = 0; let checks = 0; let saves = 0;
  const job = { customer_id: "synthetic", job_id: "job", import_method_id: "method", state: "Needs Mapping", target_order_number: null, source_evidence: { provider: "wrike", task_id: "TASK123", connection_id: "connection", attachment_id: "ATTACH1", version_id: "VERSION1", evidence_id: "evidence", evidence_sha256: "a".repeat(64), import_method_fingerprint: "fingerprint", captured_at: "2026-09-10T10:00:00Z" } } as ProcessingJobPreview;
  const snapshot = { checked_at: time, jobs: [job], submits: [] as SubmitAttempt[] };
  const saved = { customer_id: "synthetic", connection: { connection_id: "connection", provider: "wrike", status: "Active" }, method: { import_method_id: "method", source: "Wrike", status: "Active", source_config: { wrike: { connection_id: "connection", trigger_status_id: "STATUS1", trigger_status_label: "Sent to Print – LTL" } } } } as Awaited<ReturnType<typeof readWrikeIntakeFeedbackScope>>;
  const intake: IntakeLedger = { get: async () => attempt, reserve: async () => { throw new Error("unexpected reserve"); }, transition: async () => { throw new Error("unexpected intake update"); } };
  const receipts: IntakeDeliveryLedger = { get: async () => receipt, prepare: async (row, kind, now) => receipt = prepareIntakeDelivery(receipt, row, kind, now),
    claim: async (row, current, now) => { if (attempt.revision !== current.revision) throw new Error("revision changed"); return receipt = claimIntakeDelivery(row, current, now); },
    acknowledge: async (row, id, now) => receipt = acknowledgeIntakeDelivery(row, id, now) };
  const args: Parameters<typeof dispatchWrikeIntakeFeedback>[0] = { enabled: true, scope, attempt_id: attempt.attempt_id, intake, receipts,
    loadScope: async () => saved, snapshot: async () => snapshot, loadCredentials: async () => credentials, saveCredentials: async () => { saves++; }, now: () => new Date(time),
    verify: async (_oauth, requested) => { checks++; assert.equal(requested.task_id, "TASK123"); return { credentials, checked_at: time, task_id: "TASK123", trigger_status_id: "STATUS1", task_updated_at: "2026-09-10T09:00:00Z" }; },
    currentWorkbooks: async () => ({ credentials, attachments: [{ attachment_id: "ATTACH1", version_id: "VERSION1", updated_at: "2026-09-10T09:00:00Z" }] }),
    post: async (_oauth, requested) => { posts++; assert.equal(receipt!.state, "uncertain"); assert.equal(requested.task_id, "TASK123"); assert.match(requested.text, /products could not be matched/); return { credentials, comment: { comment_id: "COMMENT1", created_at: time } }; } };
  return { args, snapshot, saved, receipt: () => receipt, posts: () => posts, checks: () => checks, saves: () => saves, change: () => { attempt = { ...attempt, revision: attempt.revision + 1 }; } };
}
test("disabled adapter has no reads; safe correction verifies exact status and preserves credentials before and after a single comment", async () => {
  const f = fixture();
  assert.equal((await dispatchWrikeIntakeFeedback({ ...f.args, enabled: false })).status, "disabled"); assert.equal(f.receipt(), null);
  assert.equal((await dispatchWrikeIntakeFeedback(f.args)).status, "sent"); assert.equal(f.posts(), 1); assert.equal(f.checks(), 1); assert.equal(f.saves(), 4);
  assert.equal((await dispatchWrikeIntakeFeedback(f.args)).status, "suppressed"); assert.equal(f.posts(), 1); assert.equal(f.checks(), 1);
});
test("any transport history, a corrected job, conflicting job or wrong scope blocks comments before provider verification", async () => {
  for (const variant of ["transport", "corrected", "duplicate", "scope", "inactive", "readonly"]) {
    const f = fixture();
    if (variant === "transport") f.snapshot.submits.push({ customer_id: "synthetic", job_id: "job", state: "Blocked" } as SubmitAttempt);
    if (variant === "corrected") f.snapshot.jobs[0]!.state = "Ready";
    if (variant === "duplicate") f.snapshot.jobs.push({ ...f.snapshot.jobs[0]!, job_id: "other" });
    if (variant === "scope") f.saved.method.source_config.wrike!.connection_id = "other";
    if (variant === "inactive") f.saved.connection.status = "Inactive";
    if (variant === "readonly") f.args.loadCredentials = async () => ({ ...credentials, scope: "wsReadOnly" });
    assert.equal((await dispatchWrikeIntakeFeedback(f.args)).status, "blocked", variant); assert.equal(f.posts(), 0); assert.equal(f.checks(), 0);
  }
});
test("status mismatch preserves rotated credentials and prevents a claim; post uncertainty never retries", async () => {
  const f = fixture();
  f.args.verify = async () => { throw new WrikeConnectionError("trigger_status_mismatch", "private", credentials); };
  await assert.rejects(dispatchWrikeIntakeFeedback(f.args)); assert.equal(f.receipt()!.state, "prepared"); assert.equal(f.saves(), 1); assert.equal(f.posts(), 0);
  const g = fixture(); let posts = 0;
  g.args.post = async () => { posts++; throw new WrikeConnectionError("comment_write_failed", "private", credentials); };
  assert.equal((await dispatchWrikeIntakeFeedback(g.args)).status, "uncertain");
  assert.equal((await dispatchWrikeIntakeFeedback(g.args)).status, "suppressed"); assert.equal(posts, 1); assert.equal(g.saves(), 4);
});
test("evidence changing during verification or after claim suppresses comments", async () => {
  const f = fixture(); const verify = f.args.verify!;
  f.args.verify = async (...args) => { const checked = await verify(...args); f.snapshot.jobs[0]!.state = "Ready"; return checked; };
  assert.equal((await dispatchWrikeIntakeFeedback(f.args)).status, "blocked"); assert.equal(f.posts(), 0);
  const g = fixture(); const claim = g.args.receipts.claim;
  g.args.receipts.claim = async (...args) => { const row = await claim(...args); g.snapshot.jobs[0]!.state = "Ready"; return row; };
  assert.equal((await dispatchWrikeIntakeFeedback(g.args)).status, "uncertain"); assert.equal(g.posts(), 0);
});
