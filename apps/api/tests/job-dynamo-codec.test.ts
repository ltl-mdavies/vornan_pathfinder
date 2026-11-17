import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { IntakePreparationFailure, safePreparationFailure } from "../src/intake-diagnostics.js";
import { decodeDynamoRecord, encodeJobDynamoItem, jobDynamoItemBytes,
  JOB_ITEM_BUDGET, JOB_JSON_BUDGET, JobStorageError } from "../src/job-dynamo-codec.js";

function item(job: Record<string, unknown>) {
  return { customer_id: { S: "284619" }, job_id: { S: "synthetic-100" },
    updated_at: { S: "2026-11-17T18:00:00.000Z" }, data: { S: JSON.stringify(job) } };
}
function syntheticJob() {
  const lines = Array.from({ length: 100 }, (_, i) => ({
    line_number: i + 1, creative: `${i < 50 ? "A" : "B"}${i % 50 + 1}`,
    quantity: 1, product_id: "348225", width: 18.5, height: 23.5,
    notes: "Synthetic lossless persistence fixture. ".repeat(45)
  }));
  return { customer_id: "284619", job_id: "synthetic-100", contract_number: "C-SYNTHETIC",
    pathfinder_order_id: "PF-SYNTHETIC", source_evidence: { task_id: "task-synthetic" },
    parsed_order_rows: lines, source_sheets: [{ parsed_rows: lines, sections: [{ parsed_rows: lines }] }],
    canonical_order: { lines }, lift_payload: { order: { ext_id: "PF-SYNTHETIC", lines } },
    submit_request_masked: { body: { lines } } };
}
test("storage limits produce an internal-support diagnostic, not a grid-format blame", () => {
  const failure=safePreparationFailure(new IntakePreparationFailure("job_storage_size_exceeded","preview_creation"));
  assert.equal(failure.reason_code,"job_storage_size_exceeded");
  assert.match(failure.message,/Keep all order lines/);
  assert.doesNotMatch(failure.message,/grid format/);
});
test("100 distinct ordered creatives roundtrip without changing any field", () => {
  const job = syntheticJob(), original = item(job), encoded = encodeJobDynamoItem(original);
  assert.ok(jobDynamoItemBytes(original) > 409600);
  assert.ok(jobDynamoItemBytes(encoded) < JOB_ITEM_BUDGET);
  assert.equal(encoded.data?.S, undefined); // Old operational writers fail closed.
  assert.match(encoded.job_search!.S!, /C-SYNTHETIC.*PF-SYNTHETIC|PF-SYNTHETIC.*C-SYNTHETIC/);
  assert.match(encoded.job_search!.S!, /task-synthetic/);
  assert.deepEqual(decodeDynamoRecord(encoded), job);
  assert.deepEqual(decodeDynamoRecord(encodeJobDynamoItem(item(decodeDynamoRecord(encoded)!))), job);
  assert.equal(encoded.updated_at, original.updated_at);
  assert.equal(new Set(job.canonical_order.lines.map(l => l.creative)).size, 100);
});
test("legacy small JSON records and missing records retain their shape", () => {
  const original = item({ customer_id: "284619", job_id: "synthetic-100", state: "Ready" });
  assert.equal(encodeJobDynamoItem(original), original);
  assert.deepEqual(decodeDynamoRecord(original), JSON.parse(original.data.S));
  assert.equal(decodeDynamoRecord({}), null);
});
test("corrupt, foreign, unknown-format and over-budget compressed records fail closed", () => {
  const encoded = encodeJobDynamoItem(item(syntheticJob()));
  const bad = [
    { ...encoded, data_encoding: { S: "future-v2" } },
    { ...encoded, data_sha256: { S: "a".repeat(64) } },
    { ...encoded, data_utf8_bytes: { N: "1" } },
    { ...encoded, data_utf8_bytes: { N: String(JOB_JSON_BUDGET + 1) } },
    { ...encoded, data: { B: randomBytes(100) } },
    { ...encoded, data: { B: gzipSync(Buffer.alloc(1024 * 1024)) }, data_utf8_bytes: { N: "32" } },
    { ...encoded, customer_id: { S: "another-customer" } },
    { ...encoded, job_id: { S: "another-job" } },
    { ...encoded, data_encoding: undefined },
  ];
  for (const broken of bad) assert.throws(() => decodeDynamoRecord(broken as typeof encoded), JobStorageError);
});
test("incompressible data and excess envelope keys are rejected before persistence", () => {
  assert.throws(() => encodeJobDynamoItem({ ...item(syntheticJob()), customer_id: { S: "foreign" } }), { code: "job_storage_integrity_failed" });
  const oversized = item({ customer_id: "284619", job_id: "synthetic-100", blob: randomBytes(600000).toString("base64") });
  assert.throws(() => encodeJobDynamoItem(oversized), { code: "job_storage_size_exceeded" });
  assert.throws(() => encodeJobDynamoItem({ ...item(syntheticJob()), oversized_metadata: { S: "x".repeat(410000) } }), { code: "job_storage_size_exceeded" });
  const tiny = item({ customer_id: "284619", job_id: "synthetic-100", unicode: "印刷" });
  assert.ok(jobDynamoItemBytes(tiny) >= Buffer.byteLength(tiny.data.S));
});
