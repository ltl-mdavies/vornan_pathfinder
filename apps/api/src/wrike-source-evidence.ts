import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  WrikeQualifiedReferenceProofSource,
  WrikeQualifiedWorkbookSource,
  WrikeReferenceProofExtension,
  WrikeWorkbookExtension
} from "@pathfinder/wrike-adapter";

export type WrikeSourceDocumentRole = "order_grid" | "reference_proof";
export type WrikeSourceDocumentExtension = WrikeWorkbookExtension | WrikeReferenceProofExtension;
type WrikeQualifiedSourceDocument = WrikeQualifiedWorkbookSource | WrikeQualifiedReferenceProofSource;

export interface WrikeWorkbookEvidenceRecord {
  evidence_id: string;
  customer_id: string;
  import_method_id: string;
  connection_id: string;
  account_id: string;
  provider: "wrike";
  document_role: WrikeSourceDocumentRole;
  task_id: string;
  attachment_id: string;
  version_id: string;
  file_name: string;
  extension: WrikeSourceDocumentExtension;
  content_type: string;
  byte_size: number;
  sha256: string;
  wrike_updated_at: string;
  stored_at: string;
  storage_status: "Stored" | "Replayed";
}

interface LocalEvidenceEnvelope {
  record: Omit<WrikeWorkbookEvidenceRecord, "storage_status">;
  bytes_base64: string;
}

export class WrikeSourceEvidenceError extends Error {
  constructor(
    public readonly code: "invalid_evidence" | "identity_conflict" | "not_found" | "storage_failed",
    message: string
  ) {
    super(message);
    this.name = "WrikeSourceEvidenceError";
  }
}

function boundedIdentifier(value: string, label: string) {
  const clean = value.trim();
  if (!/^[a-zA-Z0-9_:.=-]{1,256}$/.test(clean) || clean === "." || clean === "..") {
    throw new WrikeSourceEvidenceError("invalid_evidence", `${label} is invalid.`);
  }
  return clean;
}

function evidenceIdentity(workbook: WrikeQualifiedSourceDocument) {
  return [
    boundedIdentifier(workbook.account_id, "Wrike account ID"),
    boundedIdentifier(workbook.task_id, "Wrike task ID"),
    boundedIdentifier(workbook.attachment_id, "Wrike attachment ID"),
    boundedIdentifier(workbook.version_id, "Wrike attachment version ID")
  ].join("\u001f");
}

function safeFileName(value: string) {
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!clean || clean.length > 512 || clean.includes("/") || clean.includes("\\")) {
    throw new WrikeSourceEvidenceError("invalid_evidence", "Wrike workbook file name is invalid.");
  }
  return clean;
}

function safeContentType(value: string) {
  const clean = value.trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(clean)) {
    throw new WrikeSourceEvidenceError("invalid_evidence", "Wrike workbook content type is invalid.");
  }
  return clean;
}

function createEvidenceRecord(args: {
  customer_id: string;
  import_method_id: string;
  connection_id: string;
  document: WrikeQualifiedSourceDocument;
  document_role: WrikeSourceDocumentRole;
  now: Date;
}) {
  const customerId = boundedIdentifier(args.customer_id, "Customer ID");
  const importMethodId = boundedIdentifier(args.import_method_id, "Import Method ID");
  const connectionId = boundedIdentifier(args.connection_id, "Source connection ID");
  const identity = evidenceIdentity(args.document);
  const evidencePrefix = args.document_role === "order_grid" ? "wrike_workbook" : "wrike_reference_proof";
  const evidenceId = `${evidencePrefix}_${createHash("sha256").update(identity).digest("hex")}`;
  const sha256 = createHash("sha256").update(args.document.bytes).digest("hex");
  const storedAt = args.now.toISOString();
  const updatedAt = new Date(args.document.updated_at);
  if (
    !Number.isFinite(updatedAt.getTime()) ||
    !Number.isSafeInteger(args.document.byte_size) ||
    args.document.byte_size < 1 ||
    args.document.byte_size !== args.document.bytes.byteLength
  ) {
    throw new WrikeSourceEvidenceError("invalid_evidence", "Wrike workbook evidence metadata is invalid.");
  }
  return {
    evidence_id: evidenceId,
    customer_id: customerId,
    import_method_id: importMethodId,
    connection_id: connectionId,
    account_id: boundedIdentifier(args.document.account_id, "Wrike account ID"),
    provider: "wrike" as const,
    document_role: args.document_role,
    task_id: boundedIdentifier(args.document.task_id, "Wrike task ID"),
    attachment_id: boundedIdentifier(args.document.attachment_id, "Wrike attachment ID"),
    version_id: boundedIdentifier(args.document.version_id, "Wrike attachment version ID"),
    file_name: safeFileName(args.document.file_name),
    extension: args.document.extension,
    content_type: safeContentType(args.document.content_type),
    byte_size: args.document.byte_size,
    sha256,
    wrike_updated_at: updatedAt.toISOString(),
    stored_at: storedAt
  };
}

