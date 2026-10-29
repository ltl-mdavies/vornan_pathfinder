import assert from "node:assert/strict";
import test from "node:test";
import { revisionProtectsProof, revisionSubmissionCopy } from "../src/revision-submission-state.ts";

test("accepted transport waits for a proof without claiming file import", () => {
  const copy = revisionSubmissionCopy({ state: "accepted" });
  assert.equal(copy.title, "Artwork sent");
  assert.match(copy.detail, /Awaiting updated proof/);
  assert.doesNotMatch(copy.detail, /imported|approved|received by Lift/i);
});

test("submitted, checking, and lost receipts remain uncertain without a spinner or resend", () => {
  for (const receipt of [null, { state: "submitted" as const }, { state: "checking" as const }]) {
    const copy = revisionSubmissionCopy(receipt);
    assert.equal(copy.title, "Submission not confirmed");
    assert.equal(copy.tone, "uncertain");
    assert.match(copy.detail, /do not send the artwork again/);
  }
});

test("receipt protects exact original proof but not a replacement proof", () => {
  const receipt = { attachment_id: "original", version_id: "v1" };
  assert.equal(revisionProtectsProof(receipt, "original", "v1"), true);
  assert.equal(revisionProtectsProof(receipt, "replacement", "v2"), false);
  assert.equal(revisionProtectsProof(receipt, "original", "v2"), false);
  assert.equal(revisionProtectsProof(receipt, null, null), false);
});
