import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createWrikeReferenceProofZip } from "../src/wrike-reference-proof-zip.ts";
import type { WrikeWorkbookEvidenceRecord } from "../src/wrike-source-evidence.ts";

function proof(overrides: Partial<WrikeWorkbookEvidenceRecord> = {}) {
  const bytes = new TextEncoder().encode(`%PDF-1.7 ${overrides.evidence_id ?? "proof-one"}`);
  const record: WrikeWorkbookEvidenceRecord = {
    evidence_id: "wrike_reference_proof_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    customer_id: "284619",
    import_method_id: "method-1",
    connection_id: "connection-1",
    account_id: "account-1",
    provider: "wrike",
    document_role: "reference_proof",
    task_id: "task-1",
    attachment_id: "attachment-1",
    version_id: "version-1",
    file_name: "Indoor Proof.pdf",
    extension: "pdf",
    content_type: "application/pdf",
    byte_size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    wrike_updated_at: "2026-08-11T12:00:00.000Z",
    stored_at: "2026-08-11T12:01:00.000Z",
    storage_status: "Stored",
    ...overrides
  };
  return { record, bytes };
}

function zipEntries(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 0, "PDF entries use deterministic store mode");
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    entries.push({
      name: buffer.subarray(nameStart, nameStart + nameLength).toString("utf8"),
      bytes: buffer.subarray(contentStart, contentStart + size)
    });
    offset = contentStart + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  return entries;
}

test("creates one deterministic, traceable ZIP from multiple immutable Wrike proofs", () => {
  const indoor = proof();
  const gpa = proof({
    evidence_id: "wrike_reference_proof_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    attachment_id: "attachment-2",
    version_id: "version-2",
    file_name: "GPA Proof.pdf"
  });
  const first = createWrikeReferenceProofZip({
    contract_number: "c316969",
    archive_file_name_template: "<contract_number>_referenceProofs.zip",
    proofs: [indoor, gpa]
  });
  const replay = createWrikeReferenceProofZip({
    contract_number: "C316969",
    archive_file_name_template: "<contract_number>_referenceProofs.zip",
    proofs: [gpa, indoor]
  });

  assert.equal(first.evidence.file_name, "C316969_referenceProofs.zip");
  assert.equal(first.evidence.content_type, "application/zip");
  assert.equal(first.evidence.task_id, "task-1");
  assert.match(first.evidence.evidence_id, /^wrike_reference_proof_bundle_[a-f0-9]{64}$/);
  assert.deepEqual(first.evidence, replay.evidence);
  assert.deepEqual(first.bytes, replay.bytes);
  assert.deepEqual(first.source_evidence_ids, [gpa.record.evidence_id, indoor.record.evidence_id]);
  assert.deepEqual(
    zipEntries(first.bytes).map((entry) => [entry.name, entry.bytes.toString("utf8")]),
    [
      ["GPA_Proof.pdf", Buffer.from(gpa.bytes).toString("utf8")],
      ["Indoor_Proof.pdf", Buffer.from(indoor.bytes).toString("utf8")]
    ]
  );
});

test("deduplicates archive entry names and rejects cross-task or changed evidence", () => {
  const first = proof();
  const second = proof({
    evidence_id: "wrike_reference_proof_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    attachment_id: "attachment-2",
    version_id: "version-2"
  });
  const archive = createWrikeReferenceProofZip({
    contract_number: "C316969",
    archive_file_name_template: "<contract_number>_referenceProofs.zip",
    proofs: [first, second]
  });
  assert.deepEqual(zipEntries(archive.bytes).map((entry) => entry.name), [
    "Indoor_Proof.pdf",
    "Indoor_Proof_2.pdf"
  ]);

  assert.throws(
    () => createWrikeReferenceProofZip({
      contract_number: "C316969",
      archive_file_name_template: "<contract_number>_referenceProofs.zip",
      proofs: [first, { ...second, record: { ...second.record, task_id: "task-2" } }]
    }),
    /same Wrike task/i
  );
  assert.throws(
    () => createWrikeReferenceProofZip({
      contract_number: "C316969",
      archive_file_name_template: "<contract_number>_referenceProofs.zip",
      proofs: [first, { ...second, bytes: new TextEncoder().encode("changed") }]
    }),
    /immutable PDFs/i
  );
});
