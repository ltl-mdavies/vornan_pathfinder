import type { PathfinderCustomerWorkspace, ProcessingJobPreview, SubmitAttempt } from "../../apps/api/src/store";
import { toJobListItem } from "../../apps/api/src/job-list";

// Test-only contract simulator, never imported by the production entry point.
// It does not call a transport, reserve a real attempt, or run reconciliation.
export type SubmissionSeed = { jobs: ProcessingJobPreview[]; workspaces: Record<string, PathfinderCustomerWorkspace> };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Outcome = "ready" | "uncertain" | "confirmed";
const clone = <T,>(value: T): T => structuredClone(value);
const stamp = "2026-10-24T14:00:00.000Z";
const fingerprint = "a".repeat(64);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function createSubmissionReview(seed: SubmissionSeed, query: URLSearchParams, storage?: Storage) {
  const scenario = query.get("submissionReview") || "ready";
  const storageKey = `pathfinder-ux-submit-v1:${scenario}:${(query.get("reviewCase") || "default").replace(/[^\w-]/g, "_")}`;
  let outcome: Outcome = scenario === "uncertain" || scenario === "confirmed" ? scenario : "ready";
  const saved = storage?.getItem(storageKey);
  if (saved === "ready" || saved === "uncertain" || saved === "confirmed") outcome = saved;
  const source = clone(seed.jobs[0]);
  if (!source) throw new Error("Submission review requires a synthetic seed job.");
  const secondary = query.has("submissionSlow") && seed.jobs[1] ? clone(seed.jobs[1]) : null;
  function job(): ProcessingJobPreview {
    return {
      ...clone(source), state: outcome === "ready" ? "Ready" : outcome === "uncertain" ? "Submitted" : "Order Confirmed",
      archived_at: null, target_order_number: outcome === "confirmed" ? "A9000999" : null,
      target_order_status: null, target_order_lookup_url: null,
      order_confirmed_at: outcome === "confirmed" ? stamp : null,
      updated_at: stamp, last_activity_at: stamp,
      submit_integrity: { version: 1, fingerprint, payload_sha256: fingerprint, request_sha256: fingerprint, document_set_sha256: fingerprint, reviewed_at: stamp },
      submit_certification: {
        can_submit: scenario !== "blocked", external_submit_enabled: true, live_transport_enabled: false,
        summary: scenario === "blocked" ? "Synthetic certification blocker" : "Certified for simulated transport only",
        items: scenario === "blocked" ? [{ item_id: "qa-product", label: "Product mapping", status: "Blocked", blocking: true, message: "Synthetic product mapping requires review.", action_key: "product-map" }] : []
      }
    };
  }
  function attempts(): SubmitAttempt[] {
    if (outcome === "ready") return [];
    const current = job();
    // Preserve the uncertain attempt even after association, like the real store.
    return [{
      attempt_id: "qa-uncertain-attempt", idempotency_key: `qa:${source.job_id}:${fingerprint}`,
      customer_id: source.customer_id, customer_name: source.customer_name, job_id: source.job_id,
      output_route_id: source.output_route_id, output_route_name: source.output_route_name,
      submit_profile_id: "qa-only", submit_profile_name: "Isolated simulation", submit_mode: "live_customer", sandbox: false,
      state: "Submission Uncertain", transport_mode: "mock", external_submit_enabled: true,
      request_fingerprint: fingerprint, endpoint_url: "https://example.invalid/not-called",
      ext_id: source.lift_payload.order.ext_id, company_id: source.customer_id,
      submit_request_masked: current.submit_request_masked, certification: current.submit_certification!, blocking_items: [],
      response: { status: "error", http_status: null, lift_order_id: null, message: "Synthetic timeout: Lift confirmation is not yet known. Do not resubmit this order.", received_at: stamp },
      created_at: stamp, updated_at: stamp
    }];
  }
  function save(next: Outcome) { outcome = next; storage?.setItem(storageKey, next); }
  return {
    storageKey,
    reset() { storage?.removeItem(storageKey); },
    // Explicit local QA control, not a fabricated production reconciliation endpoint.
    simulateReconciliation() { if (outcome === "uncertain") save("confirmed"); },
    async handle(url: URL, method: string, body?: unknown): Promise<Response | null> {
      if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return reply({ error: "Simulation blocks off-origin requests." }, 423);
      if (method === "GET" && url.pathname === "/api/jobs") return reply({ jobs: [job(), ...(secondary ? [secondary] : [])].map(toJobListItem), wrike_operations_snapshots: [] });
      if (method === "GET" && url.pathname === "/api/submit-runtime") return reply({ transport_mode: "mock", external_submit_enabled: true, live_transport_enabled: false, profiles: [] });
      const customer = url.pathname.match(/^\/api\/customers\/([^/]+)\//)?.[1];
      if (method === "GET" && customer && url.pathname.endsWith("/workspace") && seed.workspaces[customer]) {
        const workspace = clone(seed.workspaces[customer]);
        workspace.jobs = customer === source.customer_id ? [job()] : [];
        if (secondary?.customer_id === customer) workspace.jobs.push(clone(secondary));
        workspace.submit_attempts = customer === source.customer_id ? attempts() : [];
        return reply(workspace);
      }
      const match = url.pathname.match(/^\/api\/customers\/([^/]+)\/jobs\/([^/]+)(?:\/(certification|submit))?$/);
      if (!match) return method === "GET" ? null : reply({ error: "Unsupported simulated write. No provider was called." }, 423);
      if (secondary && method === "GET" && !match[3] && match[1] === secondary.customer_id && match[2] === secondary.job_id) return reply({ job: clone(secondary), submit_attempts: [] });
      if (match[1] !== source.customer_id || match[2] !== source.job_id) return reply({ error: "Synthetic job not found for this customer." }, 404);
      if (method === "GET" && !match[3]) return reply({ job: job(), submit_attempts: attempts() });
      if (method === "POST" && match[3] === "certification") return reply({ job: job() });
      if (method === "POST" && match[3] === "submit") {
        const reviewed = (body as { reviewed_submit_fingerprint?: unknown } | undefined)?.reviewed_submit_fingerprint;
        if (scenario === "changed" || reviewed !== fingerprint) return reply({ error: "The reviewed payload has changed. Refresh the job and review it again before submitting.", code: "review_mismatch" }, 409);
        if (attempts().length) return reply({ attempt: attempts()[0], reused: true, message: "The exact submit attempt is uncertain and will not be sent again until reconciled." });
        if (scenario === "blocked") return reply({ error: "Preview job is not certified for Lift submit.", certification: job().submit_certification }, 409);
        save("uncertain");
        if (scenario === "network") throw new TypeError("Synthetic lost response after reservation");
        if (query.has("submissionSlow")) await new Promise(resolve => setTimeout(resolve, 8000));
        return reply({ job: job(), attempt: attempts()[0], message: "Synthetic timeout. No external request was made." });
      }
      return reply({ error: "Unsupported simulated operation." }, 423);
    }
  };
}
