import {
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  S3Client,
  type Tag
} from "@aws-sdk/client-s3";
import type { ProofAssetUploadRecord } from "@pathfinder/proof-domain/proof-asset-upload";
import {
  createProofAssetVerificationPublicationService,
  ProofAssetVerificationPublicationError,
  type ProofAssetScanObservation
} from "./asset-verification-publication.js";
import {
  getProofAssetUploadRecord,
  transitionProofAssetUpload
} from "./asset-upload-store.js";
import { emitProofMetric } from "./telemetry.js";

const ACCOUNT_ID = /^[0-9]{12}$/;
const REGION = /^[a-z]{2}-[a-z]+-[0-9]$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const OBSERVATION_KEYS = [
  "bucket_name",
  "event_id",
  "object_key",
  "object_version_id",
  "occurred_at",
  "scan_result",
  "schema_version"
].sort().join(",");
const MESSAGE_KEYS = ["account", "observation", "region"].sort().join(",");
const PROOF_LIFECYCLE_TAG = "proof-lifecycle";
const GUARD_DUTY_TAG = "GuardDutyMalwareScanStatus";

interface S3TaggingClient {
  send(command: GetObjectTaggingCommand | PutObjectTaggingCommand): Promise<{
    TagSet?: Tag[];
  }>;
}

interface ProofAssetScanQueueRecord {
  messageId?: string;
  body?: string;
}

interface ProofAssetScanQueueEvent {
  Records?: ProofAssetScanQueueRecord[];
}

export interface ProofAssetScanWorkerConfig {
  enabled: boolean;
  account_id: string;
  region: string;
  bucket_name: string;
}

export interface ProofAssetScanWorkerDependencies {
  observeScan(observation: ProofAssetScanObservation): Promise<unknown>;
  now?(): number;
}

export function getProofAssetScanWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): ProofAssetScanWorkerConfig {
  return {
    enabled: env.PATHFINDER_ENABLE_PROOF_ASSET_SCAN_WORKER === "true",
    account_id: env.PATHFINDER_PROOF_ASSET_SCAN_ACCOUNT_ID?.trim() ?? "",
    region: env.PATHFINDER_PROOF_ASSET_SCAN_REGION?.trim() ?? "",
    bucket_name: env.PATHFINDER_PROOF_ASSET_BUCKET?.trim() ?? ""
  };
}

function exactKeys(value: object, expected: string) {
  return Object.keys(value).sort().join(",") === expected;
}

function scanMessage(body: string | undefined, config: ProofAssetScanWorkerConfig) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? "");
  } catch {
    throw new Error("InvalidProofAssetScanMessage");
  }
  const message = parsed as {
    account?: unknown;
    region?: unknown;
    observation?: unknown;
  };
  const observation = message?.observation as ProofAssetScanObservation;
  if (
    !message ||
    typeof message !== "object" ||
    !exactKeys(message, MESSAGE_KEYS) ||
    typeof message.account !== "string" ||
    !ACCOUNT_ID.test(message.account) ||
    message.account !== config.account_id ||
    typeof message.region !== "string" ||
    !REGION.test(message.region) ||
    message.region !== config.region ||
    !observation ||
    typeof observation !== "object" ||
    !exactKeys(observation, OBSERVATION_KEYS) ||
    observation.bucket_name !== config.bucket_name
  ) {
    throw new Error("CrossBoundProofAssetScanMessage");
  }
  return observation;
}

function expectedGuardDutyStatuses(lifecycle: "quarantined" | "retained-source") {
  return lifecycle === "retained-source"
    ? new Set(["NO_THREATS_FOUND"])
    : new Set(["THREATS_FOUND", "UNSUPPORTED", "ACCESS_DENIED", "FAILED"]);
}

function normalizedTags(tags: Tag[]) {
  if (
    tags.some(
      (tag) =>
        typeof tag.Key !== "string" ||
        typeof tag.Value !== "string" ||
        tag.Key.length < 1 ||
        tag.Key.length > 128 ||
        tag.Value.length > 256
    )
  ) {
    throw new Error("InvalidProofAssetSourceTags");
  }
  const unique = new Map<string, string>();
  for (const tag of tags) {
    if (unique.has(tag.Key!)) throw new Error("InvalidProofAssetSourceTags");
    unique.set(tag.Key!, tag.Value!);
  }
  return unique;
}

