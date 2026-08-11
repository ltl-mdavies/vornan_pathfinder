import {
  CopyObjectCommand,
  HeadObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { ProofAssetUploadRecord } from "@pathfinder/proof-domain/proof-asset-upload";
import {
  createProofAssetVerificationPublicationService,
  ProofAssetVerificationPublicationError,
  type ProofAssetDirectDeliveryObservation,
  type ProofAssetOutboundPublication
} from "./asset-verification-publication.js";
import { getProofAssetPublicationRuntimeConfig } from "./asset-publication-config.js";
import {
  getProofAssetUploadRecord,
  transitionProofAssetUpload
} from "./asset-upload-store.js";

const MAXIMUM_PUBLICATION_WINDOW_MS = 4 * 60 * 60 * 1_000;
const LOCATOR_ID = /^plocator_[a-f0-9]{64}$/;

interface S3PublicationClient {
  send(command: CopyObjectCommand | HeadObjectCommand): Promise<any>;
}

export interface ProofAssetPublicationServiceDependencies {
  s3?: S3PublicationClient;
  fetchDirect?: typeof fetch;
  now?: () => Date;
  runtimeConfig?: typeof getProofAssetPublicationRuntimeConfig;
  getRecord?: typeof getProofAssetUploadRecord;
  transition?: typeof transitionProofAssetUpload;
}

function copySource(bucket: string, key: string, versionId: string) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket}/${encodedKey}?versionId=${encodeURIComponent(versionId)}`;
}

function base64Sha256(hex: string) {
  return Buffer.from(hex, "hex").toString("base64");
}

function sourceDisposition(filename: string) {
  return `attachment; filename="${filename.replace(/["\\]/g, "_")}"`;
}

function notFound(error: unknown) {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === "NotFound" || candidate?.$metadata?.httpStatusCode === 404;
}

function assertExactHead(
  head: any,
  input: { content_type: string; content_length: number; sha256: string }
) {
  if (
    head.ContentLength !== input.content_length ||
    head.ContentType !== input.content_type ||
    head.ChecksumSHA256 !== base64Sha256(input.sha256)
  ) {
    throw new ProofAssetVerificationPublicationError(
      "cross_bound",
      "Published Proof object does not match the checksum-bound source."
    );
  }
}

function assertActive(
  config: ReturnType<typeof getProofAssetPublicationRuntimeConfig>,
  orderNumber: string,
  now: Date
) {
  const expiry = config.activation_expires_at
    ? Date.parse(config.activation_expires_at)
    : Number.NaN;
  if (
    !config.enabled ||
    !config.bucket_name ||
    !config.delivery_base_url ||
    !config.allowed_order_numbers.includes(orderNumber) ||
    !Number.isFinite(expiry) ||
    expiry <= now.getTime() ||
    expiry > now.getTime() + MAXIMUM_PUBLICATION_WINDOW_MS
  ) {
    throw new ProofAssetVerificationPublicationError(
      "publication_failed",
      "Proof asset publication is disabled or outside its exact bounded window."
    );
  }
  return {
    bucket_name: config.bucket_name,
    delivery_base_url: config.delivery_base_url
  };
}

