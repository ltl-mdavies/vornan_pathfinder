import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Info,
  Minus,
  Plus,
  XCircle
} from "lucide-react";

export type InspectionViewMode = "original" | "heatmap" | "findings" | "compare";
export type InspectionFindingSeverity = "needs-work" | "review";
export type InspectionVerdict = "passed" | "needs-work" | "review";

export type InspectionMetric = Readonly<{
  label: string;
  value: string;
  emphasis?: "warning";
}>;

export type InspectionFinding = Readonly<{
  id: string;
  number: number;
  pageNumber: number;
  severity: InspectionFindingSeverity;
  category: string;
  title: string;
  listLabel?: string;
  description: string;
  regionLabel: string;
  affectedArea: string;
  recommendation: string;
  marker?: Readonly<{ xPercent: number; yPercent: number }>;
}>;

export type InspectionPage = Readonly<{
  pageNumber: number;
  label: string;
  dimensions: string;
  pixelWidth: number;
  pixelHeight: number;
  originalPreviewUrl: string;
  originalPreviewAlt: string;
  heatmapPreviewUrl: string;
  heatmapPreviewAlt: string;
  mediaType?: "image" | "pdf";
}>;

export type ArtworkInspectionResultViewModel = Readonly<{
  inspectionId: string;
  productName: string;
  versionLabel: string;
  specification: string;
  targetDpi: string;
  completedAt: string;
  verdict: InspectionVerdict;
  verdictLabel: string;
  verdictDetail: string;
  verdictSummary: string;
  policyRevision: string;
  providerDisplayName?: string;
  reportLabel: string;
  metrics: ReadonlyArray<InspectionMetric>;
  pages: ReadonlyArray<InspectionPage>;
  findings: ReadonlyArray<InspectionFinding>;
  availableModes?: ReadonlyArray<InspectionViewMode>;
  localAnalysis?: Readonly<{
    filename: string;
    format: string;
    sha256: string;
    byteSize: number;
    persistence: string;
  }>;
}>;

export type ArtworkInspectionResultsActions = Readonly<{
  onBack: (inspectionId: string) => void;
  onDownloadReport: (inspectionId: string) => void;
  onOpenAnalyzedArtwork: (inspectionId: string) => void;
}>;

export type ArtworkInspectionResultsWorkspaceProps = Readonly<{
  result: ArtworkInspectionResultViewModel;
  actions: ArtworkInspectionResultsActions;
  initialMode?: InspectionViewMode;
}>;

type InspectionRailTab = "details" | "findings";
type InspectionResultStatus = "PASS" | "WARNING" | "FAIL";

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

export type InspectionPreviewSize = Readonly<{ width: number; height: number; scale: number }>;

