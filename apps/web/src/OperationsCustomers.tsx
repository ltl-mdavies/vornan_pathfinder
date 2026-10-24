import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LiftCustomer } from "@pathfinder/customer-directory";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { filterCustomers } from "./customer-directory";
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

export function OperationsCustomers({ customers, workspaceIds, setupError, updated, refreshing, warning, onSelect, onRefresh }: {
  customers: LiftCustomer[]; currentTab: string; updated?: string; refreshing: boolean; warning?: string;
  workspaceIds: string[] | null; setupError?: string;
  onSelect: (id: string) => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"pathfinder" | "lift">("pathfinder");
  const [page, setPage] = useState(0);
  const configured = new Set(workspaceIds ?? []);
  const setupState = (id: string) => workspaceIds === null ? "unknown" : configured.has(id) ? "ready" : "missing";
  const rows = filterCustomers(customers, query)
    .filter(c => view === "lift" || configured.has(c.lift_customer_id))
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name));
  const size = 11;
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  useEffect(() => setPage(0), [query, view]);
  return <section className="ops-page ops-directory" aria-label="Customer directory">
    <header className="ops-heading ops-directory-heading"><h1>Customers</h1><button className="ops-icon" type="button" disabled={refreshing} aria-label="Refresh customer directory" title={updated ? `Last updated ${new Date(updated).toLocaleString()}` : "Refresh customer directory"} onClick={onRefresh}><RefreshCw size={18}/></button></header>
    {warning ? <p className="ops-notice" role="status">{warning}</p> : null}
    {setupError ? <p className="ops-notice" role="status">{setupError}</p> : null}
    <div className="ops-surface">
      <div className="ops-directory-toolbar">
        <label className="ops-search"><Search size={18} aria-hidden="true"/><input aria-label="Search customer directory" placeholder="Search customers…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <select aria-label="Customer directory view" value={view} onChange={event => setView(event.target.value as "pathfinder" | "lift")}><option value="pathfinder">Pathfinder Customers</option><option value="lift">All Customers</option></select>
      </div>
      <div className="ops-directory-scroll" aria-busy={refreshing || (view === "pathfinder" && workspaceIds === null && !setupError)}>
        <ul className="ops-directory-list" aria-label={view === "pathfinder" ? "Pathfinder customers" : "All Lift customers"}>{rows.slice(safePage * size, (safePage + 1) * size).map(customer => {
      const state = setupState(customer.lift_customer_id);
      return <li key={customer.lift_customer_id}>
        <button className="ops-directory-row" type="button" onClick={() => onSelect(customer.lift_customer_id)}>
          <span className="ops-directory-identity"><strong>{customer.customer_name}</strong><small>Lift ID {customer.lift_customer_id}</small></span>
          {view === "lift" ? <span className="ops-directory-membership">{state === "ready" ? "In Pathfinder" : state === "missing" ? "Not set up" : setupError ? "Setup unknown" : "Checking…"}</span> : null}
        </button>
      </li>;
    })}</ul>{!rows.length ? <p className="ops-empty" role="status">{view === "pathfinder" && workspaceIds === null ? setupError ? "Pathfinder customers could not be checked. Refresh to retry." : "Loading Pathfinder customers…" : refreshing ? "Loading customers…" : query ? "No customers match your search." : view === "pathfinder" ? "No Pathfinder customers yet. Choose All Lift customers to set one up." : "No Lift customers available."}</p> : null}</div>
      {rows.length > size ? <OperationsPagination page={safePage} count={rows.length} size={size} onPage={setPage}/> : <footer className="ops-directory-count">{view === "pathfinder" && workspaceIds === null ? "—" : `${rows.length} ${rows.length === 1 ? "customer" : "customers"}`}</footer>}
    </div>
  </section>;
}
