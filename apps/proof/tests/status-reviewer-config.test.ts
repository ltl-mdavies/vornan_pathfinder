import assert from "node:assert/strict";
import test from "node:test";
import { validStatusReviewerConfig } from "../src/status-reviewer-config.ts";

test("reviewer sign-in stays disabled unless canonical project configuration is complete", () => {
  const config = { VITE_PROOF_STATUS_REVIEWER_SIGNIN: "true", VITE_FIREBASE_PROJECT_ID: "synthetic-project",
    VITE_FIREBASE_AUTH_DOMAIN: "synthetic-project.firebaseapp.com", VITE_FIREBASE_API_KEY: "synthetic", VITE_FIREBASE_APP_ID: "synthetic" };
  assert.equal(validStatusReviewerConfig(config), true);
  for (const key of Object.keys(config)) assert.equal(validStatusReviewerConfig({ ...config, [key]: "" }), false);
  for (const domain of ["other.firebaseapp.com", "https://synthetic-project.firebaseapp.com", "evil.example", "synthetic-project.firebaseapp.com/path"]) {
    assert.equal(validStatusReviewerConfig({ ...config, VITE_FIREBASE_AUTH_DOMAIN: domain }), false);
  }
});
