import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LiftCustomer } from "@pathfinder/customer-directory";
import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { filterCustomers, directoryFieldKey, directoryFieldLabel, type CustomerOrderSummary } from "./customer-directory";
import { OperationsPagination } from "./OperationsWorkspace";

export function CustomerSwitcher({ customers, selectedId, onSelect }: {
  customers: LiftCustomer[]; selectedId: string; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { setOpen(false); setQuery(""); }, [selectedId]);
  const matches = filterCustomers(customers, query);
  return <div className="ops-customer-switcher" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className="ops-switch-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => { setQuery(""); setOpen(!open); }}>Switch customer <ChevronDown size={16}/></button>
    {open ? <div id={panelId} className="ops-switch-panel" role="dialog" aria-label="Switch customer">
      <label className="ops-search"><Search size={16}/><input ref={input} aria-label="Search customers to switch" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, customer ID or number…"/></label>
      <div className="ops-switch-results">
        {matches.map(customer => <button key={customer.lift_customer_id} type="button" aria-current={customer.lift_customer_id === selectedId ? "true" : undefined} onClick={() => { setOpen(false); trigger.current?.focus(); onSelect(customer.lift_customer_id); }}>
          <strong>{customer.customer_name}</strong><small>{customer.lift_customer_id} · {customer.customer_status || "Status not recorded"}</small>
        </button>)}
        {!matches.length ? <p className="ops-empty">No matching customers.</p> : null}
      </div>
    </div> : null}
  </div>;
}

export function CustomerRecordHeader({ customers, customer, onSelect, onDirectory, tools }: {
  customers: LiftCustomer[]; customer: LiftCustomer; onSelect: (id: string) => void; onDirectory: () => void;
  tools?: ReactNode;
}) {
  return <header className="ops-customer-header">
    <div><div className="ops-customer-breadcrumb"><button className="ops-link" onClick={onDirectory}>Customers</button><span>/ {customer.lift_customer_id}</span></div><h1>{customer.customer_name}</h1></div>
    <div className="ops-customer-header-actions">{tools}<CustomerSwitcher customers={customers} selectedId={customer.lift_customer_id} onSelect={onSelect}/></div>
  </header>;
}

export function CustomerRecordTabs({ tabs, selected, onSelect, onGlobalProof }: {
  tabs: string[]; selected: string; onSelect: (tab: string) => void; onGlobalProof: () => void;
}) {
  return <div className="ops-customer-tabs-row"><nav className="ops-tabs ops-customer-tabs" aria-label="Customer tabs">{tabs.map(tab => <button key={tab} aria-current={tab === selected || (tab === "Jobs" && selected === "Intake Exceptions") ? "page" : undefined} onClick={() => onSelect(tab)}>{tab === "Artwork Catalog" ? "Catalog" : tab}</button>)}</nav>{selected === "Proof" ? <button className="ops-link" onClick={onGlobalProof}>All-customer proof queue →</button> : null}</div>;
}

