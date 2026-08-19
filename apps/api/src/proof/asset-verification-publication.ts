import { createHash } from "node:crypto";
import type { ProofAuditAction, ProofAuditEvent } from "@pathfinder/proof-domain";
import {
  beginProofAssetScan,
  beginProofAssetVerification,
  completeProofAssetVerification,
  recordProofAssetDeliveryVerification,
  recordProofAssetPublication,
  type ProofAssetUploadRecord
} from "@pathfinder/proof-domain/proof-asset-upload";
import type { ProofAssetMalwareScanStatus } from "@pathfinder/proof-domain/proof-asset-lifecycle";

const BUCKET = /^vornan-pathfinder-proof-assets-[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const VERSION_ID = /^[A-Za-z0-9._~+/=-]{1,1024}$/;
const EVENT_ID = /^[A-Za-z0-9-]{1,128}$/;
const CORRELATION_SOURCE = /^[A-Za-z0-9._:-]{1,128}$/;
const SOURCE_KEY = /^orders\/(A\d{7,8})\/tasks\/[A-Za-z0-9._:-]{1,256}\/revisions\/[A-Za-z0-9._:-]{1,256}\/source\/(passet_[a-f0-9]{64})\/[A-Za-z0-9][A-Za-z0-9._() -]{0,239}$/;
const LOCATOR_ID = /^plocator_[a-f0-9]{64}$/;
const SYSTEM_ACTOR_ID = "system_proof_asset_worker";

export type GuardDutyProofScanResult =
  | "NO_THREATS_FOUND"
  | "THREATS_FOUND"
  | "UNSUPPORTED"
  | "ACCESS_DENIED"
  | "FAILED";

export interface ProofAssetScanObservation {
  schema_version: "1.0";
  event_id: string;
  occurred_at: string;
  bucket_name: string;
  object_key: string;
  object_version_id: string;
  scan_result: GuardDutyProofScanResult;
}

export interface ProofAssetOutboundPublication {
  object_version_id: string;
  content_length: number;
  sha256: string;
  published_at: string;
}

export interface ProofAssetLocatorRegistration {
  locator_id: string;
  delivery_url: string;
}

export interface ProofAssetDirectDeliveryObservation {
  observed_at: string;
  status: number;
  redirected: boolean;
  content_type: string;
  content_length: number;
}

export interface ProofAssetVerificationPublicationDependencies {
  getRecord(orderNumber: string, assetId: string): Promise<ProofAssetUploadRecord | null>;
  transition(
    current: ProofAssetUploadRecord,
    next: ProofAssetUploadRecord,
    auditEvent: ProofAuditEvent
  ): Promise<ProofAssetUploadRecord>;
  setSourceLifecycle(input: {
    record: ProofAssetUploadRecord;
    object_version_id: string;
    lifecycle: "quarantined" | "retained-source";
  }): Promise<void>;
  publishExact(input: {
    record: ProofAssetUploadRecord;
    source_object_version_id: string;
  }): Promise<ProofAssetOutboundPublication>;
  registerLocator(input: {
    locator_id: string;
    outbound_key: string;
    outbound_object_version_id: string;
    content_type: string;
    content_length: number;
    expires_at_epoch: number;
  }): Promise<ProofAssetLocatorRegistration>;
  verifyDirectDelivery(input: {
    delivery_url: string;
  }): Promise<ProofAssetDirectDeliveryObservation>;
}

export class ProofAssetVerificationPublicationError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "not_found"
      | "cross_bound"
      | "conflict"
      | "publication_failed"
      | "delivery_failed",
    message: string
  ) {
    super(message);
    this.name = "ProofAssetVerificationPublicationError";
  }
}

function sha256(...parts: string[]) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

function timestamp(value: string, label: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ProofAssetVerificationPublicationError("invalid", `${label} is invalid.`);
  }
  return parsed;
}

function malwareStatus(value: GuardDutyProofScanResult): Exclude<ProofAssetMalwareScanStatus, "pending"> {
  const statuses = {
    NO_THREATS_FOUND: "no_threats_found",
    THREATS_FOUND: "threats_found",
    UNSUPPORTED: "unsupported",
    ACCESS_DENIED: "access_denied",
    FAILED: "failed"
  } as const;
  const status = statuses[value];
  if (!status) {
    throw new ProofAssetVerificationPublicationError(
      "invalid",
      "GuardDuty Proof scan result is invalid."
    );
  }
  return status;
}

