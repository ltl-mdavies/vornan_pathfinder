import type { PathfinderCustomerWorkspace, PublicOrderStatusSnapshot } from "./store.js";

/** Presentation only. Never grants Proof viewing or decision access. Unknown fails closed. */
export function statusProofingEnabled(snapshot: Pick<PublicOrderStatusSnapshot, "order_number" | "live_order">,
  workspace: PathfinderCustomerWorkspace | undefined, boundCustomerId: string | undefined): boolean {
  if (!workspace || !boundCustomerId || workspace.customer.lift_customer_id !== boundCustomerId) return false;
  const policy = workspace.proof_capability_policy;
  const identity = policy?.customer_identity;
  if (!identity || !Number.isFinite(Date.parse(identity.verified_at))
    || !/^A\d{7,8}$/.test(identity.verified_order_number)
    || !snapshot.live_order?.customer_id
    || snapshot.live_order.order_number !== snapshot.order_number
    || String(snapshot.live_order.customer_id) !== identity.proof_customer_id) return false;
  const override = policy.order_overrides.find(item => item.order_number === snapshot.order_number);
  const mode = override?.access_mode ?? policy.access_mode;
  return (mode === "view_only" || mode === "review")
    && Number.isFinite(Date.parse(override?.updated_at ?? policy.updated_at));
}
