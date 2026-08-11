import { createHash } from "node:crypto";
import {
  sanitizeWrikeLiftDeliveryFileName,
  type WrikeLiftSourceEvidenceBinding
} from "@pathfinder/wrike-adapter";
import type { WrikeWorkbookEvidenceRecord } from "./wrike-source-evidence.js";

const ZIP_NAMESPACE = "pathfinder-wrike-reference-proof-zip-v1";
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;

export interface WrikeReferenceProofZipSource {
  record: WrikeWorkbookEvidenceRecord;
  bytes: Uint8Array;
}

export interface WrikeReferenceProofZip {
  evidence: WrikeLiftSourceEvidenceBinding;
  bytes: Uint8Array;
  source_evidence_ids: string[];
}

function sha256(...values: string[]) {
  const hash = createHash("sha256").update(ZIP_NAMESPACE);
  for (const value of values) hash.update("\0").update(value);
  return hash.digest("hex");
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uniqueDeliveryFileNames(records: WrikeWorkbookEvidenceRecord[]) {
  const counts = new Map<string, number>();
  return records.map((record) => {
    const safe = sanitizeWrikeLiftDeliveryFileName(record.file_name);
    const key = safe.toLocaleLowerCase("en-US");
    const occurrence = (counts.get(key) ?? 0) + 1;
    counts.set(key, occurrence);
    if (occurrence === 1) return safe;
    const extension = safe.toLocaleLowerCase("en-US").endsWith(".pdf") ? ".pdf" : "";
    const stem = extension ? safe.slice(0, -extension.length) : safe;
    return sanitizeWrikeLiftDeliveryFileName(`${stem}_${occurrence}${extension}`);
  });
}

function createStoredZip(entries: Array<{ file_name: string; bytes: Uint8Array }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.file_name, "utf8");
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(ZIP_VERSION, 4);
    local.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12); // 1980-01-01, fixed for deterministic replay.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.byteLength, 18);
    local.writeUInt32LE(bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(ZIP_VERSION, 4);
    central.writeUInt16LE(ZIP_VERSION, 6);
    central.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.byteLength, 20);
    central.writeUInt32LE(bytes.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + bytes.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...localParts, centralDirectory, end]));
}

function archiveFileName(template: string, contractNumber: string) {
  const contract = contractNumber.trim().toUpperCase();
  if (!/^C\d{6,10}$/.test(contract)) {
    throw new Error("A valid Contract Number is required to name the reference-proof ZIP.");
  }
  if (template.split("<contract_number>").length !== 2) {
    throw new Error("The reference-proof archive naming convention must contain <contract_number> exactly once.");
  }
  const raw = template.replace("<contract_number>", contract);
  const safe = sanitizeWrikeLiftDeliveryFileName(raw);
  if (!safe.toLocaleLowerCase("en-US").endsWith(".zip")) {
    throw new Error("The reference-proof archive naming convention must produce a .zip file.");
  }
  return safe;
}

export function createWrikeReferenceProofZip(args: {
  contract_number: string;
  archive_file_name_template: string;
  proofs: WrikeReferenceProofZipSource[];
}): WrikeReferenceProofZip {
  if (args.proofs.length < 2 || args.proofs.length > 10) {
    throw new Error("A reference-proof ZIP requires between 2 and 10 source PDFs.");
  }
  const proofs = [...args.proofs].sort(
    (left, right) =>
      left.record.file_name.localeCompare(right.record.file_name, "en-US") ||
      left.record.attachment_id.localeCompare(right.record.attachment_id) ||
      left.record.version_id.localeCompare(right.record.version_id)
  );
  const taskId = proofs[0]?.record.task_id ?? "";
  for (const proof of proofs) {
    const actualSha256 = createHash("sha256").update(proof.bytes).digest("hex");
    if (
      proof.record.document_role !== "reference_proof" ||
      proof.record.extension !== "pdf" ||
      proof.record.content_type !== "application/pdf" ||
      proof.record.task_id !== taskId ||
      proof.record.byte_size !== proof.bytes.byteLength ||
      proof.record.sha256 !== actualSha256
    ) {
      throw new Error("Reference-proof ZIP sources must be immutable PDFs from the same Wrike task.");
    }
  }
  const names = uniqueDeliveryFileNames(proofs.map((proof) => proof.record));
  const bytes = createStoredZip(
    proofs.map((proof, index) => ({ file_name: names[index]!, bytes: proof.bytes }))
  );
  const sourceEvidenceIds = proofs.map((proof) => proof.record.evidence_id);
  const archiveName = archiveFileName(args.archive_file_name_template, args.contract_number);
  if (new Set(sourceEvidenceIds).size !== sourceEvidenceIds.length) {
    throw new Error("Reference-proof ZIP sources must have distinct immutable evidence identities.");
  }
  const sourceSetDigest = sha256(archiveName, ...sourceEvidenceIds);
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    evidence: {
      evidence_id: `wrike_reference_proof_bundle_${sourceSetDigest}`,
      document_role: "reference_proof",
      task_id: taskId,
      attachment_id: `proof_bundle_${sourceSetDigest}`,
      version_id: `proof_set_${sourceSetDigest}`,
      file_name: archiveName,
      content_type: "application/zip",
      byte_size: bytes.byteLength,
      sha256: digest
    },
    bytes,
    source_evidence_ids: sourceEvidenceIds
  };
}
