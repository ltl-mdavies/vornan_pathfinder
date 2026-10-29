import type { ProofRevisionSubmission } from "./api";

export interface RevisionIntent {
  task_id: string;
  attachment_id: string;
  version_id: string;
  asset_id: string;
  filename: string;
  proof_filename?: string | null;
  line_number: string | null;
  idempotency_key: string;
}

export function revisionIntentKey(orderNumber: string, participantId: string) {
  // Participant IDs are unique to the grant. No token, file bytes or delivery URL.
  return `proof:revision-intents:v1:${encodeURIComponent(orderNumber)}:${encodeURIComponent(participantId)}`;
}

export function readRevisionIntents(storage: Pick<Storage, "getItem">, key: string): RevisionIntent[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 100 || !values.every((v) => v &&
    ["task_id", "attachment_id", "version_id", "asset_id", "filename", "idempotency_key"].every((field) => typeof v[field] === "string" && v[field].length > 0 && v[field].length <= 1024) &&
    (v.line_number === null || typeof v.line_number === "string") &&
    (v.proof_filename == null || typeof v.proof_filename === "string"))) throw new Error("Saved artwork status could not be read.");
  return values as RevisionIntent[];
}

export function matchesRevisionIntent(receipt: ProofRevisionSubmission, intent: RevisionIntent) {
  return receipt.asset_id === intent.asset_id && receipt.task_id === intent.task_id &&
    receipt.attachment_id === intent.attachment_id && receipt.version_id === intent.version_id;
}

/** Persist before network I/O; a failed save must prevent the external action. */
export function saveRevisionIntent(storage: Pick<Storage, "setItem">, key: string, intents: RevisionIntent[], next: RevisionIntent) {
  if (intents.some((intent) => revisionProtectsProof(intent, next.attachment_id, next.version_id))) throw new Error("This proof already has a saved artwork submission.");
  const updated = [...intents, next];
  if (updated.length > 100) throw new Error("Saved artwork status needs review before another submission.");
  storage.setItem(key, JSON.stringify(updated));
  return updated;
}

/** A positive transport receipt is not evidence that Lift imported the file. */
export function revisionSubmissionCopy(receipt: Pick<ProofRevisionSubmission, "state"> | null) {
  if (receipt?.state === "accepted") {
    return {
      title: "Artwork sent",
      detail: "Your artwork was sent to the production team. Check the proof queue for any updated proof.",
      tone: "sent" as const
    };
  }
  return {
    title: "Submission not confirmed",
    detail: "We could not confirm this artwork submission. Your file is saved. Check its status here; do not submit this file again for the original proof. You can continue reviewing other proofs.",
    tone: "uncertain" as const
  };
}

/** Only the original attachment/version is locked; a new proof is a new review. */
export function revisionProtectsProof(
  receipt: Pick<ProofRevisionSubmission, "attachment_id" | "version_id">,
  attachmentId: string | null,
  versionId: string | null
) {
  return receipt.attachment_id === attachmentId && receipt.version_id === versionId;
}
