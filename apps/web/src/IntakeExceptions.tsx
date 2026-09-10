import React, { useEffect, useRef, useState } from "react";
import { pathfinderFetch as fetch } from "./api-client";
import { IntakeDeliveries } from "./IntakeDeliveries";

export interface IntakeExceptionRow {
  attempt_id: string;
  provider: string;
  source_id: string;
  state: string;
  owner: string;
  reason: string | null;
  created_at: string;
  next_action_at: string | null;
  overdue: boolean;
  job_id: string | null;
  confirmed_order_number: string | null;
}
export interface IntakeExceptionsPage { rows: IntakeExceptionRow[]; next_cursor: string | null; checked_at: string }
const label = (value: string) => value.replaceAll("_", " ");
export function IntakeExceptionsTable({ rows }: { rows: IntakeExceptionRow[] }) {
  return <div style={{ overflowX: "auto" }}><table className="data-table">
    <caption>Requests requiring attention, including requests without a job</caption>
    <thead><tr><th scope="col">Source</th><th scope="col">Outcome</th><th scope="col">Owner</th><th scope="col">Reason</th><th scope="col">Next action</th><th scope="col">Job / order</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.attempt_id}>
      <td>{row.provider}<br />{row.source_id}</td><td>{label(row.state)}</td><td>{label(row.owner)}</td>
      <td>{row.reason ? label(row.reason) : "Processing"}</td>
      <td>{row.overdue ? <strong>Overdue · </strong> : null}{row.next_action_at ? new Date(row.next_action_at).toLocaleString() : "Status link repair"}</td>
      <td>{row.job_id ?? "No job created"}<br />{row.confirmed_order_number ?? "No confirmed order"}</td>
    </tr>)}</tbody>
  </table></div>;
}
export function IntakeExceptions({ customerId, apiBaseUrl }: { customerId: string; apiBaseUrl: string }) {
  const [rows, setRows] = useState<IntakeExceptionRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  async function load(next: string | null, reset: boolean) {
    const requestGeneration = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setBusy(true); setError(null);
    if (reset) { setRows([]); setCursor(null); setLoaded(false); }
    try {
      const query = new URLSearchParams({ limit: "50", ...(next ? { cursor: next } : {}) });
      const response = await fetch(`${apiBaseUrl}/api/customers/${encodeURIComponent(customerId)}/intake-exceptions?${query}`, { signal: controller.current.signal });
      if (!response.ok) throw new Error(response.status === 423 ? "Intake Exceptions is not enabled for this customer." : "Could not load intake exceptions. Please retry.");
      const page = await response.json() as IntakeExceptionsPage;
      if (requestGeneration !== generation.current) return;
      setRows((existing) => Array.from(new Map([...(reset ? [] : existing), ...page.rows].map((row) => [row.attempt_id, row])).values()));
      setCursor(page.next_cursor); setLoaded(true);
    } catch (caught) {
      if (requestGeneration === generation.current) setError(caught instanceof Error ? caught.message : "Could not load intake exceptions.");
    } finally { if (requestGeneration === generation.current) setBusy(false); }
  }
  useEffect(() => {
    void load(null, true);
    return () => { generation.current++; controller.current?.abort(); };
  }, [customerId, apiBaseUrl]);
  return <section className="panel" aria-labelledby="intake-exceptions-heading" aria-busy={busy}>
    <div className="table-panel-header"><h2 id="intake-exceptions-heading">Intake Exceptions</h2><button type="button" disabled={busy} onClick={() => void load(null, true)}>Refresh</button></div>
    <p>Customer and internal follow-up across intake sources. Orders awaiting a source status link remain visible.</p>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">Loading intake requests…</p> : null}
    {loaded && !rows.length ? <p>{cursor ? "No exceptions on the pages loaded. More requests are available." : "No intake exceptions found."}</p> : null}
    {rows.length ? <IntakeExceptionsTable rows={rows} /> : null}
    {cursor ? <button type="button" disabled={busy} onClick={() => void load(cursor, false)}>Load more requests</button> : null}
    {rows.length ? <p>{rows.length} exceptions loaded{cursor ? "; more requests available" : ""}.</p> : null}
    <IntakeDeliveries key={customerId} customerId={customerId} apiBaseUrl={apiBaseUrl} />
  </section>;
}
