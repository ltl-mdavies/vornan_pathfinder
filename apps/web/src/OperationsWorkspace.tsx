import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search } from "lucide-react";
import { defaultOperationsFilters, filterOperationsJobs, needsOperationsAttention, operationsDate, type OperationsJob } from "./operations-model";
import "./operations-workspace.css";

export function OperationsHeader({ title, scope, updated, children }: { title: string; scope: string; updated?: string | null; children?: ReactNode }) {
  return <header className="ops-heading"><div><h1>{title}</h1><span>{scope}</span></div><div className="ops-heading-actions"><small>{updated ? `Updated ${operationsDate(updated)}` : "Waiting for data"}</small>{children}</div></header>;
}
export function OperationsPagination({ page, count, size, onPage }: { page: number; count: number; size: number; onPage: (page: number) => void }) {
  const last = Math.max(0, Math.ceil(count / size) - 1);
  return <footer className="ops-pagination"><span>{count ? `Showing ${page * size + 1}–${Math.min((page + 1) * size, count)} of ${count}` : "0 results"}</span><div><button aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button><span>Page {page + 1} of {last + 1}</span><button aria-label="Next page" disabled={page >= last} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button></div></footer>;
}
function ProcessingLabel({ job }: { job: OperationsJob }) {
  const label = job.liftOrder ? "Confirmed" : job.processing === "Submitted" ? "Confirming" : job.processing;
  const failed = !job.liftOrder && ["Failed", "Submit Failed"].includes(job.processing);
  return <span className={`ops-state ${job.liftOrder ? "ops-good" : failed ? "ops-danger" : needsOperationsAttention(job) ? "ops-warning" : ""}`}>{job.liftOrder ? <CheckCircle2 size={16} /> : failed ? <AlertCircle size={16} /> : needsOperationsAttention(job) ? <Clock3 size={16} /> : null}{label}</span>;
}

export function OperationsJobs({ jobs, updated, onOpen, tools, exceptions, onRefresh, error }: {
  jobs: OperationsJob[]; updated: string | null; onOpen: (id: string) => void; tools?: ReactNode;
  exceptions?: ReactNode; onRefresh: () => void; error?: string | null;
}) {
  const [filters, setFilters] = useState(defaultOperationsFilters);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState("all");
  const [advanced, setAdvanced] = useState(false);
  const rows = useMemo(() => filterOperationsJobs(jobs, { ...filters, attention: tab === "attention" }), [jobs, filters, tab]);
  const size = 11;
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  useEffect(() => setPage(0), [filters, tab]);
  const customers = [...new Map(jobs.map(job => [job.customerId, job.customer])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return <section className="ops-page" aria-label="Global jobs">
    <OperationsHeader title="Jobs" scope="All customers · All intake methods" updated={updated}><button className="ops-icon" onClick={onRefresh} aria-label="Refresh jobs"><RefreshCw size={16} /></button></OperationsHeader>
    {error ? <p className="ops-notice" role="alert">{error} Last loaded rows remain visible.</p> : null}
    <div className="ops-toolbar"><label className="ops-search"><Search size={17} /><input aria-label="Search jobs" placeholder="Search job, source order, Lift order…" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} /></label>
      <select aria-label="Filter jobs by customer" value={filters.customer} onChange={e => setFilters({ ...filters, customer: e.target.value })}><option value="">All customers</option>{customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <select aria-label="Filter intake method" value={filters.intake} onChange={e => setFilters({ ...filters, intake: e.target.value })}><option value="">All intake methods</option>{[...new Set(jobs.map(j => j.intake))].sort().map(method => <option key={method}>{method}</option>)}</select>
      <select aria-label="Intake date range" value={filters.days} onChange={e => setFilters({ ...filters, days: e.target.value })}><option value="">All dates</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
      <button onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>More</button>
    </div>
    {advanced ? <div className="ops-toolbar"><select aria-label="Archive visibility" value={filters.archived} onChange={e => setFilters({ ...filters, archived: e.target.value })}><option value="active">Active jobs</option><option value="archived">Archived jobs</option><option value="all">Include archived</option></select><button onClick={() => { setFilters(defaultOperationsFilters); setTab("all"); }}>Reset filters</button><small>Open a job for its existing submit, recovery, and archive controls.</small></div> : null}
    <nav className="ops-tabs" aria-label="Jobs queue views"><button aria-current={tab === "all" ? "page" : undefined} onClick={() => setTab("all")}>All jobs</button><button aria-current={tab === "attention" ? "page" : undefined} onClick={() => setTab("attention")}>Needs attention</button>{exceptions ? <button aria-current={tab === "exceptions" ? "page" : undefined} onClick={() => setTab("exceptions")}>Intake exceptions</button> : null}</nav>
    {tab === "exceptions" ? exceptions : <div className="ops-surface"><div className="ops-table-scroll"><table className="ops-table ops-jobs-table"><thead><tr><th>Job / Source order</th><th>Customer</th><th>Intake method</th><th>Lift order</th><th>Processing</th><th>Production</th><th>Last activity</th></tr></thead><tbody>{rows.slice(safePage * size, (safePage + 1) * size).map(job => <tr key={`${job.customerId}:${job.id}`}><td><button className="ops-link" onClick={() => onOpen(job.id)}>{job.label}</button><small>{job.sourceOrder}</small></td><td>{job.customer}</td><td>{job.intake}</td><td>{job.liftOrder ?? "—"}</td><td><ProcessingLabel job={job} /></td><td><span className="ops-production">{job.production}</span></td><td>{operationsDate(job.activityAt)}</td></tr>)}</tbody></table>{!rows.length ? <p className="ops-empty">{updated ? "No jobs match these filters." : "Loading jobs…"}</p> : null}</div><OperationsPagination page={safePage} count={rows.length} size={size} onPage={setPage} /></div>}
    {tools ? <details className="ops-tools"><summary>Advanced order lookup and legacy queue tools</summary>{tools}</details> : null}
  </section>;
}