function normalizedObservation(value: ProofAssetScanObservation) {
  const match = value.object_key?.match(SOURCE_KEY);
  if (
    value.schema_version !== "1.0" ||
    !EVENT_ID.test(value.event_id ?? "") ||
    !BUCKET.test(value.bucket_name ?? "") ||
    !match ||
    !VERSION_ID.test(value.object_version_id ?? "")
  ) {
    throw new ProofAssetVerificationPublicationError(
      "invalid",
      "GuardDuty Proof scan observation is invalid."
    );
  }
  timestamp(value.occurred_at, "GuardDuty Proof scan time");
  return {
    ...value,
    order_number: match[1],
    asset_id: match[2],
    scan_status: malwareStatus(value.scan_result)
  };
}

function eventCorrelation(eventId: string) {
  if (!CORRELATION_SOURCE.test(eventId)) {
    throw new ProofAssetVerificationPublicationError(
      "invalid",
      "Proof asset event correlation is invalid."
    );
  }
  return `pcorr_asset_${sha256("vornan-proof-asset-scan-event-v1", eventId)}`;
}

function publicationCorrelation(value: string) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new ProofAssetVerificationPublicationError(
      "invalid",
      "Proof asset publication correlation is invalid."
    );
  }
  return `pcorr_asset_${sha256("vornan-proof-asset-publication-v1", value)}`;
}

function auditEvent(input: {
  record: ProofAssetUploadRecord;
  action: ProofAuditAction;
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
    actor_type: "system",
    actor_id: SYSTEM_ACTOR_ID,
    correlation_id: input.correlation_id,
    metadata: {
      source: "system",
      proof_asset_id: input.record.asset_id,
      proof_asset_state: input.record.state
    }
  };
}

function exactScanEvidence(observation: ReturnType<typeof normalizedObservation>) {
  return sha256(
    "vornan-proof-guardduty-scan-evidence-v1",
    observation.schema_version,
    observation.occurred_at,
    observation.bucket_name,
    observation.object_key,
    observation.object_version_id,
    observation.scan_result
  );
}

function locatorId(record: ProofAssetUploadRecord) {
  return `plocator_${sha256(
    "vornan-proof-asset-locator-v1",
    record.asset_id,
    record.publication_id,
    record.outbound_object_version_id ?? ""
  )}`;
}

