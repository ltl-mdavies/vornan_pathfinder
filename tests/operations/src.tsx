import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LayoutDashboard, BriefcaseBusiness, FileCheck2, Users, Settings, Target, ScrollText } from "lucide-react";
import "../../apps/web/src/styles.css";
import { OperationsJobs } from "../../apps/web/src/OperationsWorkspace";
import { OperationsDashboard } from "../../apps/web/src/OperationsDashboard";
import { OperationsProof } from "../../apps/web/src/OperationsProof";
import { CustomerRecordHeader, CustomerRecordTabs, OperationsCustomers } from "../../apps/web/src/OperationsCustomers";
import type { OperationsJob, OperationsProofPage } from "../../apps/web/src/operations-model";
import "./styles.css";

// Deterministic local data. This harness imports production components but never contacts providers.
const checked = "2026-10-23T15:42:00Z";
const proofChecked = new Date().toISOString();
const dashboardState = new URLSearchParams(location.search).get("dashboardState");
const customers = [["284619", "Empirical – Momentara"], ["174094", "Silicon Pasture"], ["1249", "LTL Demo"]];
const states = ["Submitted", "Needs Mapping", "Failed", "Submit Failed", "Submitted", "Needs Mapping", "Ready", "Submitted", "Submitted", "Submitted", "Submitted", "Submitted", "Submitted"];
const jobs: OperationsJob[] = states.map((processing, i) => ({
  id: `job_${i}`, label: `JOB-${147314 - i}`, customerId: customers[i % 3][0], customer: customers[i % 3][1],
  sourceOrder: i % 3 === 0 ? `C${317925 - i}` : i % 3 === 1 ? `SP-${100206 - i}` : `DEMO-${220 - i}`,
  intake: ["Wrike", "JSON API", "Manual XLSX"][i % 3], liftOrder: i > 6 || i === 3 || i === 4 ? `A${233914 - i}` : null,
  processing, production: i > 6 ? ["Ready to Print", "In Production", "Shipped"][i % 3] : "—",
  createdAt: "2026-10-23T12:00:00Z", confirmedAt: i > 6 || i === 3 || i === 4 ? "2026-10-23T14:00:00Z" : null,
  activityAt: new Date(Date.parse(checked) - i * 240000).toISOString(), archived: false
}));
const proof: OperationsProofPage = { checked_at: proofChecked, next_cursor: null, coverage: "cached_orders_only", lines: Array.from({ length: 27 }, (_, i) => ({
  id: `line-${i}`, orderNumber: `A${233914 - Math.floor(i / 3)}`, orderTitle: ["Fall campaign signage", "Sticker Press production", "Proof QA samples"][Math.floor(i / 3) % 3],
  customerId: customers[Math.floor(i / 3) % 3][0], customer: customers[Math.floor(i / 3) % 3][1],
  lineNumber: String(i % 3 + 1), product: ["Pump topper (Exxon)", "Window Perf · 30.375 × 46.375", "Counter card · 8.5 × 11"][i % 3],
  state: i < 22 ? "pending" : i === 22 ? "waiting" : "changes", creativeCount: 1, since: "2026-10-22T14:24:00Z", lastSynced: proofChecked, stale: false
})) };
// Explicit preview states, never connected to production APIs.
const dashboardProof = dashboardState === "unknown" ? undefined : dashboardState === "empty" ? { ...proof, lines: [] } : dashboardState === "stale" ? { ...proof, next_cursor: "sample-more", lines: proof.lines.map(line => ({ ...line, stale: true })) } : proof;
const directory = [
  ...customers.map(([lift_customer_id, customer_name]) => ({ lift_customer_id, customer_name, customer_status: "Active", customer_number: lift_customer_id })),
  { lift_customer_id: "300001", customer_name: "Example new customer", customer_status: "Inactive", customer_number: "SAMPLE-004" },
  { lift_customer_id: "300002", customer_name: "Sample Print Company", customer_status: "Active", customer_number: "SAMPLE-005" }
];
const nav = [["Dashboard", LayoutDashboard], ["Jobs", BriefcaseBusiness], ["Proof", FileCheck2], ["Customers", Users], ["Targets", Target], ["Audit", ScrollText], ["Settings", Settings]] as const;
function Review() {
  const [page, setPage] = useState(location.hash.slice(1) || "Dashboard");
  const [opened, setOpened] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [customerId, setCustomerId] = useState("284619");
  const [customerTab, setCustomerTab] = useState("Proof");
  const [workspaceIds, setWorkspaceIds] = useState(customers.map(c => c[0]));
  const selectedCustomer = directory.find(customer => customer.lift_customer_id === customerId)!;
  const customerProof = useMemo(() => ({ ...proof, lines: proof.lines.filter(line => line.customerId === customerId) }), [customerId]);
  const selectCustomer = (id: string) => { setCustomerId(id); setDirectoryOpen(false); setOpened(""); };
  const navigate = (next: string) => { setPage(next); setOpened(""); if (next === "Customers") setDirectoryOpen(true); location.hash = next; };
  return <main className="app-shell ops-shell"><aside className="sidebar"><div className="brand-block"><img className="vornan-wordmark" src="/brand/vornan-wordmark.png" alt="Vornan"/><img className="pathfinder-product-lockup" src="/brand/pathfinder-lockup-zinnia.svg" alt="Pathfinder"/></div><nav className="nav-list" aria-label="Primary">{nav.map(([label, Icon]) => <button key={label} className={`nav-item ${page === label ? "nav-item-active" : ""}`} onClick={() => navigate(label)}><Icon size={18}/><span>{label}</span></button>)}</nav><small className="fixture-label">Local review · sample data<br/>No production actions</small></aside><section className="workspace">
  {opened ? <div className="ops-notice" role="status">Selected {opened}. In the authenticated app this opens the existing detail workspace. <button className="ops-link" onClick={() => setOpened("")}>Dismiss</button></div> : null}
  {page === "Dashboard" ? <OperationsDashboard jobs={dashboardState === "unknown" || dashboardState === "empty" ? [] : jobs} updated={dashboardState === "unknown" ? null : checked} jobsError={dashboardState === "unknown" ? "Sample: Job feed unavailable." : null} initialProof={dashboardProof} onOpen={setOpened} onJobs={() => navigate("Jobs")} onProof={() => navigate("Proof")} onOpenProof={(order, customer) => setOpened(`${order} · Customer ${customer} · Proof`)} onRefresh={() => {}} health={dashboardState === "unknown" ? [] : [{ title: "Wrike intake", status: "Scheduler healthy", detail: "Sample observation · Configured Wrike scheduler · Last cycle Oct 23, 11:40 AM" }, { title: "Lift", status: "Health not monitored", detail: "Order confirmation is not an endpoint health check." }, { title: "JSON API", status: "Not monitored", detail: "No health telemetry connected." }, { title: "Notifications", status: "Coverage unknown", detail: "Customer Intake Exceptions contains available delivery evidence." }]} /> : null}
  {page === "Jobs" ? <OperationsJobs jobs={jobs} updated={checked} onOpen={setOpened} onRefresh={() => {}} tools={<p>Existing order tools are preserved in the authenticated app.</p>} exceptions={<p className="ops-empty">Customer-scoped intake exceptions use the existing visibility gate.</p>} /> : null}
  {page === "Proof" ? <OperationsProof apiBaseUrl="" initialPage={proof} onOpen={setOpened} /> : null}
  {page === "Customers" ? directoryOpen ? <OperationsCustomers customers={directory} workspaceIds={workspaceIds} currentTab={customerTab} updated={checked} refreshing={false} onSelect={selectCustomer} onRefresh={() => {}}/> : <><CustomerRecordHeader customers={directory} customer={selectedCustomer} onSelect={selectCustomer} onDirectory={() => setDirectoryOpen(true)}/>{!workspaceIds.includes(customerId) ? <section className="ops-page ops-surface"><h2>Set up workspace</h2><p>{selectedCustomer.customer_name} is available from Lift but does not yet have a Pathfinder workspace.</p><p>This is a local simulation of the existing setup confirmation. No real customer, intake method or order will be changed.</p><button className="ops-link" onClick={() => setWorkspaceIds(ids => [...ids, customerId])}>Confirm setup (preview only)</button></section> : <><CustomerRecordTabs tabs={["Overview", "Import Methods", "Products", "Artwork Catalog", "Jobs", "Proof", "Settings"]} selected={customerTab} onSelect={tab => { setCustomerTab(tab); setOpened(""); }} onGlobalProof={() => navigate("Proof")}/>{customerTab === "Proof" ? <OperationsProof key={customerId} apiBaseUrl="" customerId={customerId} customerName={selectedCustomer.customer_name} initialPage={customerProof} onOpen={setOpened}/> : <section className="ops-page ops-surface"><div className="ops-section-heading"><h2>{selectedCustomer.customer_name} · {customerTab}</h2></div><p className="ops-empty">The existing {customerTab} workspace is preserved in the authenticated app. This preview demonstrates customer switching without changing the selected tab.</p></section>}</>}</> : null}
  {!["Dashboard", "Jobs", "Proof", "Customers"].includes(page) ? <p>Existing {page} page is unchanged; this local review covers the four new surfaces.</p> : null}
  </section></main>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Review/>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
