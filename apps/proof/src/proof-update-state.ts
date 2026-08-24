import { ProofApiError } from "./api";
import type { ProofOrder, ProofTask } from "./types";

export const PROOF_UPDATED_MESSAGE = "This proof was updated in Lift. The latest file is now ready for review.";

export function isLiftProofUpdatedError(error: unknown) {
  return error instanceof ProofApiError &&
    error.status === 409 &&
    /selected proof (?:is no longer current and actionable|is not the current actionable)/i.test(error.message);
}

export function replacementProofTaskId(order: ProofOrder, previous: ProofTask) {
  const sameLine = order.tasks.filter((task) => task.line_number === previous.line_number);
  return sameLine.find((task) => task.state === "pending" && task.current_version)?.task_id
    ?? sameLine.find((task) => task.current_version)?.task_id
    ?? sameLine[0]?.task_id
    ?? order.tasks[0]?.task_id
    ?? null;
}