export function OperationsCustomers({ customers, workspaceIds, setupError, updated, refreshing, warning, orderSummaries = {}, ordersLoading = false, onSelect, onRefresh }: {
  customers: LiftCustomer[]; currentTab: string; updated?: string; refreshing: boolean; warning?: string;
  workspaceIds: string[] | null; setupError?: string;
  orderSummaries?: Record<string, CustomerOrderSummary>; ordersLoading?: boolean;
  onSelect: (id: string) => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"pathfinder" | "lift">("pathfinder");
  const [page, setPage] = useState(0);
  const [market, setMarket] = useState("");
  const [rep, setRep] = useState("");
  const options = (field: "primary_market" | "sales_rep") => [...new Map(customers.map(c => [directoryFieldKey(c[field]), directoryFieldLabel(c[field])])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const configured = new Set(workspaceIds ?? []);
  const setupState = (id: string) => workspaceIds === null ? "unknown" : configured.has(id) ? "ready" : "missing";
  const rows = filterCustomers(customers, query)
    .filter(c => view === "lift" || configured.has(c.lift_customer_id))
    .filter(c => !market || directoryFieldKey(c.primary_market) === market)
    .filter(c => !rep || directoryFieldKey(c.sales_rep) === rep)
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name));
  const size = 11;
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  useEffect(() => setPage(0), [query, view, market, rep]);
  return <section className="ops-page ops-directory" aria-label="Customer directory">
    <header className="ops-heading ops-directory-heading"><h1>Customers</h1><button className="ops-icon" type="button" disabled={refreshing} aria-label="Refresh customer directory" title={updated ? `Last updated ${new Date(updated).toLocaleString()}` : "Refresh customer directory"} onClick={onRefresh}><RefreshCw size={18}/></button></header>
    {warning ? <p className="ops-notice" role="status">{warning}</p> : null}
    {setupError ? <p className="ops-notice" role="status">{setupError}</p> : null}
    <div className="ops-surface ops-directory-surface">
      <div className="ops-directory-toolbar">
        <label className="ops-search"><Search size={18} aria-hidden="true"/><input aria-label="Search customer directory" placeholder="Search customers…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <select aria-label="Customer directory view" value={view} onChange={event => setView(event.target.value as "pathfinder" | "lift")}><option value="pathfinder">Pathfinder Customers</option><option value="lift">All Lift Customers</option></select>
        <select aria-label="Primary market" value={market} onChange={event => setMarket(event.target.value)}><option value="">All markets</option>{options("primary_market").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Sales rep" value={rep} onChange={event => setRep(event.target.value)}><option value="">All sales reps</option>{options("sales_rep").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {query || market || rep ? <button type="button" className="ops-link" onClick={() => { setQuery(""); setMarket(""); setRep(""); }}>Clear filters</button> : null}
      </div>
      <div className="ops-directory-scroll" aria-busy={refreshing || (view === "pathfinder" && workspaceIds === null && !setupError)}>
        <table className="ops-customer-table" aria-label={view === "pathfinder" ? "Pathfinder customers" : "All Lift customers"}>
          <thead><tr><th scope="col">Customer</th><th scope="col">Primary market</th><th scope="col">Sales rep</th>{view === "pathfinder" ? <th scope="col" title="Latest recorded Pathfinder-to-Lift confirmation date for a non-archived production job. Not customer PO or Lift order creation time. New confirmations may take up to one minute to appear.">Last confirmed order</th> : null}<th scope="col">Pathfinder status</th><th scope="col"><span className="ops-visually-hidden">Open customer</span></th></tr></thead>
          <tbody>{rows.slice(safePage * size, (safePage + 1) * size).map(customer => {
            const state = setupState(customer.lift_customer_id);
            const order = orderSummaries[customer.lift_customer_id];
            return <tr key={customer.lift_customer_id}>
              <td><button type="button" className="ops-customer-name" onClick={() => onSelect(customer.lift_customer_id)}>{customer.customer_name}</button><small>Customer {customer.customer_number || customer.lift_customer_id}</small></td>
              <td>{directoryFieldLabel(customer.primary_market)}</td>
              <td>{directoryFieldLabel(customer.sales_rep)}</td>
              {view === "pathfinder" ? <td>{ordersLoading ? "Checking…" : order?.status === "confirmed" ? <><time dateTime={order.confirmed_at} title={`Confirmed ${new Date(order.confirmed_at!).toLocaleString()}`}>{new Date(order.confirmed_at!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time><small>{order.order_number}</small></> : order?.status === "none" ? "No confirmed orders" : order?.status === "date_unavailable" ? "Date unavailable" : "Unavailable"}</td> : null}
              <td>{state === "ready" ? <span className="ops-customer-active" title="Configured Pathfinder workspace">Active</span> : <span className="ops-customer-muted">{state === "missing" ? "Not set up" : setupError ? "Setup unknown" : "Checking…"}</span>}</td>
              <td><button type="button" className="ops-icon" aria-label={`Open ${customer.customer_name}`} onClick={() => onSelect(customer.lift_customer_id)}><ChevronRight size={16} aria-hidden="true"/></button></td>
            </tr>;
          })}</tbody>
        </table>{!rows.length ? <p className="ops-empty" role="status">{view === "pathfinder" && workspaceIds === null ? setupError ? "Pathfinder customers could not be checked. Refresh to retry." : "Loading Pathfinder customers…" : refreshing ? "Loading customers…" : query || market || rep ? "No customers match these filters. Clear filters to see all customers in this view." : view === "pathfinder" ? "No Pathfinder customers yet. Choose All Lift customers to set one up." : "No Lift customers available."}</p> : null}</div>
      {rows.length > size ? <OperationsPagination page={safePage} count={rows.length} size={size} onPage={setPage}/> : <footer className="ops-directory-count">{view === "pathfinder" && workspaceIds === null ? "—" : `${rows.length} ${rows.length === 1 ? "customer" : "customers"}`}</footer>}
    </div>
  </section>;
}
