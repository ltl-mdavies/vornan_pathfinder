import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { LiftOrderPayload, LiftSubmitRequest, LiftSubmitTransportResult } from "@pathfinder/lift-adapter";
import type {
  ProcessingJobPreview,
  SubmitAttemptStatus,
  SubmitIntegritySnapshot
} from "./store.js";

const SUBMIT_INTEGRITY_NAMESPACE = "pathfinder-reviewed-submit-v1";
const DIRECT_DOCUMENT_HOST = "go.vornan.co";

type S3Sender = {
  send(command: unknown): Promise<any>;
};

export class SubmitIntegrityError extends Error {
  constructor(
    public readonly code:
      | "review_required"
      | "review_mismatch"
      | "document_binding_invalid"
      | "document_delivery_disabled"
      | "document_object_invalid"
      | "document_delivery_unavailable",
    message: string
  ) {
    super(message);
    this.name = "SubmitIntegrityError";
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new SubmitIntegrityError("review_mismatch", "Reviewed submit data contains a non-finite number.");
  }
  return value;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function publicationIdentity(publications: ProcessingJobPreview["source_document_publications"]) {
  return [...(publications ?? [])]
    .map((publication) => ({
      document_role: publication.document_role,
      evidence_id: publication.evidence_id,
      publication_id: publication.publication_id,
      sha256: publication.sha256,
      object_version_id: publication.object_version_id,
      published_at: publication.published_at,
      expires_at: publication.expires_at
    }))
    .sort((left, right) =>
      left.document_role.localeCompare(right.document_role) || left.publication_id.localeCompare(right.publication_id)
    );
}

export function buildSubmitIntegritySnapshot(args: {
  payload: LiftOrderPayload;
  submit_request_masked: ProcessingJobPreview["submit_request_masked"];
  source_document_publications?: ProcessingJobPreview["source_document_publications"];
  reviewed_at?: string;
}): SubmitIntegritySnapshot {
  const payloadSha256 = sha256(args.payload);
  const requestSha256 = sha256(args.submit_request_masked);
  const documentSetSha256 = sha256(publicationIdentity(args.source_document_publications));
  const fingerprint = createHash("sha256")
    .update(SUBMIT_INTEGRITY_NAMESPACE)
    .update("\0")
    .update(payloadSha256)
    .update("\0")
    .update(requestSha256)
    .update("\0")
    .update(documentSetSha256)
    .digest("hex");
  return {
    version: 1,
    fingerprint,
    payload_sha256: payloadSha256,
    request_sha256: requestSha256,
    document_set_sha256: documentSetSha256,
    reviewed_at: args.reviewed_at ?? new Date().toISOString()
  };
}

export function assertReviewedSubmitIntegrity(args: {
  job: ProcessingJobPreview;
  reviewed_fingerprint: string;
  current_submit_request_masked: ProcessingJobPreview["submit_request_masked"];
}) {
  const saved = args.job.submit_integrity;
  if (!saved || !/^[a-f0-9]{64}$/.test(args.reviewed_fingerprint)) {
    throw new SubmitIntegrityError(
      "review_required",
      "Refresh submit certification and review the exact payload before submitting."
    );
  }
  const current = buildSubmitIntegritySnapshot({
    payload: args.job.lift_payload,
    submit_request_masked: args.current_submit_request_masked,
    source_document_publications: args.job.source_document_publications,
    reviewed_at: saved.reviewed_at
  });
  if (
    args.reviewed_fingerprint !== saved.fingerprint ||
    current.fingerprint !== saved.fingerprint ||
    current.payload_sha256 !== saved.payload_sha256 ||
    current.request_sha256 !== saved.request_sha256 ||
    current.document_set_sha256 !== saved.document_set_sha256
  ) {
    throw new SubmitIntegrityError(
      "review_mismatch",
      "The reviewed payload or document set changed. Refresh certification and review it again."
    );
  }
  return current;
}

interface DocumentExpectation {
  document_role: "order_grid" | "reference_proof";
  evidence_id: string;
  publication_id: string;
  sha256: string;
  object_version_id: string;
  expires_at: string;
  direct_url: string;
  object_key: string;
}

function directDocumentUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== DIRECT_DOCUMENT_HOST ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/d\/[A-Za-z0-9_-]{16,160}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,179}$/.test(url.pathname)
    ) {
      throw new Error("unsafe");
    }
    return { direct_url: url.toString(), object_key: url.pathname.slice(1) };
  } catch {
    throw new SubmitIntegrityError(
      "document_binding_invalid",
      "A reviewed Wrike source document does not use the approved direct-delivery URL shape."
    );
  }
}

