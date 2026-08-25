import type { ProofVersion } from "./types";

type ProofAssetKind = ProofVersion["preview_kind"];

export function safeProofAssetUrl(value: string | null | undefined, origin = typeof window === "undefined" ? null : window.location.origin) {
  if (!value) return null;
  try {
    if (value.startsWith("//")) return null;
    const relative = value.startsWith("/") && !value.startsWith("//");
    if (relative && !origin) return null;
    const url = new URL(value, origin ?? undefined);
    if (relative) return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function stableProofAssetUrlIdentity(
  value: string | null | undefined,
  origin = typeof window === "undefined" ? null : window.location.origin
) {
  const safe = safeProofAssetUrl(value, origin);
  if (!safe) return null;
  try {
    const url = new URL(safe, origin ?? undefined);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("x-amz-")) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return safe;
  }
}

function proofAssetKindForUrl(value: string | null, fallback: ProofAssetKind, origin: string | null): ProofAssetKind {
  if (!value) return fallback;
  try {
    const pathname = new URL(value, origin ?? undefined).pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) return "pdf";
    if (/\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/.test(pathname)) return "image";
  } catch {
    return fallback;
  }
  return fallback;
}

export function proofAsset(version: ProofVersion | null, origin?: string | null) {
  const resolvedOrigin = origin ?? (typeof window === "undefined" ? null : window.location.origin);
  const download = safeProofAssetUrl(version?.download_url, resolvedOrigin);
  const candidatePreview = safeProofAssetUrl(version?.preview_url, resolvedOrigin);
  const kind = version?.preview_kind ?? "unavailable";
  const preview = kind === "image" || kind === "pdf" ? candidatePreview ?? download : null;
  const display = download ?? preview;
  const contentKind: ProofAssetKind = kind === "download"
    ? "download"
    : version?.content_type === "application/pdf"
    ? "pdf"
    : version?.content_type?.startsWith("image/")
      ? "image"
      : kind;
  return {
    preview,
    download: download ?? candidatePreview,
    open: download ?? candidatePreview,
    display,
    kind,
    display_kind: kind === "download" ? "download" : proofAssetKindForUrl(display, contentKind, resolvedOrigin)
  };
}
