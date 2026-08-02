import { sha256 } from "@noble/hashes/sha256";

const CONTENT_TYPES = Object.freeze({
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  psd: "image/vnd.adobe.photoshop",
  ai: "application/postscript",
  eps: "application/postscript"
} satisfies Record<string, string>);

export function sanitizeProofUploadFilename(value: string) {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._() -]+/g, "_")
    .replace(/^\.+$/, "_")
    .slice(0, 240);
  if (!normalized || !/^[A-Za-z0-9]/.test(normalized)) {
    throw new Error("Choose a revised-art file with a usable filename.");
  }
  return normalized;
}

export function proofUploadContentType(file: Pick<File, "name" | "type">) {
  const declared = file.type.trim().toLowerCase();
  if (declared) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension as keyof typeof CONTENT_TYPES] ?? "";
}

export function assertPrivateProofUploadDestination(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The revised-art upload destination is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.-]+\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname)
  ) {
    throw new Error("The revised-art upload destination is outside private S3 storage.");
  }
  return url.toString();
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function sha256ProofUpload(
  file: Blob,
  onProgress?: (completedBytes: number) => void
) {
  const digest = sha256.create();
  const reader = file.stream().getReader();
  let completed = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      digest.update(chunk.value);
      completed += chunk.value.byteLength;
      onProgress?.(completed);
    }
    return hex(digest.digest());
  } finally {
    reader.releaseLock();
  }
}

export function buildProofUploadForm(
  fields: Record<string, string>,
  file: Blob,
  filename: string
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", file, sanitizeProofUploadFilename(filename));
  return form;
}
