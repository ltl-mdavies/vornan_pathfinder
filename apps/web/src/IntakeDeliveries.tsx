import React, { useEffect, useRef, useState } from "react";
import { pathfinderFetch as fetch } from "./api-client";
export interface IntakeDeliveryRow {
  receipt_id: string; attempt_id: string; kind: string; state: string; updated_at: string;
  dispatch_started_at: string | null; provider_message_id: string | null; needs_review: boolean;
}
export function IntakeDeliveriesTable({ rows }: { rows: IntakeDeliveryRow[] }) {
  return <div style={{ overflowX: "auto" }}><table className="data-table">
    <caption>Delivery receipts, including resolved intake requests</caption>
    <thead><tr><th scope="col">Intake request</th><th scope="col">Channel</th><th scope="col">Delivery outcome</th><th scope="col">Updated</th><th scope="col">Provider reference</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.receipt_id}>
      <td style={{ overflowWrap: "anywhere", maxWidth: "20rem" }}>{row.attempt_id}</td>
      <td>{row.kind === "source_feedback" ? "Customer feedback" : "Internal notification"}</td>
      <td>{row.needs_review ? <><strong>Outcome uncertain — review required</strong><br />Check provider records before any retry.</> : row.state === "sent" ? "Provider acknowledged" : row.state === "cancelled" ? "Cancelled before sending" : "Prepared; not sent"}</td>
      <td>{new Date(row.updated_at).toLocaleString()}</td><td>{row.provider_message_id ?? "No acknowledgement recorded"}</td>
    </tr>)}</tbody>
  </table></div>;
}
export function IntakeDeliveries({ customerId, apiBaseUrl }: { customerId: string; apiBaseUrl: string }) {
  const [rows, setRows] = useState<IntakeDeliveryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  async function load(next: string | null, reset: boolean) {
    const version = ++generation.current;
    controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setError(null);
    if (reset) { setRows([]); setCursor(null); setLoaded(false); }
    try {
      const query = new URLSearchParams({ limit: "50", ...(next ? { cursor: next } : {}) });
      const response = await fetch(`${apiBaseUrl}/api/customers/${encodeURIComponent(customerId)}/intake-deliveries?${query}`, { signal: controller.current.signal });
      if (!response.ok) throw new Error(response.status === 423 ? "Delivery visibility is not enabled for this customer." : "Could not load delivery receipts. Please retry.");
      const page = await response.json() as { rows: IntakeDeliveryRow[]; next_cursor: string | null };
      if (version !== generation.current) return;
      setRows(previous => Array.from(new Map([...(reset ? [] : previous), ...page.rows].map(row => [row.receipt_id, row])).values()));
      setCursor(page.next_cursor); setLoaded(true);
    } catch (caught) { if (version === generation.current) setError(caught instanceof Error ? caught.message : "Could not load delivery receipts."); }
    finally { if (version === generation.current) setBusy(false); }
  }
  useEffect(() => { void load(null, true); return () => { generation.current++; controller.current?.abort(); }; }, [customerId, apiBaseUrl]);
  return <section aria-labelledby="intake-deliveries-heading" aria-busy={busy}>
    <div className="table-panel-header"><h3 id="intake-deliveries-heading">Delivery receipts</h3><button type="button" disabled={busy} onClick={() => void load(null, true)}>Refresh receipts</button></div>
    <p>Uncertain delivery blocks automatic retries. Provider acknowledgement does not prove the recipient received the message.</p>
    {error ? <p role="alert">{error}</p> : null}{busy ? <p role="status">Loading delivery receipts…</p> : null}
    {loaded && !rows.length ? <p>{cursor ? "No receipts on this page. More pages are available." : "No delivery receipts found."}</p> : null}
    {rows.length ? <IntakeDeliveriesTable rows={rows} /> : null}
    {cursor ? <button type="button" disabled={busy} onClick={() => void load(cursor, false)}>Load more receipts</button> : null}
  </section>;
}