export function fitInspectionPreview(
  viewport: Readonly<{ width: number; height: number }>,
  source: Readonly<{ width: number; height: number }>
): InspectionPreviewSize {
  if (![viewport.width, viewport.height, source.width, source.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Inspection preview dimensions must be positive finite numbers.");
  }
  const scale = Math.min(viewport.width / source.width, viewport.height / source.height);
  return { width: source.width * scale, height: source.height * scale, scale };
}

export function clampInspectionZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function adjacentFindingId(
  findings: ReadonlyArray<InspectionFinding>,
  selectedId: string,
  direction: -1 | 1
): string {
  if (findings.length === 0) return "";
  const currentIndex = Math.max(0, findings.findIndex((finding) => finding.id === selectedId));
  const nextIndex = (currentIndex + direction + findings.length) % findings.length;
  return findings[nextIndex].id;
}

export function inspectionHasPageRail(pages: ReadonlyArray<InspectionPage>): boolean {
  return pages.length > 1;
}

function formattedInspectionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function inspectionResultStatus(result: ArtworkInspectionResultViewModel): InspectionResultStatus {
  if (result.verdict === "passed") return "PASS";
  if (result.findings.some((finding) => finding.category === "File integrity" && finding.severity === "needs-work")) return "FAIL";
  return "WARNING";
}

function resultStatusIcon(status: InspectionResultStatus, size = 19) {
  if (status === "PASS") return <CheckCircle2 size={size} aria-hidden="true" />;
  if (status === "FAIL") return <XCircle size={size} aria-hidden="true" />;
  return <AlertTriangle size={size} aria-hidden="true" />;
}

function findingIcon(severity: InspectionFindingSeverity) {
  return severity === "review"
    ? <Info size={17} aria-hidden="true" />
    : <AlertTriangle size={17} aria-hidden="true" />;
}

function formatInspectionBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function metricValue(result: ArtworkInspectionResultViewModel, ...labels: string[]): string | undefined {
  return result.metrics.find((metric) => labels.includes(metric.label))?.value;
}

function PreviewMarkers({
  findings,
  selectedFindingId,
  onSelectFinding
}: Readonly<{
  findings: ReadonlyArray<InspectionFinding>;
  selectedFindingId: string;
  onSelectFinding: (findingId: string) => void;
}>) {
  return (
    <div className="inspection-preview-markers" aria-label="Finding locations">
      {findings.filter((finding) => finding.marker).map((finding) => (
        <button
          type="button"
          key={finding.id}
          className={finding.id === selectedFindingId ? "inspection-preview-marker inspection-preview-marker-selected" : "inspection-preview-marker"}
          style={{ left: `${finding.marker?.xPercent}%`, top: `${finding.marker?.yPercent}%` }}
          onClick={() => onSelectFinding(finding.id)}
          aria-label={`Finding ${finding.number}: ${finding.title}, ${finding.regionLabel}`}
          aria-pressed={finding.id === selectedFindingId}
        >
          {finding.number}
        </button>
      ))}
    </div>
  );
}

function ArtworkPreview({
  page,
  mode,
  zoom,
  findings,
  selectedFindingId,
  onSelectFinding,
  compact = false
}: Readonly<{
  page: InspectionPage;
  mode: Exclude<InspectionViewMode, "compare">;
  zoom: number;
  findings: ReadonlyArray<InspectionFinding>;
  selectedFindingId: string;
  onSelectFinding: (findingId: string) => void;
  compact?: boolean;
}>) {
  const previewRef = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState({ width: page.pixelWidth, height: page.pixelHeight });
  const heatmapVisible = mode === "heatmap";
  const markersVisible = mode === "heatmap" || mode === "findings";
  const imageUrl = heatmapVisible ? page.heatmapPreviewUrl : page.originalPreviewUrl;
  const imageAlt = heatmapVisible ? page.heatmapPreviewAlt : page.originalPreviewAlt;
  const fit = fitInspectionPreview(viewport, { width: page.pixelWidth, height: page.pixelHeight });
  const zoomScale = zoom / 100;
  const style = {
    width: `${fit.width * zoomScale}px`,
    height: `${fit.height * zoomScale}px`,
    aspectRatio: `${page.pixelWidth} / ${page.pixelHeight}`
  } as CSSProperties;

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || typeof ResizeObserver === "undefined") return undefined;
    const updateViewport = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      setViewport((current) => current.width === width && current.height === height ? current : { width, height });
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateViewport(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(preview);
    updateViewport(preview.clientWidth, preview.clientHeight);
    return () => observer.disconnect();
  }, [compact]);

  return (
    <figure
      ref={previewRef}
      className={compact ? "inspection-preview inspection-preview-compact" : "inspection-preview"}
      data-source-width={page.pixelWidth}
      data-source-height={page.pixelHeight}
      data-fit-zoom={zoom}
    >
      <div className="inspection-preview-content" style={style}>
        {page.mediaType === "pdf" ? (
          <div className="inspection-pdf-fallback" role="img" aria-label={imageAlt}>
            <FileText size={34} aria-hidden="true" />
            <strong>PDF preview unavailable</strong>
            <span>The technical inspection results remain available without opening the browser PDF viewer.</span>
          </div>
        ) : <img src={imageUrl} alt={imageAlt} />}
        {markersVisible ? (
          <PreviewMarkers findings={findings} selectedFindingId={selectedFindingId} onSelectFinding={onSelectFinding} />
        ) : null}
      </div>
    </figure>
  );
}

