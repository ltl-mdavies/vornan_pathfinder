export const DEFAULT_PUBLIC_STATUS_POLL_MS = 60_000;
export const MAX_PUBLIC_STATUS_BACKOFF_MS = 300_000;

export function publicStatusPollDelay(
  seconds: unknown,
  options: {
    degradedAttempts?: number;
    jitterRatio?: number;
    random?: () => number;
  } = {}
) {
  const parsed = typeof seconds === "number" ? seconds : Number(seconds);
  const base = Number.isFinite(parsed)
    ? Math.min(60_000, Math.max(15_000, Math.round(parsed * 1_000)))
    : DEFAULT_PUBLIC_STATUS_POLL_MS;
  const degradedAttempts = Math.max(0, Math.min(4, Math.floor(options.degradedAttempts ?? 0)));
  const backedOff = Math.min(MAX_PUBLIC_STATUS_BACKOFF_MS, base * (2 ** degradedAttempts));
  const jitterRatio = Math.max(0, Math.min(0.2, options.jitterRatio ?? 0.1));
  const random = options.random ?? Math.random;
  const jitter = backedOff * ((random() * 2) - 1) * jitterRatio;
  return Math.min(MAX_PUBLIC_STATUS_BACKOFF_MS, Math.max(15_000, Math.round(backedOff + jitter)));
}

export function publicStatusOpenErrorMessage(httpStatus: number) {
  if (httpStatus === 410) return "This private status link has expired. Request a new secure link to continue.";
  if (httpStatus === 404) return "This private status link is unavailable. Request a new secure link to continue.";
  return "This status link could not be opened right now. Please try again shortly.";
}

export function shouldPollPublicStatus(visibilityState: DocumentVisibilityState) {
  return visibilityState === "visible";
}

export interface TransientProofAsset {
  proof_filename?: string | null;
  creation_date?: string | null;
  proof_link_low?: string | null;
  proof_link_high?: string | null;
  preview_kind?: "image" | "pdf" | "download" | "unavailable";
}

export interface TransientProofLine {
  line_number: number;
  proofs: TransientProofAsset[];
}

export interface TransientProofSnapshot {
  order_key: string;
  order_number?: string;
  lines: TransientProofLine[];
}

function highResolutionAssetKind(value: string) {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) return "pdf";
    if (/\.(?:avif|gif|jpe?g|png|webp)$/.test(pathname)) return "image";
  } catch {
    // The server will still validate and resolve the token-bound asset.
  }
  const path = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".pdf")) return "pdf";
  if (/\.(?:avif|gif|jpe?g|png|webp)$/.test(path)) return "image";
  return "document";
}

function tokenBoundProofAssetUrl(args: {
  base: string;
  token: string;
  orderNumber: string;
  lineNumber: number;
  filename: string;
  assetKind: "thumbnail" | "pdf" | "image" | "document";
}) {
  return `${args.base}/public/status/${encodeURIComponent(args.token)}/proof-asset?${new URLSearchParams({
    order_number: args.orderNumber,
    line_number: String(args.lineNumber),
    filename: args.filename,
    asset_kind: args.assetKind
  }).toString()}`;
}

export function proxyHighResolutionProofAssets<T extends TransientProofSnapshot>(
  snapshots: T[],
  apiBaseUrl: string,
  token: string
) {
  const base = apiBaseUrl.replace(/\/$/, "");
  return snapshots.map((snapshot) => ({
    ...snapshot,
    lines: snapshot.lines.map((line) => ({
      ...line,
      proofs: line.proofs.map((proof) => {
        const filename = proof.proof_filename?.trim();
        if (!filename || !snapshot.order_number) return proof;
        const synthesizedThumbnail = !proof.proof_link_low;
        return {
          ...proof,
          proof_link_low: proof.proof_link_low ?? tokenBoundProofAssetUrl({
            base,
            token,
            orderNumber: snapshot.order_number,
            lineNumber: line.line_number,
            filename,
            assetKind: "thumbnail"
          }),
          proof_link_high: tokenBoundProofAssetUrl({
            base,
            token,
            orderNumber: snapshot.order_number,
            lineNumber: line.line_number,
            filename,
            assetKind: highResolutionAssetKind(proof.proof_link_high ?? filename)
          }),
          preview_kind: synthesizedThumbnail ? "image" as const : proof.preview_kind
        };
      })
    }))
  }));
}

function proofKey(proof: TransientProofAsset) {
  return `${proof.proof_filename ?? ""}\u0000${proof.creation_date ?? ""}`;
}

/**
 * A partial Lift refresh may update order or shipping data while retaining the
 * most recently delivered, still-short-lived proof links in browser memory.
 * Links are never written back to the durable status snapshot by this helper.
 */
export function retainTransientProofAssets<T extends TransientProofSnapshot>(
  previous: T[] | undefined,
  incoming: T[]
) {
  if (!previous?.length) return incoming;
  const previousSnapshots = new Map(previous.map((snapshot) => [snapshot.order_key, snapshot]));

  return incoming.map((snapshot) => {
    const prior = previousSnapshots.get(snapshot.order_key);
    if (!prior) return snapshot;
    const priorLines = new Map(prior.lines.map((line) => [line.line_number, line]));
    return {
      ...snapshot,
      lines: snapshot.lines.map((line) => {
        const priorProofs = new Map((priorLines.get(line.line_number)?.proofs ?? []).map((proof) => [proofKey(proof), proof]));
        return {
          ...line,
          proofs: line.proofs.map((proof) => {
            if (proof.proof_link_low || proof.proof_link_high) return proof;
            const priorProof = priorProofs.get(proofKey(proof));
            if (!priorProof?.proof_link_low && !priorProof?.proof_link_high) return proof;
            return {
              ...proof,
              proof_link_low: priorProof.proof_link_low ?? null,
              proof_link_high: priorProof.proof_link_high ?? null,
              preview_kind: priorProof.preview_kind
            };
          })
        };
      })
    };
  });
}
