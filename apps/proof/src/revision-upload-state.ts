import type { ProofRevisionAsset } from "./api";

export const REVISION_UPLOAD_CONTENT_TYPES = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/vnd.adobe.photoshop",
  "application/postscript"
]);

export const REVISION_UPLOAD_MAXIMUM_BYTES = 1024 * 1024 * 1024;

export function revisionContentType(file: Pick<File, "name" | "type">) {
  if (REVISION_UPLOAD_CONTENT_TYPES.includes(file.type)) return file.type;
  const extension = file.name.trim().toLowerCase().split(".").at(-1);
  return ({
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    tif: "image/tiff",
    tiff: "image/tiff",
    psd: "image/vnd.adobe.photoshop",
    ai: "application/postscript",
    eps: "application/postscript",
    ps: "application/postscript"
  } as Record<string, string>)[extension ?? ""] ?? null;
}

export function validateRevisionFile(file: Pick<File, "name" | "size" | "type">) {
  if (!file.name.trim()) return "Choose a file with a valid name.";
  if (!Number.isInteger(file.size) || file.size < 1) return "Choose a non-empty file.";
  if (file.size > REVISION_UPLOAD_MAXIMUM_BYTES) return "The selected file is larger than 1 GB.";
  if (!revisionContentType(file)) {
    return "Choose a PDF, JPEG, PNG, TIFF, Photoshop, or PostScript file.";
  }
  return null;
}

export async function sha256File(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function revisionAssetProgress(asset: ProofRevisionAsset) {
  if (asset.verification_status === "quarantined") {
    return {
      tone: "error" as const,
      title: "This file needs attention",
      detail: "Contact Vornan before continuing with this artwork."
    };
  }
  if (asset.state === "ready_for_lift" && asset.publication_status === "delivery_verified") {
    return {
      tone: "ready" as const,
      title: "Revised artwork is ready",
      detail: "Your file passed its checks and is ready for the next step."
    };
  }
  if (asset.publication_status === "published") {
    return {
      tone: "working" as const,
      title: "Preparing your file",
      detail: "The revised artwork is being prepared for the production team."
    };
  }
  if (asset.verification_status === "cleared") {
    return {
      tone: "stored" as const,
      title: "File check complete",
      detail: "Your revised artwork passed the required checks."
    };
  }
  if (asset.state === "verifying" || asset.state === "scan_pending") {
    return {
      tone: "working" as const,
      title: "Checking your file",
      detail: "We’re reviewing the revised artwork now."
    };
  }
  return {
    tone: "working" as const,
    title: "Upload received",
    detail: "Your revised artwork is waiting for its file checks."
  };
}
