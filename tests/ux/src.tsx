import React from "react";
import { createRoot } from "react-dom/client";
import fixtures from "./fixtures.json";
import { proofLines, proofHealth, cachedProofOrder } from "./proof-fixtures";
import { App } from "../../apps/web/src/App";
import "../../apps/web/src/styles.css";
import "../../apps/web/src/pathfinder-shell.css";

// Actual App with an in-memory HTTP boundary. Never fall through to a real API.
const configured = new Set(["284619","174094","1249"]);
const query = new URLSearchParams(location.search);
const calls: {url:string;method:string}[] = [];
let jobReads = 0;
const proofReads = new Map<string, number>();
Object.assign(window, { uxReviewRequests:calls });
const response = (body:unknown,status=200) => Promise.resolve(new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}));
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  calls.push({url:url.pathname,method});
  const customer = url.pathname.match(/\/customers\/([^/]+)/)?.[1];
  if (customer && query.get("slow") === customer) await new Promise(resolve=>setTimeout(resolve,1800));
  if (method !== "GET") {
    if (method === "POST" && url.pathname.endsWith("/workspace") && customer) { configured.add(customer); return response(fixtures.workspaces[customer]); }
    return response({error:"Local review: mutations are blocked. No provider request was made."},423);
  }
  if (url.pathname === "/api/lift/customers") return response({customers:fixtures.customers,source:"local-ux-fixtures",loaded_at:new Date().toISOString()});
  if (url.pathname === "/api/operations/customer-workspaces") return query.has("membershipError") ? response({error:"Synthetic membership outage"},503) : response({workspace_customer_ids:[...configured]});
  if (url.pathname.endsWith("/workspace") && customer) return configured.has(customer) ? response(fixtures.workspaces[customer]) : response({error:"Workspace not set up"},404);
  if (url.pathname.endsWith("/source-connections")) return response({definitions:[],connections:[]});
  if (url.pathname.endsWith("/intake-exceptions")) return response({rows:[{attempt_id:"ux-request-no-job",provider:"wrike",source_id:"SAMPLE-REQUEST-ONLY",state:"action_required",owner:"customer",reason:"missing_contract_number",created_at:new Date().toISOString(),next_action_at:null,overdue:false,job_id:null,confirmed_order_number:null}],next_cursor:null,checked_at:new Date().toISOString()});
  if (url.pathname.endsWith("/intake-deliveries")) return response({rows:[{receipt_id:"ux-receipt",attempt_id:"ux-request-no-job",kind:"source_feedback",state:"sent",updated_at:new Date().toISOString(),dispatch_started_at:null,provider_message_id:"synthetic-ack",needs_review:false}],next_cursor:null});
  if (url.pathname === "/api/targets") return response({targets:fixtures.targets});
  if (url.pathname === "/api/jobs") return query.has("jobsError") || (query.has("jobsStale") && ++jobReads > 2) ? response({error:"Synthetic job feed outage"},503) : response({jobs:query.has("zeroJobs") ? [] : fixtures.jobList,wrike_operations_snapshots:[]});
  if (url.pathname.includes("/jobs/") && customer) { const job=fixtures.jobs.find(j=>j.job_id===url.pathname.split("/").pop() && j.customer_id===customer); return job ? response({job,submit_attempts:[]}) : response({error:"No fixture for this job action"},404); }
  if (url.pathname === "/api/canonical-registry") return response(fixtures.registry);
  if (url.pathname === "/api/submit-runtime") return response({transport_mode:"dry_run",external_submit_enabled:false,live_transport_enabled:false,profiles:[]});
  if (url.pathname === "/api/operations/proof-queue") {
    const scope = url.searchParams.get("customer") ?? "global";
    const reads = (proofReads.get(scope) ?? 0) + 1; proofReads.set(scope, reads);
    if (query.has("proofSlow") || query.get("slow") === scope) await new Promise(resolve => setTimeout(resolve,1800));
    if (query.has("proofRestricted")) return response({error:"Synthetic permission restriction"},403);
    if (query.has("proofRecover") && reads <= (scope === "global" ? 2 : 1)) return response({error:"Synthetic temporary cache outage"},503);
    if (query.has("proofDisabled")) return response({error:"Synthetic disabled queue"},404);
    // Dashboard may read the global cache before the operator opens the queue.
    if (query.has("proofError") || (query.has("proofStale") && reads > (scope === "global" ? 2 : 1))) return response({error:"Synthetic proof cache outage"},503);
    const lines = query.has("proofEmpty") ? [] : proofLines.filter(row => scope === "global" || row.customerId === scope);
    const offset = Number(url.searchParams.get("cursor") ?? 0), size = scope === "global" ? 27 : 9;
    return response({lines:lines.slice(offset, offset+size),coverage:"cached_orders_only",next_cursor:offset+size < lines.length ? String(offset+size) : null,checked_at:"2026-10-23T16:20:00Z"});
  }
  if (url.pathname === "/api/proof/health/lift") return response(proofHealth);
  if (/^\/api\/proof\/orders\/A\d+\/grants$/.test(url.pathname)) return response({grants:[]});
  if (/^\/api\/proof\/orders\/A\d+\/audit$/.test(url.pathname)) return response({events:[],next_cursor:null});
  if (/^\/api\/proof\/orders\/A\d+$/.test(url.pathname)) { const order = cachedProofOrder(url.pathname.split("/").pop()!); return order ? response(order) : response({error:"Order is not in this local cache"},404); }
  return response({error:`Local review has no fixture for ${url.pathname}. No live request was made.`},503);
};
window.open = () => null;
const authSession = {displayName:"Local review · sample data",email:"review@example.invalid",photoURL:null,domain:"example.invalid",token:null,getIdToken:async()=>null,expireSession:async()=>{},signOut:async()=>{}};
createRoot(document.getElementById("root")!).render(<App authSession={authSession}/>);
