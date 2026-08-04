import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import type { LiftProofingAction } from "@pathfinder/lift-proof-adapter/proofing-action-runtime";
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

export type ProofOperatorActionOutcome =
  | "prepared"
  | "submission_uncertain"
  | "reconciling";

export interface ProofOperatorActionRecord {
  idempotency_key: string;
  canonical_body_hash: string;
  request_body_sha256: string;
  action: LiftProofingAction;
  order_number: string;
  task_id: string;
  order_line_id: string | null;
  attachment_id: string;
  expected_task_version: number;
  expected_version_id: string;
  feedback_fingerprint: string;
  execution_scope_sha256: string;
  approval_mode: "simple" | "quantity_allocation" | null;
  approve_quantity: number | null;
  expected_line_quantity: number | null;
  allocation_plan_sha256: string | null;
  target_id: string;
  environment_id: string;
  note_sha256: string | null;
  revision_asset_id: string | null;
  revision_publication_id: string | null;
  revision_id: string | null;
  revision_source_object_version_sha256: string | null;
  revision_outbound_object_version_sha256: string | null;
  revision_asset_sha256: string | null;
  revision_outbound_sha256: string | null;
  revision_delivery_url_sha256: string | null;
  revision_lift_not_before_epoch: number | null;
  revision_retention_anchor_at: string | null;
  revision_retention_days: number | null;
  revision_cleanup_eligible_at_epoch: number | null;
  prepared_audit_event_id: string;
  outcome: ProofOperatorActionOutcome;
  record_version: number;
  created_at: string;
  updated_at: string;
  expires_at_epoch: number;
  attempt_id: string | null;
  response_classification: string | null;
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const HASH = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const ORDER_NUMBER = /^A\d{7,8}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ACTIONS = new Set([
  "APPROVE",
  "REJECT",
  "SEND_BACK_TO_ARTIST",
  "CANCEL_LINE",
  "REVISED_ART_WILL_BE_SENT"
]);

export class ProofOperatorActionStoreError extends Error {
  constructor(
    public readonly code:
      | "conflict"
      | "concurrent_update"
      | "malformed"
      | "not_found",
    message: string
  ) {
    super(message);
    this.name = "ProofOperatorActionStoreError";
  }
}

function key(orderNumber: string, idempotencyKey: string) {
  return `${orderNumber}:${idempotencyKey}`;
}

function coreKey(record: Pick<ProofOperatorActionRecord, "order_number" | "idempotency_key">) {
  return {
    pk: proofStringAttribute(`ORDER#${record.order_number}`),
    sk: proofStringAttribute(`OPERATOR_ACTION#${record.idempotency_key}`)
  };
}

function operatorItem(record: ProofOperatorActionRecord) {
  return proofDataItem(
    `ORDER#${record.order_number}`,
    `OPERATOR_ACTION#${record.idempotency_key}`,
    record,
    {
      canonical_body_hash: proofStringAttribute(record.canonical_body_hash),
      outcome: proofStringAttribute(record.outcome),
      record_version: { N: String(record.record_version) },
      ttl_epoch: { N: String(record.expires_at_epoch) }
    }
  );
}

function executionScopeItem(record: ProofOperatorActionRecord) {
  return proofDataItem(
    `ORDER#${record.order_number}`,
    `OPERATOR_ACTION_SCOPE#${record.execution_scope_sha256}`,
    {
      execution_scope_sha256: record.execution_scope_sha256,
      canonical_body_hash: record.canonical_body_hash,
      outcome: "submission_uncertain",
      created_at: record.updated_at,
      expires_at_epoch: record.expires_at_epoch
    },
    {
      ttl_epoch: { N: String(record.expires_at_epoch) }
    }
  );
}

function validatePreparedAudit(
  record: ProofOperatorActionRecord,
  value: unknown
) {
  const event = value as ProofAuditEvent;
  if (
    !event ||
    typeof event !== "object" ||
    event.event_id !== record.prepared_audit_event_id ||
    event.occurred_at !== record.created_at ||
    event.action !== "proof.operator_action_prepared" ||
    event.outcome !== "succeeded" ||
    event.order_number !== record.order_number ||
    event.task_id !== record.task_id ||
    event.order_line_id !== record.order_line_id ||
    event.attachment_id !== record.attachment_id ||
    event.grant_id !== null ||
    event.participant_id !== null ||
    event.actor_type !== "operator" ||
    typeof event.actor_id !== "string" ||
    !event.actor_id.startsWith("operator_") ||
    typeof event.correlation_id !== "string" ||
    !event.correlation_id ||
    !event.metadata ||
    event.metadata.source !== "operator" ||
    event.metadata.operator_action_kind !== record.action ||
    event.metadata.decision_outcome !== "prepared" ||
    Object.keys(event.metadata).sort().join(",") !==
      "decision_outcome,operator_action_kind,source"
  ) {
    throw new ProofOperatorActionStoreError(
      "malformed",
      "Proof operator action prepared audit is invalid."
    );
  }
  return event;
}

function validateTransitionAudit(
  record: ProofOperatorActionRecord,
  event: ProofAuditEvent
) {
  const expectedAction =
    record.outcome === "submission_uncertain"
      ? "proof.operator_action_submission_started"
      : record.outcome === "reconciling"
        ? "proof.operator_action_observed"
        : null;
  const metadataKeys = [
    "decision_outcome",
    "operator_action_kind",
    ...(record.outcome === "reconciling" ? ["response_classification"] : []),
    "source"
  ].sort().join(",");
  if (
    !expectedAction ||
    event.action !== expectedAction ||
    event.outcome !== "succeeded" ||
    event.order_number !== record.order_number ||
    event.task_id !== record.task_id ||
    event.order_line_id !== record.order_line_id ||
    event.attachment_id !== record.attachment_id ||
    event.grant_id !== null ||
    event.participant_id !== null ||
    event.actor_type !== "operator" ||
    typeof event.actor_id !== "string" ||
    !event.actor_id.startsWith("operator_") ||
    typeof event.correlation_id !== "string" ||
    !event.correlation_id ||
    event.metadata?.source !== "operator" ||
    event.metadata.operator_action_kind !== record.action ||
    event.metadata.decision_outcome !== record.outcome ||
    (record.outcome === "reconciling" &&
      event.metadata.response_classification !== record.response_classification) ||
    Object.keys(event.metadata ?? {}).sort().join(",") !== metadataKeys
  ) {
    throw new ProofOperatorActionStoreError(
      "malformed",
      "Proof operator action transition audit is invalid."
    );
  }
}

export function validateProofOperatorActionRecord(value: unknown) {
  const record = value as ProofOperatorActionRecord;
  if (
    !record ||
    typeof record !== "object" ||
    typeof record.idempotency_key !== "string" ||
    !IDEMPOTENCY_KEY.test(record.idempotency_key) ||
    typeof record.canonical_body_hash !== "string" ||
    !HASH.test(record.canonical_body_hash) ||
    typeof record.request_body_sha256 !== "string" ||
    !HASH.test(record.request_body_sha256) ||
    typeof record.action !== "string" ||
    !ACTIONS.has(record.action) ||
    typeof record.order_number !== "string" ||
    !ORDER_NUMBER.test(record.order_number) ||
    typeof record.task_id !== "string" ||
    !IDENTIFIER.test(record.task_id) ||
    typeof record.attachment_id !== "string" ||
    !IDENTIFIER.test(record.attachment_id) ||
    typeof record.target_id !== "string" ||
    !IDENTIFIER.test(record.target_id) ||
    typeof record.environment_id !== "string" ||
    !IDENTIFIER.test(record.environment_id) ||
    !Number.isInteger(record.expected_task_version) ||
    record.expected_task_version < 1 ||
    typeof record.expected_version_id !== "string" ||
    !IDENTIFIER.test(record.expected_version_id) ||
    typeof record.feedback_fingerprint !== "string" ||
    !record.feedback_fingerprint ||
    typeof record.execution_scope_sha256 !== "string" ||
    !HASH.test(record.execution_scope_sha256) ||
    (record.approval_mode !== null &&
      record.approval_mode !== "simple" &&
      record.approval_mode !== "quantity_allocation") ||
    (record.approve_quantity !== null &&
      (!Number.isSafeInteger(record.approve_quantity) ||
        record.approve_quantity <= 0)) ||
    (record.expected_line_quantity !== null &&
      (!Number.isSafeInteger(record.expected_line_quantity) ||
        record.expected_line_quantity <= 0)) ||
    (record.allocation_plan_sha256 !== null &&
      !HASH.test(record.allocation_plan_sha256)) ||
    (record.action === "APPROVE" &&
      (record.approval_mode === null ||
        record.expected_line_quantity === null ||
        (record.approval_mode === "simple" &&
          (record.approve_quantity !== null ||
            record.allocation_plan_sha256 !== null)) ||
        (record.approval_mode === "quantity_allocation" &&
          (record.approve_quantity === null ||
            record.approve_quantity > record.expected_line_quantity ||
            record.allocation_plan_sha256 === null)))) ||
    (record.action !== "APPROVE" &&
      (record.approval_mode !== null ||
        record.approve_quantity !== null ||
        record.expected_line_quantity !== null ||
        record.allocation_plan_sha256 !== null)) ||
    !["prepared", "submission_uncertain", "reconciling"].includes(record.outcome) ||
    !Number.isInteger(record.record_version) ||
    record.record_version < 1 ||
    !Number.isFinite(Date.parse(record.created_at)) ||
    !Number.isFinite(Date.parse(record.updated_at)) ||
    !Number.isInteger(record.expires_at_epoch) ||
    record.expires_at_epoch !==
      Math.floor(Date.parse(record.created_at) / 1_000) + THIRTY_DAYS_SECONDS ||
    (record.note_sha256 !== null && !HASH.test(record.note_sha256)) ||
    (record.revision_asset_id !== null &&
      !/^passet_[a-f0-9]{64}$/.test(record.revision_asset_id)) ||
    (record.revision_publication_id !== null &&
      !/^ppublication_[a-f0-9]{64}$/.test(record.revision_publication_id)) ||
    (record.revision_id !== null &&
      !/^prevision_[a-f0-9]{64}$/.test(record.revision_id)) ||
    (record.revision_source_object_version_sha256 !== null &&
      !HASH.test(record.revision_source_object_version_sha256)) ||
    (record.revision_outbound_object_version_sha256 !== null &&
      !HASH.test(record.revision_outbound_object_version_sha256)) ||
    (record.revision_asset_sha256 !== null &&
      !HASH.test(record.revision_asset_sha256)) ||
    (record.revision_outbound_sha256 !== null &&
      !HASH.test(record.revision_outbound_sha256)) ||
    (record.revision_delivery_url_sha256 !== null &&
      !HASH.test(record.revision_delivery_url_sha256)) ||
    (record.revision_lift_not_before_epoch !== null &&
      (!Number.isInteger(record.revision_lift_not_before_epoch) ||
        record.revision_lift_not_before_epoch < 1)) ||
    (record.revision_retention_anchor_at !== null &&
      !Number.isFinite(Date.parse(record.revision_retention_anchor_at))) ||
    (record.revision_retention_days !== null &&
      (!Number.isInteger(record.revision_retention_days) ||
        record.revision_retention_days < 60 ||
        record.revision_retention_days > 90)) ||
    (record.revision_cleanup_eligible_at_epoch !== null &&
      (!Number.isInteger(record.revision_cleanup_eligible_at_epoch) ||
        record.revision_cleanup_eligible_at_epoch < 1)) ||
    (record.revision_retention_anchor_at !== null &&
      record.revision_retention_days !== null &&
      record.revision_cleanup_eligible_at_epoch !==
        Math.floor(Date.parse(record.revision_retention_anchor_at) / 1_000) +
          record.revision_retention_days * 24 * 60 * 60) ||
    (record.revision_outbound_sha256 !== null &&
      record.revision_asset_sha256 !== record.revision_outbound_sha256) ||
    (record.action === "REVISED_ART_WILL_BE_SENT" &&
      (record.revision_asset_id === null ||
        record.revision_publication_id === null ||
        record.revision_id === null ||
        record.revision_source_object_version_sha256 === null ||
        record.revision_outbound_object_version_sha256 === null ||
        record.revision_asset_sha256 === null ||
        record.revision_outbound_sha256 === null ||
        record.revision_delivery_url_sha256 === null ||
        record.revision_lift_not_before_epoch === null ||
        record.revision_retention_anchor_at === null ||
        record.revision_retention_days === null ||
        record.revision_cleanup_eligible_at_epoch === null)) ||
    (record.action !== "REVISED_ART_WILL_BE_SENT" &&
      (record.revision_asset_id !== null ||
        record.revision_publication_id !== null ||
        record.revision_id !== null ||
        record.revision_source_object_version_sha256 !== null ||
        record.revision_outbound_object_version_sha256 !== null ||
        record.revision_asset_sha256 !== null ||
        record.revision_outbound_sha256 !== null ||
        record.revision_delivery_url_sha256 !== null ||
        record.revision_lift_not_before_epoch !== null ||
        record.revision_retention_anchor_at !== null ||
        record.revision_retention_days !== null ||
        record.revision_cleanup_eligible_at_epoch !== null)) ||
    (record.attempt_id !== null && !/^paction_[a-f0-9]{64}$/.test(record.attempt_id))
  ) {
    throw new ProofOperatorActionStoreError("malformed", "Proof operator action record is invalid.");
  }
  return record;
}

async function getDynamo(record: Pick<ProofOperatorActionRecord, "order_number" | "idempotency_key">) {
  const response = await getProofDynamoClient().send(new GetItemCommand({
    TableName: requiredProofCoreTable(),
    Key: coreKey(record),
    ConsistentRead: true
  }));
  const parsed = parseProofData<ProofOperatorActionRecord>(
    response.Item as Record<string, AttributeValue> | undefined
  );
  if (!parsed) return null;
  const validated = validateProofOperatorActionRecord(parsed);
  const auditResponse = await getProofDynamoClient().send(new GetItemCommand({
    TableName: requiredProofAuditTable(),
    Key: {
      pk: proofStringAttribute(`ORDER#${validated.order_number}`),
      sk: proofStringAttribute(
        `${validated.created_at}#${validated.prepared_audit_event_id}`
      )
    },
    ConsistentRead: true
  }));
  const audit = parseProofData<ProofAuditEvent>(
    auditResponse.Item as Record<string, AttributeValue> | undefined
  );
  validatePreparedAudit(validated, audit);
  return validated;
}

export async function getProofOperatorActionRecord(
  orderNumber: string,
  idempotencyKey: string
) {
  if (getProofRuntimeConfig().storage_driver === "dynamodb") {
    return getDynamo({ order_number: orderNumber, idempotency_key: idempotencyKey });
  }
  const store = await readLocalProofStore();
  const value = store.operator_action_records[key(orderNumber, idempotencyKey)];
  if (!value) return null;
  const validated = validateProofOperatorActionRecord(value);
  validatePreparedAudit(
    validated,
    store.audit_events[validated.prepared_audit_event_id]
  );
  return validated;
}

function transactionToken(...parts: string[]) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 36);
}

