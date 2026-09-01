import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCw } from "lucide-react";

type FitMode = "page" | "width" | "actual";

type ProofDocumentViewerProps = {
  source: string;
  filename: string | null;
  onLoad(): void;
  onError(): void;
};

const zoomSteps = [.5, .75, 1, 1.25, 1.5, 2, 2.5, 3];

function clampZoom(value: number) {
  return Math.min(zoomSteps.at(-1)!, Math.max(zoomSteps[0]!, value));
}

function nextZoom(value: number, direction: -1 | 1) {
  if (direction < 0) return [...zoomSteps].reverse().find((step) => step < value - .01) ?? zoomSteps[0]!;
  return zoomSteps.find((step) => step > value + .01) ?? zoomSteps.at(-1)!;
}

function fitLabel(mode: FitMode) {
  if (mode === "width") return "Fit width";
  if (mode === "actual") return "Actual size";
  return "Fit page";
}

export function ProofDocumentViewer({ source, filename, onLoad, onError }: ProofDocumentViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderNonce = useRef(0);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const [document, setDocument] = useState<any>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [fitMode, setFitMode] = useState<FitMode>("page");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 });
  const [fitMenuOpen, setFitMenuOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  }, [onError, onLoad]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => setViewerSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let loadingTask: { promise: Promise<any>; destroy?: () => void } | null = null;
    setDocument(null);
    setPageNumber(1);
    setPageCount(null);
    setFitMode("page");
    setZoom(1);
    setRotation(0);
    setFailed(false);

    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url")
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        loadingTask = pdfjs.getDocument({
          url: source,
          disableAutoFetch: false,
          disableStream: false,
          rangeChunkSize: 64 * 1024,
          withCredentials: false
        });
        const nextDocument = await loadingTask.promise;
        if (disposed) {
          void nextDocument.destroy?.();
          return;
        }
        setDocument(nextDocument);
        setPageCount(nextDocument.numPages);
        onLoadRef.current();
      } catch {
        if (disposed) return;
        setFailed(true);
        onErrorRef.current();
      }
    })();

    return () => {
      disposed = true;
      void loadingTask?.destroy?.();
    };
  }, [source]);

  useEffect(() => {
    if (!document || !canvasRef.current || !viewerSize.width || !viewerSize.height) return;
    const nonce = ++renderNonce.current;
    let cancelled = false;
    let renderTask: { cancel?: () => void; promise: Promise<void> } | null = null;

    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled || nonce !== renderNonce.current) return;
        const unscaled = page.getViewport({ scale: 1, rotation });
        const horizontalPadding = 32;
        const verticalPadding = 32;
        const fitPageScale = Math.min(
          Math.max(.1, (viewerSize.width - horizontalPadding) / unscaled.width),
          Math.max(.1, (viewerSize.height - verticalPadding) / unscaled.height)
        );
        const baseScale = fitMode === "width"
          ? Math.max(.1, (viewerSize.width - horizontalPadding) / unscaled.width)
          : fitMode === "actual" ? 1 : fitPageScale;
        const viewport = page.getViewport({ scale: baseScale * zoom, rotation });
        const canvas = canvasRef.current;
        if (!canvas || cancelled || nonce !== renderNonce.current) return;
        const outputScale = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable");
        const nextRenderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
        });
        renderTask = nextRenderTask;
        await nextRenderTask.promise;
      } catch (error) {
        if (cancelled || (error as { name?: string }).name === "RenderingCancelledException") return;
        setFailed(true);
        onErrorRef.current();
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [document, fitMode, pageNumber, rotation, viewerSize, zoom]);

  function changeFitMode(next: FitMode) {
    setFitMode(next);
    setZoom(1);
    setFitMenuOpen(false);
    window.requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" }));
  }

  function changeZoom(next: number) {
    setFitMode("page");
    setZoom(clampZoom(next));
  }

  const label = fitMode === "page" && zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
  const zoomed = fitMode !== "page" || zoom > 1;
  const viewerStyle = { "--proof-page-zoom": String(zoom) } as CSSProperties;

  if (failed) {
    return (
      <div className="preview-empty" role="status">
        <strong>PDF preview unavailable</strong>
        <span>We couldn’t load this proof in the viewer. Use Open or Download while Vornan requests a current file link from Lift.</span>
      </div>
    );
  }

  return (
    <div className="proof-document-viewer" aria-busy={!document}>
      <div
        ref={viewportRef}
        className={`proof-document-viewport ${zoomed ? "zoomed" : "fit"}`}
        style={viewerStyle}
        aria-label={`PDF proof viewer: ${filename ?? "selected artwork"}`}
      >
        <canvas ref={canvasRef} className="proof-document-canvas" />
      </div>
      {document ? (
        <div className="proof-control-island" role="group" aria-label="PDF proof viewer controls">
          {pageCount && pageCount > 1 ? <>
            <button type="button" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => Math.max(1, page - 1))}><ChevronLeft aria-hidden="true" /></button>
            <span className="proof-page-indicator" aria-live="polite">{pageNumber} <i>/</i> {pageCount}</span>
            <button type="button" aria-label="Next page" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))}><ChevronRight aria-hidden="true" /></button>
            <span className="proof-control-divider" aria-hidden="true" />
          </> : null}
          <button type="button" aria-label="Zoom out" disabled={zoom <= zoomSteps[0]!} onClick={() => changeZoom(nextZoom(zoom, -1))}><Minus aria-hidden="true" /></button>
          <div className="proof-fit-menu">
            <button type="button" className="proof-zoom-fit" aria-label={`${fitLabel(fitMode)}. Choose zoom fitting`} aria-haspopup="menu" aria-expanded={fitMenuOpen} onClick={() => setFitMenuOpen((open) => !open)}>{label}</button>
            {fitMenuOpen ? <div className="proof-fit-options" role="menu" aria-label="PDF zoom fitting">
              {(["page", "width", "actual"] as FitMode[]).map((mode) => <button key={mode} type="button" role="menuitemradio" aria-checked={fitMode === mode && zoom === 1} onClick={() => changeFitMode(mode)}>{fitLabel(mode)}</button>)}
            </div> : null}
          </div>
          <button type="button" aria-label="Zoom in" disabled={zoom >= zoomSteps.at(-1)!} onClick={() => changeZoom(nextZoom(zoom, 1))}><Plus aria-hidden="true" /></button>
          <span className="proof-control-divider" aria-hidden="true" />
          <button type="button" aria-label="Rotate clockwise" onClick={() => setRotation((degrees) => (degrees + 90) % 360)}><RotateCw aria-hidden="true" /></button>
        </div>
      ) : <div className="proof-resolution-status" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><strong>Loading full-resolution proof…</strong></div>}
    </div>
  );
}
