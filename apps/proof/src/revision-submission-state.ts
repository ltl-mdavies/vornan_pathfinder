import type { ProofRevisionSubmission } from "./api";

/** A positive transport receipt is not evidence that Lift imported the file. */
export function revisionSubmissionCopy(receipt: Pick<ProofRevisionSubmission, "state"> | null) {
  if (receipt?.state === "accepted") {
    return {
      title: "Artwork sent",
      detail: "Awaiting updated proof. Your artwork was sent to the production team; the updated proof will appear here when it is ready.",
      tone: "sent" as const
    };
  }
  return {
    title: "Submission not confirmed",
    detail: "We could not confirm the submission. Your file is saved. Check status before taking another action; do not send the artwork again.",
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
