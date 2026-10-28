import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyIntakeObservation, diagnosticKey, type IntakeDiagnostic, type IntakeObservation } from "./intake-diagnostics.js";

const client = new DynamoDBClient({ maxAttempts: 2 });
function table() {
  const name = process.env.PATHFINDER_INTAKE_DIAGNOSTICS_TABLE;
  if (!name) throw new Error("Intake diagnostic storage is not configured");
  return name;
}
const isDynamo = () => process.env.PATHFINDER_STORAGE_DRIVER === "dynamodb";
const localPath = () => path.resolve(process.env.PATHFINDER_INTAKE_DIAGNOSTICS_FILE ?? "data/intake-diagnostics.json");
type StoredObservation = IntakeDiagnostic | { observed_at: string };
async function readLocal(): Promise<Record<string, StoredObservation>> {
  try { return JSON.parse(await readFile(localPath(), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
let localQueue: Promise<unknown> = Promise.resolve();
export async function recordIntakeDiagnostic(input: IntakeObservation) {
  const id = diagnosticKey(input);
  if (!isDynamo()) {
    const operation = localQueue.then(async () => {
      const all = await readLocal(); const key = `${input.customer_id}:${id}`;
      const previous = all[key];
      if (previous && Date.parse(previous.observed_at) >= Date.parse(input.observed_at)) return;
      const next = applyIntakeObservation(previous && "diagnostic_id" in previous ? previous : null, input);
      if (!next && !input.job_ids?.some(id => /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(id))) return;
      // A success watermark suppresses an older in-flight failure without inventing
      // a historical alert. Watermarks are not returned by the diagnostic reader.
      all[key] = next ?? { observed_at: input.observed_at };
      const target = localPath(); await mkdir(path.dirname(target), { recursive: true });
      await writeFile(`${target}.tmp`, JSON.stringify(all)); await rename(`${target}.tmp`, target);
    });
    localQueue = operation.catch(() => undefined); return operation;
  }
  const Key = { customer_id: { S: input.customer_id }, diagnostic_id: { S: id } };
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await client.send(new GetItemCommand({ TableName: table(), Key, ConsistentRead: true }), { abortSignal: AbortSignal.timeout(5000) });
    const raw = found.Item?.data?.S;
    const previous = raw ? JSON.parse(raw) as IntakeDiagnostic : null;
    const observed = found.Item?.observed_at?.S ?? previous?.observed_at;
    if (observed && Date.parse(observed) >= Date.parse(input.observed_at)) return;
    const next = applyIntakeObservation(previous, input);
    if (next === previous && next !== null) return;
    if (!next && !input.job_ids?.some(id => /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(id))) return;
    try {
      await client.send(new PutItemCommand({ TableName: table(), Item: { ...Key, observed_at: { S: input.observed_at },
        ...(next ? { state: { S: next.state }, data: { S: JSON.stringify(next) } } : { state: { S: "watermark" } }) },
        ConditionExpression: raw ? "#data = :previous" : observed ? "#observed = :previous" : "attribute_not_exists(diagnostic_id)",
        ...(raw ? { ExpressionAttributeNames: { "#data": "data" }, ExpressionAttributeValues: { ":previous": { S: raw } } }
          : observed ? { ExpressionAttributeNames: { "#observed": "observed_at" }, ExpressionAttributeValues: { ":previous": { S: observed } } } : {}) }), { abortSignal: AbortSignal.timeout(5000) });
      return;
    } catch (error) { if ((error as Error).name !== "ConditionalCheckFailedException" || attempt === 3) throw error; }
  }
}

type Cursor = { customer: string; state: "open" | "all"; workspace?: string; after?: string };
export function decodeDiagnosticCursor(token: string | undefined, customer: string, state: "open" | "all" = "open"): Cursor {
  if (!token) return { customer, state };
  try {
    if (token.length > 600) throw new Error();
    const cursor = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Cursor;
    if (cursor.customer !== customer || cursor.state !== state || typeof cursor.workspace !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/.test(cursor.workspace) ||
        (cursor.after !== undefined && !/^[a-f0-9]{64}$/.test(cursor.after))) throw new Error();
    return cursor;
  } catch { throw new Error("Invalid diagnostic cursor"); }
}
/** Queries a bounded page from saved authorized workspaces; no provider reads or writes. */
export async function readIntakeDiagnostics(customers: string[], customer: string, token?: string, state: "open" | "all" = "open") {
  const ids = [...new Set(customer ? [customer] : customers)].sort();
  const cursor = decodeDiagnosticCursor(token, customer, state);
  const items: IntakeDiagnostic[] = [];
  let position = cursor.workspace ? ids.findIndex(id => id >= cursor.workspace!) : 0;
  if (position < 0) position = ids.length;
  let after = ids[position] === cursor.workspace ? cursor.after : undefined; let requests = 0;
  while (position < ids.length && items.length < 20 && requests++ < 5) {
    const id = ids[position]!;
    if (isDynamo()) {
      const result = await client.send(new QueryCommand({ TableName: table(), ConsistentRead: true, Limit: 20 - items.length,
        KeyConditionExpression: "customer_id = :customer", ExpressionAttributeValues: { ":customer": { S: id }, ...(state === "open" ? { ":open": { S: "open" } } : {}) },
        ...(state === "open" ? { FilterExpression: "#state = :open", ExpressionAttributeNames: { "#state": "state" } } : {}),
        ...(after ? { ExclusiveStartKey: { customer_id: { S: id }, diagnostic_id: { S: after } } } : {}) }), { abortSignal: AbortSignal.timeout(5000) });
      for (const item of result.Items ?? []) if (item.data?.S) {
        const record = JSON.parse(item.data.S) as IntakeDiagnostic;
        if (record.customer_id === id && (state === "all" || record.state === "open")) items.push(record);
      }
      after = result.LastEvaluatedKey?.diagnostic_id?.S;
    } else {
      const matches = Object.values(await readLocal()).filter((row): row is IntakeDiagnostic => "diagnostic_id" in row).filter(row => row.customer_id === id && (state === "all" || row.state === "open") && (!after || row.diagnostic_id > after)).sort((a, b) => a.diagnostic_id.localeCompare(b.diagnostic_id));
      const selected = matches.slice(0, 20 - items.length); items.push(...selected);
      after = matches.length > selected.length ? selected.at(-1)?.diagnostic_id : undefined;
    }
    if (!after) position++;
  }
  return { items, next_cursor: position < ids.length ? Buffer.from(JSON.stringify({ customer, state, workspace: ids[position], after })).toString("base64url") : null };
}
