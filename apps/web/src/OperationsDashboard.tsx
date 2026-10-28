import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Clock3, RefreshCw } from "lucide-react";
import { OperationsHeader } from "./OperationsWorkspace";
import { IntakeDiagnostics } from "./IntakeDiagnostics";
import { operationsDate, operationsMetrics, type OperationsJob, type OperationsProofPage } from "./operations-model";
import { dashboardAttention, dashboardIssue, dashboardProofOrders, dashboardRecent, readDashboardProof } from "./dashboard-model";

export interface OperationsHealth { title: string; status: string; detail: string; warning?: boolean }
export function OperationsDashboard({ jobs, updated, health, onOpen, onJobs, onProof, onOpenProof, onRefresh, apiBaseUrl, initialProof, jobsError }: {
  jobs: OperationsJob[]; updated: string | null; health: OperationsHealth[];
  onOpen: (id: string) => void; onJobs: () => void; onProof: () => void;
  onOpenProof: (order: string, customerId: string) => void; onRefresh: () => void;
  apiBaseUrl?: string; initialProof?: OperationsProofPage; jobsError?: string | null;
}) {
  const [proof, setProof] = useState<OperationsProofPage | null>(initialProof ?? null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [healthOpen, setHealthOpen] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current;
    const controller = new AbortController();
    setProofError(null);
    if (initialProof) { setProof(initialProof); setProofBusy(false); return; }
    if (apiBaseUrl === undefined) { setProofError("Proof preview is not connected."); setProofBusy(false); return; }
    setProofBusy(true);
    void readDashboardProof(apiBaseUrl, controller.signal).then(page => {
      if (id === generation.current) setProof(page);
    }).catch(error => {
      if (id === generation.current && !controller.signal.aborted) setProofError(error instanceof Error ? error.message : "Proof preview unavailable.");
    }).finally(() => { if (id === generation.current) setProofBusy(false); });
    return () => { generation.current++; controller.abort(); };
  }, [apiBaseUrl, initialProof, refresh]);
  const metrics = operationsMetrics(jobs);
  const attention = dashboardAttention(jobs);
  const recent = dashboardRecent(jobs);
  const proofOrders = dashboardProofOrders(proof?.lines ?? []);
  const proofReadAge = proof ? Date.now() - Date.parse(proof.checked_at) : 0;
  const proofReadStale = Boolean(proof && (proofReadAge > 15 * 60_000 || !Number.isFinite(proofReadAge)));
  return <section className="ops-page ops-dashboard" aria-label="System dashboard">
    <OperationsHeader title="Dashboard" scope="All customers · All intake methods" updated={updated}>
      <button className="ops-icon" aria-label="Refresh dashboard" onClick={() => { onRefresh(); setRefresh(value => value + 1); }}><RefreshCw size={18}/></button>
    </OperationsHeader>
    {jobsError ? <p className="ops-notice" role="status">{jobsError} {updated ? "Showing the last loaded jobs." : "Job data is unavailable."}</p> : null}
    <section className="ops-dashboard-summary" aria-label="Activity summary">
      <article><h2>Received today</h2><div><strong>{updated ? metrics.receivedToday : "—"}</strong><span>{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })} · All intake methods</span></div></article>
      <article><h2>Confirmed today</h2><div><strong>{updated ? metrics.confirmedToday : "—"}</strong><span>Recorded Lift confirmations</span></div></article>
      <article><h2>Needs attention</h2><div><strong className={updated && attention.length ? "ops-warning" : ""}>{updated ? attention.length : "—"}</strong><span>Open job issues · All dates</span></div></article>
    </section>
    <IntakeDiagnostics compact apiBaseUrl={apiBaseUrl} refreshKey={refresh} customerNames={Object.fromEntries(jobs.map(job => [job.customerId, job.customer]))} />
    <div className="ops-dashboard-panels">
      <section className="ops-surface ops-dashboard-recent" aria-label="Recent orders">
        <header className="ops-section-heading"><h2>Recent orders</h2><button className="ops-link" onClick={onJobs}>View all jobs →</button></header>
        <div className="ops-dashboard-table-wrap"><table className="ops-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>{recent.map(job => <tr key={`${job.customerId}:${job.id}`}>
            <td><button className="ops-link" onClick={() => onOpen(job.id)}>{job.sourceOrder || job.label}</button><small>{job.liftOrder || job.label}</small></td>
            <td>{job.customer || "Customer not recorded"}</td>
            <td><span className={`ops-state ${job.liftOrder ? "ops-good" : attention.some(item => item.id === job.id) ? "ops-warning" : ""}`}>{job.liftOrder ? <CheckCircle2 size={14}/> : job.processing === "Submitted" ? <Clock3 size={14}/> : <Circle size={12}/>}<span>{job.liftOrder ? "Confirmed" : job.processing === "Submitted" ? "Confirming" : job.processing || "Unknown"}</span></span></td>
            <td>{operationsDate(job.activityAt)}<small>{job.intake || "Intake not recorded"}</small></td>
          </tr>)}</tbody></table></div>
        {!recent.length ? <p className="ops-empty">{updated ? "No active orders in the loaded jobs." : jobsError ? "Order activity is unavailable." : "Loading order activity…"}</p> : null}
      </section>
      <section className="ops-surface ops-dashboard-attention" aria-label="Jobs needing attention">
        <header className="ops-section-heading"><h2>Needs attention <small>{updated ? attention.length : "—"}</small></h2></header>
        <ul className="ops-dashboard-issues">{attention.slice(0, 3).map(job => <li key={`${job.customerId}:${job.id}`}><AlertCircle size={19} aria-hidden="true"/><div><strong>{dashboardIssue(job)}</strong><p>{job.sourceOrder || job.label} · {job.customer}</p><button className="ops-link" onClick={() => onOpen(job.id)}>Review job →</button></div></li>)}</ul>
        {!attention.length ? <p className="ops-empty">{updated ? "No actionable job issues in the loaded queue." : jobsError ? "Job issues are unavailable." : "Checking job activity…"}</p> : null}
        <footer className="ops-dashboard-panel-footer"><button className="ops-link" onClick={onJobs}>View jobs →</button><small>Job issues only</small></footer>
      </section>
      <section className="ops-surface ops-dashboard-proofs" aria-label="Awaiting proof approval" aria-busy={proofBusy}>
        <header className="ops-section-heading"><div><h2>Awaiting proof approval</h2><p>Pending lines in loaded cached orders</p></div><button className="ops-link" onClick={onProof}>View proof queue →</button></header>
        {proofError ? <p className="ops-dashboard-data-note" role="status">{proofError} {proof ? "Last loaded preview retained." : "Approval status is unknown."} <button className="ops-link" disabled={proofBusy} onClick={() => setRefresh(value => value + 1)}>Retry</button></p> : null}
        {proofOrders.length ? <div className="ops-dashboard-table-wrap"><table className="ops-table ops-dashboard-proof-table"><thead className="sr-only"><tr><th>Order</th><th>Customer</th><th>Pending lines</th><th>Last updated</th><th>Action</th></tr></thead><tbody>{proofOrders.slice(0, 3).map(order => <tr key={order.key}><td><strong>{order.order}</strong></td><td>{order.customer}</td><td>{order.pending} {order.pending === 1 ? "line" : "lines"} pending</td><td title={`Last synced ${operationsDate(order.lastSynced)}`}>{order.stale || proofReadStale || proofError ? <span className="ops-warning">Needs refresh</span> : operationsDate(order.since)}</td><td><button className="ops-link" onClick={() => onOpenProof(order.order, order.customerId)}>Open Proof →</button></td></tr>)}</tbody></table></div> : !proofError ? <p className="ops-empty">{proofBusy || !proof ? "Loading cached proof orders…" : "No pending lines in this cached preview. Open the queue for broader coverage."}</p> : null}
        <footer className="ops-dashboard-panel-footer"><small>{proof ? `${proof.next_cursor ? "Partial cache preview" : "Cached orders only"} · Read ${operationsDate(proof.checked_at)}${proofReadStale ? " · Refresh recommended" : ""}` : "Cache coverage not yet known"}{proofBusy && proof ? " · Refreshing…" : ""}</small></footer>
      </section>
      <section className="ops-surface ops-dashboard-health" aria-label="System health">
        <header className="ops-section-heading"><div><h2>System health</h2><p>Latest observed activity</p></div><button className="ops-link" aria-expanded={healthOpen} onClick={() => setHealthOpen(value => !value)}>{healthOpen ? "Hide details" : "Details"}</button></header>
        <ul>{health.map(item => <li key={item.title}><div><span className={`ops-state ${item.warning ? "ops-warning" : ""}`}>{item.warning ? <AlertCircle size={15}/> : <Circle size={12}/>}<strong>{item.title}</strong></span><span>{item.status}</span></div>{healthOpen ? <p>{item.detail}</p> : null}</li>)}</ul>
        {!health.length ? <p className="ops-empty">System health has not been observed.</p> : null}
      </section>
    </div>
    <p className="ops-footnote">Summary totals use loaded job records. Intake checks are separate recorded preparation observations. Cached proof coverage and service health may be incomplete.</p>
  </section>;
}
