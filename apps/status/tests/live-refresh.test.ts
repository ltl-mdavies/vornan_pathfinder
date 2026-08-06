import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PUBLIC_STATUS_POLL_MS,
  publicStatusPollDelay,
  retainTransientProofAssets,
  shouldPollPublicStatus
} from "../src/live-refresh.js";

test("uses a bounded server-directed polling interval", () => {
  assert.equal(publicStatusPollDelay(undefined), DEFAULT_PUBLIC_STATUS_POLL_MS);
  assert.equal(publicStatusPollDelay(1), 15_000);
  assert.equal(publicStatusPollDelay(30), 30_000);
  assert.equal(publicStatusPollDelay(300), 60_000);
});

test("polls only while the status page is visible", () => {
  assert.equal(shouldPollPublicStatus("visible"), true);
  assert.equal(shouldPollPublicStatus("hidden"), false);
});

test("retains transient proof links in browser memory across a degraded partial refresh", () => {
  const previous = [{
    order_key: "order-1",
    lines: [{
      line_number: 1,
      proofs: [{
        proof_filename: "proof.jpg",
        creation_date: "2026-08-06",
        proof_link_low: "https://proof.example.invalid/temporary-low.jpg",
        proof_link_high: "https://proof.example.invalid/temporary-high.jpg",
        preview_kind: "image" as const
      }]
    }]
  }];
  const incoming = [{
    order_key: "order-1",
    lines: [{
      line_number: 1,
      proofs: [{
        proof_filename: "proof.jpg",
        creation_date: "2026-08-06",
        proof_link_low: null,
        proof_link_high: null,
        preview_kind: "unavailable" as const
      }]
    }]
  }];

  const merged = retainTransientProofAssets(previous, incoming);
  assert.equal(merged[0]?.lines[0]?.proofs[0]?.proof_link_low, previous[0]?.lines[0]?.proofs[0]?.proof_link_low);
  assert.equal(merged[0]?.lines[0]?.proofs[0]?.preview_kind, "image");
});

test("does not carry proof links to a different proof identity", () => {
  const previous = [{
    order_key: "order-1",
    lines: [{ line_number: 1, proofs: [{ proof_filename: "old.jpg", proof_link_low: "https://proof.example.invalid/old.jpg" }] }]
  }];
  const incoming = [{
    order_key: "order-1",
    lines: [{ line_number: 1, proofs: [{ proof_filename: "new.jpg", proof_link_low: null }] }]
  }];

  assert.equal(retainTransientProofAssets(previous, incoming)[0]?.lines[0]?.proofs[0]?.proof_link_low, null);
});
