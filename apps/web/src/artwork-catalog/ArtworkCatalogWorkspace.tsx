import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  Filter,
  History,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Upload,
  X
} from "lucide-react";
import type {
  ApprovalState,
  ArtworkCatalogActions,
  ArtworkVersion,
  CatalogProduct,
  InspectionState,
  UploadCandidate
} from "./fixtures";

export type UploadStage = "select" | "review" | "confirm" | "processing" | "success";

export function nextUploadStage(stage: UploadStage): UploadStage {
  if (stage === "select") return "review";
  if (stage === "review") return "confirm";
  if (stage === "confirm") return "processing";
  if (stage === "processing") return "success";
  return "success";
}

export function currentArtworkVersion(product: CatalogProduct): ArtworkVersion {
  const current = product.versions.filter((version) => version.isCurrent);
  if (current.length !== 1) {
    throw new Error(`Catalog product ${product.id} must have exactly one current artwork version.`);
  }
  return current[0];
}

type ViewerState =
  | { kind: "closed" }
  | { kind: "history"; selectedVersionId: string }
  | { kind: "upload"; stage: UploadStage; candidate: UploadCandidate | null; error: string | null };

export type ArtworkCatalogWorkspaceProps = {
  customerLabel: string;
  products: ReadonlyArray<CatalogProduct>;
  actions: ArtworkCatalogActions;
  initialProductId?: string;
};

function formatDate(value?: string, includeYear = false) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {})
  }).format(new Date(value));
}

function inspectionTone(state: InspectionState) {
  if (state === "Passed") return "success";
  if (state === "Needs work") return "warning";
  return "neutral";
}

function approvalTone(state: ApprovalState) {
  if (state === "Approved") return "success";
  if (state === "Needs review") return "warning";
  return "neutral";
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "neutral" }) {
  return (
    <span className={`artwork-catalog-status artwork-catalog-status-${tone}`}>
      {tone === "success" ? <Check size={12} aria-hidden="true" /> : tone === "warning" ? <AlertTriangle size={12} aria-hidden="true" /> : <Clock3 size={12} aria-hidden="true" />}
      {label}
    </span>
  );
}

function ProductArtworkThumb({ product, version, compact = false }: { product: CatalogProduct; version?: ArtworkVersion; compact?: boolean }) {
  const current = version ?? currentArtworkVersion(product);
  return (
    <span className={compact ? "artwork-catalog-thumb artwork-catalog-thumb-compact" : "artwork-catalog-thumb"}>
      {product.id === "product_1249_pump_topper_chevron" ? (
        <img src={current.previewUrl} alt="" />
      ) : (
        <FileImage size={compact ? 18 : 22} aria-hidden="true" />
      )}
    </span>
  );
}

