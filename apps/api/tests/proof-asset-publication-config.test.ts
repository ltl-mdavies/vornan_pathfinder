import assert from "node:assert/strict";
import test from "node:test";
import { getProofAssetPublicationRuntimeConfig } from "../src/proof/asset-publication-config.ts";

test("keeps publication dark unless every separate binding is supplied", () => {
  assert.deepEqual(getProofAssetPublicationRuntimeConfig({}), {
    enabled: false,
    bucket_name: null,
    delivery_base_url: null,
    allowed_order_numbers: [],
    activation_expires_at: null
  });
});
test("normalizes only exact Proof publication orders, bucket, expiry, and origin", () => {
  assert.deepEqual(getProofAssetPublicationRuntimeConfig({
    PATHFINDER_ENABLE_PROOF_ASSET_PUBLICATION: "true",
    PATHFINDER_PROOF_ASSET_BUCKET:
      "vornan-pathfinder-proof-assets-dev-744016783602",
    PATHFINDER_PROOF_ASSET_DELIVERY_BASE_URL: "https://go.vornan.co",
    PATHFINDER_PROOF_ASSET_PUBLICATION_ALLOWED_ORDERS:
      "a0226753,invalid,A0226753,A0227641",
    PATHFINDER_PROOF_ASSET_PUBLICATION_EXPIRES_AT:
      "2026-08-11T20:00:00Z"
  }), {
    enabled: true,
    bucket_name: "vornan-pathfinder-proof-assets-dev-744016783602",
    delivery_base_url: "https://go.vornan.co",
    allowed_order_numbers: ["A0226753", "A0227641"],
    activation_expires_at: "2026-08-11T20:00:00.000Z"
  });
  assert.throws(() => getProofAssetPublicationRuntimeConfig({
    PATHFINDER_PROOF_ASSET_DELIVERY_BASE_URL: "https://example.com"
  }), /go\.vornan\.co/);
});
