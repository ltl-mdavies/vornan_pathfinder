import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PUBLIC_STATUS_POLL_MS,
  MAX_PUBLIC_STATUS_BACKOFF_MS,
  proxyHighResolutionProofAssets,
  publicStatusOpenErrorMessage,
  publicStatusPollDelay,
  retainTransientProofAssets,
  shouldPollPublicStatus
} from "../src/live-refresh.js";

test("routes high-resolution proof files through the token-bound inline viewer", () => {
  const [snapshot] = proxyHighResolutionProofAssets([{
    order_key: "order-1",
    order_number: "A0227641",
    lines: [{
      line_number: 1,
      proofs: [{
        proof_filename: "Proof panel 1.jpg",
        proof_link_low: "https://proof.example.invalid/low.jpg",
        proof_link_high: "https://proof.example.invalid/high.pdf"
      }]
    }]
  }], "https://api.pathfinder.vornan.co/", "private/token");

  const proof = snapshot?.lines[0]?.proofs[0];
  assert.equal(proof?.proof_link_low, "https://proof.example.invalid/low.jpg");
  assert.equal(
    proof?.proof_link_high,
    "https://api.pathfinder.vornan.co/public/status/private%2Ftoken/proof-asset?order_number=A0227641&line_number=1&filename=Proof+panel+1.jpg&asset_kind=pdf"
  );
});

test("marks image high-resolution assets for the lightbox renderer", () => {
  const [snapshot] = proxyHighResolutionProofAssets([{
    order_key: "order-1",
    order_number: "A0227641",
    lines: [{
      line_number: 1,
      proofs: [{
        proof_filename: "proof.pdf",
        proof_link_high: "https://proof.example.invalid/original.jpg?token=short-lived"
      }]
    }]
  }], "https://api.pathfinder.vornan.co", "token");

  assert.match(snapshot?.lines[0]?.proofs[0]?.proof_link_high ?? "", /asset_kind=image/);
});

test("hydrates redacted initial proof metadata with token-bound thumbnail and viewer URLs", () => {
  const [snapshot] = proxyHighResolutionProofAssets([{
    order_key: "order-1",
    order_number: "A0230105",
    lines: [{
      line_number: 1,
      proofs: [{
        proof_filename: "MTM_30_375x46_375OS.jpg",
        proof_link_low: null,
        proof_link_high: null,
        preview_kind: "unavailable" as const
      }]
    }]
  }], "https://api.pathfinder.vornan.co", "private-token");

  const proof = snapshot?.lines[0]?.proofs[0];
  assert.match(proof?.proof_link_low ?? "", /order_number=A0230105/);
  assert.match(proof?.proof_link_low ?? "", /asset_kind=thumbnail/);
  assert.match(proof?.proof_link_high ?? "", /asset_kind=image/);
  assert.equal(proof?.preview_kind, "image");
});

test("does not invent proof asset routes without a real proof filename", () => {
  const [snapshot] = proxyHighResolutionProofAssets([{
    order_key: "order-1",
    order_number: "A0230105",
    lines: [{
      line_number: 1,
      proofs: [{ proof_filename: null, proof_link_low: null, proof_link_high: null }]
    }]
  }], "https://api.pathfinder.vornan.co", "private-token");

  assert.equal(snapshot?.lines[0]?.proofs[0]?.proof_link_low, null);
  assert.equal(snapshot?.lines[0]?.proofs[0]?.proof_link_high, null);
});

test("uses a bounded server-directed polling interval", () => {
  const noJitter = { random: () => 0.5 };
  assert.equal(publicStatusPollDelay(undefined, noJitter), DEFAULT_PUBLIC_STATUS_POLL_MS);
  assert.equal(publicStatusPollDelay(1, noJitter), 15_000);
  assert.equal(publicStatusPollDelay(30, noJitter), 30_000);
  assert.equal(publicStatusPollDelay(60, noJitter), 60_000);
  assert.equal(publicStatusPollDelay(300, noJitter), 60_000);
});

test("backs off repeated degraded refreshes with bounded jitter", () => {
  assert.equal(publicStatusPollDelay(60, { degradedAttempts: 1, random: () => 0.5 }), 120_000);
  assert.equal(publicStatusPollDelay(60, { degradedAttempts: 2, random: () => 0.5 }), 240_000);
  assert.equal(publicStatusPollDelay(60, { degradedAttempts: 4, random: () => 0.5 }), MAX_PUBLIC_STATUS_BACKOFF_MS);
  assert.equal(publicStatusPollDelay(60, { degradedAttempts: 1, random: () => 0 }), 108_000);
  assert.equal(publicStatusPollDelay(60, { degradedAttempts: 1, random: () => 1 }), 132_000);
});

test("maps initial public API failures to fixed customer-safe copy", () => {
  assert.equal(publicStatusOpenErrorMessage(410), "This private status link has expired. Request a new secure link to continue.");
  assert.equal(publicStatusOpenErrorMessage(404), "This private status link is unavailable. Request a new secure link to continue.");
  assert.equal(publicStatusOpenErrorMessage(500), "This status link could not be opened right now. Please try again shortly.");
  assert.equal(publicStatusOpenErrorMessage(0).includes("provider"), false);
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
