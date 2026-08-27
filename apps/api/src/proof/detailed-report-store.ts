import { createHash } from "node:crypto";
import { GetItemCommand, PutItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import {
  getProofDynamoClient,
  mutateLocalProofStore,
  parseProofData,
  proofDataItem,
  proofStringAttribute,
  readLocalProofStore,
  requiredProofCoreTable
} from "./store.js";
import { getProofRuntimeConfig } from "./runtime-config.js";

export type ProofDetailedReportState = "unavailable" | "ready" | "generation_started" | "running" | "failed" | "timed_out";

export interface ProofDetailedReportRecord {
  record_id: string;
  customer_id: string;
  order_number: string;
  task_id: string;
  order_line_id: string;
  attachment_id: string;
  version_id: string;
  definition_id: string;
  definition_label: string | null;
  report_id: string | null;
  state: ProofDetailedReportState;
  created_at: string;
  updated_at: string;
  generation_deadline_at: string | null;
}

export class ProofDetailedReportStoreError extends Error {
  constructor(public readonly code: "conflict" | "not_found", message: string) {
    super(message);
    this.name = "ProofDetailedReportStoreError";
  }
}

export function proofDetailedReportRecordId(input: Pick<ProofDetailedReportRecord, "customer_id" | "order_number" | "order_line_id" | "attachment_id" | "definition_id">) {
  const fingerprint = [input.customer_id, input.order_number, input.order_line_id, input.attachment_id, input.definition_id].join("\0");
  return `preport_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 48)}`;
}

function localKey(orderNumber: string, recordId: string) { return `${orderNumber}:${recordId}`; }
function dynamoKey(orderNumber: string, recordId: string) {
  return { pk: proofStringAttribute(`ORDER#${orderNumber}`), sk: proofStringAttribute(`DETAILED_REPORT#${recordId}`) };
}

export async function getProofDetailedReportRecord(orderNumber: string, recordId: string) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    const response = await getProofDynamoClient().send(new GetItemCommand({
      TableName: requiredProofCoreTable(), Key: dynamoKey(orderNumber, recordId), ConsistentRead: true
    }));
    return parseProofData<ProofDetailedReportRecord>(response.Item as Record<string, AttributeValue> | undefined);
  }
  return (await readLocalProofStore()).detailed_report_records[localKey(orderNumber, recordId)] as ProofDetailedReportRecord | undefined ?? null;
}

export async function createProofDetailedReportRecord(record: ProofDetailedReportRecord) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    try {
      await getProofDynamoClient().send(new PutItemCommand({
        TableName: requiredProofCoreTable(),
        Item: proofDataItem(`ORDER#${record.order_number}`, `DETAILED_REPORT#${record.record_id}`, record, {
          detailed_report_state: proofStringAttribute(record.state)
        }),
        ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
      }));
      return record;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        throw new ProofDetailedReportStoreError("conflict", "Detailed report generation is already in progress.");
      }
      throw error;
    }
  }
  return mutateLocalProofStore((store) => {
    const key = localKey(record.order_number, record.record_id);
    if (store.detailed_report_records[key]) throw new ProofDetailedReportStoreError("conflict", "Detailed report generation is already in progress.");
    store.detailed_report_records[key] = record;
    return record;
  });
}

export async function saveProofDetailedReportRecord(record: ProofDetailedReportRecord) {
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "dynamodb") {
    await getProofDynamoClient().send(new PutItemCommand({
      TableName: requiredProofCoreTable(),
      Item: proofDataItem(`ORDER#${record.order_number}`, `DETAILED_REPORT#${record.record_id}`, record, {
        detailed_report_state: proofStringAttribute(record.state)
      })
    }));
    return record;
  }
  return mutateLocalProofStore((store) => {
    store.detailed_report_records[localKey(record.order_number, record.record_id)] = record;
    return record;
  });
}
