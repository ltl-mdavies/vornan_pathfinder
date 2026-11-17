import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

type Item = Record<string, AttributeValue>;
const FORMAT = "pathfinder-job-json-gzip-v1";
export const JOB_COMPRESS_THRESHOLD = 300 * 1024;
// Reserve room for the existing timestamp override and future small metadata.
export const JOB_ITEM_BUDGET = 396 * 1024;
export const JOB_JSON_BUDGET = 16 * 1024 * 1024;
export const WRITE_COMPRESSED_JOBS = true;

export class JobStorageError extends Error {
  constructor(public readonly code: "job_storage_size_exceeded" | "job_storage_integrity_failed") {
    super(code === "job_storage_size_exceeded"
      ? "The job exceeds safe storage capacity. Internal support must review storage; do not remove order lines or resubmit an uncertain order."
      : "The saved job could not be verified. Internal support must review storage before any submission.");
    this.name = "JobStorageError";
  }
}
const fail = (): never => { throw new JobStorageError("job_storage_integrity_failed"); };
const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Conservative complete item budget, including attribute names and envelopes. */
export function jobDynamoItemBytes(item: Item): number {
  function valueSize(value: AttributeValue): number {
    if (value.S !== undefined) return bytes(value.S);
    if (value.B !== undefined) return value.B.byteLength;
    if (value.N !== undefined) return 22; // Upper bound for DynamoDB numbers.
    if (value.BOOL !== undefined || value.NULL !== undefined) return 1;
    if (value.L) return 3 + value.L.reduce((n, v) => n + 1 + valueSize(v), 0);
    if (value.M) return 3 + Object.entries(value.M).reduce((n, [k, v]) => n + bytes(k) + 1 + valueSize(v), 0);
    if (value.SS) return value.SS.reduce((n, s) => n + bytes(s), 0);
    if (value.NS) return value.NS.length * 22;
    if (value.BS) return value.BS.reduce((n, b) => n + b.byteLength, 0);
    return fail();
  }
  return Object.entries(item).reduce((n, [k, v]) => n + bytes(k) + valueSize(v), 0);
}

/** Called only for the existing {customer_id, job_id} primary-key shape. */
export function encodeJobDynamoItem(item: Item): Item {
  const raw = item.data?.S;
  if (typeof raw !== "string" || !item.customer_id?.S || !item.job_id?.S) return fail();
  const plainBytes = jobDynamoItemBytes(item);
  if (plainBytes <= JOB_COMPRESS_THRESHOLD) return item;
  if (!WRITE_COMPRESSED_JOBS && plainBytes <= JOB_ITEM_BUDGET) return item;
  const source = Buffer.from(raw, "utf8");
  if (source.byteLength > JOB_JSON_BUDGET || !WRITE_COMPRESSED_JOBS) {
    throw new JobStorageError("job_storage_size_exceeded");
  }
  const job = JSON.parse(raw);
  if (job.customer_id !== item.customer_id.S || job.job_id !== item.job_id.S) return fail();
  // Keep only bounded identifiers searchable. This is never used as job data.
  const identifiers = [job.customer_id, job.job_id, job.pathfinder_order_id,
    job.contract_number, job.canonical_order?.order?.contract_number,
    job.lift_payload?.order?.contract_number,
    job.lift_payload?.order?.ext_id, job.lift_payload?.order?.po_number,
    job.target_order_number, job.source_evidence?.task_id]
    .filter((s): s is string => typeof s === "string" && /^[A-Za-z0-9:_-]{1,256}$/.test(s));
  const encoded: Item = {
    ...item,
    data: { B: gzipSync(source) },
    data_encoding: { S: FORMAT },
    data_sha256: { S: digest(source) },
    data_utf8_bytes: { N: String(source.byteLength) },
    job_search: { S: [...new Set(identifiers)].join(" ") }
  };
  if (jobDynamoItemBytes(encoded) > JOB_ITEM_BUDGET) throw new JobStorageError("job_storage_size_exceeded");
  return encoded;
}

/** Shared decoder: old JSON stays unchanged; unknown/corrupt binary fails closed. */
export function decodeDynamoRecord<T>(item: Item): T | null {
  if (!item.data_encoding && item.data?.S !== undefined) return JSON.parse(item.data.S) as T;
  if (!item.data_encoding && !item.data?.B) return null;
  const size = Number(item.data_utf8_bytes?.N);
  if (item.data_encoding?.S !== FORMAT || !item.data?.B || item.data.S !== undefined ||
      !Number.isSafeInteger(size) || size < 1 || size > JOB_JSON_BUDGET ||
      !/^[a-f0-9]{64}$/.test(item.data_sha256?.S ?? "") ||
      !item.customer_id?.S || !item.job_id?.S) return fail();
  try {
    const raw = gunzipSync(item.data.B, { maxOutputLength: size });
    if (raw.byteLength !== size || digest(raw) !== item.data_sha256!.S) return fail();
    const job = JSON.parse(raw.toString("utf8"));
    if (!job || job.customer_id !== item.customer_id.S || job.job_id !== item.job_id.S) return fail();
    return job as T;
  } catch { return fail(); }
}
