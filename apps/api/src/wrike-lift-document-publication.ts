import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  sanitizeWrikeLiftDeliveryFileName,
  type WrikeLiftDocumentPublication,
  type WrikeLiftSourceEvidenceBinding
} from "@pathfinder/wrike-adapter";

const OUTBOUND_RETENTION_DAYS = 14;
const PUBLICATION_NAMESPACE = "pathfinder-wrike-lift-document-publication-v1";

type S3Sender = {
  send(command: unknown): Promise<any>;
};

export interface WrikeLiftDocumentPublicationConfig {
  enabled: boolean;
  bucket_name: string | null;
  manifest_bucket_name: string | null;
  delivery_base_url: string | null;
}

export class WrikeLiftDocumentPublicationError extends Error {
  constructor(
    public readonly code:
      | "disabled"
      | "invalid_configuration"
      | "manifest_read_failed"
      | "object_write_failed"
      | "object_head_failed"
      | "manifest_write_failed"
      | "identity_conflict"
      | "delivery_preflight_failed",
    message: string
  ) {
    super(message);
    this.name = "WrikeLiftDocumentPublicationError";
  }
}

let s3Client: S3Client | null = null;

function defaultS3Client() {
  s3Client ??= new S3Client({});
  return s3Client as unknown as S3Sender;
}

function exactDeliveryBaseUrl(value: string | null) {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "go.vornan.co" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      throw new Error("unsafe");
    }
    return "https://go.vornan.co";
  } catch {
    throw new WrikeLiftDocumentPublicationError(
      "invalid_configuration",
      "Wrike Lift document delivery must use the exact go.vornan.co HTTPS origin."
    );
  }
}

export function getWrikeLiftDocumentPublicationConfig(
  env: NodeJS.ProcessEnv = process.env
): WrikeLiftDocumentPublicationConfig {
  const enabled = env.PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION === "true";
  const bucketName = env.PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET?.trim() || null;
  const manifestBucketName = env.PATHFINDER_SOURCE_EVIDENCE_BUCKET?.trim() || null;
  const deliveryBaseUrl = exactDeliveryBaseUrl(
    env.PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BASE_URL?.trim() || null
  );
  if (enabled && (!bucketName || !manifestBucketName || !deliveryBaseUrl)) {
    throw new WrikeLiftDocumentPublicationError(
      "invalid_configuration",
      "Wrike Lift document publication requires its dedicated bucket and go.vornan.co delivery origin."
    );
  }
  return {
    enabled,
    bucket_name: bucketName,
    manifest_bucket_name: manifestBucketName,
    delivery_base_url: deliveryBaseUrl
  };
}

function digest(...values: string[]) {
  const hash = createHash("sha256").update(PUBLICATION_NAMESPACE);
  values.forEach((value) => hash.update("\0").update(value));
  return hash.digest("hex");
}

function publicationIdentity(evidence: WrikeLiftSourceEvidenceBinding) {
  const identity = digest(evidence.evidence_id, evidence.document_role, evidence.sha256);
  const fileName = sanitizeWrikeLiftDeliveryFileName(evidence.file_name);
  return {
    publication_id: `wrike_publication_${identity}`,
    token: `wd_${digest("public-token", identity)}`,
    file_name: fileName,
    object_key: `d/wd_${digest("public-token", identity)}/${fileName}`,
    manifest_key: `wrike/publications/wrike_publication_${identity}.json`
  };
}

function awsErrorObservation(error: unknown) {
  if (!error || typeof error !== "object") {
    return { name: "", http_status: null };
  }
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return {
    name: typeof candidate.name === "string" ? candidate.name : "",
    http_status:
      typeof candidate.$metadata?.httpStatusCode === "number"
        ? candidate.$metadata.httpStatusCode
        : null
  };
}

function isMissingObject(error: unknown) {
  const observation = awsErrorObservation(error);
  return observation.http_status === 404 || observation.name === "NoSuchKey" || observation.name === "NotFound";
}

function isConditionalConflict(error: unknown) {
  const observation = awsErrorObservation(error);
  return observation.http_status === 412 || observation.name === "PreconditionFailed";
}

function assertEvidenceBytes(evidence: WrikeLiftSourceEvidenceBinding, bytes: Uint8Array) {
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength !== evidence.byte_size ||
    actualDigest !== evidence.sha256
  ) {
    throw new WrikeLiftDocumentPublicationError(
      "identity_conflict",
      "Wrike source-document bytes do not match their immutable evidence record."
    );
  }
}

