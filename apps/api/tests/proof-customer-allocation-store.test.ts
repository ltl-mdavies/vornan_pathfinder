import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DynamoDBClient, TransactWriteItemsCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import type { ProofAuditEvent } from "@pathfinder/proof-domain";
import type { CustomerAllocation } from "../src/proof/customer-allocation-store.ts";

test("allocation storage is atomic, survives reload and excludes competing single/batch actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "proof-v1-allocation-"));
  const previous = { driver: process.env.PATHFINDER_PROOF_STORAGE_DRIVER, path: process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH };
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "local";
  process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = join(directory, "store.json");
  const { claimProofAction, listCustomerAllocations, readCustomerAllocation, replaceCustomerAllocation, reserveCustomerAllocation } = await import("../src/proof/customer-allocation-store.ts");
  const record = {
    batch_id: "pbatch_test", order_number: "A0229638", record_version: 1, state: "ready",
    entries: ["1", "2"].map(id => ({ attachment_id: id, expected_version_id: `version-${id}`, state: "pending" }))
  } as CustomerAllocation;
  const event = { event_id: "paudit_allocation-test", order_number: record.order_number, occurred_at: "2026-10-22T12:00:00.000Z", action: "proof.decision_prepared", metadata: {} } as ProofAuditEvent;
  try {
    const reservations = await Promise.all([reserveCustomerAllocation(record, event), reserveCustomerAllocation({ ...record, batch_id: "pbatch_competing" }, event)]);
    assert.deepEqual(reservations, [true, false]);
    assert.deepEqual(await readCustomerAllocation(record.order_number, record.batch_id), record);
    assert.equal((await listCustomerAllocations(record.order_number)).length, 1);
    assert.deepEqual(await listCustomerAllocations("A0000001"), []);
    assert.equal(await claimProofAction(record.order_number, "1", "version-1", "single-decision"), false);
    assert.equal(await claimProofAction(record.order_number, "1", "new-artwork-version", "single-decision"), true);
    assert.equal(await claimProofAction(record.order_number, "1", "new-artwork-version", "single-decision"), true);
    assert.equal(await claimProofAction(record.order_number, "1", "new-artwork-version", "other-decision"), false);
    const next = { ...record, record_version: 2, state: "checking" as const };
    const updates = await Promise.all([replaceCustomerAllocation(record, next, { ...event, event_id: "paudit_advance" }), replaceCustomerAllocation(record, next, { ...event, event_id: "paudit_duplicate" })]);
    assert.deepEqual(updates, [true, false]);
    const disk = JSON.parse(await readFile(process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH!, "utf8"));
    assert.equal(Object.values(disk.allocation_records).length, 1);
    assert.ok(disk.audit_events.paudit_advance);
    assert.equal(disk.audit_events.paudit_duplicate, undefined);
    const paused = { ...next, record_version: 3, state: "paused" as const, entries: next.entries.map((e, i) => ({ ...e, state: i === 0 ? "submitted" as const : "pending" as const })) };
    assert.equal(await replaceCustomerAllocation(next, paused, { ...event, event_id: "paudit_paused" }), true);
    assert.equal(await claimProofAction(record.order_number, "1", "version-1", "new-decision"), false, "submitted creative must stay locked");
    assert.equal(await claimProofAction(record.order_number, "2", "version-2", "new-decision"), true, "unsent creative must be available for a new review");
  } finally {
    if (previous.driver === undefined) delete process.env.PATHFINDER_PROOF_STORAGE_DRIVER; else process.env.PATHFINDER_PROOF_STORAGE_DRIVER = previous.driver;
    if (previous.path === undefined) delete process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH; else process.env.PATHFINDER_PROOF_LOCAL_STORE_PATH = previous.path;
    await rm(directory, { recursive: true, force: true });
  }
});

test("Dynamo batch and claims use conditional atomic writes and consistent paginated recovery reads", async (t) => {
  const names = ["PATHFINDER_PROOF_STORAGE_DRIVER", "PATHFINDER_PROOF_CORE_TABLE", "PATHFINDER_PROOF_AUDIT_TABLE"];
  const previous = names.map(name => process.env[name]);
  process.env.PATHFINDER_PROOF_STORAGE_DRIVER = "dynamodb";
  process.env.PATHFINDER_PROOF_CORE_TABLE = "ProofCoreTest";
  process.env.PATHFINDER_PROOF_AUDIT_TABLE = "ProofAuditTest";
  const commands: any[] = [];
  let queries = 0;
  const transport = t.mock.method(DynamoDBClient.prototype, "send", async (command: any) => {
    commands.push(command);
    if (command instanceof QueryCommand) return ++queries === 1 ? { Items: [], LastEvaluatedKey: { pk: { S: "ORDER#A0229638" }, sk: { S: "ALLOCATION#old" } } } : { Items: [] };
    return {};
  });
  try {
    const storage = await import("../src/proof/customer-allocation-store.ts");
    const record = { batch_id: "pbatch_test", order_number: "A0229638", record_version: 1, state: "ready", entries: [{ attachment_id: "1", expected_version_id: "v1", state: "pending" }, { attachment_id: "2", expected_version_id: "v2", state: "pending" }] } as CustomerAllocation;
    const audit = { event_id: "paudit_test", order_number: record.order_number, occurred_at: "2026-10-22T12:00:00.000Z", metadata: {} } as ProofAuditEvent;
    assert.equal(await storage.reserveCustomerAllocation(record, audit), true);
    assert.ok(commands[0] instanceof TransactWriteItemsCommand);
    const writes = commands[0].input.TransactItems;
    assert.equal(writes.length, 4);
    assert.ok(writes.every((write: any) => write.Put.ConditionExpression));
    assert.equal(writes.at(-1).Put.TableName, "ProofAuditTest");
    const next = { ...record, record_version: 2, state: "paused" as const, entries: [{ ...record.entries[0]!, state: "submitted" as const }, record.entries[1]!] };
    assert.equal(await storage.replaceCustomerAllocation(record, next, audit), true);
    const changes = commands[1].input.TransactItems;
    assert.equal(changes.length, 3, "one record, only the unsent claim, and audit");
    assert.equal(changes[0].Put.ConditionExpression, "record_version = :version");
    assert.equal(changes[1].Put.ConditionExpression, "#owner = :owner");
    assert.equal(changes[1].Put.Item.owner.S, "released-unsent");
    assert.deepEqual(await storage.listCustomerAllocations(record.order_number), []);
    assert.equal(queries, 2);
    assert.ok(commands.slice(2).every(command => command.input.ConsistentRead === true));
    assert.ok(commands[3].input.ExclusiveStartKey);
    transport.mock.mockImplementation(async () => { throw Object.assign(new Error("collision"), { name: "TransactionCanceledException" }); });
    assert.equal(await storage.reserveCustomerAllocation(record, audit), false);
  } finally {
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});
