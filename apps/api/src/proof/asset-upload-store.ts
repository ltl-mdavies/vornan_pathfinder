import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import {
  validateProofAssetUploadRecord,
  type ProofAssetUploadRecord
} from "@pathfinder/proof-domain/proof-asset-upload";
import {
  auditEventItem,
  getProofDynamoClient,
  mutateLocalProofStore,
  parseProofData,
  proofDataItem,
  proofStringAttribute,
  readLocalProofStore,
  requiredProofAuditTable,
  requiredProofCoreTable
} from "./store.js";
import { getProofRuntimeConfig } from "./runtime-config.js";

export class ProofAssetUploadStoreError extends Error {
  constructor(
    public readonly code:
      | "conflict"
      | "concurrent_update"
      | "malformed"
      | "not_found",
    message: string
  ) {
    super(message);
    this.name = "ProofAssetUploadStoreError";
  }
}

function storageKey(orderNumber: string, assetId: string) {
  return `${orderNumber}:${assetId}`;
}

function coreKey(orderNumber: string, assetId: string) {
  return {
    pk: proofStringAttribute(`ORDER#${orderNumber}`),
    sk: proofStringAttribute(`PROOF_ASSET#${assetId}`)
  };
}

function assetItem(record: ProofAssetUploadRecord) {
  return proofDataItem(
    `ORDER#${record.order_number}`,
    `PROOF_ASSET#${record.asset_id}`,
    record,
    {
      asset_state: proofStringAttribute(record.state),
      record_version: { N: String(record.record_version) }
    }
  );
}

function token(...parts: string[]) {
  return createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 36);
}

function assetAuditEventId(
  assetId: string,
  state: ProofAssetUploadRecord["state"],
  recordVersion: number
) {
  return `paudit_asset-${createHash("sha256")
    .update(assetId)
    .update("\0")
    .update(state)
    .update("\0")
    .update(String(recordVersion))
    .update("\0")
    .digest("hex")}`;
}

function validateAudit(
  record: ProofAssetUploadRecord,
  event: ProofAuditEvent,
  expectedState = record.state,
  expectedAt = record.updated_at,
  expectedRecordVersion = record.record_version
) {
  const expectedAction =
    expectedState === "initialized"
      ? "proof.asset_upload_initialized"
      : expectedState === "uploading"
        ? "proof.asset_upload_started"
        : expectedState === "uploaded"
          ? "proof.asset_upload_completed"
          : null;
  if (
    !expectedAction ||
    event.event_id !==
      assetAuditEventId(record.asset_id, expectedState, expectedRecordVersion) ||
    event.action !== expectedAction ||
    event.outcome !== "succeeded" ||
    event.order_number !== record.order_number ||
    event.task_id !== record.task_id ||
    event.order_line_id !== null ||
    event.attachment_id !== record.attachment_id ||
    event.grant_id !== null ||
    event.participant_id !== null ||
    event.actor_type !== "operator" ||
    !/^operator_[a-f0-9]{64}$/.test(event.actor_id) ||
    !/^pcorr_asset_[a-f0-9]{64}$/.test(event.correlation_id ?? "") ||
    event.occurred_at !== expectedAt ||
    event.metadata.source !== "operator" ||
    event.metadata.proof_asset_id !== record.asset_id ||
    event.metadata.proof_asset_state !== expectedState ||
    Object.keys(event.metadata).sort().join(",") !==
      "proof_asset_id,proof_asset_state,source"
  ) {
    throw new ProofAssetUploadStoreError(
      "malformed",
      "Proof asset audit event is invalid."
    );
  }
}

async function getDynamoAudit(
  orderNumber: string,
  occurredAt: string,
  eventId: string
) {
  const response = await getProofDynamoClient().send(
    new GetItemCommand({
      TableName: requiredProofAuditTable(),
      Key: {
        pk: proofStringAttribute(`ORDER#${orderNumber}`),
        sk: proofStringAttribute(`${occurredAt}#${eventId}`)
      },
      ConsistentRead: true
    })
  );
  return parseProofData<ProofAuditEvent>(
    response.Item as Record<string, AttributeValue> | undefined
  );
}