function replayOrConflict(
  existing: Omit<WrikeWorkbookEvidenceRecord, "storage_status">,
  next: Omit<WrikeWorkbookEvidenceRecord, "storage_status">
): WrikeWorkbookEvidenceRecord {
  const immutableFields = [
    "evidence_id",
    "customer_id",
    "import_method_id",
    "connection_id",
    "account_id",
    "provider",
    "document_role",
    "task_id",
    "attachment_id",
    "version_id",
    "file_name",
    "extension",
    "content_type",
    "byte_size",
    "sha256",
    "wrike_updated_at"
  ] as const;
  if (immutableFields.some((field) => existing[field] !== next[field])) {
    throw new WrikeSourceEvidenceError(
      "identity_conflict",
      "The same Wrike attachment version returned different evidence; operator review is required."
    );
  }
  return { ...existing, storage_status: "Replayed" };
}

function localEvidenceRoot() {
  const configured = process.env.PATHFINDER_LOCAL_SOURCE_EVIDENCE_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  const storePath = process.env.PATHFINDER_LOCAL_STORE_PATH?.trim();
  return storePath
    ? path.join(path.dirname(path.resolve(storePath)), "pathfinder-source-evidence")
    : path.resolve("/tmp/pathfinder-source-evidence");
}

async function persistLocalEvidence(
  record: Omit<WrikeWorkbookEvidenceRecord, "storage_status">,
  bytes: Uint8Array
): Promise<WrikeWorkbookEvidenceRecord> {
  const directory = path.join(localEvidenceRoot(), record.customer_id, record.import_method_id);
  const filePath = path.join(directory, `${record.evidence_id}.json`);
  await mkdir(directory, { recursive: true });
  const envelope: LocalEvidenceEnvelope = {
    record,
    bytes_base64: Buffer.from(bytes).toString("base64")
  };
  try {
    await writeFile(filePath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { ...record, storage_status: "Stored" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new WrikeSourceEvidenceError("storage_failed", "Wrike workbook evidence could not be stored.");
    }
    try {
      const existing = JSON.parse(await readFile(filePath, "utf8")) as LocalEvidenceEnvelope;
      return replayOrConflict(existing.record, record);
    } catch (readError) {
      if (readError instanceof WrikeSourceEvidenceError) {
        throw readError;
      }
      throw new WrikeSourceEvidenceError("storage_failed", "Stored Wrike workbook evidence is unreadable.");
    }
  }
}

let s3Client: S3Client | undefined;

function getS3Client() {
  s3Client ??= new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  return s3Client;
}

function encodeMetadata(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeMetadata(value: string | undefined, label: string) {
  if (!value) {
    throw new WrikeSourceEvidenceError("storage_failed", `Stored Wrike evidence ${label} is missing.`);
  }
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new WrikeSourceEvidenceError("storage_failed", `Stored Wrike evidence ${label} is invalid.`);
  }
}

function s3ObjectKey(record: Omit<WrikeWorkbookEvidenceRecord, "storage_status">) {
  return `wrike/${record.customer_id}/${record.import_method_id}/${record.evidence_id}.${record.extension}`;
}

function recordFromHead(
  record: Omit<WrikeWorkbookEvidenceRecord, "storage_status">,
  metadata: Record<string, string> | undefined,
  contentLength: number | undefined
) {
  if (metadata?.evidence_id !== record.evidence_id) {
    throw new WrikeSourceEvidenceError(
      "identity_conflict",
      "Stored Wrike workbook evidence does not match its immutable identity."
    );
  }
  const existing = {
    ...record,
    document_role: metadata?.document_role
      ? decodeMetadata(metadata.document_role, "document role") as WrikeSourceDocumentRole
      : "order_grid",
    account_id: decodeMetadata(metadata?.account_id, "account ID"),
    connection_id: decodeMetadata(metadata?.connection_id, "connection ID"),
    task_id: decodeMetadata(metadata?.task_id, "task ID"),
    attachment_id: decodeMetadata(metadata?.attachment_id, "attachment ID"),
    version_id: decodeMetadata(metadata?.version_id, "version ID"),
    extension: decodeMetadata(metadata?.extension, "extension") as WrikeWorkbookExtension,
    file_name: decodeMetadata(metadata?.file_name, "file name"),
    content_type: decodeMetadata(metadata?.content_type, "content type"),
    sha256: metadata?.sha256 ?? "",
    byte_size: Number(contentLength),
    wrike_updated_at: decodeMetadata(metadata?.wrike_updated_at, "provider timestamp"),
    stored_at: decodeMetadata(metadata?.stored_at, "storage timestamp")
  };
  return replayOrConflict(existing, record);
}

async function readS3Evidence(
  bucket: string,
  key: string,
  record: Omit<WrikeWorkbookEvidenceRecord, "storage_status">
) {
  try {
    const result = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return recordFromHead(record, result.Metadata, result.ContentLength);
  } catch (error) {
    if (
      error instanceof S3ServiceException &&
      (error.$metadata.httpStatusCode === 403 ||
        error.$metadata.httpStatusCode === 404 ||
        error.name === "NotFound" ||
        error.name === "NoSuchKey")
    ) {
      // The runtime role intentionally has no ListBucket permission, so S3 masks a
      // missing key as 403. The caller follows this probe only with an If-None-Match
      // conditional Put; a real permission failure therefore still fails closed.
      return null;
    }
    if (error instanceof WrikeSourceEvidenceError) {
      throw error;
    }
    throw new WrikeSourceEvidenceError("storage_failed", "Stored Wrike workbook evidence could not be checked.");
  }
}

async function persistS3Evidence(
  bucket: string,
  record: Omit<WrikeWorkbookEvidenceRecord, "storage_status">,
  bytes: Uint8Array
) {
  const key = s3ObjectKey(record);
  const existing = await readS3Evidence(bucket, key, record);
  if (existing) {
    return existing;
  }
  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: record.content_type,
        ContentLength: record.byte_size,
        IfNoneMatch: "*",
        ServerSideEncryption: "AES256",
        Metadata: {
          evidence_id: record.evidence_id,
          document_role: record.document_role,
          account_id: encodeMetadata(record.account_id),
          connection_id: encodeMetadata(record.connection_id),
          task_id: encodeMetadata(record.task_id),
          attachment_id: encodeMetadata(record.attachment_id),
          version_id: encodeMetadata(record.version_id),
          extension: encodeMetadata(record.extension),
          sha256: record.sha256,
          file_name: encodeMetadata(record.file_name),
          content_type: encodeMetadata(record.content_type),
          wrike_updated_at: encodeMetadata(record.wrike_updated_at),
          stored_at: encodeMetadata(record.stored_at)
        }
      })
    );
    return { ...record, storage_status: "Stored" as const };
  } catch (error) {
    if (
      error instanceof S3ServiceException &&
      (error.$metadata.httpStatusCode === 409 || error.$metadata.httpStatusCode === 412)
    ) {
      const replay = await readS3Evidence(bucket, key, record);
      if (replay) {
        return replay;
      }
    }
    if (error instanceof WrikeSourceEvidenceError) {
      throw error;
    }
    throw new WrikeSourceEvidenceError("storage_failed", "Wrike workbook evidence could not be stored.");
  }
}

