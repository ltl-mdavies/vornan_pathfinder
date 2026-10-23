import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Clock3, FileImage, RefreshCw, Search } from "lucide-react";
import { pathfinderFetch } from "./api-client";
import { OperationsHeader, OperationsPagination } from "./OperationsWorkspace";
import { operationsDate, proofLineHasState, sortProofLines, proofOrderGroupKey, type ProofGrouping, type OperationsProofLine, type OperationsProofPage, type QueueState } from "./operations-model";

const stateLabel: Record<QueueState, string> = { pending: "Awaiting approval", waiting: "Waiting for proof", changes: "Changes requested", reviewed: "Reviewed (legacy)", approved: "Approved", reference: "Reference", cancel_requested: "Cancellation requested", revision_pending: "Revised art expected", unavailable: "Unavailable" };
export function OperationsProof({ apiBaseUrl, customerId = "", customerName, onOpen, tools, initialPage }: {
  apiBaseUrl: string; customerId?: string; customerName?: string; onOpen: (orderNumber: string, customerId: string) => void;
  tools?: React.ReactNode; initialPage?: OperationsProofPage;
}) {
  const [rows, setRows] = useState<OperationsProofLine[]>(initialPage?.lines ?? []);
  const [cursor, setCursor] = useState<string | null>(initialPage?.next_cursor ?? null);
  const [checked, setChecked] = useState<string | null>(initialPage?.checked_at ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<QueueState | "all">("pending");
  const [search, setSearch] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [grouping, setGrouping] = useState<ProofGrouping>("order");
  const [page, setPage] = useState(0);
  const [closed, setClosed] = useState<string[]>([]);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  async function load(next: string | null = null) {
    if (initialPage) { setRows(initialPage.lines); setChecked(initialPage.checked_at); return; }
    const generation = ++request.current;
    controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams({ ...(customerId ? { customer: customerId } : {}), ...(next ? { cursor: next } : {}) });
      const response = await pathfinderFetch(`${apiBaseUrl}/api/operations/proof-queue?${query}`, { signal: controller.current.signal, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "The new Proof queue is not enabled on this API yet. Existing proof tools remain available." : "Could not load the Proof queue. Retry without changing any proof actions.");
      const data = await response.json() as OperationsProofPage;
      if (generation !== request.current) return;
      setRows(existing => [...new Map([...(next ? existing : []), ...data.lines].map(row => [row.id, row])).values()]);
      setCursor(data.next_cursor); setChecked(data.checked_at);
    } catch (caught) { if (generation === request.current) setError(caught instanceof Error ? caught.message : "Proof queue unavailable."); }
    finally { if (generation === request.current) setBusy(false); }
  }
  useEffect(() => {
    setRows(initialPage?.lines ?? []); setCursor(initialPage?.next_cursor ?? null); setChecked(initialPage?.checked_at ?? null);
    setFilterCustomer(""); setClosed([]); setPage(0);
    if (!initialPage) void load();
    return () => { request.current++; controller.current?.abort(); };
  }, [customerId, apiBaseUrl, initialPage]);
  useEffect(() => setPage(0), [state, search, filterCustomer, grouping]);
  const effectiveGrouping = customerId ? "order" : grouping;
  const filtered = sortProofLines(rows.filter(row => (!customerId || row.customerId === customerId) && (state === "all" || proofLineHasState(row, state)) && (!filterCustomer || row.customerId === filterCustomer) && [row.customer, row.orderNumber, row.orderTitle, row.product, row.lineNumber].join(" ").toLowerCase().includes(search.trim().toLowerCase())), effectiveGrouping);
  const size = 9; const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
  const visible = filtered.slice(safePage * size, (safePage + 1) * size);
  const groups = [...new Set(visible.map(proofOrderGroupKey))];
  const customers = [...new Map(rows.map(row => [row.customerId, row.customer])).entries()];
  return <section className={`ops-page${customerId ? " ops-customer-proof" : ""}`} aria-label={customerName ? `${customerName} proof queue` : "Global proof queue"} aria-busy={busy}>
    {!customerId ? <OperationsHeader title="Proof" scope="All active Pathfinder customers" updated={checked}><button className="ops-icon" disabled={busy} aria-label="Refresh proof queue" onClick={() => void load()}><RefreshCw size={16} /></button></OperationsHeader> : null}
    <nav className="ops-tabs" aria-label="Proof queue states">{(["pending", "waiting", "changes", "all"] as const).map(tab => <button key={tab} aria-current={state === tab ? "page" : undefined} onClick={() => setState(tab)}>{tab === "all" ? "All cached" : stateLabel[tab]} <span>{rows.filter(row => tab === "all" || proofLineHasState(row, tab)).length}</span></button>)}</nav>
    <div className="ops-toolbar"><label className="ops-search"><Search size={17} /><input aria-label="Search proof queue" value={search} placeholder="Find order, customer or creative…" onChange={e => setSearch(e.target.value)} /></label>{!customerId ? <select aria-label="Filter proof customer" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}><option value="">All loaded customers</option>{customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select> : null}{!customerId ? <label className="ops-proof-grouping">Group by<select aria-label="Group proof queue by" value={grouping} onChange={e => { setGrouping(e.target.value as ProofGrouping); setClosed([]); }}><option value="order">Order</option><option value="customer">Customer</option></select></label> : null}</div>
    {error ? <p className="ops-notice" role="alert">{error}</p> : null}
    <div className="ops-surface"><div className="ops-table-scroll"><table className="ops-table ops-proof-table"><thead><tr><th>Line / Creative</th><th>Status</th><th>Last updated</th><th>Last sync</th><th><span className="sr-only">Open proof</span></th></tr></thead><tbody>{groups.map((groupKey, groupIndex) => {
      const children = visible.filter(row => proofOrderGroupKey(row) === groupKey); const first = children[0]!; const order = first.orderNumber; const collapsed = closed.includes(groupKey);
      const prior = groupIndex > 0 ? visible.find(row => proofOrderGroupKey(row) === groups[groupIndex - 1]) : null;
      const showCustomer = effectiveGrouping === "customer" && first.customerId !== prior?.customerId;
      return <Fragment key={groupKey}>{showCustomer ? <tr className="ops-proof-customer-group"><th colSpan={5}><strong>{first.customer}</strong><small>{visible.filter(row => row.customerId === first.customerId).length} lines on this page</small></th></tr> : null}<tr className="ops-order-group"><th colSpan={5}><button onClick={() => setClosed(value => collapsed ? value.filter(id => id !== groupKey) : [...value, groupKey])} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<strong>{order}</strong>{!customerId && effectiveGrouping === "order" ? <span>{first.customer}</span> : null}<span>{first.orderTitle}</span><small>{children.length} {children.length === 1 ? "line" : "lines"} on this page</small></button></th></tr>{!collapsed ? children.map(row => <tr key={row.id}><td><div className="ops-creative"><FileImage size={26} aria-label="Preview not loaded" /><span><small>Line {row.lineNumber ?? "—"} · {row.creativeCount} creative{row.creativeCount === 1 ? "" : "s"}</small><strong>{row.product}</strong></span></div></td><td><span className={`ops-state ${row.state === "pending" ? "ops-warning" : ""}`}><Clock3 size={15} />{stateLabel[state !== "all" && proofLineHasState(row, state) ? state : row.state]}</span>{row.stateCounts && Object.keys(row.stateCounts).length > 1 ? <small>{Object.entries(row.stateCounts).map(([key, count]) => `${count} ${stateLabel[key as QueueState].toLowerCase()}`).join(" · ")}</small> : null}</td><td>{operationsDate(row.since)}</td><td>{operationsDate(row.lastSynced)}{row.stale ? <small className="ops-warning">Stale snapshot</small> : null}</td><td><button className="ops-link" onClick={() => onOpen(row.orderNumber, row.customerId)}>Open Proof →</button></td></tr>) : null}</Fragment>;
    })}</tbody></table>{!visible.length ? <p className="ops-empty">{busy ? "Loading cached proof orders…" : !checked ? "Queue has not loaded." : "No matching lines in the cached orders loaded. This is not a complete Lift order inventory."}</p> : null}</div><OperationsPagination count={filtered.length} page={safePage} size={size} onPage={setPage} /></div>
    <div className="ops-coverage"><small>Cached orders only · counts reflect loaded records, not every Lift order.</small>{customerId ? <div className="ops-customer-queue-meta"><small>{checked ? `Checked ${operationsDate(checked)}` : "Loading proof queue"}</small><button disabled={busy} onClick={() => void load()}>Refresh</button></div> : null}{cursor ? <button disabled={busy} onClick={() => void load(cursor)}>{busy ? "Loading…" : "Load more cached orders"}</button> : null}</div>
    {tools ? <details className="ops-tools"><summary>Order lookup, customer access, and Proof tools</summary>{tools}</details> : null}
  </section>;
}