async function requireAuditEvent(
  record: ProofAssetUploadRecord,
  state: ProofAssetUploadRecord["state"],
  occurredAt: string,
  recordVersion: number
) {
  const eventId = assetAuditEventId(record.asset_id, state, recordVersion);
  const config = getProofRuntimeConfig();
  const event =
    config.storage_driver === "dynamodb"
      ? await getDynamoAudit(record.order_number, occurredAt, eventId)
      : (await readLocalProofStore()).audit_events[eventId] ?? null;
  if (!event) {
    throw new ProofAssetUploadStoreError(
      "malformed",
      "Proof asset upload is missing its retained audit trail."
    );
  }
  validateAudit(record, event, state, occurredAt, recordVersion);
}

async function requireAuditTrail(record: ProofAssetUploadRecord) {
  await requireAuditEvent(record, "initialized", record.initialized_at, 1);
  if (record.state === "initialized") return;
  await requireAuditEvent(record, "uploading", record.upload_started_at!, 2);
  if (record.state === "uploading") return;
  await requireAuditEvent(record, "uploaded", record.upload_completed_at!, 3);
}

function sameImmutableUpload(
  left: ProofAssetUploadRecord,
  right: ProofAssetUploadRecord
) {
  return (
    left.asset_id === right.asset_id &&
    left.bucket_name === right.bucket_name &&
    left.revision_id === right.revision_id &&
    left.publication_id === right.publication_id &&
    left.order_number === right.order_number &&
    left.task_id === right.task_id &&
    left.attachment_id === right.attachment_id &&
    left.replaces_proof_version_id === right.replaces_proof_version_id &&
    left.original_filename === right.original_filename &&
    left.content_policy_id === right.content_policy_id &&
    left.content_policy_max_bytes === right.content_policy_max_bytes &&
    left.declared_content_type === right.declared_content_type &&
    left.declared_content_length === right.declared_content_length &&
    left.declared_sha256 === right.declared_sha256 &&
    left.source_key === right.source_key &&
    left.outbound_key === right.outbound_key
  );
}

async function getDynamo(orderNumber: string, assetId: string) {
  const response = await getProofDynamoClient().send(
    new GetItemCommand({
      TableName: requiredProofCoreTable(),
      Key: coreKey(orderNumber, assetId),
      ConsistentRead: true
    })
  );
  const value = parseProofData<ProofAssetUploadRecord>(
    response.Item as Record<string, AttributeValue> | undefined
  );
  return value ? validateProofAssetUploadRecord(value) : null;
}

export async function getProofAssetUploadRecord(
  orderNumber: string,
  assetId: string
) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new ProofAssetUploadStoreError(
      "not_found",
      "Proof persistence is disabled."
    );
  }
  if (config.storage_driver === "dynamodb") {
    const record = await getDynamo(orderNumber, assetId);
    if (record) await requireAuditTrail(record);
    return record;
  }
  const store = await readLocalProofStore();
  const value = store.asset_upload_records[storageKey(orderNumber, assetId)];
  if (!value) return null;
  const record = validateProofAssetUploadRecord(value);
  await requireAuditTrail(record);
  return record;
}