export async function persistWrikeWorkbookEvidence(args: {
  customer_id: string;
  import_method_id: string;
  connection_id: string;
  workbook: WrikeQualifiedWorkbookSource;
  now?: Date;
}): Promise<WrikeWorkbookEvidenceRecord> {
  return persistWrikeSourceDocumentEvidence({
    ...args,
    document: args.workbook,
    document_role: "order_grid"
  });
}

export async function persistWrikeReferenceProofEvidence(args: {
  customer_id: string;
  import_method_id: string;
  connection_id: string;
  reference_proof: WrikeQualifiedReferenceProofSource;
  now?: Date;
}): Promise<WrikeWorkbookEvidenceRecord> {
  return persistWrikeSourceDocumentEvidence({
    ...args,
    document: args.reference_proof,
    document_role: "reference_proof"
  });
}

async function persistWrikeSourceDocumentEvidence(args: {
  customer_id: string;
  import_method_id: string;
  connection_id: string;
  document: WrikeQualifiedSourceDocument;
  document_role: WrikeSourceDocumentRole;
  now?: Date;
}): Promise<WrikeWorkbookEvidenceRecord> {
  const record = createEvidenceRecord({ ...args, now: args.now ?? new Date() });
  const bucket = process.env.PATHFINDER_SOURCE_EVIDENCE_BUCKET?.trim();
  if (process.env.PATHFINDER_STORAGE_DRIVER !== "local" && !bucket) {
    throw new WrikeSourceEvidenceError(
      "storage_failed",
      "Wrike workbook evidence storage is not configured."
    );
  }
  return bucket
    ? persistS3Evidence(bucket, record, args.document.bytes)
    : persistLocalEvidence(record, args.document.bytes);
}

