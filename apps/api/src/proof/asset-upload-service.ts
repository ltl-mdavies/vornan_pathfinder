import {
  GetObjectTaggingCommand,
  HeadObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { createHash } from "node:crypto";
import type { ProofAuditEvent, ProofOrder } from "@pathfinder/proof-domain";
import {
  beginProofAssetUpload,
  completeProofAssetUpload,
  createProofAssetUploadRecord,
  type ProofAssetUploadRecord
} from "@pathfinder/proof-domain/proof-asset-upload";
import { syncProofOrder } from "./service.js";
import {
  getProofAssetUploadRuntimeConfig,
  type ProofAssetUploadRuntimeConfig
} from "./asset-upload-config.js";
import {
  getProofAssetUploadRecord,
  ProofAssetUploadStoreError,
  reserveProofAssetUpload,
  transitionProofAssetUpload
} from "./asset-upload-store.js";

const CUSTOMER_ID = "1249";
const CONTENT_POLICY_ID = "proof-revised-art-operator-v1";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const ASSET_ID = /^passet_[a-f0-9]{64}$/;

type S3Sender = { send(command: unknown): Promise<any> };

export class ProofAssetUploadServiceError extends Error {
  constructor(
    public readonly code:
      | "disabled"
      | "unauthenticated"
      | "not_allowed"
      | "invalid"
      | "stale"
      | "conflict"
      | "storage_failed",
    message: string
  ) {
    super(message);
    this.name = "ProofAssetUploadServiceError";
  }
}

export interface ProofAssetUploadPrepareRequest {
  order_number: string;
  task_id: string;
  attachment_id: string;
  idempotency_key: string;
  original_filename: string;
  content_type: string;
  content_length: number;
  sha256: string;
}

export interface ProofAssetUploadFinalizeRequest {
  order_number: string;
  asset_id: string;
}

export interface ProofAssetUploadStatusRequest {
  order_number: string;
  asset_id: string;
}

export interface ProofAssetUploadServiceDependencies {
  syncOrder?: typeof syncProofOrder;
  getRecord?: typeof getProofAssetUploadRecord;
  reserve?: typeof reserveProofAssetUpload;
  transition?: typeof transitionProofAssetUpload;
  runtimeConfig?: () => ProofAssetUploadRuntimeConfig;
  createPost?: typeof createPresignedPost;
  s3?: S3Sender;
  now?: () => Date;
}

let sharedS3: S3Client | null = null;

function defaultS3() {
  sharedS3 ??= new S3Client({});
  return sharedS3;
}

function sha256(...parts: string[]) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

function actorId(uid: string) {
  if (!/^[A-Za-z0-9_.:-]{1,180}$/.test(uid)) {
    throw new ProofAssetUploadServiceError(
      "unauthenticated",
      "An authenticated Pathfinder operator is required."
    );
  }
  return `operator_${sha256("vornan-proof-asset-operator-v1", uid)}`;
}

function correlationId(value: string) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new ProofAssetUploadServiceError(
      "invalid",
      "Proof upload request correlation is invalid."
    );
  }
  return `pcorr_asset_${sha256(
    "vornan-proof-asset-correlation-v1",
    value
  )}`;
}

function requireGate(now: Date, config: ProofAssetUploadRuntimeConfig) {
  const expiry = config.activation_expires_at
    ? Date.parse(config.activation_expires_at)
    : Number.NaN;
  if (
    !config.enabled ||
    !config.bucket_name ||
    !Number.isFinite(expiry) ||
    expiry <= now.getTime()
  ) {
    throw new ProofAssetUploadServiceError(
      "disabled",
      "Proof revised-art uploads are disabled or their bounded window has expired."
    );
  }
  return config;
}

function safeFilename(value: unknown) {
  if (typeof value !== "string") {
    throw new ProofAssetUploadServiceError("invalid", "Proof filename is invalid.");
  }
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._() -]+/g, "_")
    .replace(/^\.+$/, "_")
    .slice(0, 240);
  if (!normalized || !/^[A-Za-z0-9]/.test(normalized)) {
    throw new ProofAssetUploadServiceError("invalid", "Proof filename is invalid.");
  }
  return normalized;
}

