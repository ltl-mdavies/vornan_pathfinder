import { createHash } from "node:crypto";
import { getOrderStatusToken, getWorkspace, resolveCustomerProofCapabilityForCustomerOrder } from "../store.js";
import { getProofOrder } from "./store.js";
import { createProofGrant, ProofAccessDeniedError } from "./access-service.js";

/** Explicit click only. Never called while polling/rendering Status. No client-selected scope. */
export async function createStatusProofView(rawToken: unknown, orderNumber: unknown, now = new Date()) {
  if (process.env.PATHFINDER_PROOF_STATUS_HANDOFF_LTL_DEMO !== "true"
    || typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)
    || typeof orderNumber !== "string" || !/^A\d{7,8}$/.test(orderNumber)) throw new ProofAccessDeniedError();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const parent = await getOrderStatusToken(tokenHash);
  if (!parent || parent.status !== "Active" || !Number.isFinite(Date.parse(parent.expires_at))
    || Date.parse(parent.expires_at) <= now.getTime()) throw new ProofAccessDeniedError();
  const binding = (parent.orders?.length ? parent.orders : [parent]).find(item => item.order_number === orderNumber && item.customer_id === "1249");
  if (!binding) throw new ProofAccessDeniedError();
  const [workspace, order, capability] = await Promise.all([
    getWorkspace("1249"), getProofOrder(orderNumber), resolveCustomerProofCapabilityForCustomerOrder("1249",orderNumber)
  ]);
  if (workspace?.status_access_policy.proof_visibility !== "review_link" || order?.customer_id !== "1249"
    || order.health !== "active" || !order.tasks.some(task => task.state === "pending")
    || capability.association_status !== "associated" || capability.pathfinder_customer_id !== "1249"
    || capability.proof_customer_id !== "1249" || capability.source === "safe_default"
    || capability.access_mode === "disabled" || !capability.identity_verified_at || !capability.policy_updated_at) throw new ProofAccessDeniedError();
  const created = await createProofGrant({ order_number: orderNumber, scope: "view", label: "Status view-only access",
    expires_at: new Date(Math.min(Date.parse(parent.expires_at),now.getTime()+15*60*1000)).toISOString(), now,
    status_origin: {token_hash:tokenHash,order_key:binding.order_key,customer_id:"1249"},
    capability: {pathfinder_customer_id:"1249",proof_customer_id:"1249",identity_verified_at:capability.identity_verified_at,
      access_mode:capability.access_mode,review_experience:capability.review_experience,source:capability.source,
      policy_updated_at:capability.policy_updated_at}
  });
  const destination = new URL(created.access_url);
  destination.searchParams.set("statusView", "1");
  destination.searchParams.set("statusOrder", orderNumber);
  return {access_url:destination.toString(),expires_at:created.grant.expires_at,scope:"view" as const};
}
