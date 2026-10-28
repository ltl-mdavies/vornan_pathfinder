import React, { useEffect, useId, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import { pathfinderFetch } from "./api-client";
import { operationsDate } from "./operations-model";

export interface IntakeDiagnosticRow {
  customer_id: string; diagnostic_id: string; import_method_id: string; task_id: string;
  contract_number: string | null; task_url?: string | null; state: "open" | "resolved";
  stage: string; reason_code: string; message: string;
  first_seen_at: string; last_seen_at: string; resolved_at: string | null; occurrences: number;
  attachment: { kind: string; file_name: string; observed_bytes: number; size_source: string; limit_bytes: number } | null;
}
interface Page { items: IntakeDiagnosticRow[]; next_cursor: string | null; checked_at: string; coverage: string }
export async function readIntakeDiagnosticsPage(base: string, customer: string, cursor: string | undefined, signal: AbortSignal, state: "open" | "all" = "open"): Promise<Page> {
  const query = new URLSearchParams(); if (customer) query.set("customer", customer); if (cursor) query.set("cursor", cursor);
  query.set("state", state);
  const response = await pathfinderFetch(`${base}/api/operations/intake-diagnostics?${query}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Intake diagnostics could not be loaded. Intake health is unknown.");
  const page = await response.json() as Page;
  if (!Array.isArray(page.items) || page.coverage !== "recorded_preparation_observations") throw new Error("Intake diagnostics returned incomplete data.");
  return page;
}
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
export function IntakeDiagnosticDetails({ row, customerName }: { row: IntakeDiagnosticRow; customerName?: string }) {
  return <article className="ops-intake-diagnostic">
    <header><strong>{row.contract_number || "Contract not established"} · {customerName || `Customer ${row.customer_id}`}</strong><span className={row.state === "open" ? "ops-warning" : "ops-good"}>{row.state === "open" ? "Intake blocked" : "Preparation recovered"}</span></header>
    <p>{row.message}</p>
    {row.attachment ? <p><strong>{row.attachment.file_name}</strong><br/>{row.attachment.size_source === "content_length" ? "Declared size" : row.attachment.size_source === "stream_lower_bound" ? "Read at least" : "File size"}: {mib(row.attachment.observed_bytes)} · Limit: {mib(row.attachment.limit_bytes)}</p> : null}
    <p><small>First seen {operationsDate(row.first_seen_at)} · Last failure {operationsDate(row.last_seen_at)} · {row.occurrences} observation{row.occurrences === 1 ? "" : "s"}{row.resolved_at ? ` · Preparation recovered ${operationsDate(row.resolved_at)}` : ""}</small></p>
    {row.task_url ? <a className="ops-link" href={row.task_url} target="_blank" rel="noreferrer">Open source request ↗</a> : <small>Source request {row.task_id}</small>}
    {row.state === "resolved" ? <p><small>Preparation succeeded. Order confirmation and source updates are tracked separately.</small></p> : null}
  </article>;
}
export function IntakeDiagnostics({ apiBaseUrl, customerId = "", customerNames = {}, refreshKey, compact = false }: {
  apiBaseUrl?: string; customerId?: string; customerNames?: Record<string, string>; refreshKey?: unknown; compact?: boolean;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const [state, setState] = useState<"open" | "all">("open");
  useEffect(() => { setCursor(undefined); setHistory([]); setPage(null); }, [customerId]);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null); setPage(null); setExpanded(false);
    if (apiBaseUrl === undefined) { setError("Intake checks are not connected. Intake status is unknown."); setBusy(false); return; }
    void readIntakeDiagnosticsPage(apiBaseUrl, customerId, cursor, controller.signal, state).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }).catch(() => { if (!controller.signal.aborted) setError("Intake checks are unavailable. Intake status is unknown; refresh to try again."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [apiBaseUrl, customerId, cursor, refresh, refreshKey, state]);
  const visibleItems = page?.items.slice(0, compact && !expanded ? 3 : undefined) ?? [];
  const hasPagination = Boolean(history.length || page?.next_cursor);
  const checked = page ? <span className="ops-intake-checked">Checked {operationsDate(page.checked_at)}</span> : null;
  return <section className="ops-surface ops-intake-diagnostics" aria-label="Intake checks" aria-busy={busy}>
    <header className="ops-section-heading ops-intake-heading">
      <div className="ops-intake-title"><h2>Intake checks</h2><button className="ops-intake-info" aria-label="About intake checks" aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(value => !value)}><Info size={16} aria-hidden="true"/></button></div>
      <div className="ops-intake-controls"><label>Show <select aria-label="Intake diagnostic status" value={state} onChange={event => { setState(event.target.value as "open" | "all"); setCursor(undefined); setHistory([]); }}><option value="open">Open issues</option><option value="all">All recorded issues</option></select></label><button className="ops-icon" aria-label="Refresh intake checks" title="Refresh intake checks" disabled={busy} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={16} aria-hidden="true"/></button></div>
    </header>
    <div id={helpId} hidden={!helpOpen} className="ops-intake-help">
      <p>Shows recorded order-preparation issues, including requests that did not create a job. Coverage is limited to connected checks; some intake methods and requests excluded before preparation are not captured.</p>
      <p>Records begin when monitoring was enabled; earlier issues are not included. Recovered means preparation succeeded. Order confirmation and source updates are tracked separately.</p>
    </div>
    {error ? <p className="ops-intake-message ops-intake-unavailable" role="status">{error}</p> : busy || !page ? <p className="ops-intake-message" role="status">Loading intake checks…</p> : null}
    {visibleItems.map(row => <IntakeDiagnosticDetails key={`${row.customer_id}:${row.diagnostic_id}`} row={row} customerName={customerNames[row.customer_id]} />)}
    {page && !page.items.length ? <div className="ops-intake-empty"><p>{state === "open" ? "No open intake issues recorded." : "No intake issues recorded."}</p>{checked}</div> : null}
    {page && (page.items.length > 0 || hasPagination) ? <footer className="ops-dashboard-panel-footer ops-intake-footer">
      <div className="ops-intake-count"><span>{visibleItems.length === page.items.length ? `${page.items.length} recorded issue${page.items.length === 1 ? "" : "s"}` : `${visibleItems.length} of ${page.items.length} issues shown`}{hasPagination ? " on this page" : ""}</span>{compact && page.items.length > 3 ? <button className="ops-link" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `Show all ${page.items.length}`}</button> : null}</div>
      <div className="ops-intake-page-actions">{page.items.length > 0 ? checked : null}{hasPagination ? <nav aria-label="Intake checks pages"><button className="ops-link" disabled={busy || !history.length} onClick={() => { setCursor(history.at(-1)); setHistory(values => values.slice(0, -1)); }}>Previous</button><button className="ops-link" disabled={busy || !page.next_cursor} onClick={() => { setHistory(values => [...values, cursor]); setCursor(page.next_cursor ?? undefined); }}>Next</button></nav> : null}</div>
    </footer> : null}
  </section>;
}
