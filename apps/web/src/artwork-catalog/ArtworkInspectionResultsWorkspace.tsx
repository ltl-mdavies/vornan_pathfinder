import { useMemo, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  Info,
  Minus,
  Plus
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
  learnMoreLabel?: string;
  marker: Readonly<{ xPercent: number; yPercent: number }>;
}>;

export type InspectionPage = Readonly<{
  pageNumber: number;
  label: string;
  dimensions: string;
  originalPreviewUrl: string;
  originalPreviewAlt: string;
  heatmapPreviewUrl: string;
  heatmapPreviewAlt: string;
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
}>;

export type ArtworkInspectionResultsActions = Readonly<{
  onBack: (inspectionId: string) => void;
  onDownloadReport: (inspectionId: string) => void;
  onOpenAnalyzedArtwork: (inspectionId: string) => void;
  onLearnMore?: (input: { inspectionId: string; findingId: string }) => void;
}>;

export type ArtworkInspectionResultsWorkspaceProps = Readonly<{
  result: ArtworkInspectionResultViewModel;
  actions: ArtworkInspectionResultsActions;
  initialMode?: InspectionViewMode;
}>;

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

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

function verdictIcon(verdict: InspectionVerdict) {
  return verdict === "passed" ? <Info size={19} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />;
}

