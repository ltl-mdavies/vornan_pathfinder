import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, RefreshCw, Search } from "lucide-react";
import { defaultOperationsFilters, filterOperationsJobs, needsOperationsAttention, operationsDate, operationsJobsPageSize, type OperationsJob } from "./operations-model";
import "./operations-workspace.css";
import { OperationsJobInspector } from "./OperationsJobInspector";

export function OperationsHeader({ title, scope, updated, children }: { title: string; scope: string; updated?: string | null; children?: ReactNode }) {
  return <header className="ops-heading"><div><h1>{title}</h1><span>{scope}</span></div><div className="ops-heading-actions"><small>{updated ? `Updated ${operationsDate(updated)}` : "Waiting for data"}</small>{children}</div></header>;
}
export function OperationsPagination({ page, count, size, onPage, children }: { page: number; count: number; size: number; onPage: (page: number) => void; children?: ReactNode }) {
  const last = Math.max(0, Math.ceil(count / size) - 1);
  return <footer className="ops-pagination"><span>{count ? `Showing ${page * size + 1}–${Math.min((page + 1) * size, count)} of ${count}` : "0 results"}</span>{children}<div><button aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button><span>Page {page + 1} of {last + 1}</span><button aria-label="Next page" disabled={page >= last} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button></div></footer>;
}
function ProcessingLabel({ job }: { job: OperationsJob }) {
  const label = job.liftOrder ? "Confirmed" : job.processing === "Submitted" ? "Confirming" : job.processing;
  const failed = !job.liftOrder && ["Failed", "Submit Failed"].includes(job.processing);
  return <span className={`ops-state ${job.liftOrder ? "ops-good" : failed ? "ops-danger" : needsOperationsAttention(job) ? "ops-warning" : ""}`}>{job.liftOrder ? <CheckCircle2 size={16} /> : failed ? <AlertCircle size={16} /> : needsOperationsAttention(job) ? <Clock3 size={16} /> : null}{label}</span>;
}

