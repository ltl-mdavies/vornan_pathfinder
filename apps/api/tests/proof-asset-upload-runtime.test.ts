import assert from "node:assert/strict";
import test from "node:test";
import type { ProofOrder } from "@pathfinder/proof-domain";
import type { ProofAssetUploadRecord } from "@pathfinder/proof-domain/proof-asset-upload";
import type { ProofAssetUploadRuntimeConfig } from "../src/proof/asset-upload-config.ts";
import {
  createProofAssetUploadService,
  ProofAssetUploadServiceError
} from "../src/proof/asset-upload-service.ts";
import { ProofAssetUploadStoreError } from "../src/proof/asset-upload-store.ts";

const now = new Date("2026-08-01T12:00:00.000Z");
const checksum = "a".repeat(64);
const order: ProofOrder = {
  order_number: "A0226753",
  order_title: "Synthetic LTL Demo",
  customer_id: "1249",
  customer_name: "LTL Demo",
  order_status: "Pending Art Approval",
  health: "active",
  version: 1,
  lines: [],
  tasks: [{
    task_id: "ptask_synthetic_001",
    order_line_id: "line-synthetic-001",
    line_number: "1",
    attachment_id: "proofing-synthetic-0001",
    product_name: "Synthetic panel",
    quantity: 1,
    state: "pending",
    actionable: true,
    sibling_index: 0,
    sibling_count: 1,
    version: 7,
    current_version: {
      version_id: "pversion-synthetic-001",
      attachment_id: "proofing-synthetic-0001",
      created_at: "2026-08-01T11:00:00.000Z",
      filename: "synthetic-proof.pdf",
      preview_url: null,
      download_url: null,
      approval_status: null,
      approved_by: null,
      approved_at: null,
      comments: [],
      detailed_report: null,
      feedback_fingerprint: "feedback-synthetic-001",
      current: true,
      archived_at: null
    },
    versions: [],
    created_at: "2026-08-01T11:00:00.000Z",
    updated_at: "2026-08-01T11:00:00.000Z",
    archived_at: null
  }],
  archived_tasks: [],
  warnings: [],
  created_at: "2026-08-01T11:00:00.000Z",
  updated_at: "2026-08-01T11:00:00.000Z",
  last_synced_at: "2026-08-01T11:00:00.000Z"
};

function config(enabled = true): ProofAssetUploadRuntimeConfig {
  return {
    enabled,
    bucket_name: "vornan-pathfinder-proof-assets-dev-744016783602",
    allowed_customer_id: "1249",
    allowed_order_numbers: ["A0226753"],
    activation_expires_at: "2026-08-01T13:00:00.000Z",
    maximum_bytes: 1024 * 1024 * 1024,
    upload_ticket_seconds: 600,
    allowed_content_types: ["application/pdf"]
  };
}

const request = {
  order_number: "A0226753",
  task_id: "ptask_synthetic_001",
  attachment_id: "proofing-synthetic-0001",
  idempotency_key: "asset-upload-synthetic-0001",
  original_filename: "Revised / Artwork?.pdf",
  content_type: "application/pdf",
  content_length: 8192,
  sha256: checksum
};

test("dark upload gate denies before Lift read, persistence, or S3", async () => {
  const calls: string[] = [];
  const service = createProofAssetUploadService({
    runtimeConfig: () => config(false),
    now: () => now,
    syncOrder: async () => {
      calls.push("sync");
      return { order, diagnostics: null } as never;
    },
    reserve: async () => {
      calls.push("reserve");
      throw new Error("must not run");
    },
    createPost: async () => {
      calls.push("s3");
      throw new Error("must not run");
    }
  });
  await assert.rejects(
    () => service.prepare({
      request,
      operator_uid: "operator-synthetic",
      correlation_id: "correlation-synthetic"
    }),
    (error: unknown) =>
      error instanceof ProofAssetUploadServiceError && error.code === "disabled"
  );
  assert.deepEqual(calls, []);
});