export function createProofAssetPublicationService(
  dependencies: ProofAssetPublicationServiceDependencies = {}
) {
  const s3 = dependencies.s3 ?? new S3Client({});
  const directFetch = dependencies.fetchDirect ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const runtimeConfig = dependencies.runtimeConfig ?? getProofAssetPublicationRuntimeConfig;
  const getRecord = dependencies.getRecord ?? getProofAssetUploadRecord;
  const transition = dependencies.transition ?? transitionProofAssetUpload;

  async function publishExact(input: {
    record: ProofAssetUploadRecord;
    source_object_version_id: string;
  }): Promise<ProofAssetOutboundPublication> {
    const config = assertActive(runtimeConfig(), input.record.order_number, now());
    const copied = await s3.send(new CopyObjectCommand({
      Bucket: config.bucket_name,
      Key: input.record.outbound_key,
      CopySource: copySource(
        config.bucket_name,
        input.record.source_key,
        input.source_object_version_id
      ),
      MetadataDirective: "REPLACE",
      ContentType: input.record.source_content_type!,
      ContentDisposition: sourceDisposition(input.record.original_filename),
      ChecksumAlgorithm: "SHA256",
      TaggingDirective: "REPLACE",
      Tagging: "proof-lifecycle=lift-outbound"
    }));
    const versionId = copied.VersionId;
    if (!versionId) {
      throw new ProofAssetVerificationPublicationError(
        "publication_failed",
        "Proof publication did not return an immutable object version."
      );
    }
    const head = await s3.send(new HeadObjectCommand({
      Bucket: config.bucket_name,
      Key: input.record.outbound_key,
      VersionId: versionId,
      ChecksumMode: "ENABLED"
    }));
    assertExactHead(head, {
      content_type: input.record.source_content_type!,
      content_length: input.record.source_content_length!,
      sha256: input.record.source_sha256!
    });
    return {
      object_version_id: versionId,
      content_length: input.record.source_content_length!,
      sha256: input.record.source_sha256!,
      published_at: now().toISOString()
    };
  }

  async function registerLocator(input: {
    locator_id: string;
    outbound_key: string;
    outbound_object_version_id: string;
    content_type: string;
    content_length: number;
    expires_at_epoch: number;
  }) {
    if (!LOCATOR_ID.test(input.locator_id)) {
      throw new ProofAssetVerificationPublicationError(
        "delivery_failed",
        "Proof delivery locator identity is invalid."
      );
    }
    const record = await getRecordForOutbound(input.outbound_key);
    const config = assertActive(runtimeConfig(), record.order_number, now());
    const key = `a/${input.locator_id}`;
    let existing: any = null;
    try {
      existing = await s3.send(new HeadObjectCommand({
        Bucket: config.bucket_name,
        Key: key,
        ChecksumMode: "ENABLED"
      }));
    } catch (error) {
      if (!notFound(error)) throw error;
    }
    if (existing) {
      assertExactHead(existing, {
        content_type: input.content_type,
        content_length: input.content_length,
        sha256: record.outbound_sha256!
      });
    } else {
      await s3.send(new CopyObjectCommand({
        Bucket: config.bucket_name,
        Key: key,
        CopySource: copySource(
          config.bucket_name,
          input.outbound_key,
          input.outbound_object_version_id
        ),
        MetadataDirective: "REPLACE",
        ContentType: input.content_type,
        ContentDisposition: sourceDisposition(record.original_filename),
        ChecksumAlgorithm: "SHA256",
        TaggingDirective: "REPLACE",
        Tagging: "proof-lifecycle=lift-outbound"
      }));
      const head = await s3.send(new HeadObjectCommand({
        Bucket: config.bucket_name,
        Key: key,
        ChecksumMode: "ENABLED"
      }));
      assertExactHead(head, {
        content_type: input.content_type,
        content_length: input.content_length,
        sha256: record.outbound_sha256!
      });
    }
    return {
      locator_id: input.locator_id,
      delivery_url: `${config.delivery_base_url}/${key}`
    };
  }

  async function getRecordForOutbound(outboundKey: string) {
    const match = outboundKey.match(/^orders\/(A\d{7,8})\/.*\/outbound\/(ppublication_[a-f0-9]{64})\//);
    if (!match) {
      throw new ProofAssetVerificationPublicationError(
        "cross_bound",
        "Proof outbound publication key is invalid."
      );
    }
    const assetMatch = outboundKey.match(/\/revisions\/(prevision_[a-f0-9]{64})\//);
    if (!assetMatch) {
      throw new ProofAssetVerificationPublicationError(
        "cross_bound",
        "Proof outbound revision binding is invalid."
      );
    }
    // The service already holds the current asset in its publication closure;
    // this lookup is replaced below before locator registration.
    const record = publicationRecords.get(outboundKey);
    if (!record) {
      throw new ProofAssetVerificationPublicationError(
        "cross_bound",
        "Proof delivery locator does not match the active publication."
      );
    }
    return record;
  }

  async function verifyDirectDelivery(input: {
    delivery_url: string;
  }): Promise<ProofAssetDirectDeliveryObservation> {
    const response = await directFetch(input.delivery_url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    });
    await response.body?.cancel().catch(() => undefined);
    return {
      observed_at: now().toISOString(),
      status: response.status,
      redirected: response.redirected || (response.status >= 300 && response.status < 400),
      content_type: response.headers.get("content-type")?.split(";")[0]?.trim() ?? "",
      content_length: Number(response.headers.get("content-length") ?? "NaN")
    };
  }

  const publicationRecords = new Map<string, ProofAssetUploadRecord>();
  const lifecycle = createProofAssetVerificationPublicationService({
    getRecord: async (orderNumber, assetId) => {
      const record = await getRecord(orderNumber, assetId);
      if (record) publicationRecords.set(record.outbound_key, record);
      return record;
    },
    transition: async (current, next, audit) => {
      const persisted = await transition(current, next, audit);
      publicationRecords.set(persisted.outbound_key, persisted);
      return persisted;
    },
    setSourceLifecycle: async () => {
      throw new ProofAssetVerificationPublicationError(
        "publication_failed",
        "Scan lifecycle changes are not available through publication."
      );
    },
    publishExact,
    registerLocator,
    verifyDirectDelivery
  });

  return {
    async publishCleared(input: {
      order_number: string;
      asset_id: string;
      correlation_id: string;
    }) {
      assertActive(runtimeConfig(), input.order_number, now());
      try {
        return await lifecycle.publishCleared(input);
      } finally {
        for (const [key, record] of publicationRecords) {
          if (
            record.order_number === input.order_number &&
            record.asset_id === input.asset_id
          ) {
            publicationRecords.delete(key);
          }
        }
      }
    }
  };
}
