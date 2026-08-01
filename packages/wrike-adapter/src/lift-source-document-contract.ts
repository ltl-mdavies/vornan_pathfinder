export type WrikeLiftSourceDocumentRole = "order_grid" | "reference_proof";

export interface WrikeLiftSourceEvidenceBinding {
  evidence_id: string;
  document_role: WrikeLiftSourceDocumentRole;
  task_id: string;
  attachment_id: string;
  version_id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  sha256: string;
}

export interface WrikeLiftDocumentPublication {
  publication_id: string;
  evidence_id: string;
  document_role: WrikeLiftSourceDocumentRole;
  source_sha256: string;
  object_version_id: string;
  direct_url: string;
  published_byte_size: number;
  published_at: string;
  expires_at: string;
  preflight: {
    http_status: 200;
    redirect_count: 0;
    content_length: number;
    checked_at: string;
  };
}

export interface WrikeLiftOrderDocumentPatch {
  order_attachment: string;
  artwork_folder_url: string | null;
  reference_proof_url: string | null;
  publications: Array<{
    publication_id: string;
    evidence_id: string;
    document_role: WrikeLiftSourceDocumentRole;
    sha256: string;
  }>;
}

export class WrikeLiftDocumentContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrikeLiftDocumentContractError";
  }
}

function identifier(value: string, label: string) {
  const clean = value.trim();
  if (!/^[A-Za-z0-9_:.=-]{1,256}$/.test(clean)) {
    throw new WrikeLiftDocumentContractError(`${label} is invalid.`);
  }
  return clean;
}

function sha256(value: string, label: string) {
  const clean = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clean)) {
    throw new WrikeLiftDocumentContractError(`${label} is invalid.`);
  }
  return clean;
}

function objectVersionId(value: string) {
  const clean = value.trim();
  if (!/^[A-Za-z0-9.+/=_-]{1,1024}$/.test(clean)) {
    throw new WrikeLiftDocumentContractError("Published object version ID is invalid.");
  }
  return clean;
}

export function sanitizeWrikeLiftDeliveryFileName(value: string) {
  const original = value.normalize("NFKC").trim();
  let clean = original
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "_")
    .replace(/\.+$/, "_");
  if (!clean || clean === "." || clean === "..") {
    clean = "document";
  }
  if (clean.length > 180) {
    const extension = clean.match(/\.[A-Za-z0-9]{1,16}$/)?.[0] ?? "";
    clean = `${clean.slice(0, 180 - extension.length)}${extension}`;
  }
  return clean;
}

function directDeliveryUrl(value: string, expectedFileName: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "go.vornan.co" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/d\/[A-Za-z0-9_-]{16,160}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,179}$/.test(url.pathname) ||
      url.pathname.split("/").at(-1) !== expectedFileName
    ) {
      throw new Error("unsafe");
    }
    return url.toString();
  } catch {
    throw new WrikeLiftDocumentContractError(
      "Lift document delivery must use an opaque direct HTTPS go.vornan.co URL without redirects or query credentials."
    );
  }
}

function validateEvidence(evidence: WrikeLiftSourceEvidenceBinding) {
  identifier(evidence.evidence_id, "Evidence ID");
  identifier(evidence.task_id, "Wrike task ID");
  identifier(evidence.attachment_id, "Wrike attachment ID");
  identifier(evidence.version_id, "Wrike attachment version ID");
  if (
    !evidence.file_name.trim() ||
    evidence.file_name.length > 512 ||
    evidence.file_name.includes("/") ||
    evidence.file_name.includes("\\") ||
    !Number.isSafeInteger(evidence.byte_size) ||
    evidence.byte_size < 1
  ) {
    throw new WrikeLiftDocumentContractError("Source evidence metadata is invalid.");
  }
  sha256(evidence.sha256, "Source evidence digest");
}

