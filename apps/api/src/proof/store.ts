import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  type AttributeValue
} from "@aws-sdk/client-dynamodb";
import type {
  ProofAccessGrant,
  ProofAccessSession,
  ProofAuditEvent,
  ProofAuditPage,
  ProofDecisionLedgerRecord,
  ProofFeedbackAcknowledgement,
  ProofOrder,
  ProofParticipant,
  ProofTask,
  ProofVersion
} from "@pathfinder/proof-domain";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getProofRuntimeConfig } from "./runtime-config.js";

export interface LocalProofStore {
  orders: Record<string, ProofOrder>;
  grants: Record<string, ProofAccessGrant>;
  sessions: Record<string, ProofAccessSession>;
  participants: Record<string, ProofParticipant>;
  feedback_acknowledgements: Record<string, ProofFeedbackAcknowledgement>;
  decision_records: Record<string, ProofDecisionLedgerRecord>;
  audit_events: Record<string, ProofAuditEvent>;
}

const localStorePath =
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH ??
  (process.env.PATHFINDER_RUNTIME === "lambda"
    ? "/tmp/pathfinder-proof-store.local.json"
    : fileURLToPath(new URL("../../../../data/pathfinder-proof-store.local.json", import.meta.url)));

let dynamoClient: DynamoDBClient | null = null;
let localMutationTail: Promise<void> = Promise.resolve();

function client() {
  dynamoClient ??= new DynamoDBClient({});
  return dynamoClient;
}

export function getProofDynamoClient() {
  return client();
}

export function proofStringAttribute(value: string) {
  return { S: value };
}

const stringAttribute = proofStringAttribute;

export function proofDataItem(pk: string, sk: string, data: unknown, indexes: Record<string, AttributeValue> = {}) {
  return {
    pk: stringAttribute(pk),
    sk: stringAttribute(sk),
    data: stringAttribute(JSON.stringify(data)),
    updated_at: stringAttribute(new Date().toISOString()),
    ...indexes
  };
}

const dataItem = proofDataItem;

export function parseProofData<T>(item: Record<string, AttributeValue> | undefined) {
  const data = item?.data?.S;
  return data ? (JSON.parse(data) as T) : null;
}

const parseData = parseProofData;

export function requiredProofCoreTable() {
  const tableName = getProofRuntimeConfig().core_table_name;
  if (!tableName) {
    throw new Error("PATHFINDER_PROOF_CORE_TABLE must be configured when Proof storage uses DynamoDB.");
  }
  return tableName;
}

const requiredCoreTable = requiredProofCoreTable;

export function requiredProofAuditTable() {
  const tableName = getProofRuntimeConfig().audit_table_name;
  if (!tableName) {
    throw new Error("PATHFINDER_PROOF_AUDIT_TABLE must be configured when Proof storage uses DynamoDB.");
  }
  return tableName;
}

const requiredAuditTable = requiredProofAuditTable;

export async function readLocalProofStore(): Promise<LocalProofStore> {
  try {
    const parsed = JSON.parse(await readFile(localStorePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The local Vornan Proof store root must be an object.");
    }
    const stored = parsed as Record<string, unknown>;
    const collection = <T>(key: keyof LocalProofStore) => {
      const candidate = stored[key];
      if (candidate === undefined) {
        return {} as Record<string, T>;
      }
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(`The local Vornan Proof store collection ${key} must be an object.`);
      }
      return candidate as Record<string, T>;
    };
    return {
      orders: collection<ProofOrder>("orders"),
      grants: collection<ProofAccessGrant>("grants"),
      sessions: collection<ProofAccessSession>("sessions"),
      participants: collection<ProofParticipant>("participants"),
      feedback_acknowledgements: collection<ProofFeedbackAcknowledgement>("feedback_acknowledgements"),
      decision_records: collection<ProofDecisionLedgerRecord>("decision_records"),
      audit_events: collection<ProofAuditEvent>("audit_events")
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        orders: {},
        grants: {},
        sessions: {},
        participants: {},
        feedback_acknowledgements: {},
        decision_records: {},
        audit_events: {}
      };
    }
    throw new Error(
      `Could not read the local Vornan Proof store at ${localStorePath}; the existing file was preserved.`,
      { cause: error }
    );
  }
}

const readLocalStore = readLocalProofStore;

