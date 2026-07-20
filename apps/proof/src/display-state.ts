import type { ProofOrder } from "./types";

export function proofOrderDisplayTitle(order: Pick<ProofOrder, "order_number" | "order_title">) {
  return order.order_title?.trim() || `Order ${order.order_number}`;
}

export function proofOrderDisplayStatus(orderStatus: ProofOrder["order_status"]) {
  return orderStatus?.trim() || "Proof review";
}