export function ArtworkInspectionResultsWorkspace({
  result,
  actions,
  initialMode = "heatmap"
}: ArtworkInspectionResultsWorkspaceProps) {
  if (result.pages.length === 0) throw new Error("Artwork inspection results require at least one page.");
  if (result.findings.some((finding) => !result.pages.some((page) => page.pageNumber === finding.pageNumber))) {
    throw new Error("Every inspection finding must reference a supplied page.");
  }

  const availableModes = result.availableModes ?? (["original", "heatmap", "findings", "compare"] as const);
  const [mode, setMode] = useState<InspectionViewMode>(availableModes.includes(initialMode) ? initialMode : availableModes[0] ?? "original");
  const [selectedPageNumber, setSelectedPageNumber] = useState(result.pages[0].pageNumber);
  const [selectedFindingId, setSelectedFindingId] = useState(result.findings[0]?.id ?? "");
  const [railTab, setRailTab] = useState<InspectionRailTab>("details");
  const [zoom, setZoom] = useState(100);
  const findingCardRefs = useRef(new Map<string, HTMLElement>());

  const selectedPage = result.pages.find((page) => page.pageNumber === selectedPageNumber) ?? result.pages[0];
  const selectedFinding = result.findings.find((finding) => finding.id === selectedFindingId) ?? result.findings[0];
  const pageFindings = useMemo(
    () => result.findings.filter((finding) => finding.pageNumber === selectedPage.pageNumber),
    [result.findings, selectedPage.pageNumber]
  );
  const status = inspectionResultStatus(result);
  const detectedSize = metricValue(result, "Dimensions") ?? metricValue(result, "Trim") ?? selectedPage.dimensions;
  const effectiveDpi = metricValue(result, "Effective DPI", "Effective PPI") ?? "Indeterminate";
  const color = metricValue(result, "Color") ?? "Indeterminate";
  const trim = metricValue(result, "Trim") ?? selectedPage.dimensions;
  const bleed = metricValue(result, "Bleed") ?? "Indeterminate";
  const pages = metricValue(result, "Pages") ?? String(result.pages.length);
  const fileSize = result.localAnalysis ? formatInspectionBytes(result.localAnalysis.byteSize) : metricValue(result, "File size") ?? "Not reported";
  const aspectWarning = result.findings.some((finding) => finding.category === "Specification");
  const summaryMetrics = [
    { label: "Detected size", value: detectedSize },
    { label: "Effective DPI", value: effectiveDpi },
    { label: "Color", value: color },
    { label: "Trim / Bleed", value: bleed !== "Indeterminate" ? bleed : trim },
    { label: "Pages", value: pages }
  ];

  const selectFinding = (findingId: string) => {
    const finding = result.findings.find((candidate) => candidate.id === findingId);
    if (!finding) return;
    setSelectedFindingId(finding.id);
    setSelectedPageNumber(finding.pageNumber);
    setRailTab("findings");
  };

  useEffect(() => {
    if (railTab !== "findings" || !selectedFindingId) return;
    findingCardRefs.current.get(selectedFindingId)?.scrollIntoView({ block: "nearest" });
  }, [railTab, selectedFindingId]);

  const moveFinding = (direction: -1 | 1) => {
    const findingId = adjacentFindingId(result.findings, selectedFindingId, direction);
    if (findingId) selectFinding(findingId);
  };

  const setPreviewMode = (nextMode: InspectionViewMode) => {
    if (!availableModes.includes(nextMode)) return;
    setMode(nextMode);
    if (nextMode === "findings") setRailTab("findings");
  };

  return (
    <section className="artwork-inspection-results artwork-inspection-results-unified" aria-labelledby="inspection-results-title">
      <header className="inspection-results-header">
        <div className="inspection-results-title-group">
          <button type="button" className="inspection-back-link" onClick={() => actions.onBack(result.inspectionId)}>
            <ArrowLeft size={15} aria-hidden="true" /> Back to Artwork Catalog
          </button>
          <h1 id="inspection-results-title">Technical inspection results</h1>
          <p><strong>{result.productName}</strong><span aria-hidden="true">·</span>{result.versionLabel}</p>
        </div>
        <dl className="inspection-header-facts">
          <div><dt>Specification</dt><dd>{result.specification}</dd></div>
          <div><dt>Target DPI</dt><dd>{result.targetDpi}</dd></div>
          <div><dt>Inspection completed</dt><dd>{formattedInspectionDate(result.completedAt).split(",").slice(0, 2).join(",")}</dd></div>
        </dl>
        <div className={`inspection-verdict-chip inspection-status-${status.toLowerCase()}`} aria-label={`Inspection result: ${status}. ${result.verdictDetail}`}>
          {resultStatusIcon(status, 20)}
          <span><strong>{status}</strong><small>{result.verdictDetail}</small></span>
        </div>
      </header>

      <div className="inspection-workspace-grid">
        <div className="inspection-workspace-primary">
          <section className="inspection-viewer" aria-label="Analyzed artwork">
            <div className="inspection-viewer-toolbar">
              <div className="inspection-mode-control" role="group" aria-label="Artwork analysis view">
                <button type="button" aria-pressed={mode === "original"} disabled={!availableModes.includes("original")} onClick={() => setPreviewMode("original")}>Original</button>
                <button type="button" aria-pressed={mode === "heatmap"} disabled={!availableModes.includes("heatmap")} onClick={() => setPreviewMode("heatmap")} title={!availableModes.includes("heatmap") ? "Heatmap requires a connected inspection provider" : undefined}>Heatmap</button>
                <button type="button" aria-pressed={mode === "findings"} disabled={!availableModes.includes("findings")} onClick={() => setPreviewMode("findings")}>Findings overlay <span>{result.findings.length}</span></button>
                <button type="button" aria-pressed={mode === "compare"} disabled={!availableModes.includes("compare")} onClick={() => setPreviewMode("compare")} title={!availableModes.includes("compare") ? "Comparison requires an analysis overlay" : undefined}>Compare</button>
              </div>
              <div className="inspection-zoom-control" role="group" aria-label="Artwork zoom">
                <button type="button" onClick={() => setZoom((current) => clampInspectionZoom(current - ZOOM_STEP))} disabled={zoom === MIN_ZOOM} aria-label="Zoom out"><Minus size={15} aria-hidden="true" /></button>
                <output aria-live="polite">{zoom}%</output>
                <button type="button" onClick={() => setZoom((current) => clampInspectionZoom(current + ZOOM_STEP))} disabled={zoom === MAX_ZOOM} aria-label="Zoom in"><Plus size={15} aria-hidden="true" /></button>
                <button type="button" onClick={() => setZoom(100)}>Fit <ChevronDown size={14} aria-hidden="true" /></button>
              </div>
            </div>

            <div className={inspectionHasPageRail(result.pages) ? "inspection-viewer-body inspection-viewer-body-with-pages" : "inspection-viewer-body"}>
              {inspectionHasPageRail(result.pages) ? (
                <nav className="inspection-page-rail" aria-label={`Pages (${result.pages.length})`}>
                  <strong>Pages ({selectedPage.pageNumber} of {result.pages.length})</strong>
                  {result.pages.map((page) => {
                    const count = result.findings.filter((finding) => finding.pageNumber === page.pageNumber).length;
                    return (
                      <button
                        type="button"
                        key={page.pageNumber}
                        aria-current={page.pageNumber === selectedPage.pageNumber ? "page" : undefined}
                        onClick={() => {
                          setSelectedPageNumber(page.pageNumber);
                          const firstFinding = result.findings.find((finding) => finding.pageNumber === page.pageNumber);
                          if (firstFinding) setSelectedFindingId(firstFinding.id);
                        }}
                      >
                        <img src={page.originalPreviewUrl} alt="" />
                        <span>{page.pageNumber}</span>
                        {count > 0 ? <small>{count} {count === 1 ? "finding" : "findings"}</small> : <small>No findings</small>}
                      </button>
                    );
                  })}
                </nav>
              ) : null}

              <div className="inspection-artwork-stage">
                <span className="inspection-canvas-label">Page {selectedPage.pageNumber} · {mode === "compare" ? "Compare" : mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                {mode === "compare" ? (
                  <div className="inspection-compare-grid">
                    <div><strong>Original</strong><ArtworkPreview page={selectedPage} mode="original" zoom={zoom} findings={pageFindings} selectedFindingId={selectedFindingId} onSelectFinding={selectFinding} compact /></div>
                    <div><strong>Analysis overlay</strong><ArtworkPreview page={selectedPage} mode="heatmap" zoom={zoom} findings={pageFindings} selectedFindingId={selectedFindingId} onSelectFinding={selectFinding} compact /></div>
                  </div>
                ) : (
                  <ArtworkPreview page={selectedPage} mode={mode} zoom={zoom} findings={pageFindings} selectedFindingId={selectedFindingId} onSelectFinding={selectFinding} />
                )}
              </div>
            </div>
          </section>

          <section className="inspection-summary" aria-label="Inspection summary">
            <article className="inspection-overall-verdict">
              <span>Inspection result</span>
              <div className={`inspection-verdict-title inspection-status-${status.toLowerCase()}`}>{resultStatusIcon(status, 20)}<strong>{status}</strong></div>
            </article>
            <dl className="inspection-key-metrics">
              {summaryMetrics.map((metric) => (
                <div key={metric.label}>
                  <dt>{metric.label}</dt><dd>{metric.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <aside className="inspection-results-rail" aria-label="Technical inspection information">
          <div className="inspection-rail-tabs" role="tablist" aria-label="Inspection information">
            <button type="button" role="tab" id="inspection-details-tab" aria-controls="inspection-details-panel" aria-selected={railTab === "details"} onClick={() => setRailTab("details")}>Inspection details</button>
            <button type="button" role="tab" id="inspection-findings-tab" aria-controls="inspection-findings-panel" aria-selected={railTab === "findings"} onClick={() => setRailTab("findings")}>Findings ({result.findings.length})</button>
          </div>

          {railTab === "details" ? (
            <div className="inspection-rail-scroll" role="tabpanel" id="inspection-details-panel" aria-labelledby="inspection-details-tab" tabIndex={0}>
              <section className="inspection-detail-section inspection-detail-summary">
                <h2>Summary</h2>
                <div className={`inspection-detail-status inspection-status-${status.toLowerCase()}`}>{resultStatusIcon(status, 18)}<strong>{status}</strong></div>
                <p>{result.findings.length} technical {result.findings.length === 1 ? "finding" : "findings"}</p>
                <p>{result.verdictSummary}</p>
              </section>
              <section className="inspection-detail-section">
                <h2>Product fit</h2>
                <dl>
                  <div><dt>Specification</dt><dd>{result.specification}</dd></div>
                  <div><dt>Detected size</dt><dd>{detectedSize}</dd></div>
                  <div><dt>Aspect match</dt><dd className={aspectWarning ? "inspection-detail-warning" : "inspection-detail-pass"}>{aspectWarning ? "WARNING" : "PASS"}</dd></div>
                  <div><dt>Target resolution</dt><dd>{result.targetDpi} DPI</dd></div>
                  <div><dt>Effective DPI</dt><dd>{effectiveDpi}</dd></div>
                  <div><dt>Trim / Bleed</dt><dd>{bleed !== "Indeterminate" ? bleed : trim}</dd></div>
                </dl>
              </section>
              <section className="inspection-detail-section">
                <h2>Resolution &amp; print size</h2>
                <p>{effectiveDpi === "Indeterminate" ? "Maximum supported print size is indeterminate because effective raster resolution cannot be established for this file." : `Effective resolution at the intended product size is ${effectiveDpi} DPI.`}</p>
              </section>
              <section className="inspection-detail-section">
                <h2>File construction</h2>
                <dl>
                  <div><dt>File type</dt><dd>{result.localAnalysis?.format ?? "Inspection source"}</dd></div>
                  <div><dt>File size</dt><dd>{fileSize}</dd></div>
                  <div><dt>Pages</dt><dd>{pages}</dd></div>
                  <div><dt>Color</dt><dd>{color}</dd></div>
                  <div><dt>Trim</dt><dd>{trim}</dd></div>
                  <div><dt>Bleed</dt><dd>{bleed}</dd></div>
                </dl>
              </section>
              <section className="inspection-detail-section">
                <h2>Quality signals</h2>
                <dl>
                  <div><dt>Resolution</dt><dd>{effectiveDpi}</dd></div>
                  <div><dt>Sharpness</dt><dd>{metricValue(result, "Sharpness") ?? "Indeterminate"}</dd></div>
                  <div><dt>Compression</dt><dd>{metricValue(result, "Compression") ?? "Indeterminate"}</dd></div>
                  <div><dt>Noise / Blockiness</dt><dd>{metricValue(result, "Noise / Blockiness") ?? "Not measured"}</dd></div>
                </dl>
              </section>
            </div>
          ) : (
            <div className="inspection-rail-scroll inspection-findings-rail" role="tabpanel" id="inspection-findings-panel" aria-labelledby="inspection-findings-tab" tabIndex={0}>
              {result.findings.length === 0 ? <p className="inspection-no-findings">No technical findings were reported.</p> : result.findings.map((finding) => {
                const selected = finding.id === selectedFinding?.id;
                return (
                  <article
                    className={selected ? "inspection-finding-card inspection-finding-card-selected" : "inspection-finding-card"}
                    key={finding.id}
                    ref={(node) => {
                      if (node) findingCardRefs.current.set(finding.id, node);
                      else findingCardRefs.current.delete(finding.id);
                    }}
                  >
                    <button type="button" onClick={() => selectFinding(finding.id)} aria-expanded={selected}>
                      <span className="inspection-finding-number">{finding.number}</span>
                      <span className={`inspection-finding-icon inspection-finding-${finding.severity}`}>{findingIcon(finding.severity)}</span>
                      <span><strong>{finding.listLabel ?? finding.title}</strong><small>Page {finding.pageNumber} · {finding.regionLabel}</small></span>
                      {selected ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                    </button>
                    {selected ? (
                      <div className="inspection-finding-card-body">
                        <p>{finding.description}</p>
                        <dl>
                          <div><dt>Affected area</dt><dd>{finding.affectedArea}</dd></div>
                        </dl>
                        <h3>Recommendation</h3>
                        <p>{finding.recommendation}</p>
                        <div className="inspection-finding-card-nav">
                          <button type="button" onClick={() => moveFinding(-1)}><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
                          <button type="button" onClick={() => moveFinding(1)}>Next <ChevronRight size={14} aria-hidden="true" /></button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      <div className="inspection-results-actions">
        <span><Info size={14} aria-hidden="true" /> Technical findings do not change Proof approval.</span>
        <div>
          <details className="inspection-report-details">
            <summary><Info size={14} aria-hidden="true" /> Report details</summary>
            <div>
              {result.localAnalysis ? <p><strong>Processing</strong><span>{result.localAnalysis.persistence}</span></p> : null}
              {result.localAnalysis ? <p><strong>Filename</strong><span>{result.localAnalysis.filename}</span></p> : null}
              {result.localAnalysis ? <p><strong>File identity</strong><code>{result.localAnalysis.sha256}</code></p> : null}
              <p><strong>Report ID</strong><span>{result.reportLabel}</span></p>
              <p><strong>Inspection engine</strong><span>{result.providerDisplayName ?? "Not reported"}</span></p>
              <p><strong>Policy revision</strong><span>{result.policyRevision}</span></p>
              <p><strong>Completed</strong><span>{formattedInspectionDate(result.completedAt)}</span></p>
            </div>
          </details>
          <button type="button" className="inspection-secondary-action" onClick={() => actions.onDownloadReport(result.inspectionId)}><Download size={15} aria-hidden="true" /> Download report</button>
          <button type="button" className="inspection-primary-action" onClick={() => actions.onBack(result.inspectionId)}>Close inspection <ArrowLeft size={15} aria-hidden="true" /></button>
        </div>
      </div>

      <footer className="inspection-results-footer">
        <span>Completed {formattedInspectionDate(result.completedAt)}</span>
        <span>Policy revision {result.policyRevision}</span>
        {result.providerDisplayName ? <span>Inspection engine: {result.providerDisplayName}</span> : null}
        <span>Report ID: {result.reportLabel}</span>
      </footer>
    </section>
  );
}