export function buildWrikeSubmitDocumentExpectations(job: ProcessingJobPreview): DocumentExpectation[] {
  const publications = job.source_document_publications ?? [];
  const isWrikeJob = job.source_evidence?.provider === "wrike" || publications.length > 0;
  if (!isWrikeJob) {
    return [];
  }
  const byRole = new Map(publications.map((publication) => [publication.document_role, publication] as const));
  if (publications.length !== byRole.size || !byRole.has("order_grid")) {
    throw new SubmitIntegrityError(
      "document_binding_invalid",
      "Wrike submit requires exactly one immutable order-grid publication and at most one reference proof."
    );
  }
  const urls = {
    order_grid: job.canonical_order.order.order_attachment ?? null,
    reference_proof: job.canonical_order.order.reference_proof_url ?? null
  };
  if (Boolean(urls.reference_proof) !== byRole.has("reference_proof")) {
    throw new SubmitIntegrityError(
      "document_binding_invalid",
      "The reviewed reference-proof URL and immutable publication do not match."
    );
  }
  return [...byRole.entries()].map(([documentRole, publication]) => {
    const rawUrl = urls[documentRole];
    if (!rawUrl) {
      throw new SubmitIntegrityError(
        "document_binding_invalid",
        `The reviewed ${documentRole.replaceAll("_", " ")} URL is missing.`
      );
    }
    const matchingPayloadValues = Object.values(job.lift_payload.order).filter((value) => value === rawUrl).length;
    if (matchingPayloadValues !== 1) {
      throw new SubmitIntegrityError(
        "document_binding_invalid",
        `The reviewed ${documentRole.replaceAll("_", " ")} URL must appear exactly once in the Lift order payload.`
      );
    }
    const direct = directDocumentUrl(rawUrl);
    if (
      !/^[A-Za-z0-9_:.=-]{1,256}$/.test(publication.evidence_id) ||
      !/^[A-Za-z0-9_:.=-]{1,256}$/.test(publication.publication_id) ||
      !/^[a-f0-9]{64}$/.test(publication.sha256) ||
      !/^[A-Za-z0-9.+/=_-]{1,1024}$/.test(publication.object_version_id) ||
      !Number.isFinite(new Date(publication.expires_at).getTime())
    ) {
      throw new SubmitIntegrityError(
        "document_binding_invalid",
        "Stored Wrike publication identity is malformed."
      );
    }
    return {
      document_role: documentRole,
      evidence_id: publication.evidence_id,
      publication_id: publication.publication_id,
      sha256: publication.sha256,
      object_version_id: publication.object_version_id,
      expires_at: publication.expires_at,
      ...direct
    };
  });
}

let s3Client: S3Client | null = null;
function defaultS3Sender() {
  s3Client ??= new S3Client({});
  return s3Client as unknown as S3Sender;
}

export async function preflightWrikeSubmitDocuments(args: {
  job: ProcessingJobPreview;
  publication_enabled: boolean;
  delivery_bucket_name: string | null;
  s3_sender?: S3Sender;
  fetch_impl?: typeof fetch;
  now?: () => Date;
}) {
  const documents = buildWrikeSubmitDocumentExpectations(args.job);
  if (!documents.length) {
    return { required: false as const, checked_at: null, documents: [] };
  }
  if (!args.publication_enabled || !args.delivery_bucket_name) {
    throw new SubmitIntegrityError(
      "document_delivery_disabled",
      "Wrike document delivery must be explicitly enabled for the submit window."
    );
  }
  const sender = args.s3_sender ?? defaultS3Sender();
  const fetchImpl = args.fetch_impl ?? fetch;
  const now = args.now ?? (() => new Date());
  const checkedAt = now();
  const results = [];
  for (const document of documents) {
    if (new Date(document.expires_at).getTime() <= checkedAt.getTime()) {
      throw new SubmitIntegrityError(
        "document_delivery_unavailable",
        `The ${document.document_role.replaceAll("_", " ")} publication has expired.`
      );
    }
    let head: any;
    try {
      head = await sender.send(new HeadObjectCommand({
        Bucket: args.delivery_bucket_name,
        Key: document.object_key
      }));
    } catch {
      throw new SubmitIntegrityError(
        "document_object_invalid",
        `The immutable ${document.document_role.replaceAll("_", " ")} object could not be verified.`
      );
    }
    const contentLength = Number(head.ContentLength);
    if (
      head.VersionId !== document.object_version_id ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 1 ||
      head.Metadata?.evidence_id !== document.evidence_id ||
      head.Metadata?.publication_id !== document.publication_id ||
      head.Metadata?.source_sha256 !== document.sha256 ||
      head.Metadata?.document_role !== document.document_role
    ) {
      throw new SubmitIntegrityError(
        "document_object_invalid",
        `The immutable ${document.document_role.replaceAll("_", " ")} object changed after review.`
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(document.direct_url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8_000)
      });
    } catch {
      throw new SubmitIntegrityError(
        "document_delivery_unavailable",
        `The ${document.document_role.replaceAll("_", " ")} URL is not directly downloadable.`
      );
    }
    const responseLength = Number(response.headers.get("content-length"));
    await response.body?.cancel().catch(() => undefined);
    if (
      response.status !== 200 ||
      response.redirected ||
      response.url !== document.direct_url ||
      responseLength !== contentLength
    ) {
      throw new SubmitIntegrityError(
        "document_delivery_unavailable",
        `The ${document.document_role.replaceAll("_", " ")} URL must return the exact file with HTTP 200 and no redirect.`
      );
    }
    results.push({
      document_role: document.document_role,
      publication_id: document.publication_id,
      object_version_id: document.object_version_id,
      content_length: contentLength,
      http_status: 200 as const,
      redirect_count: 0 as const
    });
  }
  return { required: true as const, checked_at: checkedAt.toISOString(), documents: results };
}

export function classifySubmitAttemptState(result: LiftSubmitTransportResult): SubmitAttemptStatus {
  if (result.status === "not_sent") {
    return "Dry Run";
  }
  if (result.status === "accepted" && result.lift_order_id) {
    return "Submitted";
  }
  if (
    result.status === "accepted" ||
    result.status === "error" ||
    result.http_status === 408 ||
    result.http_status === 425 ||
    result.http_status === 429 ||
    (typeof result.http_status === "number" && result.http_status >= 500)
  ) {
    return "Submission Uncertain";
  }
  return "Failed";
}

export function submitAttemptId(customerId: string, idempotencyKey: string) {
  return `submit_${createHash("sha256")
    .update("pathfinder-submit-attempt-v1")
    .update("\0")
    .update(customerId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")}`;
}

export function buildSubmitIdempotencyKey(job: ProcessingJobPreview, fingerprint: string) {
  return [job.job_id, job.output_route_id, job.submit_profile_id, fingerprint].join(":");
}
