import type { OrderRollupProofSummary } from "@pathfinder/order-rollup";

export type StatusProgressState = "complete" | "current" | "attention" | "pending";

export interface ProofProgressContext {
  proof_files: number;
  proof_phase: boolean;
  production_phase: boolean;
  shipping_phase: boolean;
  completed: boolean;
  has_error: boolean;
}

export function proofReviewProgress(
  summary: OrderRollupProofSummary | null | undefined,
  context: ProofProgressContext
): { label: "Proof review"; detail: string; state: StatusProgressState } {
  if (summary) {
    if (summary.pending > 0) {
      return { label: "Proof review", detail: "Review required in Vornan Proof", state: "current" };
    }
    if (summary.regenerating > 0) {
      return { label: "Proof review", detail: "Revised proof in progress", state: "current" };
    }
    if (summary.waiting > 0) {
      return { label: "Proof review", detail: "Proof files are being prepared", state: "current" };
    }
    if (summary.total > 0 && summary.reviewed === summary.total) {
      return { label: "Proof review", detail: `${summary.reviewed} of ${summary.total} reviewed`, state: "complete" };
    }
    if (summary.health === "missing" || summary.health === "error") {
      return { label: "Proof review", detail: "Proof status needs attention", state: "attention" };
    }
  }

  return {
    label: "Proof review",
    detail: context.proof_files
      ? `${context.proof_files} proof file${context.proof_files === 1 ? "" : "s"}`
      : "Awaiting proof files",
    state: context.proof_files || context.production_phase || context.shipping_phase || context.completed
      ? "complete"
      : context.proof_phase
        ? "current"
        : context.has_error
          ? "attention"
          : "pending"
  };
}
