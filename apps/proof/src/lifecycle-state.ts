import type { ProofOrder, ProofState } from "./types";

export function isOpenProofState(state: ProofState) {
  return state === "pending" || state === "waiting" || state === "revised";
}

export function isReviewedProofState(state: ProofState) {
  return state === "approved" || state === "reference";
}

export function proofTaskCounts(tasks: ProofOrder["tasks"]): ProofOrder["counts"] {
  return {
    pending: tasks.filter((task) => task.state === "pending").length,
    regenerating: tasks.filter((task) => task.state === "revised").length,
    waiting: tasks.filter((task) => task.state === "waiting").length,
    reviewed: tasks.filter((task) => isReviewedProofState(task.state)).length,
    total: tasks.length
  };
}

export function proofStatePresentation(state: ProofState) {
  switch (state) {
    case "waiting":
      return { label: "Waiting", detail: "Vornan is preparing this proof. No review file is available yet." };
    case "revised":
      return { label: "Regenerating", detail: "A revised proof is being prepared. This version remains available for reference." };
    case "reference":
      return { label: "Reference", detail: "This proof is retained as a read-only production reference." };
    case "cancelled":
      return { label: "Cancelled", detail: "This proof task was cancelled and remains read-only." };
    case "missing":
      return { label: "Unavailable", detail: "The latest proof file is temporarily unavailable." };
    case "error":
      return { label: "File unavailable", detail: "The proof file could not be refreshed. Previously synchronized details remain visible." };
    case "approved":
      return { label: "Approved", detail: null };
    default:
      return { label: "Pending", detail: null };
  }
}

export function proofOrderHealthMessage(health: ProofOrder["health"]) {
  switch (health) {
    case "stale":
      return "Showing the last synchronized proof packet while Vornan retrieves the latest details.";
    case "missing":
      return "This order is temporarily unavailable in Lift. Previously synchronized proof files remain visible for reference.";
    case "error":
      return "Some proof details could not be refreshed. Available files remain visible while Vornan investigates.";
    default:
      return null;
  }
}

export function proofOrderCompletion(order: ProofOrder) {
  if (order.health !== "active" && order.health !== "complete") return null;
  const reviewed = order.tasks.filter((task) => isReviewedProofState(task.state));
  const blocking = order.tasks.some((task) =>
    isOpenProofState(task.state) || task.state === "missing" || task.state === "error"
  );
  if (!reviewed.length || blocking) return null;

  return order.health === "complete" || reviewed.every((task) => task.state === "reference")
    ? {
        title: "Proof packet complete",
        detail: "This order’s proof review is complete. Approved and reference files remain available in Reviewed."
      }
    : {
        title: "All proofs reviewed",
        detail: "There are no proofs awaiting review. Approved files remain available in Reviewed."
      };
}