async function writeLocalStore(store: LocalProofStore) {
  await mkdir(dirname(localStorePath), { recursive: true });
  const temporaryStorePath = `${localStorePath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryStorePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporaryStorePath, localStorePath);
}

export async function mutateLocalProofStore<T>(mutation: (store: LocalProofStore) => T | Promise<T>) {
  const pending = localMutationTail.then(async () => {
    const store = await readLocalStore();
    const result = await mutation(store);
    await writeLocalStore(store);
    return result;
  });
  localMutationTail = pending.then(() => undefined, () => undefined);
  return pending;
}

const mutateLocalStore = mutateLocalProofStore;

function taskIndexes(orderNumber: string, task: ProofTask) {
  const indexes: Record<string, AttributeValue> = {};
  if (task.attachment_id) {
    indexes.gsi1pk = stringAttribute(`ATTACHMENT#${task.attachment_id}`);
    indexes.gsi1sk = stringAttribute(`ORDER#${orderNumber}#TASK#${task.task_id}`);
  }
  if (task.order_line_id) {
    indexes.gsi2pk = stringAttribute(`LINE#${task.order_line_id}`);
    indexes.gsi2sk = stringAttribute(`ORDER#${orderNumber}#TASK#${task.task_id}`);
  }
  return indexes;
}

async function putDynamoItem(item: Record<string, AttributeValue>) {
  await client().send(
    new PutItemCommand({
      TableName: requiredCoreTable(),
      Item: item
    })
  );
}

async function persistDynamoTask(orderNumber: string, task: ProofTask) {
  const pk = `ORDER#${orderNumber}`;
  await putDynamoItem(dataItem(pk, `TASK#${task.task_id}`, task, taskIndexes(orderNumber, task)));
  await Promise.all(task.versions.map((version) => persistDynamoVersion(pk, task.task_id, version)));
}

async function persistDynamoVersion(pk: string, taskId: string, version: ProofVersion) {
  await putDynamoItem(dataItem(pk, `TASK#${taskId}#VERSION#${version.version_id}`, version));
}

export async function getProofOrder(orderNumber: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(
      new GetItemCommand({
        TableName: requiredCoreTable(),
        Key: {
          pk: stringAttribute(`ORDER#${orderNumber}`),
          sk: stringAttribute("PROFILE")
        }
      })
    );
    return parseData<ProofOrder>(response.Item as Record<string, AttributeValue> | undefined);
  }

  const store = await readLocalStore();
  return store.orders[orderNumber] ?? null;
}

export async function persistProofOrder(order: ProofOrder) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const pk = `ORDER#${order.order_number}`;
    await putDynamoItem(dataItem(pk, "PROFILE", order));
    await Promise.all([...order.tasks, ...order.archived_tasks].map((task) => persistDynamoTask(order.order_number, task)));
    return order;
  }

  return mutateLocalStore((store) => {
    store.orders[order.order_number] = order;
    return order;
  });
}

function grantIndexes(grant: ProofAccessGrant) {
  const indexes: Record<string, AttributeValue> = {
    gsi1pk: stringAttribute(`TOKEN#${grant.token_hash}`),
    gsi1sk: stringAttribute(`GRANT#${grant.grant_id}`),
    gsi2pk: stringAttribute(`GRANT#${grant.grant_id}`),
    gsi2sk: stringAttribute(`ORDER#${grant.order_number}`)
  };
  if (grant.exchanged_at) {
    indexes.exchanged_at = stringAttribute(grant.exchanged_at);
  }
  return indexes;
}

export async function persistProofGrant(grant: ProofAccessGrant) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    await putDynamoItem(dataItem(`ORDER#${grant.order_number}`, `GRANT#${grant.grant_id}`, grant, grantIndexes(grant)));
    return grant;
  }
  return mutateLocalStore((store) => {
    store.grants[grant.grant_id] = grant;
    return grant;
  });
}

export async function listProofGrants(orderNumber: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(new QueryCommand({
      TableName: requiredCoreTable(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": stringAttribute(`ORDER#${orderNumber}`),
        ":prefix": stringAttribute("GRANT#")
      }
    }));
    return (response.Items ?? []).map((item) => parseData<ProofAccessGrant>(item)).filter((item): item is ProofAccessGrant => Boolean(item));
  }
  const store = await readLocalStore();
  return Object.values(store.grants).filter((grant) => grant.order_number === orderNumber);
}