export function ArtworkCatalogWorkspace({
  customerLabel,
  products,
  actions,
  initialProductId
}: ArtworkCatalogWorkspaceProps) {
  const initialProduct = products.find((product) => product.id === initialProductId) ?? products[0] ?? null;
  const [selectedProductId, setSelectedProductId] = useState<string | null>(initialProduct?.id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialProduct));
  const [query, setQuery] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<"All" | "Active" | "Draft">("All");
  const [viewer, setViewer] = useState<ViewerState>({ kind: "closed" });
  const [activityMessage, setActivityMessage] = useState("");
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const lastModalTriggerRef = useRef<HTMLElement | null>(null);

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesFilter = lifecycleFilter === "All" || product.lifecycle === lifecycleFilter;
      const matchesQuery = !normalizedQuery || [product.name, product.sku, product.category]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesFilter && matchesQuery;
    });
  }, [lifecycleFilter, products, query]);

  const totals = useMemo(() => ({
    products: products.length,
    approved: products.filter((product) => currentArtworkVersion(product).approval.state === "Approved").length,
    needsAttention: products.filter((product) => {
      const current = currentArtworkVersion(product);
      return current.inspection.state === "Needs work" || current.approval.state === "Needs review";
    }).length
  }), [products]);

  const closeViewer = () => {
    setViewer({ kind: "closed" });
    window.requestAnimationFrame(() => lastModalTriggerRef.current?.focus());
  };

  useEffect(() => {
    if (viewer.kind === "closed") return;
    modalCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewer.kind]);

  const openHistory = (trigger: HTMLElement) => {
    if (!selectedProduct) return;
    lastModalTriggerRef.current = trigger;
    setViewer({ kind: "history", selectedVersionId: currentArtworkVersion(selectedProduct).id });
  };

  const openUpload = (trigger: HTMLElement) => {
    if (!selectedProduct) return;
    lastModalTriggerRef.current = trigger;
    setViewer({ kind: "upload", stage: "select", candidate: null, error: null });
  };

  const chooseUpload = async () => {
    if (!selectedProduct || viewer.kind !== "upload") return;
    try {
      const candidate = await actions.onSelectUploadCandidate(selectedProduct.id);
      if (!candidate) return;
      setViewer({ kind: "upload", stage: "review", candidate, error: null });
    } catch {
      setViewer({ ...viewer, error: "The artwork could not be selected. Please try again." });
    }
  };

  const confirmUpload = async () => {
    if (!selectedProduct || viewer.kind !== "upload" || !viewer.candidate) return;
    const candidate = viewer.candidate;
    setViewer({ kind: "upload", stage: "processing", candidate, error: null });
    try {
      await actions.onConfirmUpload({ productId: selectedProduct.id, candidate });
      setViewer({ kind: "upload", stage: "success", candidate, error: null });
      setActivityMessage(`${candidate.name} completed the fixture upload flow. The current artwork was not replaced.`);
    } catch {
      setViewer({ kind: "upload", stage: "confirm", candidate, error: "The upload could not be completed. The current artwork is unchanged." });
    }
  };

  const openProduct = (product: CatalogProduct) => {
    setSelectedProductId(product.id);
    setDrawerOpen(true);
  };

  const selectedViewerVersion = selectedProduct && viewer.kind === "history"
    ? selectedProduct.versions.find((version) => version.id === viewer.selectedVersionId) ?? currentArtworkVersion(selectedProduct)
    : selectedProduct ? currentArtworkVersion(selectedProduct) : null;

  return (
    <section className={`artwork-catalog-workspace ${drawerOpen ? "artwork-catalog-with-drawer" : ""}`} aria-labelledby="artwork-catalog-title">
      <div className="artwork-catalog-main">
        <header className="artwork-catalog-heading">
          <div>
            <span className="artwork-catalog-eyebrow">{customerLabel}</span>
            <h1 id="artwork-catalog-title">Artwork catalog</h1>
            <p>Manage repeatable print-ready artwork without making technical inspection a prerequisite.</p>
          </div>
          <button type="button" className="artwork-catalog-primary" onClick={actions.onCreateProduct}>
            <Plus size={16} aria-hidden="true" /> New product
          </button>
        </header>

        <div className="artwork-catalog-summary" aria-label="Catalog summary">
          <article><span>Catalog products</span><strong>{totals.products}</strong><small>{totals.products - totals.needsAttention} ready for routine use</small></article>
          <article><span>Human approved</span><strong>{totals.approved}</strong><small>Approval is recorded per version</small></article>
          <article><span>Needs attention</span><strong>{totals.needsAttention}</strong><small>Technical or human follow-up</small></article>
        </div>

        <div className="artwork-catalog-toolbar">
          <label className="artwork-catalog-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search catalog</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, SKU, or category" />
          </label>
          <div className="artwork-catalog-filter" aria-label="Filter by catalog status">
            <Filter size={14} aria-hidden="true" />
            {(["All", "Active", "Draft"] as const).map((filter) => (
              <button key={filter} type="button" aria-pressed={lifecycleFilter === filter} onClick={() => setLifecycleFilter(filter)}>{filter}</button>
            ))}
          </div>
        </div>

        <div className="artwork-catalog-table-wrap">
          <table className="artwork-catalog-table">
            <thead><tr><th>Product</th><th>Specification</th><th>Technical inspection</th><th>Human approval</th><th>Updated</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {filteredProducts.map((product) => {
                const current = currentArtworkVersion(product);
                return (
                  <tr key={product.id} className={selectedProductId === product.id && drawerOpen ? "artwork-catalog-row-selected" : ""}>
                    <td><button type="button" className="artwork-catalog-product-link" onClick={() => openProduct(product)}><ProductArtworkThumb product={product} compact /><span><strong>{product.name}</strong><small>{product.sku} · {product.category}</small></span></button></td>
                    <td><strong>{product.specification[0]?.value}</strong><small>{product.lifecycle}</small></td>
                    <td><StatusBadge label={current.inspection.state} tone={inspectionTone(current.inspection.state)} /></td>
                    <td><StatusBadge label={current.approval.state} tone={approvalTone(current.approval.state)} /></td>
                    <td><strong>{formatDate(product.updatedAt)}</strong><small>Version {current.version}</small></td>
                    <td><button type="button" className="artwork-catalog-icon-button" onClick={() => openProduct(product)} aria-label={`Open ${product.name}`}><ChevronRight size={17} aria-hidden="true" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredProducts.length === 0 ? <div className="artwork-catalog-empty">No products match this view.</div> : null}
        </div>
        <p className="artwork-catalog-live-region" aria-live="polite">{activityMessage}</p>
      </div>

      {selectedProduct && drawerOpen ? (
        <aside className="artwork-catalog-drawer" aria-label={`${selectedProduct.name} product detail`}>
          <header className="artwork-catalog-drawer-header">
            <div><span>{selectedProduct.sku}</span><h2>{selectedProduct.name}</h2><p>{selectedProduct.category} · {selectedProduct.lifecycle}</p></div>
            <button type="button" className="artwork-catalog-icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close product detail"><X size={18} aria-hidden="true" /></button>
          </header>
          <div className="artwork-catalog-drawer-body">
            {(() => {
              const current = currentArtworkVersion(selectedProduct);
              return (
                <>
                  <figure className="artwork-catalog-current-preview">
                    <img src={current.previewUrl} alt={current.previewAlt} />
                    <figcaption><span>Current artwork · Version {current.version}</span><strong>{current.filename}</strong></figcaption>
                  </figure>

                  <div className="artwork-catalog-art-actions">
                    <button type="button" onClick={() => actions.onOpenArtwork({ productId: selectedProduct.id, versionId: current.id })}><ExternalLink size={14} aria-hidden="true" /> Open artwork</button>
                    <button type="button" onClick={() => actions.onDownloadArtwork({ productId: selectedProduct.id, versionId: current.id })}><Download size={14} aria-hidden="true" /> Download</button>
                    <button type="button" onClick={(event) => openHistory(event.currentTarget)}><History size={14} aria-hidden="true" /> Version history ({selectedProduct.versions.length})</button>
                  </div>

                  <section className="artwork-catalog-widget">
                    <header><span className="artwork-catalog-widget-icon"><FileImage size={16} aria-hidden="true" /></span><div><h3>Product specification</h3><p>Expected print intent for artwork checks</p></div></header>
                    <dl className="artwork-catalog-spec-grid">{selectedProduct.specification.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                  </section>

                  <section className="artwork-catalog-widget">
                    <header><span className="artwork-catalog-widget-icon"><ShieldCheck size={16} aria-hidden="true" /></span><div><h3>Technical inspection</h3><p>Optional machine-generated evidence</p></div><StatusBadge label={current.inspection.state} tone={inspectionTone(current.inspection.state)} /></header>
                    <p className="artwork-catalog-widget-summary">{current.inspection.summary}</p>
                    {current.inspection.metrics.length ? <dl className="artwork-catalog-metrics">{current.inspection.metrics.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}
                    <small>{current.inspection.checkedAt ? `Checked ${formatDate(current.inspection.checkedAt, true)}` : "Inspection has not run"}</small>
                  </section>

                  <section className="artwork-catalog-widget">
                    <header><span className="artwork-catalog-widget-icon"><CheckCircle2 size={16} aria-hidden="true" /></span><div><h3>Human approval</h3><p>Recorded independently from technical checks</p></div><StatusBadge label={current.approval.state} tone={approvalTone(current.approval.state)} /></header>
                    <p className="artwork-catalog-widget-summary">{current.approval.summary}</p>
                    <small>{current.approval.reviewedBy ? `${current.approval.reviewedBy} · ${formatDate(current.approval.reviewedAt, true)}` : "No completed review"}</small>
                  </section>

                  <section className="artwork-catalog-widget artwork-catalog-orders">
                    <header><span className="artwork-catalog-widget-icon"><ShoppingBag size={16} aria-hidden="true" /></span><div><h3>Order history</h3><p>Read-only product activity</p></div></header>
                    <div className="artwork-catalog-order-summary"><strong>{selectedProduct.orderHistory.totalOrders}</strong><span>Total orders</span><strong>{selectedProduct.orderHistory.openOrderCount}</strong><span>Open / in production</span><strong>{formatDate(selectedProduct.orderHistory.lastOrderedAt)}</strong><span>Last ordered</span></div>
                    {selectedProduct.orderHistory.recentReferences.length ? <ul>{selectedProduct.orderHistory.recentReferences.slice(0, 3).map((order) => <li key={order.reference}><span><strong>{order.reference}</strong><small>{formatDate(order.orderedAt, true)}</small></span><StatusBadge label={order.status} tone={order.status === "Complete" ? "success" : "neutral"} /></li>)}</ul> : <p className="artwork-catalog-widget-summary">No order references yet.</p>}
                    <button type="button" className="artwork-catalog-text-button" onClick={() => actions.onOpenFullOrderHistory(selectedProduct.id)}>View full order history <ChevronRight size={14} aria-hidden="true" /></button>
                  </section>
                </>
              );
            })()}
          </div>
          <footer className="artwork-catalog-drawer-footer">
            <button type="button" className="artwork-catalog-primary artwork-catalog-primary-wide" onClick={(event) => openUpload(event.currentTarget)}><Upload size={16} aria-hidden="true" /> Upload new version</button>
            <p>The current version stays in place until a future explicit activation decision.</p>
          </footer>
        </aside>
      ) : null}

      {selectedProduct && viewer.kind !== "closed" && selectedViewerVersion ? (
        <div className="artwork-catalog-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeViewer(); }}>
          <section className="artwork-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="artwork-viewer-title">
            <header className="artwork-catalog-modal-header">
              <div><span>{selectedProduct.name}</span><h2 id="artwork-viewer-title">{viewer.kind === "history" ? "Artwork viewer" : "Upload new version"}</h2><p>{viewer.kind === "history" ? `Review ${selectedProduct.versions.length} immutable artwork versions.` : "Select, review, and confirm without replacing the current artwork."}</p></div>
              <button ref={modalCloseRef} type="button" className="artwork-catalog-icon-button" onClick={closeViewer} aria-label="Close artwork viewer"><X size={19} aria-hidden="true" /></button>
            </header>

            {viewer.kind === "history" ? (
              <div className="artwork-catalog-viewer-body">
                <div className="artwork-catalog-viewer-preview">
                  <img src={selectedViewerVersion.previewUrl} alt={selectedViewerVersion.previewAlt} />
                  <div><span>Version {selectedViewerVersion.version}{selectedViewerVersion.isCurrent ? " · Current" : " · Historical"}</span><strong>{selectedViewerVersion.filename}</strong><small>{selectedViewerVersion.fileSize} · Uploaded {formatDate(selectedViewerVersion.uploadedAt, true)} by {selectedViewerVersion.uploadedBy}</small></div>
                  <div className="artwork-catalog-viewer-actions"><button type="button" onClick={() => actions.onOpenArtwork({ productId: selectedProduct.id, versionId: selectedViewerVersion.id })}><Eye size={14} aria-hidden="true" /> Open</button><button type="button" onClick={() => actions.onDownloadArtwork({ productId: selectedProduct.id, versionId: selectedViewerVersion.id })}><Download size={14} aria-hidden="true" /> Download</button></div>
                </div>
                <div className="artwork-catalog-version-panel">
                  <header><h3>Version history</h3><span>Newest first</span></header>
                  <div className="artwork-catalog-version-list">{selectedProduct.versions.map((version) => <button key={version.id} type="button" className={version.id === selectedViewerVersion.id ? "artwork-catalog-version-selected" : ""} onClick={() => setViewer({ kind: "history", selectedVersionId: version.id })} aria-pressed={version.id === selectedViewerVersion.id}><ProductArtworkThumb product={selectedProduct} version={version} compact /><span><strong>Version {version.version}{version.isCurrent ? " · Current" : ""}</strong><small>{version.filename}</small><small>{formatDate(version.uploadedAt, true)} · {version.uploadedBy}</small></span><StatusBadge label={version.inspection.state} tone={inspectionTone(version.inspection.state)} /></button>)}</div>
                  <p>Historical versions are immutable. They can be opened or downloaded, but not deleted, overwritten, or restored here.</p>
                </div>
              </div>
            ) : (
              <div className="artwork-catalog-upload-body">
                <ol className="artwork-catalog-upload-steps" aria-label="Upload progress">{(["Select", "Review", "Confirm", "Processing", "Success"] as const).map((label, index) => {
                  const activeIndex = ["select", "review", "confirm", "processing", "success"].indexOf(viewer.stage);
                  return <li key={label} className={index <= activeIndex ? "artwork-catalog-upload-step-active" : ""} aria-current={index === activeIndex ? "step" : undefined}><span>{index < activeIndex ? <Check size={12} aria-hidden="true" /> : index + 1}</span>{label}</li>;
                })}</ol>
                <div className="artwork-catalog-upload-content">
                  {viewer.stage === "select" ? <div className="artwork-catalog-upload-select"><span><Upload size={28} aria-hidden="true" /></span><h3>Select the next artwork version</h3><p>The fixture action returns local file metadata only. Nothing is uploaded or stored in this slice.</p></div> : null}
                  {viewer.stage === "review" && viewer.candidate ? <div className="artwork-catalog-upload-review"><span><FileImage size={22} aria-hidden="true" /></span><div><h3>{viewer.candidate.name}</h3><p>{viewer.candidate.fileType} · {viewer.candidate.fileSize} · Proposed version {viewer.candidate.expectedVersion}</p></div><StatusBadge label="Ready to review" tone="neutral" /></div> : null}
                  {viewer.stage === "confirm" && viewer.candidate ? <div className="artwork-catalog-upload-confirm"><ShieldCheck size={30} aria-hidden="true" /><h3>Confirm fixture processing</h3><p><strong>{viewer.candidate.name}</strong> will move through the injected demo action. Version {currentArtworkVersion(selectedProduct).version} remains current throughout this flow.</p><ul><li>Technical inspection may run later and remains optional.</li><li>Human approval is a separate decision.</li><li>No file is stored and no version is activated by this prototype.</li></ul></div> : null}
                  {viewer.stage === "processing" ? <div className="artwork-catalog-upload-select"><span><LoaderCircle className="artwork-catalog-spinner" size={28} aria-hidden="true" /></span><h3>Processing fixture response</h3><p>The existing current artwork remains available while checks are incomplete.</p></div> : null}
                  {viewer.stage === "success" && viewer.candidate ? <div className="artwork-catalog-upload-success"><span><CheckCircle2 size={28} aria-hidden="true" /></span><h3>Fixture flow complete</h3><p>{viewer.candidate.name} completed the demo path. It has not replaced the current version, passed inspection, or received human approval.</p></div> : null}
                  {viewer.error ? <p className="artwork-catalog-upload-error" role="alert">{viewer.error}</p> : null}
                </div>
              </div>
            )}

            <footer className="artwork-catalog-modal-footer">
              {viewer.kind === "history" || viewer.stage === "success" ? <button type="button" className="artwork-catalog-secondary" onClick={closeViewer}>Close</button> : null}
              {viewer.kind === "upload" && viewer.stage === "select" ? <button type="button" className="artwork-catalog-primary" onClick={chooseUpload}>Choose artwork</button> : null}
              {viewer.kind === "upload" && viewer.stage === "review" ? <><button type="button" className="artwork-catalog-secondary" onClick={() => setViewer({ ...viewer, stage: "select", candidate: null })}>Back</button><button type="button" className="artwork-catalog-primary" onClick={() => setViewer({ ...viewer, stage: "confirm" })}>Review upload safeguards</button></> : null}
              {viewer.kind === "upload" && viewer.stage === "confirm" ? <><button type="button" className="artwork-catalog-secondary" onClick={() => setViewer({ ...viewer, stage: "review" })}>Back</button><button type="button" className="artwork-catalog-primary" onClick={confirmUpload}>Confirm fixture upload</button></> : null}
              {viewer.kind === "upload" && viewer.stage === "processing" ? <span className="artwork-catalog-processing-note">Please keep this dialog open.</span> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