export function createProofAssetSourceLifecycleWriter(
  client: S3TaggingClient = new S3Client({})
) {
  return async (input: {
    record: ProofAssetUploadRecord;
    object_version_id: string;
    lifecycle: "quarantined" | "retained-source";
  }) => {
    const key = {
      Bucket: input.record.bucket_name,
      Key: input.record.source_key,
      VersionId: input.object_version_id
    };
    const existing = await client.send(new GetObjectTaggingCommand(key));
    const tags = normalizedTags(existing.TagSet ?? []);
    const guardDutyStatus = tags.get(GUARD_DUTY_TAG);
    if (!guardDutyStatus || !expectedGuardDutyStatuses(input.lifecycle).has(guardDutyStatus)) {
      throw new Error("ProofAssetGuardDutyTagMismatch");
    }
    tags.set(PROOF_LIFECYCLE_TAG, input.lifecycle);
    if (tags.size > 10) throw new Error("ProofAssetSourceTagLimitExceeded");
    const TagSet = [...tags.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([Key, Value]) => ({ Key, Value }));
    await client.send(new PutObjectTaggingCommand({
      ...key,
      Tagging: { TagSet }
    }));
    const verified = normalizedTags(
      (await client.send(new GetObjectTaggingCommand(key))).TagSet ?? []
    );
    if (
      verified.size !== tags.size ||
      [...tags].some(([name, value]) => verified.get(name) !== value)
    ) {
      throw new Error("ProofAssetSourceTagVerificationFailed");
    }
  };
}

function unavailable(): never {
  throw new ProofAssetVerificationPublicationError(
    "publication_failed",
    "Proof asset publication is not enabled in the scan worker."
  );
}

export function createDefaultProofAssetScanObserver(
  lifecycleWriter = createProofAssetSourceLifecycleWriter()
) {
  return createProofAssetVerificationPublicationService({
    getRecord: getProofAssetUploadRecord,
    transition: transitionProofAssetUpload,
    setSourceLifecycle: lifecycleWriter,
    publishExact: async () => unavailable(),
    registerLocator: async () => unavailable(),
    verifyDirectDelivery: async () => unavailable()
  }).observeScan;
}

export function createProofAssetScanWorkerHandler(
  dependencies: ProofAssetScanWorkerDependencies = {
    observeScan: createDefaultProofAssetScanObserver()
  },
  configProvider: () => ProofAssetScanWorkerConfig = getProofAssetScanWorkerConfig
) {
  return async (event: ProofAssetScanQueueEvent = {}) => {
    const config = configProvider();
    const failures: { itemIdentifier: string }[] = [];
    for (const record of event.Records ?? []) {
      const startedAt = performance.now();
      const messageId = MESSAGE_ID.test(record.messageId ?? "")
        ? record.messageId!
        : "invalid-message";
      try {
        if (
          !config.enabled ||
          !ACCOUNT_ID.test(config.account_id) ||
          !REGION.test(config.region) ||
          !config.bucket_name
        ) {
          throw new Error("ProofAssetScanWorkerDisabled");
        }
        await dependencies.observeScan(scanMessage(record.body, config));
        emitProofMetric({
          service: "asset-worker",
          operation: "observe_scan",
          duration_ms: performance.now() - startedAt,
          server_error: false,
          denied: false,
          correlation_id: messageId,
          timestamp: dependencies.now?.()
        });
      } catch (error) {
        failures.push({ itemIdentifier: messageId });
        emitProofMetric({
          service: "asset-worker",
          operation: "observe_scan",
          duration_ms: performance.now() - startedAt,
          server_error: true,
          denied: /Disabled|CrossBound|Invalid/.test(
            error instanceof Error ? `${error.name}${error.message}` : ""
          ),
          correlation_id: messageId,
          failure_class: error instanceof Error ? error.name : "UnknownError",
          timestamp: dependencies.now?.()
        });
      }
    }
    return { batchItemFailures: failures };
  };
}

export const handler = createProofAssetScanWorkerHandler();