function assertObjectHead(
  evidence: WrikeLiftSourceEvidenceBinding,
  identity: ReturnType<typeof publicationIdentity>,
  head: any
) {
  const versionId = typeof head.VersionId === "string" ? head.VersionId.trim() : "";
  if (
    !versionId ||
    head.ContentLength !== evidence.byte_size ||
    head.Metadata?.evidence_id !== evidence.evidence_id ||
    head.Metadata?.source_sha256 !== evidence.sha256 ||
    head.Metadata?.document_role !== evidence.document_role ||
    head.Metadata?.publication_id !== identity.publication_id ||
    head.Metadata?.delivery_file_name !== identity.file_name ||
    !(head.LastModified instanceof Date) ||
    !Number.isFinite(head.LastModified.getTime())
  ) {
    throw new WrikeLiftDocumentPublicationError(
      "identity_conflict",
      "The existing Wrike delivery object does not match its immutable publication identity."
    );
  }
  return {
    version_id: versionId,
    published_at: head.LastModified as Date
  };
}

async function readManifest(
  sender: S3Sender,
  bucketName: string,
  manifestKey: string
): Promise<WrikeLiftDocumentPublication | null> {
  try {
    const result = await sender.send(new GetObjectCommand({ Bucket: bucketName, Key: manifestKey }));
    if (!result.Body) {
      throw new WrikeLiftDocumentPublicationError("manifest_read_failed", "Wrike publication manifest is empty.");
    }
    return JSON.parse(await result.Body.transformToString("utf8")) as WrikeLiftDocumentPublication;
  } catch (error) {
    if (error instanceof WrikeLiftDocumentPublicationError) {
      throw error;
    }
    if (isMissingObject(error)) {
      return null;
    }
    throw new WrikeLiftDocumentPublicationError(
      "manifest_read_failed",
      "Pathfinder could not read the Wrike publication manifest."
    );
  }
}

function assertManifestBinding(
  publication: WrikeLiftDocumentPublication,
  evidence: WrikeLiftSourceEvidenceBinding,
  identity: ReturnType<typeof publicationIdentity>,
  directUrl: string
) {
  if (
    publication.publication_id !== identity.publication_id ||
    publication.evidence_id !== evidence.evidence_id ||
    publication.document_role !== evidence.document_role ||
    publication.source_sha256 !== evidence.sha256 ||
    publication.direct_url !== directUrl ||
    publication.published_byte_size !== evidence.byte_size
  ) {
    throw new WrikeLiftDocumentPublicationError(
      "identity_conflict",
      "Stored Wrike publication metadata does not match its immutable evidence."
    );
  }
}