export async function reserveProofAssetUpload(
  record: ProofAssetUploadRecord,
  auditEvent: ProofAuditEvent
) {
  validateProofAssetUploadRecord(record);
  validateAudit(record, auditEvent);
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new ProofAssetUploadStoreError(
      "not_found",
      "Proof persistence is disabled."
    );
  }
  if (config.storage_driver === "dynamodb") {
    try {
      await getProofDynamoClient().send(
        new TransactWriteItemsCommand({
          ClientRequestToken: token("asset-reserve", record.asset_id),
          TransactItems: [
            {
              Put: {
                TableName: requiredProofCoreTable(),
                Item: assetItem(record),
                ConditionExpression:
                  "attribute_not_exists(pk) AND attribute_not_exists(sk)"
              }
            },
            {
              Put: {
                TableName: requiredProofAuditTable(),
                Item: auditEventItem(auditEvent),
                ConditionExpression:
                  "attribute_not_exists(pk) AND attribute_not_exists(sk)"
              }
            }
          ]
        })
      );
      return { status: "new" as const, record };
    } catch {
      const existing = await getDynamo(record.order_number, record.asset_id);
      if (existing && sameImmutableUpload(existing, record)) {
        await requireAuditTrail(existing);
        return { status: "replay" as const, record: existing };
      }
      throw new ProofAssetUploadStoreError(
        existing ? "conflict" : "concurrent_update",
        existing
          ? "Proof asset upload identity conflicts."
          : "Proof asset upload reservation was not durably confirmed."
      );
    }
  }
  return mutateLocalProofStore((store) => {
    const key = storageKey(record.order_number, record.asset_id);
    const existing = store.asset_upload_records[key];
    if (existing) {
      const validated = validateProofAssetUploadRecord(existing);
      if (sameImmutableUpload(validated, record)) {
        const milestones: Array<{
          state: ProofAssetUploadRecord["state"];
          occurred_at: string;
          record_version: number;
        }> = [{
          state: "initialized",
          occurred_at: validated.initialized_at,
          record_version: 1
        }];
        if (validated.state !== "initialized") {
          milestones.push({
            state: "uploading",
            occurred_at: validated.upload_started_at!,
            record_version: 2
          });
        }
        if (validated.state !== "initialized" && validated.state !== "uploading") {
          milestones.push({
            state: "uploaded",
            occurred_at: validated.upload_completed_at!,
            record_version: 3
          });
        }
        for (const milestone of milestones) {
          const event = store.audit_events[assetAuditEventId(
            validated.asset_id,
            milestone.state,
            milestone.record_version
          )];
          if (!event) {
            throw new ProofAssetUploadStoreError(
              "malformed",
              "Proof asset upload is missing its retained audit trail."
            );
          }
          validateAudit(
            validated,
            event,
            milestone.state,
            milestone.occurred_at,
            milestone.record_version
          );
        }
        return { status: "replay" as const, record: validated };
      }
      throw new ProofAssetUploadStoreError(
        "conflict",
        "Proof asset upload identity conflicts."
      );
    }
    if (store.audit_events[auditEvent.event_id]) {
      throw new ProofAssetUploadStoreError(
        "conflict",
        "Proof asset audit identity conflicts."
      );
    }
    store.asset_upload_records[key] = record;
    store.audit_events[auditEvent.event_id] = auditEvent;
    return { status: "new" as const, record };
  });
}

export async function transitionProofAssetUpload(
  current: ProofAssetUploadRecord,
  next: ProofAssetUploadRecord,
  auditEvent: ProofAuditEvent
) {
  validateProofAssetUploadRecord(current);
  validateProofAssetUploadRecord(next);
  validateAudit(next, auditEvent);
  if (
    !sameImmutableUpload(current, next) ||
    next.record_version !== current.record_version + 1 ||
    !(
      (current.state === "initialized" && next.state === "uploading") ||
      (current.state === "uploading" && next.state === "uploaded")
    )
  ) {
    throw new ProofAssetUploadStoreError(
      "malformed",
      "Proof asset upload transition is invalid."
    );
  }
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    try {
      await getProofDynamoClient().send(
        new TransactWriteItemsCommand({
          ClientRequestToken: token(
            "asset-transition",
            next.asset_id,
            String(next.record_version)
          ),
          TransactItems: [
            {
              Put: {
                TableName: requiredProofCoreTable(),
                Item: assetItem(next),
                ConditionExpression:
                  "asset_state = :state AND record_version = :version",
                ExpressionAttributeValues: {
                  ":state": proofStringAttribute(current.state),
                  ":version": { N: String(current.record_version) }
                }
              }
            },
            {
              Put: {
                TableName: requiredProofAuditTable(),
                Item: auditEventItem(auditEvent),
                ConditionExpression:
                  "attribute_not_exists(pk) AND attribute_not_exists(sk)"
              }
            }
          ]
        })
      );
      return next;
    } catch {
      throw new ProofAssetUploadStoreError(
        "concurrent_update",
        "Proof asset upload transition was not durably confirmed."
      );
    }
  }
  return mutateLocalProofStore((store) => {
    const key = storageKey(current.order_number, current.asset_id);
    const stored = store.asset_upload_records[key];
    const validated = stored ? validateProofAssetUploadRecord(stored) : null;
    if (
      !validated ||
      validated.record_version !== current.record_version ||
      validated.state !== current.state ||
      store.audit_events[auditEvent.event_id]
    ) {
      throw new ProofAssetUploadStoreError(
        "concurrent_update",
        "Proof asset upload transition was not durably confirmed."
      );
    }
    store.asset_upload_records[key] = next;
    store.audit_events[auditEvent.event_id] = auditEvent;
    return next;
  });
}