function validatePublication(
  evidence: WrikeLiftSourceEvidenceBinding,
  publication: WrikeLiftDocumentPublication
) {
  validateEvidence(evidence);
  identifier(publication.publication_id, "Publication ID");
  objectVersionId(publication.object_version_id);
  if (
    publication.evidence_id !== evidence.evidence_id ||
    publication.document_role !== evidence.document_role ||
    sha256(publication.source_sha256, "Publication source digest") !== sha256(evidence.sha256, "Evidence digest")
  ) {
    throw new WrikeLiftDocumentContractError("Publication does not match its immutable Wrike source evidence.");
  }
  const directUrl = directDeliveryUrl(
    publication.direct_url,
    sanitizeWrikeLiftDeliveryFileName(evidence.file_name)
  );
  const checkedAt = new Date(publication.preflight.checked_at);
  const publishedAt = new Date(publication.published_at);
  const expiresAt = new Date(publication.expires_at);
  if (
    publication.preflight.http_status !== 200 ||
    publication.preflight.redirect_count !== 0 ||
    !Number.isFinite(checkedAt.getTime()) ||
    !Number.isFinite(publishedAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime()) ||
    checkedAt.getTime() + 1_000 < publishedAt.getTime() ||
    expiresAt.getTime() <= checkedAt.getTime() ||
    publication.published_byte_size !== evidence.byte_size ||
    publication.preflight.content_length !== evidence.byte_size
  ) {
    throw new WrikeLiftDocumentContractError(
      "Published Wrike document has not passed the exact direct-200 filename and byte-length preflight."
    );
  }
  return directUrl;
}

function artworkFolderUrl(value: string | null) {
  if (value === null) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("unsafe");
    }
    return url.toString();
  } catch {
    throw new WrikeLiftDocumentContractError("Artwork Folder URL must be a safe HTTPS URL.");
  }
}

export function prepareWrikeLiftOrderDocumentPatch(args: {
  task_id: string;
  order_grid: WrikeLiftSourceEvidenceBinding;
  order_grid_publication: WrikeLiftDocumentPublication;
  reference_proof?: WrikeLiftSourceEvidenceBinding | null;
  reference_proof_publication?: WrikeLiftDocumentPublication | null;
  artwork_folder_url: string | null;
}): WrikeLiftOrderDocumentPatch {
  const taskId = identifier(args.task_id, "Wrike task ID");
  if (args.order_grid.document_role !== "order_grid" || args.order_grid.task_id !== taskId) {
    throw new WrikeLiftDocumentContractError("Order-grid evidence is not bound to the qualified Wrike task.");
  }
  const orderAttachment = validatePublication(args.order_grid, args.order_grid_publication);
  const hasReferenceEvidence = Boolean(args.reference_proof);
  const hasReferencePublication = Boolean(args.reference_proof_publication);
  if (hasReferenceEvidence !== hasReferencePublication) {
    throw new WrikeLiftDocumentContractError("Reference-proof evidence and publication must be supplied together.");
  }
  let referenceProofUrl: string | null = null;
  const publications: WrikeLiftOrderDocumentPatch["publications"] = [{
    publication_id: args.order_grid_publication.publication_id,
    evidence_id: args.order_grid.evidence_id,
    document_role: "order_grid" as const,
    sha256: args.order_grid.sha256
  }];
  if (args.reference_proof && args.reference_proof_publication) {
    if (args.reference_proof.document_role !== "reference_proof" || args.reference_proof.task_id !== taskId) {
      throw new WrikeLiftDocumentContractError("Reference-proof evidence is not bound to the qualified Wrike task.");
    }
    referenceProofUrl = validatePublication(args.reference_proof, args.reference_proof_publication);
    publications.push({
      publication_id: args.reference_proof_publication.publication_id,
      evidence_id: args.reference_proof.evidence_id,
      document_role: "reference_proof",
      sha256: args.reference_proof.sha256
    });
  }
  return {
    order_attachment: orderAttachment,
    artwork_folder_url: artworkFolderUrl(args.artwork_folder_url),
    reference_proof_url: referenceProofUrl,
    publications
  };
}