async function preflightDirectDelivery(
  directUrl: string,
  expectedBytes: number,
  fetchImpl: typeof fetch,
  now: () => Date
) {
  let response: Response;
  try {
    response = await fetchImpl(directUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new WrikeLiftDocumentPublicationError(
      "delivery_preflight_failed",
      "The Wrike delivery URL did not complete a direct download preflight."
    );
  }
  const contentLength = Number(response.headers.get("content-length"));
  await response.body?.cancel().catch(() => undefined);
  if (
    response.status !== 200 ||
    response.redirected ||
    response.url !== directUrl ||
    !Number.isSafeInteger(contentLength) ||
    contentLength !== expectedBytes
  ) {
    throw new WrikeLiftDocumentPublicationError(
      "delivery_preflight_failed",
      "The Wrike delivery URL must return the exact file directly with HTTP 200 and no redirect."
    );
  }
  return {
    http_status: 200 as const,
    redirect_count: 0 as const,
    content_length: contentLength,
    checked_at: now().toISOString()
  };
}

export async function publishWrikeLiftSourceDocument(args: {
  evidence: WrikeLiftSourceEvidenceBinding;
  bytes: Uint8Array;
  config?: WrikeLiftDocumentPublicationConfig;
  s3_sender?: S3Sender;
  fetch_impl?: typeof fetch;
  now?: () => Date;
}): Promise<WrikeLiftDocumentPublication> {
  const config = args.config ?? getWrikeLiftDocumentPublicationConfig();
  if (!config.enabled) {
    throw new WrikeLiftDocumentPublicationError(
      "disabled",
      "Wrike Lift document publication is disabled at the API boundary."
    );
  }
  const bucketName = config.bucket_name;
  const manifestBucketName = config.manifest_bucket_name;
  const deliveryBaseUrl = exactDeliveryBaseUrl(config.delivery_base_url);
  if (!bucketName || !manifestBucketName || !deliveryBaseUrl) {
    throw new WrikeLiftDocumentPublicationError(
      "invalid_configuration",
      "Wrike Lift document publication is not fully configured."
    );
  }
  assertEvidenceBytes(args.evidence, args.bytes);
  const identity = publicationIdentity(args.evidence);
  const directUrl = `${deliveryBaseUrl}/${identity.object_key}`;
  const sender = args.s3_sender ?? defaultS3Client();
  const now = args.now ?? (() => new Date());
  const existingManifest = await readManifest(sender, manifestBucketName, identity.manifest_key);

  let head: any;
  if (!existingManifest) {
    try {
      await sender.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: identity.object_key,
        Body: args.bytes,
        ContentLength: args.bytes.byteLength,
        ContentType: args.evidence.content_type,
        ContentDisposition: `attachment; filename="${identity.file_name}"`,
        CacheControl: "no-store, max-age=0",
        IfNoneMatch: "*",
        Metadata: {
          evidence_id: args.evidence.evidence_id,
          source_sha256: args.evidence.sha256,
          document_role: args.evidence.document_role,
          publication_id: identity.publication_id,
          delivery_file_name: identity.file_name
        }
      }));
    } catch (error) {
      if (!isConditionalConflict(error)) {
        throw new WrikeLiftDocumentPublicationError(
          "object_write_failed",
          "Pathfinder could not create the immutable Wrike delivery object."
        );
      }
    }
  }

  try {
    head = await sender.send(new HeadObjectCommand({ Bucket: bucketName, Key: identity.object_key }));
  } catch {
    throw new WrikeLiftDocumentPublicationError(
      "object_head_failed",
      "Pathfinder could not verify the immutable Wrike delivery object."
    );
  }
  const object = assertObjectHead(args.evidence, identity, head);
  if (existingManifest) {
    assertManifestBinding(existingManifest, args.evidence, identity, directUrl);
    if (existingManifest.object_version_id !== object.version_id) {
      throw new WrikeLiftDocumentPublicationError(
        "identity_conflict",
        "The Wrike delivery object version changed after publication."
      );
    }
  }
  const preflight = await preflightDirectDelivery(
    directUrl,
    args.evidence.byte_size,
    args.fetch_impl ?? fetch,
    now
  );
  const publishedAt = object.published_at;
  const expiresAt = new Date(publishedAt.getTime() + OUTBOUND_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
  const publication: WrikeLiftDocumentPublication = {
    publication_id: identity.publication_id,
    evidence_id: args.evidence.evidence_id,
    document_role: args.evidence.document_role,
    source_sha256: args.evidence.sha256,
    object_version_id: object.version_id,
    direct_url: directUrl,
    published_byte_size: args.evidence.byte_size,
    published_at: publishedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    preflight
  };
  if (existingManifest) {
    if (
      existingManifest.published_at !== publication.published_at ||
      existingManifest.expires_at !== publication.expires_at
    ) {
      throw new WrikeLiftDocumentPublicationError(
        "identity_conflict",
        "Wrike publication replay cannot change the original retention clock."
      );
    }
    return publication;
  }
  try {
    await sender.send(new PutObjectCommand({
      Bucket: manifestBucketName,
      Key: identity.manifest_key,
      Body: JSON.stringify(publication),
      ContentType: "application/json",
      CacheControl: "no-store, max-age=0",
      IfNoneMatch: "*",
      Metadata: {
        publication_id: identity.publication_id,
        evidence_id: args.evidence.evidence_id,
        source_sha256: args.evidence.sha256
      }
    }));
  } catch (error) {
    if (!isConditionalConflict(error)) {
      throw new WrikeLiftDocumentPublicationError(
        "manifest_write_failed",
        "Pathfinder could not finalize the Wrike publication manifest."
      );
    }
    const concurrentManifest = await readManifest(sender, manifestBucketName, identity.manifest_key);
    if (!concurrentManifest) {
      throw new WrikeLiftDocumentPublicationError(
        "manifest_write_failed",
        "The concurrent Wrike publication manifest is unavailable."
      );
    }
    assertManifestBinding(concurrentManifest, args.evidence, identity, directUrl);
    if (
      concurrentManifest.object_version_id !== publication.object_version_id ||
      concurrentManifest.published_at !== publication.published_at ||
      concurrentManifest.expires_at !== publication.expires_at
    ) {
      throw new WrikeLiftDocumentPublicationError(
        "identity_conflict",
        "The concurrent Wrike publication changed the immutable object or retention identity."
      );
    }
  }
  return publication;
}