function findingIcon(severity: InspectionFindingSeverity) {
  return severity === "review"
    ? <Info size={17} aria-hidden="true" />
    : <AlertTriangle size={17} aria-hidden="true" />;
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
      {findings.map((finding) => (
        <button
          type="button"
          key={finding.id}
          className={finding.id === selectedFindingId ? "inspection-preview-marker inspection-preview-marker-selected" : "inspection-preview-marker"}
          style={{ left: `${finding.marker.xPercent}%`, top: `${finding.marker.yPercent}%` }}
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
  const heatmapVisible = mode === "heatmap";
  const markersVisible = mode === "heatmap" || mode === "findings";
  const imageUrl = heatmapVisible ? page.heatmapPreviewUrl : page.originalPreviewUrl;
  const imageAlt = heatmapVisible ? page.heatmapPreviewAlt : page.originalPreviewAlt;
  const style = { "--inspection-preview-zoom": `${(zoom / 124) * 100}%` } as CSSProperties;

  return (
    <figure className={compact ? "inspection-preview inspection-preview-compact" : "inspection-preview"} style={style}>
      <div className="inspection-preview-content">
        <img src={imageUrl} alt={imageAlt} />
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
  if (result.pages.length === 0) {
    throw new Error("Artwork inspection results require at least one page.");
  }
  if (result.findings.some((finding) => !result.pages.some((page) => page.pageNumber === finding.pageNumber))) {
    throw new Error("Every inspection finding must reference a supplied page.");
  }

  const [mode, setMode] = useState<InspectionViewMode>(initialMode);
  const [selectedPageNumber, setSelectedPageNumber] = useState(result.pages[0].pageNumber);
  const [selectedFindingId, setSelectedFindingId] = useState(result.findings[0]?.id ?? "");
  const [findingsExpanded, setFindingsExpanded] = useState(true);
  const [zoom, setZoom] = useState(124);

  const selectedPage = result.pages.find((page) => page.pageNumber === selectedPageNumber) ?? result.pages[0];
  const selectedFinding = result.findings.find((finding) => finding.id === selectedFindingId) ?? result.findings[0];
  const pageFindings = useMemo(
    () => result.findings.filter((finding) => finding.pageNumber === selectedPage.pageNumber),
    [result.findings, selectedPage.pageNumber]
  );

  const selectFinding = (findingId: string) => {
    const finding = result.findings.find((candidate) => candidate.id === findingId);
    if (!finding) return;
    setSelectedFindingId(finding.id);
    setSelectedPageNumber(finding.pageNumber);
    setFindingsExpanded(true);
  };

  const moveFinding = (direction: -1 | 1) => {
    const findingId = adjacentFindingId(result.findings, selectedFindingId, direction);
    if (findingId) selectFinding(findingId);
  };

  const setPreviewMode = (nextMode: InspectionViewMode) => {
    setMode(nextMode);
    if (nextMode === "findings") setFindingsExpanded(true);
  };

  return (
    <section className="artwork-inspection-results" aria-labelledby="inspection-results-title">
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
        <div className={`inspection-verdict-chip inspection-verdict-${result.verdict}`} aria-label={`Overall verdict: ${result.verdictLabel}. ${result.verdictDetail}`}>
          {verdictIcon(result.verdict)}
          <span><strong>{result.verdictLabel}</strong><small>{result.verdictDetail}</small></span>
          <Info size={15} aria-hidden="true" />
        </div>
      </header>

      <section className="inspection-viewer" aria-label="Analyzed artwork">
        <div className="inspection-viewer-toolbar">
          <div className="inspection-mode-control" role="group" aria-label="Artwork analysis view">
            <button type="button" aria-pressed={mode === "original"} onClick={() => setPreviewMode("original")}>Original</button>
            <button type="button" aria-pressed={mode === "heatmap"} onClick={() => setPreviewMode("heatmap")}>Heatmap</button>
            <button type="button" aria-pressed={mode === "findings"} onClick={() => setPreviewMode("findings")}>Findings <span>{result.findings.length}</span></button>
            <button type="button" aria-pressed={mode === "compare"} onClick={() => setPreviewMode("compare")}>Compare</button>
          </div>
          <div className="inspection-zoom-control" role="group" aria-label="Artwork zoom">
            <button type="button" onClick={() => setZoom((current) => clampInspectionZoom(current - ZOOM_STEP))} disabled={zoom === MIN_ZOOM} aria-label="Zoom out"><Minus size={15} aria-hidden="true" /></button>
            <output aria-live="polite">{zoom}%</output>
            <button type="button" onClick={() => setZoom((current) => clampInspectionZoom(current + ZOOM_STEP))} disabled={zoom === MAX_ZOOM} aria-label="Zoom in"><Plus size={15} aria-hidden="true" /></button>
            <button type="button" onClick={() => setZoom(124)}>Fit <ChevronDown size={14} aria-hidden="true" /></button>
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
          <span>Overall verdict</span>
          <div className={`inspection-verdict-title inspection-verdict-${result.verdict}`}>{verdictIcon(result.verdict)}<strong>{result.verdictLabel}</strong></div>
          <p>{result.verdictSummary}</p>
        </article>
        <dl className="inspection-key-metrics">
          <div className="inspection-metrics-label">Key metrics</div>
          {result.metrics.map((metric) => (
            <div key={metric.label} className={metric.emphasis === "warning" ? "inspection-metric-warning" : ""}>
              <dt>{metric.label}</dt><dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {findingsExpanded ? (
        <section className="inspection-findings" aria-labelledby="inspection-findings-title">
          <div className="inspection-findings-list">
            <header><h2 id="inspection-findings-title">Findings ({result.findings.length})</h2></header>
            <div role="list">
              {result.findings.map((finding) => (
                <div role="listitem" key={finding.id}>
                  <button
                    type="button"
                    className={finding.id === selectedFinding?.id ? "inspection-finding-row inspection-finding-row-selected" : "inspection-finding-row"}
                    onClick={() => selectFinding(finding.id)}
                    aria-current={finding.id === selectedFinding?.id ? "true" : undefined}
                  >
                    <span className="inspection-finding-number">{finding.number}</span>
                    <span className={`inspection-finding-icon inspection-finding-${finding.severity}`}>{findingIcon(finding.severity)}</span>
                    <strong>{finding.listLabel ?? finding.title}</strong>
                    <small>Page {finding.pageNumber}</small>
                    <small>{finding.regionLabel}</small>
                    <small>{finding.category}</small>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {selectedFinding ? (
            <article className="inspection-finding-detail" aria-live="polite">
              <header>
                <span>Finding {result.findings.findIndex((finding) => finding.id === selectedFinding.id) + 1} of {result.findings.length}</span>
                <div><button type="button" onClick={() => moveFinding(-1)}><ChevronLeft size={14} aria-hidden="true" /> Previous</button><button type="button" onClick={() => moveFinding(1)}>Next <ChevronRight size={14} aria-hidden="true" /></button></div>
              </header>
              <span className="inspection-finding-category">{selectedFinding.category}</span>
              <h3>{selectedFinding.title}</h3>
              <p>{selectedFinding.description}</p>
              <dl>
                <div><dt>Page / region</dt><dd>Page {selectedFinding.pageNumber} / {selectedFinding.regionLabel}</dd></div>
                <div><dt>Affected area</dt><dd>{selectedFinding.affectedArea}</dd></div>
              </dl>
              <h4>Recommendation</h4>
              <p>{selectedFinding.recommendation}</p>
              {selectedFinding.learnMoreLabel && actions.onLearnMore ? <button type="button" className="inspection-learn-more" onClick={() => actions.onLearnMore?.({ inspectionId: result.inspectionId, findingId: selectedFinding.id })}>{selectedFinding.learnMoreLabel} <ExternalLink size={13} aria-hidden="true" /></button> : null}
            </article>
          ) : <p className="inspection-no-findings">No technical findings were reported.</p>}
        </section>
      ) : (
        <div className="inspection-findings-collapsed"><span>{result.findings.length} technical findings hidden</span></div>
      )}

      <div className="inspection-results-actions">
        <button type="button" className="inspection-collapse-button" onClick={() => setFindingsExpanded((current) => !current)}>
          {findingsExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {findingsExpanded ? "Collapse findings" : "Show findings"}
        </button>
        <div>
          <button type="button" className="inspection-secondary-action" onClick={() => actions.onDownloadReport(result.inspectionId)}><Download size={15} aria-hidden="true" /> Download report</button>
          <button type="button" className="inspection-primary-action" onClick={() => actions.onOpenAnalyzedArtwork(result.inspectionId)}>Open analyzed artwork <ExternalLink size={15} aria-hidden="true" /></button>
        </div>
      </div>

      <footer className="inspection-results-footer">
        <span><Info size={14} aria-hidden="true" /> Technical findings do not change Proof approval.</span>
        <span>Completed {formattedInspectionDate(result.completedAt)}</span>
        <span>Policy revision {result.policyRevision}</span>
        {result.providerDisplayName ? <span>Inspection engine: {result.providerDisplayName}</span> : null}
        <span>Report ID: {result.reportLabel}</span>
      </footer>
    </section>
  );
}