export async function getProofGrantById(grantId: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(new QueryCommand({
      TableName: requiredCoreTable(),
      IndexName: "LineIndex",
      KeyConditionExpression: "gsi2pk = :pk",
      ExpressionAttributeValues: { ":pk": stringAttribute(`GRANT#${grantId}`) },
      Limit: 1
    }));
    return parseData<ProofAccessGrant>(response.Items?.[0]);
  }
  const store = await readLocalStore();
  return store.grants[grantId] ?? null;
}

export async function getProofGrantByTokenHash(tokenHash: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(new QueryCommand({
      TableName: requiredCoreTable(),
      IndexName: "AttachmentIndex",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": stringAttribute(`TOKEN#${tokenHash}`) },
      Limit: 1
    }));
    return parseData<ProofAccessGrant>(response.Items?.[0]);
  }
  const store = await readLocalStore();
  return Object.values(store.grants).find((grant) => grant.token_hash === tokenHash) ?? null;
}

export async function claimProofGrant(grant: ProofAccessGrant, exchangedAt: string) {
  if (grant.exchanged_at) {
    return null;
  }
  const claimed = { ...grant, exchanged_at: exchangedAt, last_used_at: exchangedAt };
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    try {
      await client().send(new PutItemCommand({
        TableName: requiredCoreTable(),
        Item: dataItem(`ORDER#${grant.order_number}`, `GRANT#${grant.grant_id}`, claimed, grantIndexes(claimed)),
        ConditionExpression: "attribute_not_exists(exchanged_at)"
      }));
      return claimed;
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        return null;
      }
      throw error;
    }
  }
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  return mutateLocalStore((store) => {
    const current = store.grants[grant.grant_id];
    if (!current || current.exchanged_at) {
      return null;
    }
    store.grants[grant.grant_id] = claimed;
    return claimed;
  });
}

export async function persistProofSession(session: ProofAccessSession) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    await putDynamoItem(dataItem(`SESSION#${session.session_hash}`, "PROFILE", session, {
      ttl_epoch: { N: String(session.expires_at_epoch) }
    }));
    return session;
  }
  return mutateLocalStore((store) => {
    store.sessions[session.session_hash] = session;
    return session;
  });
}

export async function getProofSessionByHash(sessionHash: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(new GetItemCommand({
      TableName: requiredCoreTable(),
      Key: { pk: stringAttribute(`SESSION#${sessionHash}`), sk: stringAttribute("PROFILE") }
    }));
    return parseData<ProofAccessSession>(response.Item as Record<string, AttributeValue> | undefined);
  }
  const store = await readLocalStore();
  return store.sessions[sessionHash] ?? null;
}

export async function persistProofParticipant(participant: ProofParticipant) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    await putDynamoItem(dataItem(`GRANT#${participant.grant_id}`, `PARTICIPANT#${participant.participant_id}`, participant));
    return participant;
  }
  return mutateLocalStore((store) => {
    store.participants[participant.participant_id] = participant;
    return participant;
  });
}

export async function getProofParticipant(grantId: string, participantId: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(new GetItemCommand({
      TableName: requiredCoreTable(),
      Key: {
        pk: stringAttribute(`GRANT#${grantId}`),
        sk: stringAttribute(`PARTICIPANT#${participantId}`)
      }
    }));
    return parseData<ProofParticipant>(response.Item as Record<string, AttributeValue> | undefined);
  }
  const store = await readLocalStore();
  const participant = store.participants[participantId] ?? null;
  return participant?.grant_id === grantId ? participant : null;
}

export async function listProofParticipants(grantId: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(new QueryCommand({
      TableName: requiredCoreTable(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": stringAttribute(`GRANT#${grantId}`),
        ":prefix": stringAttribute("PARTICIPANT#")
      }
    }));
    return (response.Items ?? [])
      .map((item) => parseData<ProofParticipant>(item))
      .filter((item): item is ProofParticipant => Boolean(item));
  }
  const store = await readLocalStore();
  return Object.values(store.participants).filter((participant) => participant.grant_id === grantId);
}

function feedbackAcknowledgementKey(participantId: string, taskId: string) {
  return `${participantId}:${taskId}`;
}

