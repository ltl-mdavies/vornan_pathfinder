import assert from "node:assert/strict";
import test from "node:test";
import { matchesRevisionIntent, readRevisionIntents, revisionIntentKey, revisionProtectsProof, revisionSubmissionCopy, saveRevisionIntent, type RevisionIntent } from "../src/revision-submission-state.ts";

test("accepted transport records sending without claiming file import or continued waiting", () => {
  const copy = revisionSubmissionCopy({ state: "accepted" });
  assert.equal(copy.title, "Artwork sent");
  assert.match(copy.detail, /Check the proof queue for any updated proof/);
  assert.doesNotMatch(copy.detail, /Awaiting updated proof/);
  assert.doesNotMatch(copy.detail, /imported|approved|received by Lift/i);
});

const intent: RevisionIntent = { task_id: "task1", attachment_id: "123", version_id: "v1", asset_id: "asset1", filename: "revision.pdf", line_number: "3", idempotency_key: "revision_key_1" };
test("write-ahead recovery is participant/order scoped, reloadable and excludes duplicate attempts", () => {
  const key = revisionIntentKey("A0232139", "reviewer1");
  assert.notEqual(key, revisionIntentKey("A0232139", "reviewer2"));
  assert.notEqual(key, revisionIntentKey("A0233367", "reviewer1"));
  const saved = new Map<string, string>();
  const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => { saved.set(k, v); } };
  saveRevisionIntent(storage, key, [], intent);
  const restored = readRevisionIntents(storage, key);
  assert.deepEqual(restored, [intent]);
  assert.throws(() => saveRevisionIntent(storage, key, restored, { ...intent, asset_id: "other", idempotency_key: "another" }), /already/);
  assert.equal(saveRevisionIntent(storage, key, restored, { ...intent, attachment_id: "124", version_id: "v2" }).length, 2);
  assert.deepEqual(readRevisionIntents(storage, revisionIntentKey("A0232139", "reviewer2")), []);
});
test("storage failure or corrupted recovery cannot silently allow a send", () => {
  assert.throws(() => saveRevisionIntent({ setItem: () => { throw new Error("storage denied"); } }, "key", [], intent), /denied/);
  for (const raw of ['{', '{}', '[{"filename":"alone"}]', '[null]']) assert.throws(() => readRevisionIntents({ getItem: () => raw }, "key"));
});
test("receipt matching requires exact asset/task/attachment/version, never filename", () => {
  const receipt = { ...intent, submission_id: "receipt", state: "accepted" as const, automatic_retry: false as const, lift_outcome_confirmed: false as const };
  assert.equal(matchesRevisionIntent(receipt, intent), true);
  for (const field of ["asset_id", "task_id", "attachment_id", "version_id"] as const) assert.equal(matchesRevisionIntent({ ...receipt, [field]: "other" }, intent), false);
  assert.equal(matchesRevisionIntent({ ...receipt, filename: "renamed.pdf" }, intent), true);
});

test("submitted, checking, and lost receipts remain uncertain without a spinner or resend", () => {
  for (const receipt of [null, { state: "submitted" as const }, { state: "checking" as const }]) {
    const copy = revisionSubmissionCopy(receipt);
    assert.equal(copy.title, "Submission not confirmed");
    assert.equal(copy.tone, "uncertain");
    assert.match(copy.detail, /do not send it again/);
    assert.match(copy.detail, /continue reviewing other proofs/);
    assert.doesNotMatch(copy.detail, /before taking another action/);
  }
});

test("receipt protects exact original proof but not a replacement proof", () => {
  const receipt = { attachment_id: "original", version_id: "v1" };
  assert.equal(revisionProtectsProof(receipt, "original", "v1"), true);
  assert.equal(revisionProtectsProof(receipt, "replacement", "v2"), false);
  assert.equal(revisionProtectsProof(receipt, "original", "v2"), false);
  assert.equal(revisionProtectsProof(receipt, null, null), false);
});
