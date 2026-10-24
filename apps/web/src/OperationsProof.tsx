import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock3, FileImage, RefreshCw, Search } from "lucide-react";
import { pathfinderFetch } from "./api-client";
import { OperationsHeader } from "./OperationsWorkspace";
import { operationsDate, paginateProofLines, proofLineHasState, sortProofLines, proofOrderGroupKey, type ProofGrouping, type OperationsProofLine, type OperationsProofPage, type QueueState } from "./operations-model";

const stateLabel: Record<QueueState, string> = { pending: "Awaiting approval", waiting: "Waiting for proof", changes: "Changes requested", reviewed: "Reviewed (legacy)", approved: "Approved", reference: "Reference", cancel_requested: "Cancellation requested", revision_pending: "Revised art expected", unavailable: "Unavailable" };
export function OperationsProof({ apiBaseUrl, customerId = "", customerName, onOpen, tools, initialPage, hidden = false }: {
  apiBaseUrl: string; customerId?: string; customerName?: string; onOpen: (orderNumber: string, customerId: string) => void;
  tools?: React.ReactNode; initialPage?: OperationsProofPage; hidden?: boolean;
}) {
  const [rows, setRows] = useState<OperationsProofLine[]>(initialPage?.lines ?? []);
  const [cursor, setCursor] = useState<string | null>(initialPage?.next_cursor ?? null);
  const [checked, setChecked] = useState<string | null>(initialPage?.checked_at ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(!initialPage);
  const [state, setState] = useState<QueueState | "all">("pending");
  const [search, setSearch] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [grouping, setGrouping] = useState<ProofGrouping>("order");
  const [page, setPage] = useState(0);
  const [closed, setClosed] = useState<string[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsVisited, setToolsVisited] = useState(false);
  const [lookup, setLookup] = useState("");
  const [height, setHeight] = useState(typeof window === "undefined" ? 768 : window.innerHeight);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const retryFocus = useRef(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const moreFocus = useRef(false);
  const [retrySequence, setRetrySequence] = useState(0);
  const wasHidden = useRef(hidden);
  useEffect(() => {
    const resize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (wasHidden.current && !hidden) (origin.current?.isConnected ? origin.current : searchInput.current)?.focus();
    wasHidden.current = hidden;
  }, [hidden]);
  useEffect(() => {
    if (!busy && (retryFocus.current || moreFocus.current)) {
      const target = error ? retryButton.current : moreFocus.current ? (moreButton.current ?? searchInput.current) : searchInput.current;
      retryFocus.current = false;
      moreFocus.current = false;
      if (!hidden) target?.focus();
    }
  }, [busy, error, hidden, retrySequence]);
  function open(order: string, customer: string, element: HTMLElement) { origin.current = element; onOpen(order, customer); }
  async function load(next: string | null = null) {
    if (initialPage) { setRows(initialPage.lines); setChecked(initialPage.checked_at); return; }
    const generation = ++request.current;
    controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams({ ...(customerId ? { customer: customerId } : {}), ...(next ? { cursor: next } : {}) });
      const response = await pathfinderFetch(`${apiBaseUrl}/api/operations/proof-queue?${query}`, { signal: controller.current.signal, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? "The Proof queue is not enabled on this API. Existing Proof tools remain available." : response.status === 403 ? "You do not have access to this Proof queue. Contact an administrator; no permissions have been changed." : "Could not refresh the Proof queue. Retry without changing any proof actions.");
      const data = await response.json() as OperationsProofPage;
      if (generation !== request.current) return;
      setRows(existing => [...new Map([...(next ? existing : []), ...data.lines].filter(row => !customerId || row.customerId === customerId).map(row => [row.id, row])).values()]);
      setCursor(data.next_cursor); setChecked(data.checked_at);
    } catch (caught) { if (generation === request.current) setError(caught instanceof Error ? caught.message : "Proof queue unavailable."); }
    finally { if (generation === request.current) setBusy(false); }
  }
  useEffect(() => {
    setRows(initialPage?.lines ?? []); setCursor(initialPage?.next_cursor ?? null); setChecked(initialPage?.checked_at ?? null);
    setFilterCustomer(""); setClosed([]); setPage(0); setError(null); setToolsOpen(false); setToolsVisited(false); retryFocus.current = false; moreFocus.current = false;
    if (!initialPage) void load();
    return () => { request.current++; controller.current?.abort(); };
  }, [customerId, apiBaseUrl, initialPage]);
  useEffect(() => setPage(0), [state, search, filterCustomer, grouping]);
  const scoped = rows.filter(row => (!customerId || row.customerId === customerId) && (!filterCustomer || row.customerId === filterCustomer));
  const effectiveGrouping = customerId ? "order" : grouping;
  const filtered = sortProofLines(scoped.filter(row => (state === "all" || proofLineHasState(row, state)) && [row.customer, row.orderNumber, row.orderTitle, row.product, row.lineNumber].join(" ").toLowerCase().includes(search.trim().toLowerCase())), effectiveGrouping);
  const pages = paginateProofLines(filtered, effectiveGrouping, height - (error ? 72 : 0), Boolean(customerId));
  const safePage = Math.min(page, Math.max(0, pages.length - 1));
  const visible = pages[safePage] ?? [];
  const start = pages.slice(0, safePage).reduce((count, lines) => count + lines.length, 0);
  const groups = [...new Set(visible.map(proofOrderGroupKey))];
  const customers = [...new Map(rows.map(row => [row.customerId, row.customer])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const refresh = <button className="ops-icon" disabled={busy} aria-label="Refresh proof queue" onClick={() => void load()}><RefreshCw size={16} className={busy ? "pf-proof-refreshing" : undefined} /></button>;
  return <section hidden={hidden} className={`ops-page pf-proof-queue${customerId ? " ops-customer-proof" : ""}`} aria-label={customerName ? `${customerName} proof queue` : "Global proof queue"} aria-busy={busy}>
    {!customerId ? <OperationsHeader title="Proof" scope="All Pathfinder customers" updated={checked}>{refresh}</OperationsHeader> : null}
    <nav className="ops-tabs" aria-label="Proof queue states">{(["pending", "waiting", "changes", "all"] as const).map(tab => <button key={tab} aria-current={state === tab ? "page" : undefined} onClick={() => setState(tab)}>{tab === "all" ? "All cached" : stateLabel[tab]} <span>{checked ? scoped.filter(row => tab === "all" || proofLineHasState(row, tab)).length : "—"}</span></button>)}</nav>
    <div className="ops-toolbar">
      <label className="ops-search"><Search size={17} /><input ref={searchInput} aria-label="Search proof queue" value={search} placeholder="Find order, customer or creative…" onChange={e => setSearch(e.target.value)} /></label>
      {!customerId ? <select aria-label="Filter proof customer" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}><option value="">All loaded customers</option>{customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select> : null}
      {!customerId ? <label className="ops-proof-grouping">Group by<select aria-label="Group proof queue by" value={grouping} onChange={e => { setGrouping(e.target.value as ProofGrouping); setClosed([]); }}><option value="order">Order</option><option value="customer">Customer</option></select></label> : refresh}
      <button aria-expanded={toolsOpen} aria-controls={customerId ? "customer-proof-tools" : "global-proof-tools"} onClick={() => { setToolsVisited(true); setToolsOpen(!toolsOpen); }}>Proof tools <ChevronDown size={14} /></button>
    </div>
    {toolsVisited && !hidden ? <section hidden={!toolsOpen} id={customerId ? "customer-proof-tools" : "global-proof-tools"} className="pf-proof-tools" aria-label="Proof tools">
      {tools ?? <form onSubmit={event => { event.preventDefault(); if (/^A\d{7,8}$/.test(lookup.trim().toUpperCase())) open(lookup.trim().toUpperCase(), customerId, event.currentTarget.querySelector("button")!); }}>
        <label>Lift order number<input required pattern="[Aa][0-9]{7,8}" placeholder="A0230112" value={lookup} onChange={event => setLookup(event.target.value)} /></label>
        <button className="secondary-button" type="submit">Open cached order</button>
        <p>Opens internal tools only after verifying this customer. For orders not yet cached, use the global Proof tools to synchronize an order. No customer link is created.</p>
      </form>}
    </section> : null}
    {error ? <p className="ops-notice pf-proof-notice" role="alert"><CircleAlert size={16} /><span>{error}{checked ? " Showing the last successful cache result below." : " Queue counts are unavailable."}</span><button ref={retryButton} disabled={busy} onClick={async () => { retryFocus.current = true; await load(); setRetrySequence(value => value + 1); }}>Retry</button></p> : null}
    <div className="ops-surface"><div className="ops-table-scroll"><table className="ops-table ops-proof-table"><thead><tr><th scope="col">Line / Creative</th><th scope="col">Status</th><th scope="col">Last updated</th><th scope="col">Last sync</th><th scope="col"><span className="sr-only">Open proof</span></th></tr></thead><tbody>{groups.map((groupKey, groupIndex) => {
      const children = visible.filter(row => proofOrderGroupKey(row) === groupKey); const first = children[0]!; const order = first.orderNumber; const collapsed = closed.includes(groupKey);
      const prior = groupIndex > 0 ? visible.find(row => proofOrderGroupKey(row) === groups[groupIndex - 1]) : null;
      const showCustomer = effectiveGrouping === "customer" && first.customerId !== prior?.customerId;
      return <Fragment key={groupKey}>{showCustomer ? <tr className="ops-proof-customer-group"><th colSpan={5}><strong>{first.customer}</strong><small>{visible.filter(row => row.customerId === first.customerId).length} lines on this page</small></th></tr> : null}<tr className="ops-order-group"><th colSpan={5}><button onClick={() => setClosed(value => collapsed ? value.filter(id => id !== groupKey) : [...value, groupKey])} aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} ${order} · ${first.customer}`}>{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<strong>{order}</strong>{!customerId && effectiveGrouping === "order" ? <span>{first.customer}</span> : null}<span title={first.orderTitle ?? undefined}>{first.orderTitle}</span><small>{children.length} {children.length === 1 ? "line" : "lines"} on this page</small></button></th></tr>{!collapsed ? children.map(row => {
        const displayState = state !== "all" && proofLineHasState(row, state) ? state : row.state;
        const Icon = displayState === "approved" ? CheckCircle2 : ["changes", "unavailable", "cancel_requested"].includes(displayState) ? CircleAlert : Clock3;
        return <tr key={row.id}><td><div className="ops-creative"><FileImage size={23} aria-label="Preview not loaded" /><span><small>Line {row.lineNumber ?? "—"} · {row.creativeCount} creative{row.creativeCount === 1 ? "" : "s"}</small><strong>{row.product}</strong></span></div></td><td><span className={`ops-state ${["pending", "changes", "cancel_requested"].includes(displayState) ? "ops-warning" : displayState === "approved" ? "ops-good" : ""}`}><Icon size={15} />{stateLabel[displayState]}</span>{row.stateCounts && Object.keys(row.stateCounts).length > 1 ? <small>{Object.entries(row.stateCounts).filter(([, count]) => count).map(([key, count]) => `${count} ${stateLabel[key as QueueState].toLowerCase()}`).join(" · ")}</small> : null}</td><td>{operationsDate(row.since)}</td><td>{operationsDate(row.lastSynced)}{row.stale ? <small className="ops-warning">Stale snapshot</small> : null}</td><td><button className="ops-link" aria-label={`Open Proof ${order} line ${row.lineNumber ?? "unknown"}`} onClick={event => open(row.orderNumber, row.customerId, event.currentTarget)}>Open Proof <ArrowRight size={14} /></button></td></tr>;
      }) : null}</Fragment>;
    })}</tbody></table>{!visible.length ? <div className="ops-empty" role="status"><p>{busy ? "Loading cached proof orders…" : !checked ? "Proof queue unavailable. Retry above or open the existing Proof tools." : rows.length ? "No lines match this view in the loaded cache." : "No cached proof lines for this scope yet."}</p>{checked ? <small>{cursor ? "More cached orders are available below; they may contain matching lines." : "This is not a complete Lift order inventory. Use Proof tools to look up an order."}</small> : null}{checked && rows.length > 0 && (search || state !== "all" || filterCustomer) ? <button onClick={() => { setSearch(""); setState("all"); setFilterCustomer(""); searchInput.current?.focus(); }}>Show all loaded lines</button> : null}</div> : null}</div>
      {checked ? <div className="ops-pagination" aria-label="Proof queue pagination"><span>{filtered.length ? `Showing ${start + 1}–${start + visible.length} of ${filtered.length} loaded lines` : "0 matching loaded lines"}</span><div><button aria-label="Previous proof page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft size={16}/></button><span>Page {safePage + 1} of {Math.max(1, pages.length)}</span><button aria-label="Next proof page" disabled={safePage >= pages.length - 1} onClick={() => setPage(safePage + 1)}><ChevronRight size={16}/></button></div></div> : null}
    </div>
    <div className="ops-coverage"><small>Cached orders only · {cursor ? "More cache pages available; " : ""}counts reflect loaded lines, not every Lift order.{customerId && checked ? ` Checked ${operationsDate(checked)}.` : ""}</small>{cursor ? <button ref={moreButton} disabled={busy} onClick={async () => { moreFocus.current = true; await load(cursor); setRetrySequence(value => value + 1); }}>{busy ? "Loading…" : "Load more cached orders"}</button> : null}</div>
  </section>;
}
