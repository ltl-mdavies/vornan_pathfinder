import assert from "node:assert/strict";
import test from "node:test";
import { getProofAssetUploadRuntimeConfig } from "../src/proof/asset-upload-config.ts";
import { getProofLtlDemoQaProfile } from "../src/proof/ltl-demo-qa-profile.ts";
import { getProofRuntimeConfig } from "../src/proof/runtime-config.ts";

const now = new Date("2026-08-11T12:00:00.000Z");
const scope = "true|2026-08-11T20:00:00.000Z|A0226753,A0227641|true|true|true|true";

test("activates one bounded customer-1249 profile with explicit demo orders", () => {
  const profile = getProofLtlDemoQaProfile(
    { PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE: scope },
    now
  );
  assert.deepEqual(profile, {
    configured: true,
    active: true,
    allowed_customer_id: "1249",
    allowed_order_numbers: ["A0226753", "A0227641"],
    activation_expires_at: "2026-08-11T20:00:00.000Z",
    grant_creation_enabled: true,
    public_read_enabled: true,
    customer_approval_enabled: true,
    asset_upload_enabled: true,
    session_ttl_minutes: 720,
    automatic_retry: false
  });
});

test("fails closed without exact orders or outside the 24-hour profile window", () => {
  for (const candidate of [
    "true|2026-08-11T20:00:00.000Z||true|true|true|true",
    "true|2026-08-11T11:59:59.000Z|A0226753|true|true|true|true",
    "true|2026-08-12T12:00:01.000Z|A0226753|true|true|true|true",
    "false|2026-08-11T20:00:00.000Z|A0226753|true|true|true|true",
    "true|not-a-date|A0226753|true|true|true|true"
  ]) {
    const profile = getProofLtlDemoQaProfile(
      { PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE: candidate },
      now
    );
    assert.equal(profile.active, false);
    assert.equal(profile.grant_creation_enabled, false);
    assert.equal(profile.public_read_enabled, false);
    assert.equal(profile.customer_approval_enabled, false);
    assert.equal(profile.asset_upload_enabled, false);
  }
});

test("reuses the exact profile order allowlist for sessions and private uploads", () => {
  const env = {
    PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE: scope,
    PATHFINDER_PROOF_ASSET_BUCKET:
      "vornan-pathfinder-proof-assets-dev-744016783602"
  };
  const runtime = getProofRuntimeConfig(env, now);
  const upload = getProofAssetUploadRuntimeConfig(env, now);
  assert.equal(runtime.phase, "ltl_demo_customer_qa");
  assert.equal(runtime.feature_flags.public_read, true);
  assert.equal(runtime.feature_flags.approve, true);
  assert.equal(runtime.feature_flags.revision_upload, true);
  assert.deepEqual(runtime.access.grant_allowed_customer_ids, ["1249"]);
  assert.equal(runtime.access.session_ttl_minutes, 720);
  assert.equal(upload.enabled, true);
  assert.deepEqual(upload.allowed_order_numbers, runtime.ltl_demo_qa.allowed_order_numbers);
});
