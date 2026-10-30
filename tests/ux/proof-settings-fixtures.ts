import type { CustomerProofCapabilityPolicy as Policy } from "../../apps/web/src/ProofCustomerCapabilitySetup";

// Synthetic-only HTTP adapter: no transport, credentials, persistence or provider imports.
export function createProofSettingsReview(workspaces: Record<string, { proof_capability_policy: Policy; proof_access_revoked_count?: number }>, query: URLSearchParams) {
  let writes = 0, reads = 0, sequence = 0;
  let release: (() => void) | null = null;
  const mode = query.get("proofSettings");
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  for (const [customerId, workspace] of Object.entries(workspaces)) workspace.proof_capability_policy = {
    access_mode: "view_only", review_experience: "simple", order_overrides: [], updated_at: "2026-10-30T10:00:00Z", updated_by: "synthetic",
    customer_identity: { proof_customer_id: customerId, verified_order_number: "A0232139", verified_at: "2026-10-30T10:00:00Z", verified_by: "synthetic" }
  };
  return {
    counts: () => ({ writes, reads }),
    release() { release?.(); release = null; },
    async handle(path: string, method: string, body?: Record<string, string>) {
      const match = path.match(/^\/api\/customers\/([^/]+)\/(workspace|proof-capability-policy)(.*)$/);
      if (!match || !workspaces[match[1]]) return null;
      const workspace = workspaces[match[1]];
      if (method === "GET" && match[2] === "workspace") { reads++; return reply(workspace); }
      if (match[2] !== "proof-capability-policy" || method === "GET") return null;
      writes++;
      if (mode === "pending") await new Promise<void>(resolve => { release = resolve; });
      if (mode === "failed") return reply({ error: "Synthetic validation failure. Your entries are kept." }, 400);
      if (body?.expected_policy_updated_at !== workspace.proof_capability_policy.updated_at) return reply({ error: "Settings changed. Check saved settings before saving." }, 409);
      if (mode !== "unconfirmed") {
        const policy = structuredClone(workspace.proof_capability_policy);
        policy.updated_at = new Date(Date.UTC(2026, 9, 30, 10, 1, ++sequence)).toISOString();
        if (match[3] === "/identity") policy.customer_identity = { ...policy.customer_identity!, verified_order_number: body!.order_number };
        else if (match[3].startsWith("/orders/")) {
          const order = decodeURIComponent(match[3].slice("/orders/".length));
          policy.order_overrides = policy.order_overrides.filter(item => item.order_number !== order);
          if (method === "PUT") policy.order_overrides.push({ order_number: order, access_mode: body!.access_mode as Policy["access_mode"], review_experience: body!.review_experience as Policy["review_experience"], updated_at: policy.updated_at, updated_by: "synthetic" });
        } else { policy.access_mode = body!.access_mode as Policy["access_mode"]; policy.review_experience = body!.review_experience as Policy["review_experience"]; }
        workspace.proof_capability_policy = policy; workspace.proof_access_revoked_count = 2;
      }
      return ["unconfirmed", "lost-response"].includes(mode ?? "") ? reply({ error: "Synthetic interrupted response" }, 503) : reply(workspace);
    }
  };
}
