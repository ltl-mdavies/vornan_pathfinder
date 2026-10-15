import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { allowedLiftProofAssetUrl, boundStatusProofIdentity, matchingStatusProof, StatusProofBusyError, StatusProofReportCache } from "../src/public-status-proof-assets.js";
import type { PublicOrderStatusSnapshot } from "../src/store.js";

const binding = { order_key: "customer:order:job", job_id: "job", order_number: "A100" };
const snapshot = { ...binding, job: { job_id: "job" }, proof_visibility: "status_only", lines: [
  { line_number: 1, order_line_id: 123, proofs: [{ proof_filename: "same.jpg", created_ts: "timestamp-1" }] },
  { line_number: 2, order_line_id: 456, proofs: [{ proof_filename: "same.jpg", created_ts: "timestamp-2" }] }
] } as unknown as PublicOrderStatusSnapshot;
const query = { lineNumber: "1", filename: "same.jpg" };
const identity = boundStatusProofIdentity(snapshot, binding, query)!;
const row = { order_number: "A100", line_number: 1, order_line_id: 123, proof_filename: "same.jpg", created_ts: "timestamp-1" };

test("derives exact line identity from the token-bound snapshot, compatible with old clients", () => {
  assert.equal(identity.orderLineId, "123");
  assert.equal(identity.createdTs, "timestamp-1");
  assert.deepEqual(matchingStatusProof([row], identity), row);
  assert.equal(boundStatusProofIdentity(snapshot, binding, { ...query, createdTs: "old-version" }), null);
});

test("rejects other order/job snapshots, unknown lines/files, and hidden proofs before Lift reads", () => {
  for (const invalid of [null, { ...snapshot, order_key: "other" }, { ...snapshot, order_number: "A200" },
    { ...snapshot, job: { ...snapshot.job, job_id: "other" } }, { ...snapshot, proof_visibility: "off" as const }]) {
    assert.equal(boundStatusProofIdentity(invalid, binding, query), null);
  }
  assert.equal(boundStatusProofIdentity(snapshot, binding, { ...query, lineNumber: "3" }), null);
  assert.equal(boundStatusProofIdentity(snapshot, binding, { ...query, filename: "other.jpg" }), null);
  assert.equal(boundStatusProofIdentity({ ...snapshot, lines: [{ ...snapshot.lines[0], order_line_id: null }] }, binding, query), null);
});

test("does not serve another line/order/version or an ambiguous same-name attachment", () => {
  for (const wrong of [{ ...row, order_number: "A200" }, { ...row, line_number: 2 },
    { ...row, order_line_id: 456 }, { ...row, created_ts: "timestamp-2" }, { ...row, proof_filename: "other.jpg" }]) {
    assert.equal(matchingStatusProof([wrong], identity), null);
  }
  assert.equal(matchingStatusProof([row, { ...row }], identity), null);
  assert.equal(matchingStatusProof([{ ...row, order_line_id: 456 }, row], identity), row);
});

test("preserves signed-host and organization path validation for JPG/PDF", () => {
  for (const asset of ["thumbs/91/file.jpg", "originals/91/file.pdf"]) {
    assert.ok(allowedLiftProofAssetUrl(`https://bucket.s3.amazonaws.com/${asset}?signed=opaque`));
  }
  for (const url of ["http://bucket.s3.amazonaws.com/thumbs/91/file.jpg", "https://evil.invalid/thumbs/91/file.jpg",
    "https://bucket.s3.amazonaws.com/thumbs/92/file.jpg", "https://user:pass@bucket.s3.amazonaws.com/thumbs/91/file.jpg",
    "https://bucket.s3.amazonaws.com:444/thumbs/91/file.jpg"]) assert.equal(allowedLiftProofAssetUrl(url), null);
});

test("coalesces high/low reads per scoped line, bounds active reads, and expires successes", async () => {
  let now = 0, calls = 0;
  const cache = new StatusProofReportCache<string>(() => now, 1, 2);
  let complete!: (value: string) => void;
  const loader = () => { calls++; return new Promise<string>((resolve) => { complete = resolve; }); };
  const first = cache.read("customer:route:order:line-1", loader);
  const second = cache.read("customer:route:order:line-1", loader);
  await assert.rejects(cache.read("other:route:order:line-1", loader), StatusProofBusyError);
  complete("fresh");
  assert.deepEqual(await Promise.all([first, second]), ["fresh", "fresh"]);
  assert.equal(calls, 1);
  assert.equal(await cache.read("customer:route:order:line-1", async () => "wrong"), "fresh");
  now = 15_001;
  assert.equal(await cache.read("customer:route:order:line-1", async () => "renewed"), "renewed");
  assert.equal(await cache.read("customer:route:order:line-2", async () => "other-line"), "other-line");
});

test("failure cooldown prevents retry storms without permanently caching failures", async () => {
  let now = 0, calls = 0;
  const cache = new StatusProofReportCache<string>(() => now);
  const fail = async () => { calls++; throw new Error("timeout"); };
  await assert.rejects(cache.read("line", fail));
  await assert.rejects(cache.read("line", fail));
  assert.equal(calls, 1);
  now = 1001;
  assert.equal(await cache.read("line", async () => "recovered"), "recovered");
});

test("asset route authorizes before resolving, scopes to trusted line, and never falls back to whole report", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  const route = source.split('app.get("/public/status/:token/proof-asset"')[1].split("async function handlePublicStatusLinkRequest")[0];
  assert.ok(route.indexOf("activePublicStatusToken") < route.indexOf("boundStatusProofIdentity"));
  assert.match(route, /orderLineId: identity.orderLineId/);
  assert.match(route, /binding.customer_id, target.target_id, route.output_route_id, binding.order_number, identity.orderLineId/);
  assert.match(route, /candidate.output_route_id === job.output_route_id/);
  assert.match(route, /matchingStatusProof/);
  assert.equal((route.match(/fetchLiftProofReport\(/g) ?? []).length, 1);
});