type LoadEvidenceArgs = {
  customer_id: string;
  import_method_id: string;
  connection_id: string;
  evidence_id: string;
  extension: WrikeWorkbookExtension;
};

type LoadSourceEvidenceArgs = Omit<LoadEvidenceArgs, "extension"> & {
  document_role: WrikeSourceDocumentRole;
  extension: WrikeSourceDocumentExtension;
};

function validateLoadedEvidence(
  record: Omit<WrikeWorkbookEvidenceRecord, "storage_status">,
  bytes: Uint8Array,
  expected: LoadSourceEvidenceArgs
) {
  const exactIdentity =
    record.provider === "wrike" &&
    record.document_role === expected.document_role &&
    record.customer_id === boundedIdentifier(expected.customer_id, "Customer ID") &&
    record.import_method_id === boundedIdentifier(expected.import_method_id, "Import Method ID") &&
    record.connection_id === boundedIdentifier(expected.connection_id, "Source connection ID") &&
    record.evidence_id === boundedIdentifier(expected.evidence_id, "Evidence ID") &&
    record.extension === expected.extension;
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    !exactIdentity ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    digest !== record.sha256 ||
    record.byte_size !== bytes.byteLength ||
    bytes.byteLength < 1
  ) {
    throw new WrikeSourceEvidenceError(
      "identity_conflict",
      "Stored Wrike workbook evidence failed immutable identity or checksum verification."
    );
  }
  return {
    record: { ...record, storage_status: "Replayed" as const },
    bytes
  };
}

async function loadLocalEvidence(args: LoadSourceEvidenceArgs) {
  const filePath = path.join(
    localEvidenceRoot(),
    boundedIdentifier(args.customer_id, "Customer ID"),
    boundedIdentifier(args.import_method_id, "Import Method ID"),
    `${boundedIdentifier(args.evidence_id, "Evidence ID")}.json`
  );
  try {
    const envelope = JSON.parse(await readFile(filePath, "utf8")) as LocalEvidenceEnvelope;
    return validateLoadedEvidence(envelope.record, Buffer.from(envelope.bytes_base64, "base64"), args);
  } catch (error) {
    if (error instanceof WrikeSourceEvidenceError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WrikeSourceEvidenceError("not_found", "Stored Wrike workbook evidence was not found.");
    }
    throw new WrikeSourceEvidenceError("storage_failed", "Stored Wrike workbook evidence is unreadable.");
  }
}

