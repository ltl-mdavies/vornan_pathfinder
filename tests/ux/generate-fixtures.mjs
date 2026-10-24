// Generates synthetic data using the existing schema/seed builders. No provider calls.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temporary = await mkdtemp(join(tmpdir(), "pathfinder-ux-fixtures-"));
process.env.PATHFINDER_STORAGE_DRIVER = "local";
process.env.PATHFINDER_SECRETS_DRIVER = "local";
process.env.PATHFINDER_LOCAL_STORE_PATH = join(temporary, "store.json");
globalThis.fetch = async () => { throw new Error("Network disabled in fixture generation"); };
const { getOrCreateWorkspace, listTargets } = await import("../../apps/api/src/store.ts");
const { canonicalFieldRegistry, canonicalRegistryMetadata } = await import("@pathfinder/canonical");
const { sampleSourceGrid, buildDefaultMappings, mapSourceRowsToCanonicalOrder } = await import("@pathfinder/templates");
const { generateLiftPayload, buildLiftSubmitRequest, maskLiftSubmitRequest } = await import("@pathfinder/lift-adapter");
const { toJobListItem } = await import("../../apps/api/src/job-list.ts");
const timestamp = "2026-10-23T17:30:00.000Z";
const customers = [
  { lift_customer_id: "284619", customer_name: "Empirical – Momentara", customer_status: "Regular" },
  { lift_customer_id: "174094", customer_name: "Silicon Pasture", customer_status: "Active" },
  { lift_customer_id: "1249", customer_name: "LTL Demo", customer_status: "Active" },
  { lift_customer_id: "300001", customer_name: "Example new customer", customer_status: "Inactive" }
];
const workspaces = {};
const jobs = [];
for (const [c, customer] of customers.entries()) {
  const workspace = await getOrCreateWorkspace(customer);
  workspace.import_methods[0].name = ["Wrike placard orders", "JSON API", "Manual XLSX", "Manual XLSX"][c];
  workspaces[customer.lift_customer_id] = workspace;
  if (c === 3) continue;
  for (let i = 0; i < (c === 2 ? 0 : 32); i++) {
    const mappings = buildDefaultMappings(sampleSourceGrid.columns);
    const canonical = mapSourceRowsToCanonicalOrder(sampleSourceGrid.rows, mappings, { customerId:customer.lift_customer_id, customerName:customer.customer_name, destinationCustomerId:customer.lift_customer_id, sourceSystem:"UX fixture", sourceCustomer:customer.customer_name, targetSystem:"Lift", submittedAt:timestamp });
    canonical.order.contract_number = `C${317052 - i - c * 100}`;
    canonical.order.external_order_id = c === 1 ? `SP-${100000 + i}` : canonical.order.contract_number;
    canonical.order.order_title = `${canonical.order.contract_number} · ${c ? "Sticker Press production" : "Fall campaign signage"}`;
    const id = `job_20261023_${c}${String(i).padStart(5,"0")}`;
    const payload = generateLiftPayload(canonical, {jobId:id, canonicalOrderId:`co_${i}`, pathfinderOrderId:`UX${c}${i}`});
    const created = new Date(Date.parse(timestamp) - i * 3600000).toISOString();
    const confirmed = i % 7 > 1;
    const job = { job_id:id, pathfinder_order_id:`UX${c}${i}`, customer_id:customer.lift_customer_id, customer_name:customer.customer_name,
      import_method_id:workspace.import_methods[0].import_method_id, import_method_name:workspace.import_methods[0].name,
      output_route_id:workspace.output_routes[0].output_route_id, output_route_name:workspace.output_routes[0].name,
      state:confirmed ? "Order Confirmed" : i % 7 === 0 ? "Submitted" : "Needs Mapping", source_file_name:"Synthetic review order.xlsx",
      source_grid:sampleSourceGrid, source_sheets:[], parsed_order_rows:[], reference_rows:[], mappings, product_resolution_results:[], unresolved_products:[],
      canonical_order:canonical, canonical_validation:[], lift_payload:payload, lift_validation:[],
      submit_request_masked:maskLiftSubmitRequest(buildLiftSubmitRequest(payload)),
      submit_certification:{can_submit:false,external_submit_enabled:false,summary:"Local review: submissions disabled",items:[]},
      created_at:created, updated_at:created, last_activity_at:created, archived_at:i === 31 ? timestamp : null,
      target_order_number:confirmed ? `A${String(233900 + i).padStart(7,"0")}` : null,
      target_order_status:confirmed ? {label:["Ready to Print","In Production","Shipped"][i%3]} : null,
      order_confirmed_at:confirmed ? created : null };
    jobs.push(job);
    workspace.jobs.push(job);
  }
}
const targets = await listTargets(true);
const registry = {...canonicalRegistryMetadata, updated_at:timestamp, fields:canonicalFieldRegistry, sections:[...new Set(canonicalFieldRegistry.map(f=>f.section))], field_count:canonicalFieldRegistry.length, history:[], snapshots:[]};
await writeFile(new URL("./fixtures.json", import.meta.url), JSON.stringify({customers,workspaces,targets,jobs,jobList:jobs.map(toJobListItem),registry},null,2));
console.log(`Generated ${jobs.length} synthetic jobs. No live data or credentials used.`);
