interface WorkspaceLoadingProps {
  message?: string;
  error?: string | null;
  onRetry?: () => void;
}

export function WorkspaceLoading({
  message = "Loading your current Pathfinder workspace…",
  error = null,
  onRetry
}: WorkspaceLoadingProps) {
  return (
    <main className="app-shell workspace-loading-shell" aria-busy={!error}>
      <aside className="sidebar workspace-loading-sidebar">
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
      </aside>
      <section className="workspace workspace-loading-content">
        <div
          className={error ? "workspace-loading-status workspace-loading-error" : "workspace-loading-status"}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          <span className="workspace-loading-spinner" aria-hidden="true" />
          <div>
            <strong>{error ? "Pathfinder could not load this workspace." : message}</strong>
            <p>{error ?? "Customer, route, and job data will appear together when it is ready."}</p>
          </div>
          {error && onRetry ? (
            <button className="secondary-button" type="button" onClick={onRetry}>
              Try again
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
    </main>
  );
}