function normalizedPrepare(
  value: ProofAssetUploadPrepareRequest,
  config: ProofAssetUploadRuntimeConfig
) {
  const orderNumber = value.order_number?.trim().toUpperCase();
  const taskId = value.task_id?.trim();
  const attachmentId = value.attachment_id?.trim();
  const contentType = value.content_type?.trim().toLowerCase();
  const digest = value.sha256?.trim().toLowerCase();
  if (
    !/^A\d{7,8}$/.test(orderNumber) ||
    !taskId ||
    !attachmentId ||
    !IDEMPOTENCY_KEY.test(value.idempotency_key ?? "") ||
    !config.allowed_content_types.includes(contentType) ||
    !Number.isInteger(value.content_length) ||
    value.content_length < 1 ||
    value.content_length > config.maximum_bytes ||
    !/^[a-f0-9]{64}$/.test(digest)
  ) {
    throw new ProofAssetUploadServiceError(
      "invalid",
      "Proof revised-art upload metadata is invalid."
    );
  }
  return {
    order_number: orderNumber,
    task_id: taskId,
    attachment_id: attachmentId,
    idempotency_key: value.idempotency_key,
    original_filename: safeFilename(value.original_filename),
    content_type: contentType,
    content_length: value.content_length,
    sha256: digest
  };
}

function currentTask(order: ProofOrder, request: ReturnType<typeof normalizedPrepare>) {
  const task = order.tasks.find((candidate) => candidate.task_id === request.task_id);
  if (
    order.customer_id !== CUSTOMER_ID ||
    !task ||
    !task.actionable ||
    task.attachment_id !== request.attachment_id ||
    !task.current_version ||
    task.current_version.attachment_id !== request.attachment_id
  ) {
    throw new ProofAssetUploadServiceError(
      "stale",
      "The selected Proof is not the current actionable LTL Demo attachment."
    );
  }
  return task;
}

function identities(request: ReturnType<typeof normalizedPrepare>) {
  const identity = sha256(
    "vornan-proof-revised-art-upload-v1",
    request.order_number,
    request.idempotency_key
  );
  return {
    asset_id: `passet_${identity}`,
    revision_id: `prevision_${sha256("revision", identity)}`,
    publication_id: `ppublication_${sha256("publication", identity)}`
  };
}

function mapStoreError(error: unknown): never {
  if (error instanceof ProofAssetUploadStoreError) {
    if (error.code === "conflict" || error.code === "concurrent_update") {
      throw new ProofAssetUploadServiceError(
        "conflict",
        "Proof asset upload metadata conflicts with this idempotency key."
      );
    }
    throw new ProofAssetUploadServiceError(
      "storage_failed",
      "Proof asset upload metadata could not be verified in durable storage."
    );
  }
  throw error;
}

function auditEvent(input: {
  record: ProofAssetUploadRecord;
  action: ProofAuditEvent["action"];
  actor_id: string;
  correlation_id: string;
}): ProofAuditEvent {
  return {
    event_id: `paudit_asset-${sha256(
      input.record.asset_id,
      input.record.state,
      String(input.record.record_version)
    )}`,
    occurred_at: input.record.updated_at,
    action: input.action,
    outcome: "succeeded",
    order_number: input.record.order_number,
    task_id: input.record.task_id,
    order_line_id: null,
    attachment_id: input.record.attachment_id,
    grant_id: null,
    participant_id: null,
    actor_type: "operator",
    actor_id: input.actor_id,
    correlation_id: input.correlation_id,
    metadata: {
      source: "operator",
      proof_asset_id: input.record.asset_id,
      proof_asset_state: input.record.state as
        | "initialized"
        | "uploading"
        | "uploaded"
    }
  };
}

function sanitized(record: ProofAssetUploadRecord) {
  return {
    asset_id: record.asset_id,
    revision_id: record.revision_id,
    order_number: record.order_number,
    task_id: record.task_id,
    attachment_id: record.attachment_id,
    original_filename: record.original_filename,
    content_type: record.declared_content_type,
    content_length: record.declared_content_length,
    sha256: record.declared_sha256,
    state: record.state,
    record_version: record.record_version,
    initialized_at: record.initialized_at,
    upload_completed_at: record.upload_completed_at,
    verification_status: record.verification_status,
    publication_status: record.publication_status
  };
}

function checksumHex(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === 32 ? bytes.toString("hex") : null;
  } catch {
    return null;
  }
}

function exactObject(record: ProofAssetUploadRecord, head: any, tags: any) {
  const versionId = typeof head.VersionId === "string" ? head.VersionId : "";
  const completedAt =
    head.LastModified instanceof Date && Number.isFinite(head.LastModified.getTime())
      ? head.LastModified.toISOString()
      : "";
  const tagSet = new Map(
    Array.isArray(tags.TagSet)
      ? tags.TagSet.map((tag: any) => [tag.Key, tag.Value])
      : []
  );
  if (
    !versionId ||
    !completedAt ||
    head.ContentType !== record.declared_content_type ||
    head.ContentLength !== record.declared_content_length ||
    checksumHex(head.ChecksumSHA256) !== record.declared_sha256 ||
    head.Metadata?.["asset-id"] !== record.asset_id ||
    head.Metadata?.["revision-id"] !== record.revision_id ||
    head.Metadata?.["attachment-id"] !== record.attachment_id ||
    head.Metadata?.["declared-sha256"] !== record.declared_sha256 ||
    tagSet.get("proof-lifecycle") !== "unfinalized"
  ) {
    throw new ProofAssetUploadServiceError(
      "conflict",
      "The uploaded S3 object does not match its immutable Proof upload ticket."
    );
  }
  return { version_id: versionId, completed_at: completedAt };
}