function validateLocator(value: ProofAssetLocatorRegistration, expectedId: string) {
  let url: URL;
  try {
    url = new URL(value.delivery_url);
  } catch {
    throw new ProofAssetVerificationPublicationError(
      "delivery_failed",
      "Proof delivery locator is invalid."
    );
  }
  if (
    value.locator_id !== expectedId ||
    !LOCATOR_ID.test(value.locator_id) ||
    url.protocol !== "https:" ||
    url.hostname !== "go.vornan.co" ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/a/${expectedId}`
  ) {
    throw new ProofAssetVerificationPublicationError(
      "delivery_failed",
      "Proof delivery locator is outside the approved opaque boundary."
    );
  }
  return url.toString();
}

function sanitized(record: ProofAssetUploadRecord) {
  return {
    asset_id: record.asset_id,
    order_number: record.order_number,
    state: record.state,
    record_version: record.record_version,
    verification_status: record.verification_status,
    malware_scan_status: record.malware_scan_status,
    publication_status: record.publication_status,
    delivery_locator_id: record.delivery_locator_id,
    lift_not_before_epoch: record.lift_not_before_epoch
  };
}

export function createProofAssetVerificationPublicationService(
  dependencies: ProofAssetVerificationPublicationDependencies
) {
  async function persist(
    current: ProofAssetUploadRecord,
    next: ProofAssetUploadRecord,
    action: ProofAuditAction,
    correlationId: string
  ) {
    return dependencies.transition(
      current,
      next,
      auditEvent({ record: next, action, correlation_id: correlationId })
    );
  }

  return {
    async observeScan(input: ProofAssetScanObservation) {
      const observation = normalizedObservation(input);
      const correlation = eventCorrelation(observation.event_id);
      let record = await dependencies.getRecord(
        observation.order_number,
        observation.asset_id
      );
      if (!record) {
        throw new ProofAssetVerificationPublicationError(
          "not_found",
          "Proof asset scan does not match a durable upload."
        );
      }
      if (
        record.bucket_name !== observation.bucket_name ||
        record.source_key !== observation.object_key ||
        record.source_object_version_id !== observation.object_version_id
      ) {
        throw new ProofAssetVerificationPublicationError(
          "cross_bound",
          "Proof asset scan does not match the immutable source object."
        );
      }

      if (record.state === "uploaded") {
        const started = beginProofAssetVerification({
          record,
          expected_record_version: record.record_version,
          verification_started_at: observation.occurred_at
        }).record;
        record = await persist(
          record,
          started,
          "proof.asset_verification_started",
          correlation
        );
      }
      if (record.state === "verifying") {
        const scanning = beginProofAssetScan({
          record,
          expected_record_version: record.record_version,
          scan_started_at: observation.occurred_at
        }).record;
        record = await persist(
          record,
          scanning,
          "proof.asset_scan_started",
          correlation
        );
      }

      const evidence = exactScanEvidence(observation);
      if (record.verification_status === "pending") {
        await dependencies.setSourceLifecycle({
          record,
          object_version_id: observation.object_version_id,
          lifecycle:
            observation.scan_status === "no_threats_found"
              ? "retained-source"
              : "quarantined"
        });
        const completed = completeProofAssetVerification({
          record,
          expected_record_version: record.record_version,
          scan_completed_at: observation.occurred_at,
          scan_status: observation.scan_status,
          scan_evidence_sha256: evidence
        }).record;
        record = await persist(
          record,
          completed,
          "proof.asset_scan_completed",
          correlation
        );
      } else if (
        record.malware_scan_status !== observation.scan_status ||
        record.scan_evidence_sha256 !== evidence ||
        record.scan_completed_at !== observation.occurred_at
      ) {
        throw new ProofAssetVerificationPublicationError(
          "conflict",
          "Proof asset scan replay conflicts with the durable result."
        );
      }
      return { asset: sanitized(record) };
    },

    async publishCleared(input: {
      order_number: string;
      asset_id: string;
      correlation_id: string;
    }) {
      const correlation = publicationCorrelation(input.correlation_id);
      let record = await dependencies.getRecord(input.order_number, input.asset_id);
      if (!record) {
        throw new ProofAssetVerificationPublicationError(
          "not_found",
          "Proof asset publication does not match a durable upload."
        );
      }
      if (
        record.state === "ready_for_lift" &&
        record.publication_status === "delivery_verified"
      ) {
        return { status: "replay" as const, asset: sanitized(record) };
      }
      if (
        record.state !== "scan_pending" ||
        record.verification_status !== "cleared" ||
        record.malware_scan_status !== "no_threats_found" ||
        !record.source_object_version_id ||
        !record.source_sha256 ||
        !record.source_content_type ||
        record.source_content_length === null
      ) {
        throw new ProofAssetVerificationPublicationError(
          "publication_failed",
          "Proof asset is not durably cleared for publication."
        );
      }

      if (record.publication_status === "not_started") {
        const outbound = await dependencies.publishExact({
          record,
          source_object_version_id: record.source_object_version_id
        });
        if (
          !VERSION_ID.test(outbound.object_version_id) ||
          outbound.content_length !== record.source_content_length ||
          outbound.sha256 !== record.source_sha256
        ) {
          throw new ProofAssetVerificationPublicationError(
            "cross_bound",
            "Published Proof asset does not match the cleared source object."
          );
        }
        timestamp(outbound.published_at, "Proof publication time");
        const published = recordProofAssetPublication({
          record,
          expected_record_version: record.record_version,
          published_at: outbound.published_at,
          outbound_object_version_id: outbound.object_version_id,
          outbound_content_length: outbound.content_length,
          outbound_sha256: outbound.sha256
        }).record;
        record = await persist(
          record,
          published,
          "proof.asset_published",
          correlation
        );
      }

      const locator = locatorId(record);
      const registered = await dependencies.registerLocator({
        locator_id: locator,
        outbound_key: record.outbound_key,
        outbound_object_version_id: record.outbound_object_version_id!,
        content_type: record.source_content_type!,
        content_length: record.source_content_length!,
        expires_at_epoch: Math.floor(Date.parse(record.published_at!) / 1_000) + 86_400
      });
      const deliveryUrl = validateLocator(registered, locator);
      const observed = await dependencies.verifyDirectDelivery({
        delivery_url: deliveryUrl
      });
      timestamp(observed.observed_at, "Proof delivery verification time");
      if (observed.status !== 200 || observed.redirected !== false) {
        throw new ProofAssetVerificationPublicationError(
          "delivery_failed",
          "Proof delivery did not return a direct HTTP 200 response."
        );
      }
      const ready = recordProofAssetDeliveryVerification({
        record,
        expected_record_version: record.record_version,
        delivery_verified_at: observed.observed_at,
        delivery_locator_id: locator,
        delivery_host: "go.vornan.co",
        delivery_url_sha256: createHash("sha256").update(deliveryUrl).digest("hex"),
        direct_http_status: observed.status,
        redirected: observed.redirected,
        observed_content_type: observed.content_type,
        observed_content_length: observed.content_length,
        settle_delay_seconds: 2
      }).record;
      record = await persist(
        record,
        ready,
        "proof.asset_delivery_verified",
        correlation
      );
      return { status: "ready" as const, asset: sanitized(record) };
    }
  };
}