test("reserves immutable metadata before issuing one exact short-lived S3 POST", async () => {
  let stored: ProofAssetUploadRecord | null = null;
  let capturedPost: any = null;
  const service = createProofAssetUploadService({
    runtimeConfig: () => config(),
    now: () => now,
    syncOrder: async (_orderNumber, options) => {
      assert.deepEqual(options.allowed_customer_ids, ["1249"]);
      assert.match(
        options.audit_context!.correlation_id!,
        /^pcorr_asset_[a-f0-9]{64}$/
      );
      assert.notEqual(
        options.audit_context!.correlation_id,
        "correlation-synthetic"
      );
      return { order, diagnostics: null } as never;
    },
    reserve: async (record, audit) => {
      assert.equal(audit.action, "proof.asset_upload_initialized");
      stored = record;
      return { status: "new" as const, record };
    },
    transition: async (current, next, audit) => {
      assert.equal(current.state, "initialized");
      assert.equal(next.state, "uploading");
      assert.equal(audit.action, "proof.asset_upload_started");
      stored = next;
      return next;
    },
    createPost: (async (_client: unknown, input: unknown) => {
      capturedPost = input;
      return {
        url: "https://synthetic-bucket.s3.amazonaws.com/",
        fields: { policy: "synthetic-policy", signature: "synthetic-signature" }
      };
    }) as never
  });
  const result = await service.prepare({
    request,
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic"
  });
  assert.equal(result.status, "new");
  assert.equal(result.asset.state, "uploading");
  assert.equal(result.asset.original_filename, "Revised _ Artwork_.pdf");
  assert.equal(result.upload.method, "POST");
  assert.equal(result.upload.expires_at, "2026-08-01T12:10:00.000Z");
  assert.equal(capturedPost.Bucket, config().bucket_name);
  assert.equal(capturedPost.Expires, 600);
  assert.equal(capturedPost.Fields["Content-Type"], "application/pdf");
  assert.equal(capturedPost.Fields["x-amz-checksum-algorithm"], "SHA256");
  assert.equal(
    capturedPost.Fields["x-amz-checksum-sha256"],
    Buffer.from(checksum, "hex").toString("base64")
  );
  assert.match(capturedPost.Fields.tagging, /proof-lifecycle/);
  assert.ok(stored);
  const serialized = JSON.stringify(stored).toLowerCase();
  for (const forbidden of ["signed_url", "authorization", "client_secret", "correlation-synthetic", "wrike", "sharepoint", "dropbox"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("binds one opaque asset identity to the order and idempotency key", async () => {
  let stored: ProofAssetUploadRecord | null = null;
  let currentOrder = order;
  let postCount = 0;
  const service = createProofAssetUploadService({
    runtimeConfig: () => config(),
    now: () => now,
    syncOrder: async () => ({ order: currentOrder, diagnostics: null }) as never,
    reserve: async (candidate) => {
      if (!stored) {
        stored = candidate;
        return { status: "new" as const, record: candidate };
      }
      const exact =
        stored.asset_id === candidate.asset_id &&
        stored.task_id === candidate.task_id &&
        stored.attachment_id === candidate.attachment_id &&
        stored.replaces_proof_version_id === candidate.replaces_proof_version_id &&
        stored.original_filename === candidate.original_filename &&
        stored.declared_sha256 === candidate.declared_sha256;
      if (!exact) {
        throw new ProofAssetUploadStoreError(
          "conflict",
          "synthetic changed-body conflict"
        );
      }
      return { status: "replay" as const, record: stored };
    },
    transition: async (_current, next) => {
      stored = next;
      return next;
    },
    createPost: (async () => {
      postCount += 1;
      return { url: "https://synthetic.invalid", fields: {} };
    }) as never
  });

  const first = await service.prepare({
    request,
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic-1"
  });
  const replay = await service.prepare({
    request: { ...request },
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic-2"
  });
  assert.equal(replay.status, "replay");
  assert.equal(replay.asset.asset_id, first.asset.asset_id);
  assert.equal(postCount, 2, "an exact replay may refresh its short-lived ticket");

  for (const changed of [
    { ...request, sha256: "b".repeat(64) },
    { ...request, original_filename: "Different Artwork.pdf" }
  ]) {
    await assert.rejects(
      () => service.prepare({
        request: changed,
        operator_uid: "operator-synthetic",
        correlation_id: "correlation-synthetic-conflict"
      }),
      (error: unknown) =>
        error instanceof ProofAssetUploadServiceError && error.code === "conflict"
    );
  }

  currentOrder = {
    ...order,
    tasks: [{
      ...order.tasks[0]!,
      current_version: {
        ...order.tasks[0]!.current_version!,
        version_id: "pversion-synthetic-002"
      }
    }]
  };
  await assert.rejects(
    () => service.prepare({
      request,
      operator_uid: "operator-synthetic",
      correlation_id: "correlation-synthetic-version-conflict"
    }),
    (error: unknown) =>
      error instanceof ProofAssetUploadServiceError && error.code === "conflict"
  );

  const alternateTask = {
    ...order.tasks[0]!,
    task_id: "ptask_synthetic_002",
    attachment_id: "proofing-synthetic-0002",
    current_version: {
      ...order.tasks[0]!.current_version!,
      version_id: "pversion-synthetic-003",
      attachment_id: "proofing-synthetic-0002"
    }
  };
  currentOrder = { ...order, tasks: [order.tasks[0]!, alternateTask] };
  await assert.rejects(
    () => service.prepare({
      request: {
        ...request,
        task_id: alternateTask.task_id,
        attachment_id: alternateTask.attachment_id
      },
      operator_uid: "operator-synthetic",
      correlation_id: "correlation-synthetic-task-conflict"
    }),
    (error: unknown) =>
      error instanceof ProofAssetUploadServiceError && error.code === "conflict"
  );
  assert.equal(postCount, 2, "changed-body conflicts never issue an upload ticket");
});

test("finalizes only an exact versioned S3 object and retains scan/publication gates", async () => {
  let stored: ProofAssetUploadRecord | null = null;
  const prepareService = createProofAssetUploadService({
    runtimeConfig: () => config(),
    now: () => now,
    syncOrder: async () => ({ order, diagnostics: null }) as never,
    reserve: async (record) => {
      stored = record;
      return { status: "new" as const, record };
    },
    transition: async (_current, next) => {
      stored = next;
      return next;
    },
    createPost: (async () => ({ url: "https://synthetic.invalid", fields: {} })) as never
  });
  const prepared = await prepareService.prepare({
    request,
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic"
  });

  let sends = 0;
  const finalizeService = createProofAssetUploadService({
    runtimeConfig: () => config(),
    now: () => now,
    getRecord: async () => stored,
    transition: async (current, next, audit) => {
      assert.equal(current.state, "uploading");
      assert.equal(next.state, "uploaded");
      assert.equal(audit.action, "proof.asset_upload_completed");
      stored = next;
      return next;
    },
    s3: {
      async send() {
        sends += 1;
        if (sends === 1) {
          return {
            VersionId: "3/L4kqtJlcpXroDTDmJ+sourceVersion=",
            LastModified: new Date("2026-08-01T12:00:05.000Z"),
            ContentType: "application/pdf",
            ContentLength: 8192,
            ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64"),
            Metadata: {
              "asset-id": prepared.asset.asset_id,
              "revision-id": prepared.asset.revision_id,
              "attachment-id": "proofing-synthetic-0001",
              "declared-sha256": checksum
            }
          };
        }
        return {
          TagSet: [{ Key: "proof-lifecycle", Value: "unfinalized" }]
        };
      }
    }
  });
  const result = await finalizeService.finalize({
    request: {
      order_number: "A0226753",
      asset_id: prepared.asset.asset_id
    },
    operator_uid: "operator-synthetic",
    correlation_id: "correlation-synthetic"
  });
  assert.equal(result.status, "completed");
  assert.equal(result.asset.state, "uploaded");
  assert.equal(result.asset.verification_status, "pending");
  assert.equal(result.asset.publication_status, "not_started");
  assert.equal(sends, 2);
});

test("fails finalization closed on changed bytes or lifecycle tags", async () => {
  const fake = {
    asset_id: `passet_${"b".repeat(64)}`,
    bucket_name: config().bucket_name,
    source_key: "orders/A0226753/synthetic.pdf",
    declared_content_type: "application/pdf",
    declared_content_length: 8192,
    declared_sha256: checksum,
    revision_id: `prevision_${"c".repeat(64)}`,
    attachment_id: "proofing-synthetic-0001",
    order_number: "A0226753"
  } as ProofAssetUploadRecord;
  const service = createProofAssetUploadService({
    runtimeConfig: () => config(),
    now: () => now,
    getRecord: async () => fake,
    s3: {
      async send() {
        return {
          VersionId: "version-synthetic",
          LastModified: new Date("2026-08-01T12:00:05.000Z"),
          ContentType: "application/pdf",
          ContentLength: 8193,
          ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64"),
          Metadata: {}
        };
      }
    }
  });
  await assert.rejects(
    () => service.finalize({
      request: { order_number: "A0226753", asset_id: fake.asset_id },
      operator_uid: "operator-synthetic",
      correlation_id: "correlation-synthetic"
    }),
    (error: unknown) =>
      error instanceof ProofAssetUploadServiceError && error.code === "conflict"
  );
});