export async function reserveProofOperatorAction(
  record: ProofOperatorActionRecord,
  auditEvent: ProofAuditEvent
) {
  validateProofOperatorActionRecord(record);
  validatePreparedAudit(record, auditEvent);
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new ProofOperatorActionStoreError("not_found", "Proof persistence is disabled.");
  }
  if (config.storage_driver === "dynamodb") {
    try {
      await getProofDynamoClient().send(new TransactWriteItemsCommand({
        ClientRequestToken: transactionToken(
          "prepare",
          record.order_number,
          record.idempotency_key,
          record.canonical_body_hash
        ),
        TransactItems: [
          {
            Put: {
              TableName: requiredProofCoreTable(),
              Item: operatorItem(record),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          },
          {
            Put: {
              TableName: requiredProofAuditTable(),
              Item: auditEventItem(auditEvent),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          }
        ]
      }));
      return { status: "new" as const, record };
    } catch {
      const existing = await getDynamo(record);
      if (
        existing &&
        existing.canonical_body_hash === record.canonical_body_hash &&
        existing.prepared_audit_event_id === record.prepared_audit_event_id
      ) {
        return { status: "replay" as const, record: existing };
      }
      if (existing) {
        throw new ProofOperatorActionStoreError("conflict", "Proof action idempotency key conflicts.");
      }
      throw new ProofOperatorActionStoreError(
        "concurrent_update",
        "Proof action reservation was not durably confirmed."
      );
    }
  }
  return mutateLocalProofStore((store) => {
    const storageKey = key(record.order_number, record.idempotency_key);
    const existing = store.operator_action_records[storageKey] as
      | ProofOperatorActionRecord
      | undefined;
    if (existing) {
      const validated = validateProofOperatorActionRecord(existing);
      if (
        validated.canonical_body_hash === record.canonical_body_hash &&
        validated.prepared_audit_event_id === record.prepared_audit_event_id
      ) {
        return { status: "replay" as const, record: validated };
      }
      throw new ProofOperatorActionStoreError("conflict", "Proof action idempotency key conflicts.");
    }
    if (store.audit_events[auditEvent.event_id]) {
      throw new ProofOperatorActionStoreError("conflict", "Proof action audit event conflicts.");
    }
    store.operator_action_records[storageKey] = record;
    store.audit_events[auditEvent.event_id] = auditEvent;
    return { status: "new" as const, record };
  });
}

export async function transitionProofOperatorAction(
  current: ProofOperatorActionRecord,
  next: ProofOperatorActionRecord,
  auditEvent: ProofAuditEvent
) {
  validateProofOperatorActionRecord(current);
  validateProofOperatorActionRecord(next);
  validateTransitionAudit(next, auditEvent);
  if (
    current.order_number !== next.order_number ||
    current.idempotency_key !== next.idempotency_key ||
    current.canonical_body_hash !== next.canonical_body_hash ||
    current.execution_scope_sha256 !== next.execution_scope_sha256 ||
    current.expires_at_epoch !== next.expires_at_epoch ||
    next.record_version !== current.record_version + 1 ||
    !(
      (current.outcome === "prepared" && next.outcome === "submission_uncertain") ||
      (current.outcome === "submission_uncertain" && next.outcome === "reconciling")
    )
  ) {
    throw new ProofOperatorActionStoreError("malformed", "Proof action transition is invalid.");
  }
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const stored = await getDynamo(current);
    if (
      !stored ||
      stored.record_version !== current.record_version ||
      stored.outcome !== current.outcome ||
      stored.canonical_body_hash !== current.canonical_body_hash
    ) {
      throw new ProofOperatorActionStoreError(
        "concurrent_update",
        "Proof action transition was not durably confirmed."
      );
    }
    try {
      await getProofDynamoClient().send(new TransactWriteItemsCommand({
        ClientRequestToken: transactionToken(
          "transition",
          next.order_number,
          next.idempotency_key,
          String(next.record_version)
        ),
        TransactItems: [
          {
            Put: {
              TableName: requiredProofCoreTable(),
              Item: operatorItem(next),
              ConditionExpression:
                "canonical_body_hash = :hash AND outcome = :outcome AND record_version = :version",
              ExpressionAttributeValues: {
                ":hash": proofStringAttribute(current.canonical_body_hash),
                ":outcome": proofStringAttribute(current.outcome),
                ":version": { N: String(current.record_version) }
              }
            }
          },
          {
            Put: {
              TableName: requiredProofAuditTable(),
              Item: auditEventItem(auditEvent),
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
            }
          },
          ...(current.outcome === "prepared"
            ? [{
                Put: {
                  TableName: requiredProofCoreTable(),
                  Item: executionScopeItem(next),
                  ConditionExpression:
                    "attribute_not_exists(pk) AND attribute_not_exists(sk)"
                }
              }]
            : [])
        ]
      }));
      return next;
    } catch {
      throw new ProofOperatorActionStoreError(
        "concurrent_update",
        "Proof action transition was not durably confirmed."
      );
    }
  }
  return mutateLocalProofStore((store) => {
    const storageKey = key(current.order_number, current.idempotency_key);
    const stored = store.operator_action_records[storageKey];
    const validated = stored ? validateProofOperatorActionRecord(stored) : null;
    const scopeStorageKey = `scope:${current.order_number}:${current.execution_scope_sha256}`;
    if (
      !validated ||
      validated.record_version !== current.record_version ||
      validated.outcome !== current.outcome ||
      validated.canonical_body_hash !== current.canonical_body_hash ||
      store.audit_events[auditEvent.event_id] ||
      (current.outcome === "prepared" && store.operator_action_records[scopeStorageKey])
    ) {
      throw new ProofOperatorActionStoreError(
        "concurrent_update",
        "Proof action transition was not durably confirmed."
      );
    }
    validatePreparedAudit(
      validated,
      store.audit_events[validated.prepared_audit_event_id]
    );
    store.operator_action_records[storageKey] = next;
    if (current.outcome === "prepared") {
      store.operator_action_records[scopeStorageKey] = {
        execution_scope_sha256: current.execution_scope_sha256,
        canonical_body_hash: current.canonical_body_hash,
        outcome: "submission_uncertain",
        created_at: next.updated_at,
        expires_at_epoch: next.expires_at_epoch
      };
    }
    store.audit_events[auditEvent.event_id] = auditEvent;
    return next;
  });
}
