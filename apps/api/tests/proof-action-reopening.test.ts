import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { ProofOrder } from "@pathfinder/proof-domain";
import { normalizeProofOrder } from "@pathfinder/proof-domain";
const originalStorePath = process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH;
process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(await mkdtemp(join(tmpdir(), "proof-reopening-")), "store.json");
const { claimProofAction } = await import("../src/proof/customer-allocation-store.js");
const { recordActionApproval, reopenConfirmedAction } = await import("../src/proof/action-reopening-store.js");
const { persistProofOrder } = await import("../src/proof/store.js");
after(() => { if (originalStorePath === undefined) delete process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH; else process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = originalStorePath; });

function snapshot(state: "approved" | "pending", version: number): ProofOrder {
  return { order_number: "A0230001", version, last_synced_at: `2026-10-28T12:00:0${version}.000Z`, health: state === "approved" ? "complete" : "active", lines: [], archived_tasks: [], tasks: [{ task_id: "task", attachment_id: "1", order_line_id: "line", version, state, actionable: state === "pending", current_version: { version_id: "v1", attachment_id: "1", current: true, approval_status: state.toUpperCase() } }] } as unknown as ProofOrder;
}
test("only a retained positive approval followed by a later authoritative reopening unlocks a new intent", async () => {
  const prior = { ...process.env };
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  try {
    const approved = snapshot("approved", 2), pending = snapshot("pending", 3);
    await claimProofAction(approved.order_number, "1", "v1", "old");
    await persistProofOrder(pending);
    assert.equal(await reopenConfirmedAction(pending, pending.tasks[0]!), false, "uncertain/legacy claims never expire into availability");
    await persistProofOrder(approved);
    assert.equal(await recordActionApproval(approved, { ...approved.tasks[0]!, attachment_id: "unrelated" }, "old"), false);
    assert.equal(await recordActionApproval(approved, approved.tasks[0]!, "wrong-owner"), false);
    assert.equal(await recordActionApproval(approved, approved.tasks[0]!, "old"), true);
    assert.equal(await reopenConfirmedAction(approved, approved.tasks[0]!), false);
    assert.equal(await reopenConfirmedAction(pending, pending.tasks[0]!), false, "unpersisted/stale snapshots cannot unlock");
    await persistProofOrder(pending);
    const stale = snapshot("pending", 2);
    assert.equal(await reopenConfirmedAction(stale, stale.tasks[0]!), false);
    assert.equal(await reopenConfirmedAction(pending, { ...pending.tasks[0]!, actionable: false }), false);
    assert.equal(await reopenConfirmedAction(pending, pending.tasks[0]!), true);
    const outcomes = await Promise.all([claimProofAction(pending.order_number, "1", "v1", "new-a"), claimProofAction(pending.order_number, "1", "v1", "new-b")]);
    assert.deepEqual(outcomes, [true, false]);
    assert.equal(await reopenConfirmedAction(pending, pending.tasks[0]!), false, "old evidence cannot release the new intent");
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in prior)) delete process.env[name];
    Object.assign(process.env, prior);
  }
});
test("Dynamo reopening atomically checks claim owner, evidence and the exact authoritative snapshot", async t => {
  const prior = { ...process.env };
  Object.assign(process.env, { PATHFINDER_PROOF_STORAGE_DRIVER: "dynamodb", PATHFINDER_PROOF_CORE_TABLE: "core", PATHFINDER_PROOF_AUDIT_TABLE: "audit" });
  const pending = snapshot("pending", 3);
  const evidence = { owner: "old", attachment_id: "1", version_id: "v1", task_version: 2, order_version: 2, observed_at: snapshot("approved", 2).last_synced_at };
  const writes: any[] = [];
  t.mock.method(DynamoDBClient.prototype, "send", async (command: any) => {
    if (command instanceof GetItemCommand) { assert.equal(command.input.ConsistentRead, true); return { Item: { data: { S: JSON.stringify(evidence) } } }; }
    assert.ok(command instanceof TransactWriteItemsCommand); writes.push(command.input.TransactItems); return {};
  });
  try {
    assert.equal(await reopenConfirmedAction(pending, pending.tasks[0]!), true);
    assert.equal(writes[0].length, 4);
    assert.equal(writes[0][0].ConditionCheck.ExpressionAttributeValues[":snapshot"].S, JSON.stringify(pending));
    assert.equal(writes[0][1].ConditionCheck.ExpressionAttributeValues[":record"].S, JSON.stringify(evidence));
    assert.equal(writes[0][2].Put.ExpressionAttributeValues[":owner"].S, "old");
    assert.equal(writes[0][3].Put.TableName, "audit");
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in prior)) delete process.env[name];
    Object.assign(process.env, prior);
  }
});

test("real normalization preserves the artwork identity but unlocks a later Lift line reversal", async () => {
  const prior = { ...process.env };
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  const orderNumber = "A0230001";
  const orderPayload = (step: number) => ({ rowset: [{ ORDER_NUMBER: orderNumber, CUSTOMER_ID: 1249, LINES: [{ LINE_NUMBER: 1, ORDER_LINE_ID: 100, PRODUCT_NAME: "Synthetic panel", QUANTITY: 40, LINE_STEP_NUMBER: step }] }] });
  const proofPayload = { rowset: [{ ORDER_NUMBER: orderNumber, ORDER_LINE_ID: 100, LINE_NUMBER: 1, ATTACHMENT_ID: 501, PROOF_FILENAME: "panel.pdf", PROOF_LINK_HIGH: "https://files.example.invalid/panel.pdf", PROOF_APPROVAL_STATUS: "APPROVED" }] };
  try {
    const approved = normalizeProofOrder({ order_number: orderNumber, order_payload: orderPayload(15.22), proof_payloads: [proofPayload], synced_at: "2026-10-28T12:00:00.000Z" });
    const task = approved.tasks[0]!;
    assert.equal(approved.health, "complete");
    await persistProofOrder(approved);
    await claimProofAction(orderNumber, task.attachment_id!, task.current_version!.version_id, "confirmed-intent");
    assert.equal(await recordActionApproval(approved, task, "confirmed-intent"), true);
    const reopened = normalizeProofOrder({ order_number: orderNumber, order_payload: orderPayload(7.02), proof_payloads: [proofPayload], previous: approved, synced_at: "2026-10-28T12:01:00.000Z" });
    assert.equal(reopened.tasks[0]!.current_version!.version_id, task.current_version!.version_id);
    assert.equal(reopened.tasks[0]!.state, "pending");
    await persistProofOrder(reopened);
    assert.equal(await reopenConfirmedAction(reopened, reopened.tasks[0]!), true);
    assert.equal(await claimProofAction(orderNumber, task.attachment_id!, task.current_version!.version_id, "new-intent"), true);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in prior)) delete process.env[name];
    Object.assign(process.env, prior);
  }
});
