import React from "react";
import { createRoot } from "react-dom/client";
import fixtures from "./fixtures.json";
import { proofLines, proofHealth, cachedProofOrder } from "./proof-fixtures";
import { App } from "../../apps/web/src/App";
import "../../apps/web/src/styles.css";
import "../../apps/web/src/pathfinder-shell.css";
import { compactCatalogPilotProducts } from "../../apps/web/src/artwork-catalog/ArtworkCatalogInternalPilot";
import { SOURCE_CONNECTOR_DEFINITIONS } from "../../packages/source-connections/src/index";
import { createIntegrationReview, type IntegrationSeed } from "./integration-fixtures";
import { createSubmissionReview, type SubmissionSeed } from "./submission-fixtures";

// Actual App with an in-memory HTTP boundary. Never fall through to a real API.
const configured = new Set(["284619","174094","1249"]);
const query = new URLSearchParams(location.search);
// Opt-in density/data variants for the existing customer setup workflows.
// These records live only in this module; mutation requests still return423.
if (query.has("customerWorkflows")) {
  for (const workspace of Object.values(fixtures.workspaces)) {
    if (workspace.import_methods.some(method => method.import_method_id === "qa-paused-method")) continue;
    const method = workspace.import_methods[0];
    workspace.import_methods.push(
      {...structuredClone(method), import_method_id:"qa-paused-method", name:"Seasonal retail display order spreadsheet — regional locations and extended product names", status:"Paused"},
      {...structuredClone(method), import_method_id:"qa-draft-method", name:"New workbook configuration", status:"Draft"}
    );
    const route = workspace.output_routes[0];
    (workspace.product_mappings as unknown[]).push(...Array.from({length:12}, (_, index) => {
      const status = (["Mapped", "Unmapped", "Ambiguous", "Inactive"] as const)[index % 4];
      const identifier = status === "Mapped" ? String(360000 + index) : null;
      return {
        mapping_id:`qa-mapping-${workspace.customer.lift_customer_id}-${index}`,
        output_route_id:route.output_route_id, target_id:route.target_id, target_template:route.output_template,
        source_scope_id:null, customer_product_key:`QA_PRODUCT_${index + 1}`,
        display_label:index === 0 ? "LP 60 FV Front Bottom (Aligned) — 25.5 × 77 — 3M IJ35C — Summer promotion, extended regional artwork title" : `Window graphic — location ${index + 1}`,
        source_columns:["Product Name"], product_identifier_type:route.product_identifier_type,
        product_identifier_value:identifier, lift_product_id:identifier, lift_unit_number:null,
        product_name:identifier ? "Synthetic Lift product — long production description" : null,
        status, mapping_source:index % 2 ? "Observed order" : "Preloaded catalog", source_file_name:"QA product list.xlsx",
        last_seen_examples:[{sheet_name:"Order",row_number:index+2,final_width:"25.5",final_height:"77"}],
        created_at:"2026-10-23T17:30:00Z", updated_at:"2026-10-23T17:30:00Z"
      };
    }));
  }
}
// Test-only deterministic disk-read delay for processing focus and late completion.
// The real analyzer still receives the original bytes; no production hook is added.
let interruptCatalog: (() => void) | undefined;
if (query.has("catalogSlow") || query.has("catalogLate")) {
  const readFile = File.prototype.arrayBuffer;
  File.prototype.arrayBuffer = async function () {
    if (query.has("catalogLate")) setTimeout(() => interruptCatalog?.(), 1000);
    await new Promise(resolve => setTimeout(resolve, 20000));
    return readFile.call(this);
  };
}
// Add density fixtures only in this test entry point. No production flags or API change.
if (query.has("catalogStress") && compactCatalogPilotProducts.length === 5) {
  const names = [
    "LP 60 FV Front Bottom (Aligned) — 25.5 × 77 — 3M IJ35C — Summer promotion, extended regional artwork title",
    "CustomerSuppliedProductIdentifierWithoutWordBreaks_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "Window graphic — north entrance",
    "Shelf strip — seasonal assortment"
  ];
  compactCatalogPilotProducts.push(...Array.from({length: 35}, (_, index) => {
    const base = compactCatalogPilotProducts[index % 5];
    return {...base, id: `stress-${index}`, name: `${names[index % names.length]} ${index + 1}`, sku: `QA-DENSITY-${index + 1}`};
  }));
}
const calls: {url:string;method:string}[] = [];
const integration = query.has("integrationReview")
  ? createIntegrationReview(fixtures as unknown as IntegrationSeed, query, sessionStorage)
  : null;
const submission = query.has("submissionReview")
  ? createSubmissionReview(fixtures as unknown as SubmissionSeed, query, sessionStorage)
  : null;