export async function persistProofFeedbackAcknowledgement(acknowledgement: ProofFeedbackAcknowledgement) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    await putDynamoItem(dataItem(
      `GRANT#${acknowledgement.grant_id}`,
      `ACK#${acknowledgement.participant_id}#${acknowledgement.task_id}`,
      acknowledgement
    ));
    return acknowledgement;
  }
  return mutateLocalStore((store) => {
    store.feedback_acknowledgements[feedbackAcknowledgementKey(acknowledgement.participant_id, acknowledgement.task_id)] = acknowledgement;
    return acknowledgement;
  });
}

export async function getProofFeedbackAcknowledgement(grantId: string, participantId: string, taskId: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof core table is configured.");
  }
  if (config.storage_driver === "dynamodb") {
    const response = await client().send(new GetItemCommand({
      TableName: requiredCoreTable(),
      Key: {
        pk: stringAttribute(`GRANT#${grantId}`),
        sk: stringAttribute(`ACK#${participantId}#${taskId}`)
      }
    }));
    return parseData<ProofFeedbackAcknowledgement>(response.Item as Record<string, AttributeValue> | undefined);
  }
  const store = await readLocalStore();
  const acknowledgement = store.feedback_acknowledgements[feedbackAcknowledgementKey(participantId, taskId)] ?? null;
  return acknowledgement?.grant_id === grantId ? acknowledgement : null;
}

function auditSortKey(event: ProofAuditEvent) {
  return `${event.occurred_at}#${event.event_id}`;
}

export function auditEventItem(event: ProofAuditEvent) {
  return {
    pk: stringAttribute(`ORDER#${event.order_number}`),
    sk: stringAttribute(auditSortKey(event)),
    data: stringAttribute(JSON.stringify(event)),
    occurred_at: stringAttribute(event.occurred_at),
    event_id: stringAttribute(event.event_id)
  };
}

function auditCursor(sortKey: string) {
  return Buffer.from(sortKey, "utf8").toString("base64url");
}

function decodeAuditCursor(cursor: string | null | undefined) {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    return /^\d{4}-\d{2}-\d{2}T[^#]+#paudit_[A-Za-z0-9-]+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export async function appendProofAuditEvent(event: ProofAuditEvent) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof tables are configured.");
  }
  if (config.storage_driver === "dynamodb") {
    await client().send(new PutItemCommand({
      TableName: requiredAuditTable(),
      Item: auditEventItem(event),
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
    }));
    return event;
  }
  return mutateLocalStore((store) => {
    if (store.audit_events[event.event_id]) {
      const error = new Error(`Proof audit event ${event.event_id} already exists.`);
      error.name = "ConditionalCheckFailedException";
      throw error;
    }
    store.audit_events[event.event_id] = event;
    return event;
  });
}

export async function listProofAuditEvents(
  orderNumber: string,
  options: { limit?: number; cursor?: string | null } = {}
): Promise<ProofAuditPage> {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") {
    throw new Error("Vornan Proof persistence is disabled until the dedicated Proof tables are configured.");
  }
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const decodedCursor = decodeAuditCursor(options.cursor);
  if (options.cursor && !decodedCursor) {
    throw new Error("Proof audit cursor is invalid.");
  }
  if (config.storage_driver === "dynamodb") {
    const pk = `ORDER#${orderNumber}`;
    const response = await client().send(new QueryCommand({
      TableName: requiredAuditTable(),
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": stringAttribute(pk) },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: decodedCursor ? { pk: stringAttribute(pk), sk: stringAttribute(decodedCursor) } : undefined
    }));
    const events = (response.Items ?? [])
      .map((item) => parseData<ProofAuditEvent>(item))
      .filter((event): event is ProofAuditEvent => Boolean(event));
    const lastSortKey = response.LastEvaluatedKey?.sk?.S;
    return { events, next_cursor: lastSortKey ? auditCursor(lastSortKey) : null };
  }
  const store = await readLocalStore();
  const events = Object.values(store.audit_events)
    .filter((event) => event.order_number === orderNumber)
    .sort((left, right) => auditSortKey(right).localeCompare(auditSortKey(left)));
  const start = decodedCursor ? Math.max(0, events.findIndex((event) => auditSortKey(event) === decodedCursor) + 1) : 0;
  const page = events.slice(start, start + limit);
  return {
    events: page,
    next_cursor: start + limit < events.length && page.length ? auditCursor(auditSortKey(page[page.length - 1]!)) : null
  };
}
