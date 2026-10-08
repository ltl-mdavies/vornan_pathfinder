import type { OrderRollupProof } from "@pathfinder/order-rollup";
import type { PublicOrderStatusSnapshot } from "./store.js";

export interface StatusProofIdentity {
  orderNumber: string;
  lineNumber: string;
  orderLineId: string;
  filename: string;
  createdTs: string | null;
}

/** Line IDs come from the token-bound snapshot, never from caller input. */
export function boundStatusProofIdentity(
  snapshot: PublicOrderStatusSnapshot | null,
  binding: { order_key: string; job_id: string; order_number: string },
  request: { lineNumber: string; filename: string; createdTs?: string }
): StatusProofIdentity | null {
  if (!snapshot || snapshot.order_key !== binding.order_key || snapshot.order_number !== binding.order_number
    || snapshot.job.job_id !== binding.job_id || snapshot.proof_visibility === "off") return null;
  const lines = snapshot.lines.filter((line) => String(line.line_number) === request.lineNumber);
  if (lines.length !== 1) return null;
  const line = lines[0];
  const orderLineId = String(line.order_line_id ?? "");
  if (!/^\d+$/.test(orderLineId) || Number(orderLineId) <= 0) return null;
  const proofs = line.proofs.filter((proof) => proof.proof_filename === request.filename
    && (!request.createdTs || proof.created_ts === request.createdTs));
  if (proofs.length !== 1) return null;
  return { orderNumber: binding.order_number, lineNumber: request.lineNumber, orderLineId,
    filename: request.filename, createdTs: proofs[0].created_ts ?? null };
}

export function matchingStatusProof<T extends OrderRollupProof & {
  order_number?: string | null; line_number?: string | number | null;
  order_line_id?: string | number | null;
}>(proofs: T[], identity: StatusProofIdentity): T | null {
  const matches = proofs.filter((proof) => proof.order_number === identity.orderNumber
    && String(proof.line_number ?? "") === identity.lineNumber
    && String(proof.order_line_id ?? "") === identity.orderLineId
    && proof.proof_filename === identity.filename
    && (!identity.createdTs || proof.created_ts === identity.createdTs));
  return matches.length === 1 ? matches[0] : null;
}

export function allowedLiftProofAssetUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && url.hostname.endsWith(".s3.amazonaws.com") && /^\/(?:originals|thumbs)\/91\//.test(url.pathname)
      ? url : null;
  } catch { return null; }
}

export class StatusProofBusyError extends Error {}

/** Small, transient, per-runtime cache; no durable signed URLs or whole-order fallback. */
export class StatusProofReportCache<T> {
  private entries = new Map<string, { expires: number; pending: boolean; value: Promise<T> }>();
  private active = 0;
  constructor(private now = Date.now, private maxActive = 4, private maxEntries = 128) {}

  read(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && (entry.pending || entry.expires > this.now())) return entry.value;
    for (const [key, value] of this.entries) {
      if (!value.pending && value.expires <= this.now()) this.entries.delete(key);
    }
    if (this.active >= this.maxActive) return Promise.reject(new StatusProofBusyError());
    if (this.entries.size >= this.maxEntries) {
      const oldest = [...this.entries].find(([, value]) => !value.pending);
      if (oldest) this.entries.delete(oldest[0]);
      else return Promise.reject(new StatusProofBusyError());
    }
    this.active++;
    const next: { expires: number; pending: boolean; value: Promise<T> } = {
      expires: 0, pending: true, value: Promise.resolve(null as T)
    };
    next.value = Promise.resolve().then(loader).then((value) => {
      next.expires = this.now() + 15_000;
      return value;
    }, (error) => {
      // A brief cooldown prevents parallel failures from hammering Lift.
      next.expires = this.now() + 1_000;
      throw error;
    }).finally(() => { next.pending = false; this.active--; });
    this.entries.set(key, next);
    return next.value;
  }
}
