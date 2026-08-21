import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  Filter,
  History,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  PencilLine,
  Power,
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
  CatalogLifecycle,
  CatalogProduct,
  InspectionState,
  UploadCandidate
} from "./fixtures";
import type { ArtworkUploadBatch, ArtworkUploadProgress } from "./artwork-upload-analysis";

export type UploadStage = "select" | "review" | "processing";

export type CatalogFilterSelection = {
  lifecycles: ReadonlyArray<CatalogLifecycle>;
  inspections: ReadonlyArray<InspectionState>;
  approvals: ReadonlyArray<ApprovalState>;
};

export type ProductSpecificationDraft = {
  width: string;
  height: string;
  units: "in" | "ft" | "mm" | "cm";
  targetDpi: string;
  color: string;
};

export function nextUploadStage(stage: UploadStage): UploadStage {
  if (stage === "select") return "review";
  return "processing";
}

export function firstDroppedArtwork(files: ArrayLike<File>): File | undefined {
  return files.length > 0 ? files[0] : undefined;
}

export function currentArtworkVersion(product: CatalogProduct): ArtworkVersion {
  const current = product.versions.filter((version) => version.isCurrent);
  if (current.length !== 1) {
    throw new Error(`Catalog product ${product.id} must have exactly one current artwork version.`);
  }
  return current[0];
}

export function effectiveCatalogLifecycle(
  product: CatalogProduct,
  overrides: Readonly<Record<string, CatalogLifecycle>>
): CatalogLifecycle {
  return overrides[product.id] ?? product.lifecycle;
}

export function filterCatalogProducts(
  products: ReadonlyArray<CatalogProduct>,
  query: string,
  filters: CatalogFilterSelection,
  lifecycleOverrides: Readonly<Record<string, CatalogLifecycle>> = {}
): ReadonlyArray<CatalogProduct> {
  const normalizedQuery = query.trim().toLowerCase();
  return products.filter((product) => {
    const current = currentArtworkVersion(product);
    const lifecycle = effectiveCatalogLifecycle(product, lifecycleOverrides);
    const matchesLifecycle = filters.lifecycles.length === 0 || filters.lifecycles.includes(lifecycle);
    const matchesInspection = filters.inspections.length === 0 || filters.inspections.includes(current.inspection.state);
    const matchesApproval = filters.approvals.length === 0 || filters.approvals.includes(current.approval.state);
    const matchesQuery = !normalizedQuery || [product.name, product.sku, product.category]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
    return matchesLifecycle && matchesInspection && matchesApproval && matchesQuery;
  });
}