let jobReads = 0;
let emailReads = 0;
const proofReads = new Map<string, number>();
Object.assign(window, { uxReviewRequests:calls });
const response = (body:unknown,status=200) => Promise.resolve(new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}));
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  calls.push({url:url.pathname,method});
  if (url.origin !== location.origin) return response({error:"Local review blocks every off-origin request."},423);
  if (submission) {
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : input instanceof Request && method !== "GET" ? await input.clone().json() : undefined; }
    catch { return response({error:"Invalid local JSON request."},400); }
    const simulated = await submission.handle(url, method, body);
    if (simulated) return simulated;
  }
  const customer = url.pathname.match(/\/customers\/([^/]+)/)?.[1];
  if (customer && query.get("slow") === customer) await new Promise(resolve=>setTimeout(resolve,1800));
  if (integration) {
    if (method === "GET" && customer && url.pathname.endsWith("/workspace") && !configured.has(customer)) return response({error:"Workspace not set up"},404);
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : input instanceof Request && method !== "GET" ? await input.clone().json() : undefined; }
    catch { return response({error:"Invalid local JSON request."},400); }
    const simulated = await integration.handle(url, method, body);
    if (simulated) return simulated;
  }
  if (method !== "GET") {
    if (method === "POST" && url.pathname.endsWith("/workspace") && customer) { configured.add(customer); return response(fixtures.workspaces[customer]); }
    return response({error:"Local review: mutations are blocked. No provider request was made."},423);
  }
  if (url.pathname === "/api/lift/customers") return response({customers:fixtures.customers,source:"local-ux-fixtures",loaded_at:new Date().toISOString()});
  if (url.pathname === "/api/operations/customer-workspaces") return query.has("membershipError") ? response({error:"Synthetic membership outage"},503) : response({workspace_customer_ids:[...configured]});
  if (url.pathname.endsWith("/workspace") && customer) return configured.has(customer) ? response(fixtures.workspaces[customer]) : response({error:"Workspace not set up"},404);
  if (url.pathname.endsWith("/source-connections")) return query.has("connectionsError") ? response({error:"Synthetic source-connection read denied"},403) : response({definitions:query.has("adminReview") ? SOURCE_CONNECTOR_DEFINITIONS : [],connections:[]});
  if (url.pathname === "/api/email/status" && query.has("adminReview")) {
    emailReads++;
    if (query.has("emailSlow")) await new Promise(resolve=>setTimeout(resolve,2500));
    if (query.has("emailError") || (query.has("emailStale") && emailReads > 1)) return response({error:"Synthetic email configuration read unavailable"},503);
    const mode = query.has("emailSes") ? "ses" : "log";
    return response({mode,sender:{from:"Vornan QA <updates@example.invalid>",from_domain:"example.invalid",status_reply_to:"support@example.invalid",status_reply_to_domain:"example.invalid"},ses:{region:"us-east-1",configuration_set:null},public_intake_email_verification:{gate_enabled:false,available:false,delivery_mode:mode,debug_code_enabled:false,code_ttl_minutes:10,max_attempts:5},readiness:{status:"Warning",items:[{item_id:"qa-isolation",status:"Warning",label:"Isolated review fixture",message:"No email is sent from this local review. Mode is simulated for presentation only."}]}});
  }
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
const authSession = {displayName:submission ? "Local QA · simulated submissions" : integration ? "Local QA · simulated saves" : "Local review · sample data",email:"review@example.invalid",photoURL:null,domain:"example.invalid",token:null,getIdToken:async()=>null,expireSession:async()=>{},signOut:async()=>{}};
const root = createRoot(document.getElementById("root")!);
root.render(<><App authSession={authSession}/>{submission ? <aside aria-label="Isolated submission review" style={{position:"fixed",bottom:8,right:8,zIndex:9999,background:"white",border:"1px solid #39523b",padding:8,fontSize:12}}>No provider calls · QA only <button type="button" onClick={()=>{submission.simulateReconciliation();location.reload();}}>Simulate reconciliation</button> <button type="button" onClick={()=>{submission.reset();location.reload();}}>Reset simulated submission</button></aside> : integration ? <aside aria-label="Isolated integration review" style={{position:"fixed",bottom:8,right:8,zIndex:9999,background:"white",border:"1px solid #39523b",padding:8,fontSize:12}}>Simulated writes · this tab only <button type="button" onClick={()=>{integration.reset();location.reload();}}>Reset simulated data</button></aside> : null}</>);
if (query.has("catalogLate")) {
  // Simulate leaving the workspace while a disk read is pending. This is a test-only
  // remount, not a product navigation control; report cleanup through visible text.
  let revoked = 0;
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => {
    revoke(url);
    revoked++;
    const output = document.getElementById("ux-late-result");
    if (output) output.textContent = `Local QA: workspace remounted during read; ${revoked} late preview URL(s) released.`;
  };
  interruptCatalog = () => {
    interruptCatalog = undefined;
    root.render(<div><output id="ux-late-result" style={{position:"fixed",bottom:0,right:0,zIndex:9999,background:"white",padding:8}}>Local QA: workspace remounted during read; awaiting late completion.</output><App authSession={authSession}/></div>);
  };
}
