import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reviewerGoogleParameters } from "../src/reviewer-account-hint.ts";

test("email hint is optional, trimmed and only a Google navigation parameter", () => {
  assert.deepEqual(reviewerGoogleParameters(), {});
  assert.deepEqual(reviewerGoogleParameters({emailHint:"  "}), {});
  assert.deepEqual(reviewerGoogleParameters({emailHint:" reviewer@example.com "}), {login_hint:"reviewer@example.com"});
});
test("different account discards even an invalid hint and forces account selection", () => {
  assert.deepEqual(reviewerGoogleParameters({emailHint:"invalid",chooseAccount:true}), {prompt:"select_account"});
});
test("malformed and oversized hints are rejected without reflecting input", () => {
  for (const emailHint of ["invalid", "a@b", "a b@example.com", "a@example.com\nsecret", `${"a".repeat(250)}@example.com`])
    assert.throws(()=>reviewerGoogleParameters({emailHint}), /^Error: Enter a valid email address or leave it blank\.$/);
});
test("hint never becomes the reviewer credential or changes backend authorization", () => {
  const signin=readFileSync(new URL('../src/status-reviewer-signin.ts',import.meta.url),'utf8');
  assert.match(signin,/provider\.setCustomParameters\(parameters\)/);
  assert.match(signin,/persistence: auth\.inMemoryPersistence/);
  assert.match(signin,/reviewerAuth\.currentUser\.getIdToken\(\)/);
  assert.doesNotMatch(signin,/localStorage|sessionStorage/);
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/await signInStatusReviewer\(setReviewerStage, options\)/);
  assert.match(app,/timeReviewerStage\("authorizing", authorizeStatusReviewer\)/);
  const form=readFileSync(new URL('../src/status-reviewer-access.tsx',import.meta.url),'utf8');
  assert.match(form,/setEmailHint\(""\)/);
  assert.match(form,/type="email"/);
  assert.match(form,/Use a different internal Google account/);
});

test("notice distinguishes internal Google sign-in from unavailable customer email verification", () => {
  const form=readFileSync(new URL('../src/status-reviewer-access.tsx',import.meta.url),'utf8');
  assert.match(form,/Internal users only/);
  assert.match(form,/Internal Google sign-in/);
  assert.match(form,/Email verification isn’t available here yet/);
  assert.match(form,/does not grant review access/);
  assert.doesNotMatch(form,/Sign in with an authorized reviewer account to approve/);
});