function toggleFilterValue<T extends string>(values: ReadonlyArray<T>, value: T): ReadonlyArray<T> {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

function specificationValue(specification: CatalogProduct["specification"], label: string): string {
  return specification.find((item) => item.label === label)?.value ?? "";
}

export function productSpecificationDraft(
  product: CatalogProduct,
  specification: CatalogProduct["specification"] = product.specification
): ProductSpecificationDraft {
  const size = specificationValue(specification, "Finished size").match(/^([\d.]+)\s*[×x]\s*([\d.]+)\s*(in|ft|mm|cm)$/i);
  return {
    width: size?.[1] ?? "",
    height: size?.[2] ?? "",
    units: (size?.[3]?.toLowerCase() as ProductSpecificationDraft["units"] | undefined) ?? "in",
    targetDpi: specificationValue(specification, "Target resolution").replace(/\s*DPI$/i, ""),
    color: specificationValue(specification, "Color") || "CMYK"
  };
}

export function applyProductSpecificationDraft(
  product: CatalogProduct,
  draft: ProductSpecificationDraft
): CatalogProduct["specification"] {
  const replacements = new Map([
    ["Finished size", `${draft.width} × ${draft.height} ${draft.units}`],
    ["Target resolution", `${draft.targetDpi} DPI`],
    ["Color", draft.color]
  ]);
  return product.specification.map((item) => ({ ...item, value: replacements.get(item.label) ?? item.value }));
}

type ViewerState =
  | { kind: "closed" }
  | { kind: "history"; selectedVersionId: string }
  | { kind: "specification" }
  | {
      kind: "upload";
      stage: UploadStage;
      candidate: (UploadCandidate & { file?: File }) | null;
      batch: ArtworkUploadBatch | null;
      progressLabel: string;
      error: string | null;
    };

export type ArtworkCatalogWorkspaceProps = {
  customerLabel: string;
  products: ReadonlyArray<CatalogProduct>;
  actions: ArtworkCatalogActions;
  initialProductId?: string;
  onOpenTechnicalInspection?: (input: { productId: string; versionId: string }) => void;
  onAnalyzeLocalArtwork?: (input: {
    product: CatalogProduct;
    file: File;
    onProgress: (progress: ArtworkUploadProgress) => void;
  }) => Promise<ArtworkUploadBatch>;
  onOpenLocalInspection?: (batch: ArtworkUploadBatch) => void;
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
  initialProductId,
  onOpenTechnicalInspection,
  onAnalyzeLocalArtwork,
  onOpenLocalInspection
}: ArtworkCatalogWorkspaceProps) {
  const initialProduct = products.find((product) => product.id === initialProductId) ?? products[0] ?? null;
  const [selectedProductId, setSelectedProductId] = useState<string | null>(initialProduct?.id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialProduct));
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "cards">("list");
  const [lifecycleFilters, setLifecycleFilters] = useState<ReadonlyArray<CatalogLifecycle>>([]);
  const [inspectionFilters, setInspectionFilters] = useState<ReadonlyArray<InspectionState>>([]);
  const [approvalFilters, setApprovalFilters] = useState<ReadonlyArray<ApprovalState>>([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [lifecycleOverrides, setLifecycleOverrides] = useState<Readonly<Record<string, CatalogLifecycle>>>({});
  const [specificationOverrides, setSpecificationOverrides] = useState<Readonly<Record<string, CatalogProduct["specification"]>>>({});
  const [specificationDraft, setSpecificationDraft] = useState<ProductSpecificationDraft | null>(null);
  const [specificationError, setSpecificationError] = useState("");
  const [pendingLifecycle, setPendingLifecycle] = useState<{ productId: string; next: "Active" | "Inactive" } | null>(null);
  const [viewer, setViewer] = useState<ViewerState>({ kind: "closed" });
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [activityMessage, setActivityMessage] = useState("");
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const lastModalTriggerRef = useRef<HTMLElement | null>(null);

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const filters = useMemo<CatalogFilterSelection>(() => ({
    lifecycles: lifecycleFilters,
    inspections: inspectionFilters,
    approvals: approvalFilters
  }), [approvalFilters, inspectionFilters, lifecycleFilters]);
  const filteredProducts = useMemo(
    () => filterCatalogProducts(products, query, filters, lifecycleOverrides),
    [filters, lifecycleOverrides, products, query]
  );
  const activeFilterCount = lifecycleFilters.length + inspectionFilters.length + approvalFilters.length;
  const activeFilterChips = useMemo(() => [
    ...lifecycleFilters.map((value) => ({ key: `lifecycle-${value}`, label: `Status: ${value}`, remove: () => setLifecycleFilters((current) => current.filter((candidate) => candidate !== value)) })),
    ...inspectionFilters.map((value) => ({ key: `inspection-${value}`, label: `Inspection: ${value}`, remove: () => setInspectionFilters((current) => current.filter((candidate) => candidate !== value)) })),
    ...approvalFilters.map((value) => ({ key: `approval-${value}`, label: `Proof approval: ${value}`, remove: () => setApprovalFilters((current) => current.filter((candidate) => candidate !== value)) }))
  ], [approvalFilters, inspectionFilters, lifecycleFilters]);

  const totals = useMemo(() => ({
    products: products.length,
    approved: products.filter((product) => currentArtworkVersion(product).approval.state === "Approved").length,
    needsAttention: products.filter((product) => {
      const current = currentArtworkVersion(product);
      return current.inspection.state === "Needs work" || current.approval.state === "Needs review";
    }).length
  }), [products]);

  useEffect(() => {
    if (!filterPanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(event.target as Node)) {
        setFilterPanelOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterPanelOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [filterPanelOpen]);

  const closeViewer = () => {
    if (viewer.kind === "upload" && viewer.stage === "processing") return;
    setViewer({ kind: "closed" });
    setUploadDragActive(false);
    setSpecificationDraft(null);
    setSpecificationError("");
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
  }, [viewer]);

  const openHistory = (trigger: HTMLElement) => {
    if (!selectedProduct) return;
    lastModalTriggerRef.current = trigger;
    setViewer({ kind: "history", selectedVersionId: currentArtworkVersion(selectedProduct).id });
  };

  const openUpload = (trigger: HTMLElement) => {
    if (!selectedProduct) return;
    lastModalTriggerRef.current = trigger;
    setViewer({ kind: "upload", stage: "select", candidate: null, batch: null, progressLabel: "", error: null });
  };

  const openSpecification = (trigger: HTMLElement) => {
    if (!selectedProduct) return;
    const effectiveSpecification = specificationOverrides[selectedProduct.id] ?? selectedProduct.specification;
    lastModalTriggerRef.current = trigger;
    setSpecificationDraft(productSpecificationDraft(selectedProduct, effectiveSpecification));
    setSpecificationError("");
    setViewer({ kind: "specification" });
  };

  const chooseUpload = async () => {
    if (!selectedProduct || viewer.kind !== "upload") return;
    if (onAnalyzeLocalArtwork) {
      uploadInputRef.current?.click();
      return;
    }
    try {
      const candidate = await actions.onSelectUploadCandidate(selectedProduct.id);
      if (!candidate) return;
      setViewer({ kind: "upload", stage: "review", candidate, batch: null, progressLabel: "", error: null });
    } catch {
      setViewer({ ...viewer, error: "The artwork could not be selected. Please try again." });
    }
  };

  const selectLocalArtwork = (file: File | undefined) => {
    if (!file || !selectedProduct || viewer.kind !== "upload") return;
    setViewer({
      kind: "upload",
      stage: "review",
      candidate: {
        name: file.name,
        fileSize: `${(file.size / 1024 ** 2).toFixed(file.size >= 1024 ** 2 ? 1 : 2)} MB`,
        fileType: file.type || "Detected from file signature",
        expectedVersion: currentArtworkVersion(selectedProduct).version + 1,
        file
      },
      batch: null,
      progressLabel: "File selected",
      error: null
    });
  };

  const dropLocalArtwork = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setUploadDragActive(false);
    selectLocalArtwork(firstDroppedArtwork(event.dataTransfer.files));
  };

  const runInspection = async () => {
    if (!selectedProduct || viewer.kind !== "upload" || !viewer.candidate) return;
    const candidate = viewer.candidate;
    setViewer({ kind: "upload", stage: "processing", candidate, batch: null, progressLabel: "Starting local analysis", error: null });
    try {
      if (onAnalyzeLocalArtwork && candidate.file) {
        const batch = await onAnalyzeLocalArtwork({
          product: selectedProduct,
          file: candidate.file,
          onProgress: (progress) => setViewer((current) => current.kind === "upload"
            ? { ...current, stage: "processing", progressLabel: progress.label }
            : current)
        });
        setActivityMessage(`${candidate.name} was analyzed locally. The file was not uploaded and the current artwork remains Version ${currentArtworkVersion(selectedProduct).version}.`);
        if (onOpenLocalInspection) {
          onOpenLocalInspection(batch);
          return;
        }
        setViewer({ kind: "upload", stage: "review", candidate, batch, progressLabel: "Technical inspection ready", error: "The inspection finished, but the results workspace is unavailable." });
        return;
      }
      await actions.onConfirmUpload({ productId: selectedProduct.id, candidate });
      setActivityMessage(`${candidate.name} completed the fixture upload flow. The current artwork was not replaced.`);
      closeViewer();
    } catch {
      setViewer({ kind: "upload", stage: "review", candidate, batch: null, progressLabel: "", error: "The file could not be analyzed. The current artwork is unchanged." });
    }
  };

  const openProduct = (product: CatalogProduct) => {
    setSelectedProductId(product.id);
    setDrawerOpen(true);
    setPendingLifecycle(null);
  };

  const clearFilters = () => {
    setLifecycleFilters([]);
    setInspectionFilters([]);
    setApprovalFilters([]);
  };

  const confirmLifecycleChange = () => {
    if (!selectedProduct || pendingLifecycle?.productId !== selectedProduct.id) return;
    const next = pendingLifecycle.next;
    setLifecycleOverrides((current) => ({ ...current, [selectedProduct.id]: next }));
    setPendingLifecycle(null);
    setActivityMessage(`${selectedProduct.name} is ${next.toLowerCase()} in this prototype view. No catalog data was saved.`);
  };

  const applySpecificationChange = () => {
    if (!selectedProduct || !specificationDraft) return;
    const numericValues = [specificationDraft.width, specificationDraft.height, specificationDraft.targetDpi].map(Number);
    if (numericValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      setSpecificationError("Enter a width, height, and target resolution greater than zero.");
      return;
    }
    setSpecificationOverrides((current) => ({
      ...current,
      [selectedProduct.id]: applyProductSpecificationDraft(selectedProduct, specificationDraft)
    }));
    setActivityMessage(`${selectedProduct.name} specifications were updated in this prototype view. No catalog data was saved.`);
    closeViewer();
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
          <article><span>Proof approved</span><strong>{totals.approved}</strong><small>Approval is recorded per artwork version</small></article>
          <article><span>Needs attention</span><strong>{totals.needsAttention}</strong><small>Technical or proof follow-up</small></article>
        </div>

        <div className="artwork-catalog-toolbar">
          <label className="artwork-catalog-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search catalog</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, SKU, or category" />
          </label>
          <div className="artwork-catalog-filter-control" ref={filterPanelRef}>
            <button
              type="button"
              className="artwork-catalog-filter-trigger"
              aria-expanded={filterPanelOpen}
              aria-controls="artwork-catalog-filter-panel"
              onClick={() => setFilterPanelOpen((current) => !current)}
            >
              <Filter size={15} aria-hidden="true" /> Filters
              {activeFilterCount ? <span aria-label={`${activeFilterCount} active filters`}>{activeFilterCount}</span> : null}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {filterPanelOpen ? (
              <section id="artwork-catalog-filter-panel" className="artwork-catalog-filter-panel" aria-label="Catalog filters">
                <header><div><strong>Filter products</strong><span>Narrow this workspace without changing catalog data.</span></div><button type="button" className="artwork-catalog-icon-button" onClick={() => setFilterPanelOpen(false)} aria-label="Close filters"><X size={16} aria-hidden="true" /></button></header>
                <fieldset><legend>Catalog status</legend><div>{(["Active", "Inactive", "Draft"] as const).map((value) => <button key={value} type="button" aria-pressed={lifecycleFilters.includes(value)} onClick={() => setLifecycleFilters((current) => toggleFilterValue(current, value))}>{lifecycleFilters.includes(value) ? <Check size={13} aria-hidden="true" /> : null}{value}</button>)}</div></fieldset>
                <fieldset><legend>Technical inspection</legend><div>{(["Passed", "Needs work", "Not run"] as const).map((value) => <button key={value} type="button" aria-pressed={inspectionFilters.includes(value)} onClick={() => setInspectionFilters((current) => toggleFilterValue(current, value))}>{inspectionFilters.includes(value) ? <Check size={13} aria-hidden="true" /> : null}{value}</button>)}</div></fieldset>
                <fieldset><legend>Proof approval</legend><div>{(["Approved", "Pending", "Needs review"] as const).map((value) => <button key={value} type="button" aria-pressed={approvalFilters.includes(value)} onClick={() => setApprovalFilters((current) => toggleFilterValue(current, value))}>{approvalFilters.includes(value) ? <Check size={13} aria-hidden="true" /> : null}{value}</button>)}</div></fieldset>
                <footer><span>{filteredProducts.length} of {products.length} products</span><button type="button" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear all</button></footer>
              </section>
            ) : null}
          </div>
          <div className="artwork-catalog-view-toggle" role="group" aria-label="Catalog view">
            <button type="button" aria-label="List view" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}><List size={15} aria-hidden="true" /><span>List</span></button>
            <button type="button" aria-label="Card view" aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")}><LayoutGrid size={15} aria-hidden="true" /><span>Cards</span></button>
          </div>
        </div>

        {activeFilterChips.length ? (
          <div className="artwork-catalog-filter-chips" aria-label="Active filters">
            {activeFilterChips.map((chip) => <button key={chip.key} type="button" onClick={chip.remove}>{chip.label}<X size={13} aria-hidden="true" /><span className="sr-only">Remove {chip.label}</span></button>)}
            <button type="button" className="artwork-catalog-clear-filters" onClick={clearFilters}>Clear all</button>
          </div>
        ) : null}

        {viewMode === "list" ? (
          <div className="artwork-catalog-table-wrap">
            <table className="artwork-catalog-table">
              <thead><tr><th>Product</th><th>Specification</th><th>Technical inspection</th><th>Proof approval</th><th>Updated</th></tr></thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const current = currentArtworkVersion(product);
                  const lifecycle = effectiveCatalogLifecycle(product, lifecycleOverrides);
                  const effectiveSpecification = specificationOverrides[product.id] ?? product.specification;
                  return (
                    <tr key={product.id} className={selectedProductId === product.id && drawerOpen ? "artwork-catalog-row-selected" : ""}>
                      <td><button type="button" className="artwork-catalog-product-link" onClick={() => openProduct(product)}><ProductArtworkThumb product={product} compact /><span><strong>{product.name}</strong><small>{product.sku} · {product.category}</small></span><span className="artwork-catalog-product-open"><span>Open details</span><ChevronRight size={17} aria-hidden="true" /></span></button></td>
                      <td data-label="Specification"><strong>{effectiveSpecification[0]?.value}</strong><small>{lifecycle}</small></td>
                      <td data-label="Technical inspection"><StatusBadge label={current.inspection.state} tone={inspectionTone(current.inspection.state)} /></td>
                      <td data-label="Proof approval"><StatusBadge label={current.approval.state} tone={approvalTone(current.approval.state)} /></td>
                      <td data-label="Updated"><strong>{formatDate(product.updatedAt)}</strong><small>Version {current.version}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredProducts.length === 0 ? <div className="artwork-catalog-empty">No products match this view.</div> : null}
          </div>
        ) : (
          <div className="artwork-catalog-card-grid" aria-label="Catalog products in card view">
            {filteredProducts.map((product) => {
              const current = currentArtworkVersion(product);
              const lifecycle = effectiveCatalogLifecycle(product, lifecycleOverrides);
              const effectiveSpecification = specificationOverrides[product.id] ?? product.specification;
              return (
                <article key={product.id} className={selectedProductId === product.id && drawerOpen ? "artwork-catalog-card artwork-catalog-card-selected" : "artwork-catalog-card"}>
                  <button type="button" onClick={() => openProduct(product)} aria-label={`Open ${product.name} details`}>
                    <figure className={product.id === "product_1249_pump_topper_chevron" ? "artwork-catalog-card-art" : "artwork-catalog-card-art artwork-catalog-card-art-empty"}>
                      {product.id === "product_1249_pump_topper_chevron" ? <img src={current.previewUrl} alt={current.previewAlt} /> : <><FileImage size={28} aria-hidden="true" /><span>Artwork preview</span></>}
                      <figcaption><span>{lifecycle}</span><small>Version {current.version}</small></figcaption>
                    </figure>
                    <div className="artwork-catalog-card-body">
                      <header><div><span>{product.sku}</span><h2>{product.name}</h2><p>{product.category}</p></div><ChevronRight size={18} aria-hidden="true" /></header>
                      <dl><div><dt>Finished size</dt><dd>{specificationValue(effectiveSpecification, "Finished size")}</dd></div><div><dt>Print product</dt><dd>{specificationValue(effectiveSpecification, "Print product")}</dd></div></dl>
                      <div className="artwork-catalog-card-statuses"><StatusBadge label={current.inspection.state} tone={inspectionTone(current.inspection.state)} /><StatusBadge label={current.approval.state} tone={approvalTone(current.approval.state)} /></div>
                      <footer><span>Updated {formatDate(product.updatedAt)}</span><strong>Open details</strong></footer>
                    </div>
                  </button>
                </article>
              );
            })}
            {filteredProducts.length === 0 ? <div className="artwork-catalog-empty">No products match this view.</div> : null}
          </div>
        )}
        <p className="artwork-catalog-live-region" aria-live="polite">{activityMessage}</p>
      </div>

      {selectedProduct && drawerOpen ? (
        <aside className="artwork-catalog-drawer" aria-label={`${selectedProduct.name} product detail`}>
          <header className="artwork-catalog-drawer-header">
            <div><span>{selectedProduct.sku}</span><h2>{selectedProduct.name}</h2><p>{selectedProduct.category}</p></div>
            <div className="artwork-catalog-drawer-header-actions">
              <button
                type="button"
                className={`artwork-catalog-lifecycle artwork-catalog-lifecycle-${effectiveCatalogLifecycle(selectedProduct, lifecycleOverrides).toLowerCase()}`}
                onClick={() => {
                  const current = effectiveCatalogLifecycle(selectedProduct, lifecycleOverrides);
                  setPendingLifecycle({ productId: selectedProduct.id, next: current === "Active" ? "Inactive" : "Active" });
                }}
                aria-label={`Change catalog item status. Current status ${effectiveCatalogLifecycle(selectedProduct, lifecycleOverrides)}`}
              ><Power size={13} aria-hidden="true" /> {effectiveCatalogLifecycle(selectedProduct, lifecycleOverrides)} <ChevronDown size={13} aria-hidden="true" /></button>
              <button type="button" className="artwork-catalog-icon-button" onClick={() => { setDrawerOpen(false); setPendingLifecycle(null); }} aria-label="Close product detail"><X size={18} aria-hidden="true" /></button>
            </div>
          </header>
          <div className="artwork-catalog-drawer-body">
            {(() => {
              const current = currentArtworkVersion(selectedProduct);
              const lifecycle = effectiveCatalogLifecycle(selectedProduct, lifecycleOverrides);
              const effectiveSpecification = specificationOverrides[selectedProduct.id] ?? selectedProduct.specification;
              return (
                <>
                  {pendingLifecycle?.productId === selectedProduct.id ? (
                    <section className="artwork-catalog-lifecycle-confirmation" aria-labelledby="artwork-catalog-lifecycle-title">
                      <div><span><Power size={17} aria-hidden="true" /></span><div><h3 id="artwork-catalog-lifecycle-title">Make this item {pendingLifecycle.next.toLowerCase()}?</h3><p>{pendingLifecycle.next === "Inactive" ? "It stays in history but will not be available for new orders." : "It will be available for new orders again."}</p></div></div>
                      <p>This changes the local prototype only. A future connected action will require authorization and retain an actor-and-time audit record.</p>
                      <footer><button type="button" className="artwork-catalog-secondary" onClick={() => setPendingLifecycle(null)}>Cancel</button><button type="button" className={pendingLifecycle.next === "Inactive" ? "artwork-catalog-warning-action" : "artwork-catalog-primary"} onClick={confirmLifecycleChange}>Make {pendingLifecycle.next.toLowerCase()}</button></footer>
                    </section>
                  ) : null}
                  <figure className="artwork-catalog-current-preview">
                    <img src={current.previewUrl} alt={current.previewAlt} />
                    <figcaption><span>Current artwork · Version {current.version}</span><strong>{current.filename}</strong><small>Catalog item · {lifecycle}</small></figcaption>
                  </figure>

                  <div className="artwork-catalog-art-actions">
                    <button type="button" onClick={() => actions.onOpenArtwork({ productId: selectedProduct.id, versionId: current.id })}><ExternalLink size={14} aria-hidden="true" /> Open artwork</button>
                    <button type="button" onClick={() => actions.onDownloadArtwork({ productId: selectedProduct.id, versionId: current.id })}><Download size={14} aria-hidden="true" /> Download</button>
                    <button type="button" onClick={(event) => openHistory(event.currentTarget)}><History size={14} aria-hidden="true" /> Version history ({selectedProduct.versions.length})</button>
                  </div>

                  <section className="artwork-catalog-widget">
                    <header><span className="artwork-catalog-widget-icon"><FileImage size={16} aria-hidden="true" /></span><div><h3>Product specification</h3><p>Expected print intent for artwork checks</p></div><button type="button" className="artwork-catalog-widget-action" onClick={(event) => openSpecification(event.currentTarget)}><PencilLine size={12} aria-hidden="true" /> Edit</button></header>
                    <dl className="artwork-catalog-spec-grid">{effectiveSpecification.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                  </section>

                  <section className="artwork-catalog-widget">
                    <header><span className="artwork-catalog-widget-icon"><ShieldCheck size={16} aria-hidden="true" /></span><div><h3>Technical inspection</h3><p>Optional machine-generated evidence</p></div><StatusBadge label={current.inspection.state} tone={inspectionTone(current.inspection.state)} /></header>
                    <p className="artwork-catalog-widget-summary">{current.inspection.summary}</p>
                    {current.inspection.metrics.length ? <dl className="artwork-catalog-metrics">{current.inspection.metrics.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null}
                    <small>{current.inspection.checkedAt ? `Checked ${formatDate(current.inspection.checkedAt, true)}` : "Inspection has not run"}</small>
                    {onOpenTechnicalInspection && current.inspection.checkedAt ? (
                      <button
                        type="button"
                        className="artwork-catalog-inspection-action"
                        onClick={() => onOpenTechnicalInspection({ productId: selectedProduct.id, versionId: current.id })}
                      >
                        <span><Eye size={14} aria-hidden="true" /> View results</span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </section>

                  <section className="artwork-catalog-widget">
                    <header><span className="artwork-catalog-widget-icon"><CheckCircle2 size={16} aria-hidden="true" /></span><div><h3>Proof approval</h3><p>Approval by the prepress team and customer for print production</p></div><StatusBadge label={current.approval.state} tone={approvalTone(current.approval.state)} /></header>
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
            <button type="button" className="artwork-catalog-primary artwork-catalog-primary-wide" onClick={(event) => openUpload(event.currentTarget)}><Upload size={16} aria-hidden="true" /> {onAnalyzeLocalArtwork ? "Check new artwork" : "Upload new version"}</button>
            <p>The current version stays in place until a future explicit activation decision.</p>
          </footer>
        </aside>
      ) : null}

      {selectedProduct && viewer.kind !== "closed" && selectedViewerVersion ? (
        <div className="artwork-catalog-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !(viewer.kind === "upload" && viewer.stage === "processing")) closeViewer(); }}>
          <section className={`artwork-catalog-modal ${viewer.kind === "specification" ? "artwork-catalog-specification-modal" : viewer.kind === "upload" ? "artwork-catalog-upload-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="artwork-viewer-title">
            <header className="artwork-catalog-modal-header">
              <div><span>{selectedProduct.name}</span><h2 id="artwork-viewer-title">{viewer.kind === "history" ? "Artwork viewer" : viewer.kind === "specification" ? "Product configuration" : onAnalyzeLocalArtwork ? "Check new artwork" : "Upload new version"}</h2><p>{viewer.kind === "history" ? `Review ${selectedProduct.versions.length} immutable artwork versions.` : viewer.kind === "specification" ? "Set the finished artwork requirements for this catalog item." : onAnalyzeLocalArtwork ? "Analyze a local file without uploading, storing, or replacing the current artwork." : "Select, review, and confirm without replacing the current artwork."}</p></div>
              <button ref={modalCloseRef} type="button" className="artwork-catalog-icon-button" onClick={closeViewer} aria-label="Close dialog" disabled={viewer.kind === "upload" && viewer.stage === "processing"}><X size={19} aria-hidden="true" /></button>
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
            ) : viewer.kind === "specification" ? (
              specificationDraft ? <form className="artwork-catalog-specification-body" onSubmit={(event) => { event.preventDefault(); applySpecificationChange(); }}>
                <section aria-labelledby="artwork-requirements-title">
                  <header><div><h3 id="artwork-requirements-title">Artwork requirements</h3><p>These values describe the expected finished file and guide technical inspection.</p></div><span>Editable</span></header>
                  <div className="artwork-catalog-form-grid">
                    <label><span>Finished width</span><div><input type="number" min="0.01" step="0.01" inputMode="decimal" value={specificationDraft.width} onChange={(event) => setSpecificationDraft({ ...specificationDraft, width: event.target.value })} /><select aria-label="Width units" value={specificationDraft.units} onChange={(event) => setSpecificationDraft({ ...specificationDraft, units: event.target.value as ProductSpecificationDraft["units"] })}><option value="in">in</option><option value="ft">ft</option><option value="mm">mm</option><option value="cm">cm</option></select></div></label>
                    <label><span>Finished height</span><div><input type="number" min="0.01" step="0.01" inputMode="decimal" value={specificationDraft.height} onChange={(event) => setSpecificationDraft({ ...specificationDraft, height: event.target.value })} /><span className="artwork-catalog-input-suffix">{specificationDraft.units}</span></div></label>
                    <label><span>Target resolution</span><div><input type="number" min="1" step="1" inputMode="numeric" value={specificationDraft.targetDpi} onChange={(event) => setSpecificationDraft({ ...specificationDraft, targetDpi: event.target.value })} /><span className="artwork-catalog-input-suffix">DPI</span></div></label>
                    <label><span>Color space</span><select value={specificationDraft.color} onChange={(event) => setSpecificationDraft({ ...specificationDraft, color: event.target.value })}><option value="CMYK">CMYK</option><option value="RGB">RGB</option><option value="Grayscale">Grayscale</option></select></label>
                  </div>
                </section>
                <section className="artwork-catalog-manufacturing" aria-labelledby="manufacturing-configuration-title">
                  <header><div><h3 id="manufacturing-configuration-title">Manufacturing configuration</h3><p>Production-specific fields come from the product configuration this catalog item is based on.</p></div><span>Future</span></header>
                  <div className="artwork-catalog-manufacturing-summary"><Info size={17} aria-hidden="true" /><div><strong>{specificationValue(selectedProduct.specification, "Print product") || selectedProduct.category}</strong><p>Finishing, hardware, print sides, and other product-specific options will appear here when the product model is connected.</p></div></div>
                  <p className="artwork-catalog-form-note">Manufacturing configuration is read-only in this prototype and is not included in this save.</p>
                </section>
                {specificationError ? <p className="artwork-catalog-form-error" role="alert">{specificationError}</p> : null}
              </form> : <div className="artwork-catalog-specification-body"><p className="artwork-catalog-form-error" role="alert">Product configuration could not be loaded.</p></div>
            ) : (
              <div className="artwork-catalog-upload-body">
                <div className="artwork-catalog-upload-content">
                  {viewer.stage === "select" ? <div className="artwork-catalog-upload-select"><button type="button" className="artwork-catalog-drop-zone" data-drag-active={uploadDragActive ? "true" : "false"} onClick={chooseUpload} onDragEnter={(event) => { event.preventDefault(); setUploadDragActive(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setUploadDragActive(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setUploadDragActive(false); }} onDrop={dropLocalArtwork}><span><Upload size={28} aria-hidden="true" /></span><h3>Drop artwork here</h3><p>{onAnalyzeLocalArtwork ? "PDF, PNG, or JPEG · analyzed securely in this browser" : "Choose one file for the fixture inspection flow."}</p><strong>Choose a file</strong></button><p className="artwork-catalog-upload-scope">The file is not uploaded, stored, or used to replace the current catalog artwork.</p><input ref={uploadInputRef} className="artwork-catalog-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(event) => { selectLocalArtwork(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div> : null}
                  {viewer.stage === "review" && viewer.candidate ? <div className="artwork-catalog-upload-review-layout"><div><span className="artwork-catalog-upload-kicker">Ready to inspect</span><h3>Review selected artwork</h3><p>Run the technical inspection when the file and intended product look correct.</p></div><div className="artwork-catalog-upload-review"><span><FileImage size={22} aria-hidden="true" /></span><div><h3>{viewer.candidate.name}</h3><p>{viewer.candidate.fileType} · {viewer.candidate.fileSize}</p><small>Checking against {selectedProduct.name} · Proposed version {viewer.candidate.expectedVersion}</small></div><StatusBadge label="Ready" tone="neutral" /></div><div className="artwork-catalog-upload-review-note"><ShieldCheck size={18} aria-hidden="true" /><p>Inspection reads the real file locally. The current artwork stays unchanged, and technical findings remain separate from Proof approval.</p></div><button type="button" className="artwork-catalog-text-button" onClick={chooseUpload}>Choose a different file</button></div> : null}
                  {viewer.stage === "processing" ? <div className="artwork-catalog-upload-select"><span><LoaderCircle className="artwork-catalog-spinner" size={28} aria-hidden="true" /></span><h3>{viewer.progressLabel || "Inspecting artwork"}</h3><p>The existing current artwork remains available while checks are incomplete.</p></div> : null}
                  {viewer.error ? <p className="artwork-catalog-upload-error" role="alert">{viewer.error}</p> : null}
                </div>
              </div>
            )}

            <footer className="artwork-catalog-modal-footer">
              {viewer.kind === "history" ? <button type="button" className="artwork-catalog-secondary" onClick={closeViewer}>Close</button> : null}
              {viewer.kind === "specification" ? <><span className="artwork-catalog-modal-note">Prototype only · no catalog data is saved</span><button type="button" className="artwork-catalog-secondary" onClick={closeViewer}>Cancel</button><button type="button" className="artwork-catalog-primary" onClick={applySpecificationChange}>Apply to prototype</button></> : null}
              {viewer.kind === "upload" && viewer.stage === "select" ? <><button type="button" className="artwork-catalog-secondary" onClick={closeViewer}>Cancel</button><button type="button" className="artwork-catalog-primary" onClick={chooseUpload}>Choose file</button></> : null}
              {viewer.kind === "upload" && viewer.stage === "review" ? <><button type="button" className="artwork-catalog-secondary" onClick={closeViewer}>Cancel</button><button type="button" className="artwork-catalog-primary" onClick={runInspection}>Run inspection</button></> : null}
              {viewer.kind === "upload" && viewer.stage === "processing" ? <span className="artwork-catalog-processing-note">Please keep this dialog open.</span> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
