import assert from "node:assert/strict";
import test from "node:test";
import { isStatusProofAsset, retryStatusProofAsset } from "../../../packages/order-rollup-ui/src/proof-asset-recovery.js";
import { proxyHighResolutionProofAssets } from "../src/live-refresh.js";

test("expired direct low links are replaced by stable, version-bound thumbnail resolvers", () => {
  const [snapshot] = proxyHighResolutionProofAssets([{ order_key: "key", order_number: "A100", lines: [{
    line_number: 1, proofs: [{ proof_filename: "same.jpg", created_ts: "version 1", proof_link_low: "https://bucket.invalid/expired.jpg?Expires=1", proof_link_high: "https://bucket.invalid/art.pdf" }]
  }] }], "https://api.example.invalid", "token");
  const proof = snapshot.lines[0].proofs[0];
  assert.match(proof.proof_link_low!, /asset_kind=thumbnail/);
  assert.match(proof.proof_link_high!, /asset_kind=pdf/);
  assert.equal(new URL(proof.proof_link_low!).searchParams.get("created_ts"), "version 1");
  assert.doesNotMatch(proof.proof_link_low!, /expired|Expires/);
});

test("retry preserves token, order, line, version, and file identity without changing signed links", () => {
  const url = "https://api.example.invalid/public/status/token/proof-asset?order_number=A100&line_number=1&filename=same.jpg&created_ts=v1&asset_kind=image";
  assert.ok(isStatusProofAsset(url));
  assert.equal(retryStatusProofAsset(url, 0, 123), url);
  const retried = new URL(retryStatusProofAsset(url, 1, 123));
  assert.equal(retried.searchParams.get("asset_retry"), "123-1");
  retried.searchParams.delete("asset_retry");
  assert.equal(retried.toString(), url);
  const signed = "https://bucket.s3.amazonaws.com/originals/91/file.jpg?signature=secret";
  assert.equal(retryStatusProofAsset(signed, 1, 123), signed);
});

test("a JPG creative name does not imply its unavailable high-resolution proof URL is an image", () => {
  const [snapshot] = proxyHighResolutionProofAssets([{ order_key: "key", order_number: "A100", lines: [{
    line_number: 1, proofs: [{ proof_filename: "creative.jpg", proof_link_low: null, proof_link_high: null }]
  }] }], "https://api.example.invalid", "token");
  assert.equal(new URL(snapshot.lines[0].proofs[0].proof_link_high!).searchParams.get("asset_kind"), "document");
});
