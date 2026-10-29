import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import type { CustomerAllocation } from "../src/proof/customer-allocation-store.js";
import type { RevisionSubmission } from "../src/proof/customer-revision-store.js";
const originalStorePath = process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH;
process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(await mkdtemp(join(tmpdir(), "proof-revision-store-")), "store.json");
const { claimProofAction, reserveCustomerAllocation } = await import("../src/proof/customer-allocation-store.js");
const { listRevisionSubmissions, readRevisionSubmission, reserveRevisionSubmission, replaceRevisionSubmission } = await import("../src/proof/customer-revision-store.js");
const { readLocalProofStore } = await import("../src/proof/store.js");
after(() => { if (originalStorePath === undefined) delete process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH; else process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = originalStorePath; });

const record = { submission_id: "prevision_send_test", order_number: "A0230001", attachment_id: "501", version_id: "v1", record_version: 1, state: "submitted" } as RevisionSubmission;
const audit = { event_id: "paudit_revision-test", order_number: record.order_number, occurred_at: "2026-10-28T12:00:00.000Z", action: "proof.decision_submission_started", metadata: {} } as ProofAuditEvent;
function restore(prior: NodeJS.ProcessEnv) {
  for (const name of Object.keys(process.env)) if (!(name in prior)) delete process.env[name];
  Object.assign(process.env, prior);
}
test("revision receipt, exclusion claim and audit persist atomically; all competing action types stay locked", async () => {
  const prior = { ...process.env };
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  try {
    assert.deepEqual(await Promise.all([reserveRevisionSubmission(record, audit), reserveRevisionSubmission({ ...record, submission_id: "competing" }, { ...audit, event_id: "competing" })]), [true, false]);
    assert.deepEqual(await readRevisionSubmission(record.order_number, record.submission_id), record);
    assert.equal(await readRevisionSubmission("A0000000", record.submission_id), null);
    assert.deepEqual(await listRevisionSubmissions(record.order_number), [record]);
    assert.deepEqual(await listRevisionSubmissions("A0000000"), []);
    assert.equal(await claimProofAction(record.order_number, "501", "v1", "single"), false);
    assert.equal(await reserveCustomerAllocation({ order_number: record.order_number, batch_id: "batch", entries: [{ attachment_id: "501", expected_version_id: "v1" }] } as CustomerAllocation, audit), false);
    const next = { ...record, state: "accepted" as const, record_version: 2 };
    assert.deepEqual(await Promise.all([replaceRevisionSubmission(record, next, { ...audit, event_id: "outcome" }), replaceRevisionSubmission(record, next, { ...audit, event_id: "stale" })]), [true, false]);
    const saved = await readLocalProofStore();
    assert.ok(saved.audit_events[audit.event_id]); assert.ok(saved.audit_events.outcome);
    assert.equal(saved.audit_events.competing, undefined); assert.equal(saved.audit_events.stale, undefined);
    assert.equal(await claimProofAction(record.order_number, "501", "v1", "after-accepted"), false, "transport acceptance does not release exclusion");
    assert.equal(await reserveRevisionSubmission(record, audit), false, "same receipt cannot be reserved again");
    assert.equal(await claimProofAction(record.order_number, "502", "v2", "first-single"), true);
    assert.equal(await reserveRevisionSubmission({ ...record, submission_id: "new", attachment_id: "502", version_id: "v2" }, audit), false);
  } finally { restore(prior); }
});
test("Dynamo receipt discovery paginates within one order and excludes foreign records", async t => {
  const prior = { ...process.env };
  Object.assign(process.env, { PATHFINDER_PROOF_STORAGE_DRIVER: "dynamodb", PATHFINDER_PROOF_CORE_TABLE: "core", PATHFINDER_PROOF_AUDIT_TABLE: "audit" });
  const cursor = { pk: { S: `ORDER#${record.order_number}` }, sk: { S: "REVISION_SUBMISSION#page1" } };
  const second = { ...record, submission_id: "second" };
  let pages = 0;
  t.mock.method(DynamoDBClient.prototype, "send", async (command: any) => {
    assert.ok(command instanceof QueryCommand);
    assert.equal(command.input.TableName, "core");
    assert.equal(command.input.ConsistentRead, true);
    assert.equal(command.input.KeyConditionExpression, "pk = :pk AND begins_with(sk, :prefix)");
    assert.deepEqual(command.input.ExpressionAttributeValues, { ":pk": { S: `ORDER#${record.order_number}` }, ":prefix": { S: "REVISION_SUBMISSION#" } });
    pages += 1;
    assert.deepEqual(command.input.ExclusiveStartKey, pages === 1 ? undefined : cursor);
    const data = pages === 1 ? [record] : [second, { ...record, order_number: "A0000000" }];
    return { Items: data.map(value => ({ data: { S: JSON.stringify(value) } })), ...(pages === 1 ? { LastEvaluatedKey: cursor } : {}) };
  });
  try {
    assert.deepEqual(await listRevisionSubmissions(record.order_number), [record, second]);
    assert.equal(pages, 2);
  } finally { restore(prior); }
});
test("Dynamo revision store uses conditional transactions and consistent recovery reads", async t => {
  const prior = { ...process.env };
  Object.assign(process.env, { PATHFINDER_PROOF_STORAGE_DRIVER: "dynamodb", PATHFINDER_PROOF_CORE_TABLE: "core", PATHFINDER_PROOF_AUDIT_TABLE: "audit" });
  const writes: any[] = [];
  const transport = t.mock.method(DynamoDBClient.prototype, "send", async (command: any) => {
    if (command instanceof GetItemCommand) { assert.equal(command.input.ConsistentRead, true); return { Item: { data: { S: JSON.stringify(record) } } }; }
    assert.ok(command instanceof TransactWriteItemsCommand); writes.push(command.input.TransactItems); return {};
  });
  try {
    assert.equal(await reserveRevisionSubmission(record, audit), true);
    assert.equal(writes[0].length, 3); assert.ok(writes[0].every((w: any) => w.Put.ConditionExpression));
    assert.equal(writes[0][1].Put.Item.owner.S, record.submission_id);
    assert.equal(writes[0][2].Put.TableName, "audit");
    assert.deepEqual(await readRevisionSubmission(record.order_number, record.submission_id), record);
    assert.equal(await replaceRevisionSubmission(record, { ...record, record_version: 2 }, audit), true);
    assert.equal(writes[1].length, 2); assert.equal(writes[1][0].Put.ConditionExpression, "record_version = :version");
    transport.mock.mockImplementation(async () => { throw Object.assign(new Error("conflict"), { name: "TransactionCanceledException" }); });
    assert.equal(await reserveRevisionSubmission(record, audit), false);
    assert.equal(await replaceRevisionSubmission(record, { ...record, record_version: 2 }, audit), false);
  } finally { restore(prior); }
});
