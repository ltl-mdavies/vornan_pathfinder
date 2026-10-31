import type { OrderRollupLine, OrderRollupSnapshot } from "@pathfinder/order-rollup";

export function pendingProofControlsEnabled(snapshot: OrderRollupSnapshot): boolean {
  return snapshot.proofing_enabled === true && snapshot.proof_visibility !== "off"
    && snapshot.lifecycle?.state !== "cancelled"
    && !(Number(snapshot.order_status?.step?.step_number) >= 18);
}

/** One shared predicate for amber chips and the line-count/filter, not creative counts. */
export function isPendingProofLine(line: OrderRollupLine): boolean {
  const step = Number(line.step?.step_number);
  return !line.cancelled && (step === 7.01 || step === 7.02);
}
