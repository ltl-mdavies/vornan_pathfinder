import assert from "node:assert/strict";
import test from "node:test";
import { reviewerProgress, reviewerSignInFailure, timeReviewerStage } from "../src/reviewer-progress.ts";

test("progress distinguishes waiting for Google from authorization and loading", () => {
  assert.match(reviewerProgress("google"), /Google/);
  assert.match(reviewerProgress("authorizing"), /Checking reviewer access/);
  assert.match(reviewerProgress("loading"), /Opening/);
});
test("cancellation and blocked popup are actionable without leaking provider errors", () => {
  assert.match(reviewerSignInFailure({ code: "auth/popup-closed-by-user" }), /cancelled/);
  assert.match(reviewerSignInFailure({ code: "auth/cancelled-popup-request" }), /cancelled/);
  assert.match(reviewerSignInFailure({ code: "auth/popup-blocked" }), /blocked/);
  assert.equal(reviewerSignInFailure({ message: "secret", code: "unrecognized" }).includes("secret"), false);
});
test("local timing retains one nonidentifying duration and preserves result/error", async () => {
  assert.equal(await timeReviewerStage("token", async () => "opaque-result"), "opaque-result");
  const error = new Error("opaque-error");
  await assert.rejects(timeReviewerStage("token", async () => { throw error; }), e => e === error);
  const measures = performance.getEntriesByName("proof-reviewer:token", "measure");
  assert.equal(measures.length, 1);
  assert.ok(measures[0].duration >= 0);
  assert.equal(JSON.stringify(measures).includes("opaque"), false);
  performance.clearMeasures("proof-reviewer:token");
});