async function loadS3Evidence(bucket: string, args: LoadSourceEvidenceArgs) {
  const seed = {
    evidence_id: boundedIdentifier(args.evidence_id, "Evidence ID"),
    customer_id: boundedIdentifier(args.customer_id, "Customer ID"),
    import_method_id: boundedIdentifier(args.import_method_id, "Import Method ID"),
    connection_id: boundedIdentifier(args.connection_id, "Source connection ID"),
    account_id: "",
    provider: "wrike" as const,
    document_role: args.document_role,
    task_id: "",
    attachment_id: "",
    version_id: "",
    file_name: "",
    extension: args.extension,
    content_type: "",
    byte_size: 0,
    sha256: "",
    wrike_updated_at: "",
    stored_at: ""
  };
  try {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: s3ObjectKey(seed) })
    );
    if (!result.Body) {
      throw new WrikeSourceEvidenceError("storage_failed", "Stored Wrike workbook evidence has no content.");
    }
    const bytes = new Uint8Array(await result.Body.transformToByteArray());
    const metadata = result.Metadata;
    if (metadata?.evidence_id !== seed.evidence_id) {
      throw new WrikeSourceEvidenceError("identity_conflict", "Stored Wrike evidence identity is invalid.");
    }
    const record = {
      ...seed,
      document_role: metadata?.document_role
        ? decodeMetadata(metadata.document_role, "document role") as WrikeSourceDocumentRole
        : "order_grid",
      account_id: decodeMetadata(metadata?.account_id, "account ID"),
      connection_id: decodeMetadata(metadata?.connection_id, "connection ID"),
      task_id: decodeMetadata(metadata?.task_id, "task ID"),
      attachment_id: decodeMetadata(metadata?.attachment_id, "attachment ID"),
      version_id: decodeMetadata(metadata?.version_id, "version ID"),
      extension: decodeMetadata(metadata?.extension, "extension") as WrikeSourceDocumentExtension,
      file_name: decodeMetadata(metadata?.file_name, "file name"),
      content_type: decodeMetadata(metadata?.content_type, "content type"),
      sha256: metadata?.sha256 ?? "",
      byte_size: Number(result.ContentLength ?? bytes.byteLength),
      wrike_updated_at: decodeMetadata(metadata?.wrike_updated_at, "provider timestamp"),
      stored_at: decodeMetadata(metadata?.stored_at, "storage timestamp")
    };
    return validateLoadedEvidence(record, bytes, args);
  } catch (error) {
    if (error instanceof WrikeSourceEvidenceError) {
      throw error;
    }
    if (
      error instanceof S3ServiceException &&
      (error.$metadata.httpStatusCode === 404 || error.name === "NotFound" || error.name === "NoSuchKey")
    ) {
      throw new WrikeSourceEvidenceError("not_found", "Stored Wrike workbook evidence was not found.");
    }
    throw new WrikeSourceEvidenceError("storage_failed", "Stored Wrike workbook evidence could not be loaded.");
  }
}

export async function loadWrikeWorkbookEvidence(args: LoadEvidenceArgs) {
  const bucket = process.env.PATHFINDER_SOURCE_EVIDENCE_BUCKET?.trim();
  if (process.env.PATHFINDER_STORAGE_DRIVER !== "local" && !bucket) {
    throw new WrikeSourceEvidenceError("storage_failed", "Wrike workbook evidence storage is not configured.");
  }
  const sourceArgs: LoadSourceEvidenceArgs = { ...args, document_role: "order_grid" };
  return bucket ? loadS3Evidence(bucket, sourceArgs) : loadLocalEvidence(sourceArgs);
}

export async function loadWrikeReferenceProofEvidence(args: Omit<LoadEvidenceArgs, "extension">) {
  const bucket = process.env.PATHFINDER_SOURCE_EVIDENCE_BUCKET?.trim();
  if (process.env.PATHFINDER_STORAGE_DRIVER !== "local" && !bucket) {
    throw new WrikeSourceEvidenceError("storage_failed", "Wrike reference-proof evidence storage is not configured.");
  }
  const sourceArgs: LoadSourceEvidenceArgs = {
    ...args,
    document_role: "reference_proof",
    extension: "pdf"
  };
  return bucket ? loadS3Evidence(bucket, sourceArgs) : loadLocalEvidence(sourceArgs);
}
