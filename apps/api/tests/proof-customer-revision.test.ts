import assert from "node:assert/strict";
import test from "node:test";
import type { ProofOrder, ProofAccessSession, ProofAuditEvent } from "@pathfinder/proof-domain";
import { createCustomerRevisionService, revisionUploadOwnerAuditId } from "../src/proof/customer-revision-service.js";
import type { RevisionSubmission } from "../src/proof/customer-revision-store.js";
import { readyRevisionAsset } from "./fixtures/customer-revision-ready.js";

function fixture() {
  const asset = readyRevisionAsset();
  const session = { session_id: "psession_test", order_number: asset.order_number, grant_id: "pgrant_test", participant_id: "pparticipant_test", scope: "review", capability: { proof_customer_id: "1249", access_mode: "review" } } as ProofAccessSession;
  const task = { task_id: asset.task_id, attachment_id: asset.attachment_id, order_line_id: "line", state: "pending", actionable: true, version: 1, archived_at: null, quantity: 1, current_version: { attachment_id: asset.attachment_id, version_id: asset.replaces_proof_version_id, current: true, comments: [], feedback_fingerprint: "none" } };
  const order = { order_number: asset.order_number, customer_id: "1249", health: "active", tasks: [task], archived_tasks: [], lines: [{ order_line_id: "line", cancelled: false }], version: 1 } as unknown as ProofOrder;
  const request = { asset_id: asset.asset_id, task_id: asset.task_id, attachment_id: asset.attachment_id, expected_task_version: 1, expected_version_id: asset.replaces_proof_version_id, idempotency_key: "revision-test-0000001" };
  const owner = { event_id: revisionUploadOwnerAuditId(asset.asset_id), action: "proof.asset_upload_initialized", actor_type: "customer_session", grant_id: session.grant_id, participant_id: session.participant_id, order_number: order.order_number, task_id: task.task_id, attachment_id: asset.attachment_id, metadata: { proof_asset_id: asset.asset_id } } as ProofAuditEvent;
  let saved: RevisionSubmission | null = null, enabled = true, accepted = false, collision = false, persistFailure = false, reads = 0;
  const sends: any[] = [];
  const service = createCustomerRevisionService({
    enabled: () => enabled, runtime: () => ({ feature_flags: { public_read: true, revision_upload: true, approve: true } }) as never,
    now: () => new Date("2026-10-28T12:01:00.000Z"),
    read: async () => saved ? structuredClone(saved) : null,
    list: async () => saved ? [structuredClone(saved)] : [],
    sync: async () => { reads++; return { order } as never; }, asset: async () => asset, ownerAudit: async () => owner,
    participant: async () => ({ grant_id: session.grant_id, participant_id: session.participant_id!, order_number: order.order_number, display_name: "Reviewer", email: "reviewer@example.invalid" }) as never,
    acknowledgement: async () => null, reopen: async () => false,
    target: async () => ({ environments: [{ environment_id: "env-lift-prod", role: "PROD", status: "Active", endpoint_url: "https://lift.example.invalid/import" }] }) as never,
    credentials: async () => ({ base_url: "https://lift.example.invalid/api", company_id: "91", action_user_name: "VORNAN_PROOF", client_id: "test", client_secret: "synthetic-secret-long-enough-for-test" }),
    reserve: async record => { if (collision || saved) return false; saved = structuredClone(record); return true; },
    replace: async (current, next) => { if (persistFailure) throw new Error("storage unavailable"); if (saved?.record_version !== current.record_version) return false; saved = structuredClone(next); return true; },
    send: async input => { assert.equal(saved?.state, "submitted"); sends.push(input); if (!accepted) throw new Error("response lost"); return { status: 200 } as never; }
  });
  const context = { session, correlation_id: "test-revision" };
  return { asset, order, owner, task, request, session, service, context, sends, get reads() { return reads; }, get saved() { return saved!; }, disable: () => { enabled = false; }, accept: () => { accepted = true; }, collide: () => { collision = true; }, persistenceFailure: () => { persistFailure = true; }, submit: () => service.submit({ ...context, request }) };
}
test("revision handoff is default-dark and denies view/unidentified reviewers before reads", async () => {
  const f = fixture(); f.disable(); await assert.rejects(f.submit()); assert.equal(f.reads, 0);
  for (const patch of [{ scope: "view" }, { participant_id: null }, { capability: { access_mode: "view", proof_customer_id: "1249" } }]) {
    const f = fixture(); Object.assign(f.session, patch); await assert.rejects(f.submit()); assert.equal(f.reads, 0);
  }
});
test("one durable revision PUT uses the verified URL and existing bearer authentication; never retries a lost response", async () => {
  const f = fixture(); const result = await f.submit();
  assert.equal(result.state, "checking"); assert.equal(result.lift_outcome_confirmed, false);
  assert.equal(f.sends.length, 1);
  assert.ok(Object.values(f.sends[0].headers).some(value => String(value).startsWith("Bearer ")));
  assert.match(JSON.stringify(f.sends[0].plan.body), /go.vornan.co/);
  assert.equal(JSON.stringify(f.saved).includes("https://"), false);
  assert.deepEqual(await f.submit(), result); assert.equal(f.sends.length, 1);
  assert.deepEqual(await f.service.status({ ...f.context, submission_id: result.submission_id }), result);
  assert.equal(JSON.stringify(result).includes("pgrant"), false);
});
test("accepted transport is not proof of consumption and a failed outcome write preserves recovery", async () => {
  const f = fixture(); f.accept(); assert.equal((await f.submit()).state, "accepted"); assert.equal((await f.submit()).lift_outcome_confirmed, false);
  const lost = fixture(); lost.persistenceFailure(); const receipt = await lost.submit(); assert.equal(receipt.state, "submitted"); await lost.submit(); assert.equal(lost.sends.length, 1);
});
test("ownership, current art, feedback, cancellation, multi-creative and verified delivery are required", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.owner.grant_id = "another-grant"; },
    (f: ReturnType<typeof fixture>) => { f.owner.participant_id = "another-reviewer"; },
    (f: ReturnType<typeof fixture>) => { f.owner.actor_type = "operator"; },
    (f: ReturnType<typeof fixture>) => { f.order.customer_id = "999"; },
    (f: ReturnType<typeof fixture>) => { f.task.version++; },
    (f: ReturnType<typeof fixture>) => { f.order.lines[0]!.cancelled = true; },
    (f: ReturnType<typeof fixture>) => { f.order.tasks.push({ ...f.order.tasks[0]!, task_id: "other", attachment_id: "276" }); },
    (f: ReturnType<typeof fixture>) => { f.asset.malware_scan_status = "threats_found"; },
    (f: ReturnType<typeof fixture>) => { f.asset.delivery_url_sha256 = "0".repeat(64); },
    (f: ReturnType<typeof fixture>) => { f.asset.replaces_proof_version_id = "different-art"; },
    (f: ReturnType<typeof fixture>) => { f.asset.lift_not_before_epoch = Math.floor(Date.parse("2026-10-29T00:00:00Z") / 1000); },
    (f: ReturnType<typeof fixture>) => { f.order.tasks[0]!.current_version!.comments = [{ text: "New instructions", created_at: null, attachment: null }]; }
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.submit()); assert.equal(f.sends.length, 0); }
});
test("concurrent requests send once, conflicting claims block, and receipts remain reviewer-bound", async () => {
  const f = fixture(); await Promise.all([f.submit(), f.submit()]); assert.equal(f.sends.length, 1);
  f.request.expected_task_version = 2; await assert.rejects(f.submit());
  await assert.rejects(f.service.status({ ...f.context, session: { ...f.session, participant_id: "other" }, submission_id: f.saved.submission_id }));
  const blocked = fixture(); blocked.collide(); await assert.rejects(blocked.submit()); assert.equal(blocked.sends.length, 0);
});
test("lost-response recovery discovers only the current reviewer and task receipts without replay", async () => {
  const f = fixture(); await f.submit();
  const receipts = await f.service.list({ ...f.context, task_id: f.task.task_id });
  assert.equal(receipts.length, 1); assert.equal(receipts[0]!.asset_id, f.asset.asset_id);
  assert.equal(receipts[0]!.version_id, f.request.expected_version_id);
  assert.equal(f.sends.length, 1);
  for (const session of [
    { ...f.session, grant_id: "other" }, { ...f.session, participant_id: "other" },
    { ...f.session, order_number: "A0000000" },
    { ...f.session, capability: { ...f.session.capability!, proof_customer_id: "999" } }
  ]) assert.deepEqual(await f.service.list({ ...f.context, session, task_id: f.task.task_id }), []);
  assert.deepEqual(await f.service.list({ ...f.context, task_id: "another-task" }), []);
  f.disable(); await assert.rejects(f.service.list({ ...f.context, task_id: f.task.task_id }));
  assert.equal(f.sends.length, 1);
});
