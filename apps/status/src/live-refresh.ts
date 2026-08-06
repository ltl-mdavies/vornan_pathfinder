export const DEFAULT_PUBLIC_STATUS_POLL_MS = 30_000;

export function publicStatusPollDelay(seconds: unknown) {
  const parsed = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PUBLIC_STATUS_POLL_MS;
  }
  return Math.min(60_000, Math.max(15_000, Math.round(parsed * 1_000)));
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
  lines: TransientProofLine[];
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
