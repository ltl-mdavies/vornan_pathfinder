import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadWrikeWorkbookEvidence,
  persistWrikeWorkbookEvidence,
  WrikeSourceEvidenceError
} from "../src/wrike-source-evidence.ts";
import type { WrikeQualifiedWorkbookSource } from "@pathfinder/wrike-adapter";

function workbook(bytes = "workbook-v1"): WrikeQualifiedWorkbookSource {
  const encoded = new TextEncoder().encode(bytes);
  return {
    account_id: "IEACCOUNT",
    task_id: "IETASK",
    attachment_id: "IEATTACHMENT",
    version_id: "IEVERSION1",
    file_name: "C123456 - Summer Placards - OOH Order.xlsx",
    extension: "xlsx",
    updated_at: "2026-07-23T12:00:00.000Z",
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byte_size: encoded.byteLength,
    bytes: encoded
  };
}

test("stores one immutable local evidence envelope and safely replays identical bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pathfinder-wrike-evidence-"));
  const previous = process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR;
  const previousDriver = process.env.PATHFINDER_STORAGE_DRIVER;
  process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR = directory;
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  try {
    const input = {
      customer_id: "284619",
      import_method_id: "wrike-orders",
      connection_id: "source_wrike_momentara",
      workbook: workbook(),
      now: new Date("2026-07-23T12:30:00.000Z")
    };
    const stored = await persistWrikeWorkbookEvidence(input);
    const replayed = await persistWrikeWorkbookEvidence({
      ...input,
      now: new Date("2026-07-23T13:30:00.000Z")
    });

    assert.equal(stored.storage_status, "Stored");
    assert.equal(stored.account_id, "IEACCOUNT");
    assert.equal(replayed.storage_status, "Replayed");
    assert.equal(replayed.stored_at, stored.stored_at);
    assert.equal(replayed.sha256, stored.sha256);
    assert.equal("download_url" in stored, false);
    assert.equal("object_key" in stored, false);
    assert.equal(JSON.stringify(stored).includes("token"), false);

    const envelopePath = path.join(
      directory,
      "284619",
      "wrike-orders",
      `${stored.evidence_id}.json`
    );
    const envelope = JSON.parse(await readFile(envelopePath, "utf8")) as {
      record: { sha256: string };
      bytes_base64: string;
    };
    assert.equal(envelope.record.sha256, stored.sha256);
    assert.equal(Buffer.from(envelope.bytes_base64, "base64").toString("utf8"), "workbook-v1");

    const loaded = await loadWrikeWorkbookEvidence({
      customer_id: "284619",
      import_method_id: "wrike-orders",
      connection_id: "source_wrike_momentara",
      evidence_id: stored.evidence_id,
      extension: "xlsx"
    });
    assert.equal(Buffer.from(loaded.bytes).toString("utf8"), "workbook-v1");
    assert.equal(loaded.record.account_id, "IEACCOUNT");

    await assert.rejects(
      loadWrikeWorkbookEvidence({
        customer_id: "284619",
        import_method_id: "wrike-orders",
        connection_id: "source_wrike_other",
        evidence_id: stored.evidence_id,
        extension: "xlsx"
      }),
      (error: unknown) =>
        error instanceof WrikeSourceEvidenceError && error.code === "identity_conflict"
    );

    const tampered = JSON.parse(await readFile(envelopePath, "utf8")) as {
      record: unknown;
      bytes_base64: string;
    };
    tampered.bytes_base64 = Buffer.from("tampered").toString("base64");
    await writeFile(envelopePath, `${JSON.stringify(tampered)}\n`, "utf8");
    await assert.rejects(
      loadWrikeWorkbookEvidence({
        customer_id: "284619",
        import_method_id: "wrike-orders",
        connection_id: "source_wrike_momentara",
        evidence_id: stored.evidence_id,
        extension: "xlsx"
      }),
      (error: unknown) =>
        error instanceof WrikeSourceEvidenceError && error.code === "identity_conflict"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR;
    } else {
      process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR = previous;
    }
    if (previousDriver === undefined) {
      delete process.env.PATHFINDER_STORAGE_DRIVER;
    } else {
      process.env.PATHFINDER_STORAGE_DRIVER = previousDriver;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails closed when one Wrike attachment version returns different bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pathfinder-wrike-evidence-"));
  const previous = process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR;
  const previousDriver = process.env.PATHFINDER_STORAGE_DRIVER;
  process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR = directory;
  process.env.PATHFINDER_STORAGE_DRIVER = "local";
  try {
    const base = {
      customer_id: "284619",
      import_method_id: "wrike-orders",
      connection_id: "source_wrike_momentara",
      now: new Date("2026-07-23T12:30:00.000Z")
    };
    await persistWrikeWorkbookEvidence({ ...base, workbook: workbook("first") });
    await assert.rejects(
      persistWrikeWorkbookEvidence({ ...base, workbook: workbook("changed") }),
      (error: unknown) =>
        error instanceof WrikeSourceEvidenceError && error.code === "identity_conflict"
    );
    await assert.rejects(
      persistWrikeWorkbookEvidence({
        ...base,
        workbook: {
          ...workbook("first"),
          file_name: "C123456 - Renamed Summer Placards - OOH Order.xlsx"
        }
      }),
      (error: unknown) =>
        error instanceof WrikeSourceEvidenceError && error.code === "identity_conflict"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR;
    } else {
      process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR = previous;
    }
    if (previousDriver === undefined) {
      delete process.env.PATHFINDER_STORAGE_DRIVER;
    } else {
      process.env.PATHFINDER_STORAGE_DRIVER = previousDriver;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
