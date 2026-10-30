import type { ReactNode } from "react";
import { LogOut, type LucideIcon } from "lucide-react";
import type { PathfinderAuthSession } from "./auth";
import "./pathfinder-shell.css";
import "../../../packages/ui/src/vornan-foundation.css";

export interface PathfinderNavigationItem { label: string; icon: LucideIcon }

/** Presentation only: navigation stays behind the application's dirty-state guard. */
export function PathfinderShell({ enabled, active, items, onNavigate, session, children }: {
  enabled: boolean; active: string; items: PathfinderNavigationItem[];
  onNavigate: (label: string) => void; session?: PathfinderAuthSession | null; children: ReactNode;
}) {
  if (!enabled) return <main className="app-shell">{children}</main>;
  return <main className="app-shell ops-shell pf-shell">
    <a className="pf-skip" href="#pathfinder-content">Skip to content</a>
    <header className="pf-masthead">
      <div className="pf-brand"><img src="/brand/vornan-wordmark.svg" alt="Vornan"/><span>Pathfinder</span></div>
      <div className="pf-session">{session ? <><span>{session.displayName || session.email || "Signed in"}</span><button type="button" onClick={() => void session.signOut()} aria-label="Sign out"><LogOut size={17}/></button></> : <span>Local workspace</span>}</div>
    </header>
    <aside className="sidebar pf-rail"><nav aria-label="Primary" className="nav-list">
      {items.map(({ label, icon: Icon }) => <button key={label} type="button" className={`nav-item${active === label || (active === "Customer Directory" && label === "Customers") ? " nav-item-active" : ""}`} aria-current={active === label || (active === "Customer Directory" && label === "Customers") ? "page" : undefined} onClick={() => onNavigate(label)}><Icon size={18} aria-hidden="true"/><span>{label}</span></button>)}
    </nav></aside>
    {children}
  </main>;
}
