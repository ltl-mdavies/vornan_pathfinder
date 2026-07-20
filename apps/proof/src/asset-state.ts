import type { ProofVersion } from "./types";

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

export function proofAsset(version: ProofVersion | null, origin?: string | null) {
  const download = safeProofAssetUrl(version?.download_url, origin ?? (typeof window === "undefined" ? null : window.location.origin));
  const candidatePreview = safeProofAssetUrl(version?.preview_url, origin ?? (typeof window === "undefined" ? null : window.location.origin));
  const kind = version?.preview_kind ?? "unavailable";
  const preview = kind === "image" || kind === "pdf" ? candidatePreview ?? download : null;
  return {
    preview,
    download: download ?? candidatePreview,
    open: download ?? candidatePreview,
    kind
  };
}
