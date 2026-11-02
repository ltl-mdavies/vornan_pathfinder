import { createElement } from "react";

function StartupCompass() {
  return createElement("vornan-compass-loader", {
    className: "pathfinder-startup-compass", detail: "simple", decorative: "", "aria-hidden": "true"
  });
}

interface WorkspaceLoadingProps {
  message?: string;
  error?: string | null;
  onRetry?: () => void;
  actionLabel?: string;
  onChooseCustomer?: () => void;
  setupRequired?: boolean;
  embedded?: boolean;
  scope?: "application" | "customer";
}

export function WorkspaceLoading({
  message = "Loading your current Pathfinder workspace…",
  error = null,
  onRetry,
  actionLabel = "Try again",
  onChooseCustomer,
  setupRequired = false,
  embedded = false,
  scope = "customer"
}: WorkspaceLoadingProps) {
  if (embedded) {
    return <section className="pf-startup" aria-label={scope === "customer" ? "Customer workspace loading" : "Pathfinder loading"}>
      <div className={`pf-startup-status${scope === "application" && !error ? " pf-startup-status--application" : ""}`} role={error ? "alert" : "status"} aria-live="polite">
        {!error ? scope === "application" ? <StartupCompass/> : <span className="workspace-loading-spinner" aria-hidden="true"/> : null}
        <div>
          <strong>{setupRequired ? "Set up Pathfinder workspace" : error ? scope === "customer" ? "This customer workspace could not load." : "Pathfinder could not finish loading." : scope === "customer" ? "Loading customer workspace…" : "Opening Pathfinder…"}</strong>
          {error || scope === "customer" ? <p>{error ?? "Preparing this customer’s workspace."}</p> : null}
        </div>
      </div>
      {error ? <div className="pf-startup-actions">
        {onRetry ? <button className="secondary-button" type="button" onClick={onRetry}>{actionLabel}</button> : null}
        {scope === "customer" && onChooseCustomer ? <button className="secondary-button" type="button" onClick={onChooseCustomer}>Back to customer directory</button> : null}
      </div> : null}
    </section>;
  }
  return (
    <div className={embedded ? "pf-loading" : "app-shell workspace-loading-shell"} aria-busy={!error}>
      {!embedded ? <aside className="sidebar workspace-loading-sidebar">
        <div className="brand-block">
          <img className="vornan-wordmark" src="/brand/vornan-wordmark.png" alt="Vornan" />
          <img className="pathfinder-product-lockup" src="/brand/pathfinder-lockup-zinnia.svg" alt="Pathfinder" />
        </div>
        <div className="workspace-loading-sidebar-lines" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </aside> : null}
      <section className="workspace workspace-loading-content">
        {onChooseCustomer ? <button className="secondary-button" onClick={onChooseCustomer}>Back to customer directory</button> : null}
        <div
          className={error ? "workspace-loading-status workspace-loading-error" : "workspace-loading-status"}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          {scope === "application" && !error ? <StartupCompass/> : <span className="workspace-loading-spinner" aria-hidden="true" />}
          <div>
            <strong>{setupRequired ? "Set up Pathfinder workspace" : error ? "Pathfinder could not load this workspace." : message}</strong>
            {error || scope === "customer" ? <p>{error ?? "Customer, route, and job data will appear together when it is ready."}</p> : null}
          </div>
          {error && onRetry ? (
            <button className="secondary-button" type="button" onClick={onRetry}>
              {actionLabel}
            </button>
          ) : null}
        </div>
        {!error ? (
          <div className="workspace-skeleton" aria-label="Loading workspace">
            <div className="workspace-skeleton-heading">
              <span />
              <span />
            </div>
            <div className="workspace-skeleton-panels">
              <span />
              <span />
            </div>
            <div className="workspace-skeleton-metrics">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="workspace-skeleton-table" />
          </div>
        ) : null}
      </section>
    </div>
  );
}
