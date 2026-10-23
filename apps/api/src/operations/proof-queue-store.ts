import { ScanCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import type { ProofOrder } from "@pathfinder/proof-domain";
import { getProofRuntimeConfig } from "../proof/runtime-config.js";
import { getProofDynamoClient, parseProofData, readLocalProofStore, requiredProofCoreTable } from "../proof/store.js";

type Cursor = { customer: string; key?: Record<string, AttributeValue>; offset?: number };
export function decodeQueueCursor(value: string | undefined, customer: string): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 2000) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (cursor.customer !== customer) throw new Error();
    if (cursor.offset !== undefined && (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0)) throw new Error();
    if (cursor.key && (Object.keys(cursor.key).some(k => k !== "pk" && k !== "sk") || typeof cursor.key.pk?.S !== "string" || typeof cursor.key.sk?.S !== "string")) throw new Error();
    if (!cursor.key && cursor.offset === undefined) throw new Error();
    return cursor;
  } catch { throw new Error("Invalid queue cursor"); }
}
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");

/** Transitional bounded cache reader. Not an exhaustive Lift discovery index; never performs a provider request. */
export async function readProofQueuePage(customer: string, token?: string) {
  const cursor = decodeQueueCursor(token, customer);
  const config = getProofRuntimeConfig();
  if (config.storage_driver === "disabled") throw new Error("Proof cache unavailable");
  if (config.storage_driver === "dynamodb") {
    const result = await getProofDynamoClient().send(new ScanCommand({
      TableName: requiredProofCoreTable(), Limit: 50,
      FilterExpression: "begins_with(pk, :order) AND sk = :profile",
      ExpressionAttributeValues: { ":order": { S: "ORDER#" }, ":profile": { S: "PROFILE" } },
      ProjectionExpression: "#data", ExpressionAttributeNames: { "#data": "data" },
      ExclusiveStartKey: cursor?.key
    }));
    return {
      orders: (result.Items ?? []).map(item => parseProofData<ProofOrder>(item)).filter((order): order is ProofOrder => Boolean(order)),
      next_cursor: result.LastEvaluatedKey ? encode({ customer, key: result.LastEvaluatedKey }) : null
    };
  }
  const all = Object.values((await readLocalProofStore()).orders).sort((a, b) => a.order_number.localeCompare(b.order_number));
  const offset = cursor?.offset ?? 0;
  return { orders: all.slice(offset, offset + 20), next_cursor: offset + 20 < all.length ? encode({ customer, offset: offset + 20 }) : null };
}
