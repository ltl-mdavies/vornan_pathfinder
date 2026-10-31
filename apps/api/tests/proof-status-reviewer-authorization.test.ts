import assert from "node:assert/strict";
import test from "node:test";
import { verifyLtlDemoStatusReviewer, validateStatusReviewerFirebaseConfig } from "../src/proof/status-reviewer-authorization.ts";

test("reviewer verifier rejects emulators and cross-project credentials without exposing credentials", () => {
  const base = { FIREBASE_PROJECT_ID: "synthetic-project" };
  assert.deepEqual(validateStatusReviewerFirebaseConfig(base), { projectId: "synthetic-project" });
  for (const patch of [{ FIREBASE_PROJECT_ID: "" }, { FIREBASE_PROJECT_ID: "bad;host" },
    { FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" }, { FIREBASE_SERVICE_ACCOUNT_JSON: "invalid-secret" },
    { FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", project_id: "other-project" }) }]) {
    assert.throws(() => validateStatusReviewerFirebaseConfig({ ...base, ...patch }), { message: "Reviewer sign-in is not configured." });
  }
});

const now = new Date("2026-10-31T16:00:00Z");
const seconds = now.getTime() / 1000;
const identity = { uid: "synthetic-reviewer", email: "Mdavies@ltlco.com", email_verified: true, auth_time: seconds - 60, exp: seconds + 3600 };
test("only the approved, recently authenticated and verified LTL Demo reviewer qualifies", async () => {
  const input = { enabled: true, customerId: "1249", bearer: "synthetic-token", now,
    verifyToken: async (_token: string, revoked: true) => { assert.equal(revoked, true); return identity; } };
  assert.deepEqual(await verifyLtlDemoStatusReviewer(input), { uid: identity.uid, email: "mdavies@ltlco.com", verified_at: now.toISOString(), expires_at: new Date((identity.auth_time + 900) * 1000).toISOString() });
  for (const claims of [ { ...identity, email: "other@ltlco.com" }, { ...identity, email_verified: false },
    { ...identity, uid: "" }, { ...identity, exp: seconds }, { ...identity, auth_time: seconds - 901 },
    { ...identity, auth_time: seconds + 60 }, { ...identity, auth_time: NaN }, { ...identity, exp: NaN } ]) {
    await assert.rejects(() => verifyLtlDemoStatusReviewer({ ...input, verifyToken: async () => claims }));
  }
  await assert.rejects(() => verifyLtlDemoStatusReviewer({ ...input, verifyToken: async () => { throw new Error("revoked"); } }));
  for (const patch of [{ enabled: false }, { customerId: "175332" }, { bearer: "" }]) {
    await assert.rejects(() => verifyLtlDemoStatusReviewer({ ...input, ...patch, verifyToken: async () => { assert.fail("Must reject before verification"); } }));
  }
});
