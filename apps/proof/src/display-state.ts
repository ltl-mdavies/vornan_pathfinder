import type { ProofOrder, ProofVersion } from "./types";

/** Lift can return approval timestamps on pending rows; status is authoritative. */
export function proofApprovalTimestamp(version: Pick<ProofVersion, "approval_status" | "proof_approved_ts" | "approved_at">) {
  return version.approval_status?.trim().toUpperCase() === "APPROVED"
    ? version.proof_approved_ts ?? version.approved_at
    : null;
}

export function proofOrderDisplayTitle(order: Pick<ProofOrder, "order_number" | "order_title">) {
  return order.order_title?.trim() || `Order ${order.order_number}`;
}

export function proofOrderDisplayStatus(orderStatus: ProofOrder["order_status"]) {
  return orderStatus?.trim() || "Proof review";
}