export function createProofAssetUploadService(
  dependencies: ProofAssetUploadServiceDependencies = {}
) {
  const syncOrder = dependencies.syncOrder ?? syncProofOrder;
  const getRecord = dependencies.getRecord ?? getProofAssetUploadRecord;
  const reserve = dependencies.reserve ?? reserveProofAssetUpload;
  const transition = dependencies.transition ?? transitionProofAssetUpload;
  const runtimeConfig =
    dependencies.runtimeConfig ?? getProofAssetUploadRuntimeConfig;
  const createPost = dependencies.createPost ?? createPresignedPost;
  const s3 = dependencies.s3 ?? defaultS3();
  const now = dependencies.now ?? (() => new Date());

  return {
    async status(input: { request: ProofAssetUploadStatusRequest }) {
      const config = requireGate(now(), runtimeConfig());
      const orderNumber = input.request.order_number?.trim().toUpperCase();
      const assetId = input.request.asset_id?.trim();
      if (
        !/^A\d{7,8}$/.test(orderNumber) ||
        !ASSET_ID.test(assetId) ||
        !config.allowed_order_numbers.includes(orderNumber)
      ) {
        throw new ProofAssetUploadServiceError(
          "not_allowed",
          "Proof asset inspection is outside the bounded upload window."
        );
      }
      const record = await getRecord(orderNumber, assetId);
      if (!record || record.bucket_name !== config.bucket_name) {
        throw new ProofAssetUploadServiceError(
          "stale",
          "Proof asset upload metadata was not found."
        );
      }
      return { asset: sanitized(record) };
    },

    async prepare(input: {
      request: ProofAssetUploadPrepareRequest;
      operator_uid: string;
      correlation_id: string;
    }) {
      const currentTime = now();
      const actor = actorId(input.operator_uid);
      const correlation = correlationId(input.correlation_id);
      const config = requireGate(currentTime, runtimeConfig());
      const request = normalizedPrepare(input.request, config);
      if (!config.allowed_order_numbers.includes(request.order_number)) {
        throw new ProofAssetUploadServiceError(
          "not_allowed",
          "Proof order is not in the bounded revised-art upload allowlist."
        );
      }
      const { order } = await syncOrder(request.order_number, {
        allowed_customer_ids: [CUSTOMER_ID],
        audit_context: {
          actor_type: "operator",
          actor_id: actor,
          correlation_id: correlation,
          source: "operator"
        }
      });
      const task = currentTask(order, request);
      const ids = identities(request);
      const createdAt = currentTime.toISOString();
      const candidate = createProofAssetUploadRecord({
        ...ids,
        bucket_name: config.bucket_name!,
        order_number: request.order_number,
        task_id: request.task_id,
        attachment_id: request.attachment_id,
        replaces_proof_version_id: task.current_version!.version_id,
        original_filename: request.original_filename,
        content_policy_id: CONTENT_POLICY_ID,
        content_policy_max_bytes: config.maximum_bytes,
        allowed_content_types: config.allowed_content_types,
        declared_content_type: request.content_type,
        declared_content_length: request.content_length,
        declared_sha256: request.sha256,
        retention_days: 90,
        order_completed_at: null,
        last_proof_activity_at: order.last_synced_at,
        initialized_at: createdAt
      });
      let reservation: Awaited<ReturnType<typeof reserveProofAssetUpload>>;
      try {
        reservation = await reserve(
          candidate,
          auditEvent({
            record: candidate,
            action: "proof.asset_upload_initialized",
            actor_id: actor,
            correlation_id: correlation
          })
        );
      } catch (error) {
        mapStoreError(error);
      }
      let record = reservation.record;
      if (record.state === "initialized") {
        const started = beginProofAssetUpload({
          record,
          expected_record_version: record.record_version,
          upload_started_at: createdAt
        }).record;
        try {
          record = await transition(
            record,
            started,
            auditEvent({
              record: started,
              action: "proof.asset_upload_started",
              actor_id: actor,
              correlation_id: correlation
            })
          );
        } catch (error) {
          mapStoreError(error);
        }
      }
      if (record.state !== "uploading") {
        throw new ProofAssetUploadServiceError(
          "conflict",
          "This Proof asset upload has already been completed."
        );
      }

      const checksum = Buffer.from(record.declared_sha256, "hex").toString("base64");
      const tagging =
        "<Tagging><TagSet><Tag><Key>proof-lifecycle</Key><Value>unfinalized</Value></Tag></TagSet></Tagging>";
      let post: Awaited<ReturnType<typeof createPresignedPost>>;
      try {
        post = await createPost(s3 as S3Client, {
          Bucket: record.bucket_name,
          Key: record.source_key,
          Expires: config.upload_ticket_seconds,
          Fields: {
            "Content-Type": record.declared_content_type,
            "x-amz-checksum-algorithm": "SHA256",
            "x-amz-checksum-sha256": checksum,
            "x-amz-meta-asset-id": record.asset_id,
            "x-amz-meta-revision-id": record.revision_id,
            "x-amz-meta-attachment-id": record.attachment_id,
            "x-amz-meta-declared-sha256": record.declared_sha256,
            tagging,
            success_action_status: "201"
          },
          Conditions: [
            ["eq", "$key", record.source_key],
            ["eq", "$Content-Type", record.declared_content_type],
            ["content-length-range", record.declared_content_length, record.declared_content_length],
            ["eq", "$x-amz-checksum-algorithm", "SHA256"],
            ["eq", "$x-amz-checksum-sha256", checksum],
            ["eq", "$x-amz-meta-asset-id", record.asset_id],
            ["eq", "$x-amz-meta-revision-id", record.revision_id],
            ["eq", "$x-amz-meta-attachment-id", record.attachment_id],
            ["eq", "$x-amz-meta-declared-sha256", record.declared_sha256],
            ["eq", "$tagging", tagging],
            ["eq", "$success_action_status", "201"]
          ]
        });
      } catch {
        throw new ProofAssetUploadServiceError(
          "storage_failed",
          "A short-lived Proof upload ticket could not be issued."
        );
      }
      return {
        status: reservation.status,
        asset: sanitized(record),
        upload: {
          method: "POST" as const,
          url: post.url,
          fields: post.fields,
          expires_at: new Date(
            currentTime.getTime() + config.upload_ticket_seconds * 1_000
          ).toISOString()
        }
      };
    },

    async finalize(input: {
      request: ProofAssetUploadFinalizeRequest;
      operator_uid: string;
      correlation_id: string;
    }) {
      const currentTime = now();
      const actor = actorId(input.operator_uid);
      const correlation = correlationId(input.correlation_id);
      const config = requireGate(currentTime, runtimeConfig());
      const orderNumber = input.request.order_number?.trim().toUpperCase();
      const assetId = input.request.asset_id?.trim();
      if (
        !/^A\d{7,8}$/.test(orderNumber) ||
        !ASSET_ID.test(assetId) ||
        !config.allowed_order_numbers.includes(orderNumber)
      ) {
        throw new ProofAssetUploadServiceError(
          "not_allowed",
          "Proof asset finalization is outside the bounded upload window."
        );
      }
      const record = await getRecord(orderNumber, assetId);
      if (!record || record.bucket_name !== config.bucket_name) {
        throw new ProofAssetUploadServiceError(
          "stale",
          "Proof asset upload metadata was not found."
        );
      }
      let head: any;
      let tags: any;
      try {
        head = await s3.send(
          new HeadObjectCommand({
            Bucket: record.bucket_name,
            Key: record.source_key,
            ChecksumMode: "ENABLED"
          })
        );
        tags = await s3.send(
          new GetObjectTaggingCommand({
            Bucket: record.bucket_name,
            Key: record.source_key,
            VersionId: head.VersionId
          })
        );
      } catch {
        throw new ProofAssetUploadServiceError(
          "storage_failed",
          "The uploaded Proof object could not be verified in private storage."
        );
      }
      const object = exactObject(record, head, tags);
      const completed = completeProofAssetUpload({
        record,
        expected_record_version: record.record_version,
        upload_completed_at: object.completed_at,
        source_object_version_id: object.version_id,
        source_content_type: record.declared_content_type,
        source_content_length: record.declared_content_length,
        source_sha256: record.declared_sha256
      });
      if (completed.status === "replay") {
        return { status: "replay" as const, asset: sanitized(completed.record) };
      }
      let stored: ProofAssetUploadRecord;
      try {
        stored = await transition(
          record,
          completed.record,
          auditEvent({
            record: completed.record,
            action: "proof.asset_upload_completed",
            actor_id: actor,
            correlation_id: correlation
          })
        );
      } catch (error) {
        mapStoreError(error);
      }
      return { status: "completed" as const, asset: sanitized(stored) };
    }
  };
}