export function OperationsJobs({ jobs, updated, onOpen, tools, exceptions, onRefresh, error, customerId, onIntakeFollowup, hidden, onArchive, detailState, detailError }: {
  jobs: OperationsJob[]; updated: string | null; onOpen: (id: string) => void; tools?: ReactNode;
  exceptions?: ReactNode; onRefresh: () => void; error?: string | null;
  customerId?: string; onIntakeFollowup?: () => void; hidden?: boolean;
  onArchive?: (ids: string[], archived: boolean) => void;
  detailState?: "idle" | "loading" | "error"; detailError?: string | null;
}) {
  const [filters, setFilters] = useState(defaultOperationsFilters);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState("all");
  const [advanced, setAdvanced] = useState(false);
  const [sort, setSort] = useState("activity-desc");
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const lastRowButton = useRef<HTMLButtonElement | null>(null);
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current && !hidden && lastRowButton.current?.isConnected) lastRowButton.current.focus();
    wasHidden.current = hidden;
  }, [hidden]);
  const [selection, setSelection] = useState<string[]>([]);
  const inspected = jobs.find(job => job.id === inspectorId);
  const rows = useMemo(() => {
    const filtered = filterOperationsJobs(jobs, { ...filters, customer: customerId ?? filters.customer, attention: tab === "attention" });
    const [field, direction] = sort.split("-");
    return filtered.sort((a,b) => (direction === "asc" ? 1 : -1) * ((Date.parse(field === "created" ? a.createdAt : a.activityAt) || 0) - (Date.parse(field === "created" ? b.createdAt : b.activityAt) || 0)) || a.id.localeCompare(b.id));
  }, [jobs, filters, tab, sort, customerId]);
  const [viewportHeight, setViewportHeight] = useState(() => typeof window === "undefined" ? 768 : window.innerHeight);
  useEffect(() => { const resize = () => setViewportHeight(window.innerHeight); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  const size = operationsJobsPageSize(viewportHeight);
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  useEffect(() => setPage(0), [filters, tab]);
  useEffect(() => setSelection([]), [filters, tab]);
  const pageRows = rows.slice(safePage * size, (safePage + 1) * size);
  const selectedRows = rows.filter(job => selection.includes(job.id));
  const customers = [...new Map(jobs.map(job => [job.customerId, job.customer])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return <section hidden={hidden} className="ops-page pf-jobs" aria-label={customerId ? "Customer jobs" : "Global jobs"}>
    {!customerId ? <OperationsHeader title="Jobs" scope="All customers · All intake methods" updated={updated}><button className="ops-icon" onClick={onRefresh} aria-label="Refresh jobs"><RefreshCw size={16} /></button></OperationsHeader> : null}
    {error ? <p className="ops-notice" role="alert">{error} {jobs.length ? "Last loaded rows remain visible." : "Job data is not available yet."}</p> : null}
    {detailState === "loading" ? <p className="ops-notice" role="status">Loading job details…</p> : detailState === "error" ? <p className="ops-notice" role="alert">{detailError || "Unable to load this job. Try opening it again."}</p> : null}
    <div className="ops-toolbar"><label className="ops-search"><Search size={17} /><input aria-label="Search jobs" placeholder="Search job, source order, Lift order…" value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} /></label>
      {!customerId ? <select aria-label="Filter jobs by customer" value={filters.customer} onChange={e => setFilters({ ...filters, customer: e.target.value })}><option value="">All customers</option>{customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select> : null}
      <select aria-label="Jobs queue view" value={tab} onChange={e => setTab(e.target.value)}><option value="all">All jobs</option><option value="attention">Needs attention</option>{exceptions ? <option value="exceptions">Intake exceptions</option> : null}</select>
      <select aria-label="Filter intake method" value={filters.intake} onChange={e => setFilters({ ...filters, intake: e.target.value })}><option value="">All intake methods</option>{[...new Set(jobs.map(j => j.intake))].sort().map(method => <option key={method}>{method}</option>)}</select>
      <button onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>More</button>
      {customerId ? <button className="ops-icon" onClick={onRefresh} aria-label="Refresh jobs" title={updated ? `Updated ${operationsDate(updated)}` : "Refresh jobs"}><RefreshCw size={16}/></button> : null}
    </div>
    {selectedRows.length && onArchive ? <div className="pf-job-selection" role="region" aria-label="Selected jobs"><strong>{selectedRows.length} selected</strong><button onClick={() => onArchive(selectedRows.filter(job => !job.archived).map(job => job.id), true)} disabled={!selectedRows.some(job => !job.archived)}>Archive selected</button><button onClick={() => onArchive(selectedRows.filter(job => job.archived).map(job => job.id), false)} disabled={!selectedRows.some(job => job.archived)}>Restore selected</button><button onClick={() => setSelection([])}>Clear selection</button></div> : null}
    {advanced ? <div className="pf-jobs-more"><div className="ops-toolbar"><select aria-label="Archive visibility" value={filters.archived} onChange={e => setFilters({ ...filters, archived: e.target.value })}><option value="active">Active jobs</option><option value="archived">Archived jobs</option><option value="all">Include archived</option></select><select aria-label="Intake date range" value={filters.days} onChange={e => setFilters({ ...filters, days: e.target.value })}><option value="">All dates</option><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select><select aria-label="Sort jobs" value={sort} onChange={e => { setSort(e.target.value); setPage(0); }}><option value="activity-desc">Latest activity first</option><option value="activity-asc">Oldest activity first</option><option value="created-desc">Newest received first</option><option value="created-asc">Oldest received first</option></select><button onClick={() => { setFilters(defaultOperationsFilters); setTab("all"); setSort("activity-desc"); }}>Reset filters</button></div>{onIntakeFollowup ? <button className="ops-link" onClick={onIntakeFollowup}>Intake follow-up</button> : null}{tools}</div> : null}
    {!advanced && (filters.archived !== "active" || filters.days || sort !== "activity-desc") ? <p className="pf-jobs-filter-summary">{filters.archived === "active" ? "Active jobs" : filters.archived === "archived" ? "Archived jobs" : "Including archived"}{filters.days ? ` · Received in last ${filters.days} days` : ""} · {sort.replaceAll("-", " ")} <button className="ops-link" onClick={() => setAdvanced(true)}>Edit filters</button></p> : null}
    {tab === "exceptions" ? exceptions : <div className="ops-surface"><div className="ops-table-scroll"><table className={`ops-table ops-jobs-table${customerId ? " pf-customer-jobs-table" : ""}`}><thead><tr>{onArchive ? <th scope="col" className="pf-job-check"><input type="checkbox" aria-label="Select jobs on this page" checked={pageRows.length > 0 && pageRows.every(job => selection.includes(job.id))} onChange={event => setSelection(event.target.checked ? [...new Set([...selection, ...pageRows.map(job => job.id)])] : selection.filter(id => !pageRows.some(job => job.id === id)))}/></th> : null}<th scope="col">Job / Source order</th>{!customerId ? <th scope="col">Customer</th> : null}<th scope="col">Intake method</th><th scope="col">Lift order</th><th scope="col">Processing</th><th scope="col">Production</th><th scope="col">Last activity</th></tr></thead><tbody>{pageRows.map(job => <tr key={`${job.customerId}:${job.id}`}>{onArchive ? <td className="pf-job-check"><input type="checkbox" aria-label={`Select ${job.label}`} checked={selection.includes(job.id)} onChange={event => setSelection(event.target.checked ? [...selection, job.id] : selection.filter(id => id !== job.id))}/></td> : null}<td><button className="ops-link" title={job.id} onClick={event => { lastRowButton.current = event.currentTarget; setInspectorId(job.id); }}>{job.label}</button><small>{job.sourceOrder}</small></td>{!customerId ? <td>{job.customer}</td> : null}<td>{job.intake}</td><td>{job.liftOrder ?? "—"}</td><td><ProcessingLabel job={job} /></td><td><span className={job.production === "—" ? undefined : "ops-production"}>{job.production}</span></td><td>{operationsDate(job.activityAt)}</td></tr>)}</tbody></table>{!rows.length ? <p className="ops-empty">{error ? "Job data could not be refreshed. Retry to load this queue." : updated ? jobs.length ? "No jobs match these filters." : "No jobs have been received for this scope yet." : "Loading jobs…"}</p> : null}</div>{!error || jobs.length ? <OperationsPagination page={safePage} count={rows.length} size={size} onPage={setPage}>{customerId ? <small>{updated ? `Updated ${operationsDate(updated)}` : "Waiting for job data"}</small> : null}</OperationsPagination> : null}</div>}
    {!customerId ? <div className="pf-jobs-footer"><span>{updated ? `Updated ${operationsDate(updated)}` : "Waiting for job data"}</span></div> : null}
    {inspected && !hidden ? <OperationsJobInspector job={inspected} onClose={() => setInspectorId(null)} onOpen={() => { setInspectorId(null); onOpen(inspected.id); }}/> : null}
  </section>;
}
