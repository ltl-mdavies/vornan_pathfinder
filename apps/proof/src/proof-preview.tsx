import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, FileText, Minus, Plus, RefreshCw } from "lucide-react";
import { proofAsset, stableProofAssetUrlIdentity } from "./asset-state";
import type { ProofVersion } from "./types";

type ProofPreviewProps = {
  version: ProofVersion | null;
  refreshing?: boolean;
  quality?: "high" | "preview";
};

const zoomSteps = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function distanceBetween(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return 0;
  return Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y);
}

function clampZoom(value: number) {
  return Math.min(zoomSteps.at(-1)!, Math.max(zoomSteps[0]!, value));
}

export function previewImageFallback(input: {
  quality: "high" | "preview";
  active_source: string | null;
  preview_source: string | null;
  preview_kind: string;
}) {
  if (input.quality !== "high" || input.preview_kind !== "image" || !input.preview_source || input.active_source === input.preview_source) {
    return null;
  }
  return input.preview_source;
}

export function ProofPreview({ version, refreshing = false, quality = "high" }: ProofPreviewProps) {
  const asset = proofAsset(version);
  const source = quality === "high" ? asset.display : asset.preview;
  const sourceKind = quality === "high" ? asset.display_kind : asset.kind;
  const sourceIdentity = proofPreviewSourceIdentity({
    version_id: version?.version_id ?? null,
    source,
    preview_source: asset.preview,
    source_kind: sourceKind
  });
  return <ProofPreviewSource key={sourceIdentity} version={version} refreshing={refreshing} quality={quality} asset={asset} source={source} sourceKind={sourceKind} />;
}

export function proofPreviewSourceIdentity(input: {
  version_id: string | null;
  source: string | null;
  preview_source: string | null;
  source_kind: string;
}) {
  return [
    input.version_id ?? "none",
    stableProofAssetUrlIdentity(input.source) ?? input.source ?? "none",
    stableProofAssetUrlIdentity(input.preview_source) ?? input.preview_source ?? "none",
    input.source_kind
  ].join("|");
}

type ProofPreviewSourceProps = ProofPreviewProps & {
  asset: ReturnType<typeof proofAsset>;
  source: string | null;
  sourceKind: ReturnType<typeof proofAsset>["display_kind"];
};

function ProofPreviewSource({ version, refreshing = false, quality = "high", asset, source, sourceKind }: ProofPreviewSourceProps) {
  const [activeSource, setActiveSource] = useState(source);
  const [activeKind, setActiveKind] = useState(sourceKind);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [usingPreviewFallback, setUsingPreviewFallback] = useState(false);
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
  const pinchUsedRef = useRef(false);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const loaded = Boolean(activeSource && loadedSource === activeSource);
  const failed = Boolean(activeSource && failedSource === activeSource);
  const lowResolutionPlaceholder = quality === "high" && activeSource !== asset.preview && asset.preview && asset.kind === "image"
    ? asset.preview
    : null;

  function usePreviewFallbackOrFail() {
    const fallbackSource = previewImageFallback({
      quality,
      active_source: activeSource,
      preview_source: asset.preview,
      preview_kind: asset.kind
    });
    if (fallbackSource) {
      setActiveSource(fallbackSource);
      setActiveKind(asset.kind);
      setLoadedSource(null);
      setFailedSource(null);
      setUsingPreviewFallback(true);
      setZoom(1);
      return;
    }
    setFailedSource(activeSource);
  }

  function focusZoomAt(clientX: number, clientY: number, nextZoom: number) {
    const viewport = viewportRef.current;
    const normalizedZoom = clampZoom(nextZoom);
    if (!viewport) {
      setZoom(normalizedZoom);
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const contentX = viewport.scrollLeft + clientX - bounds.left;
    const contentY = viewport.scrollTop + clientY - bounds.top;
    const ratio = normalizedZoom / zoom;
    setZoom(normalizedZoom);
    window.requestAnimationFrame(() => {
      if (normalizedZoom === 1) {
        viewport.scrollTo({ left: 0, top: 0, behavior: "smooth" });
        return;
      }
      viewport.scrollTo({
        left: contentX * ratio - viewport.clientWidth / 2,
        top: contentY * ratio - viewport.clientHeight / 2
      });
    });
  }

  function fitProof() {
    const viewport = viewportRef.current;
    setZoom(1);
    window.requestAnimationFrame(() => viewport?.scrollTo({ left: 0, top: 0, behavior: "smooth" }));
  }

  function onProofPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointsRef.current.size === 2) {
      pinchUsedRef.current = true;
      pinchStartRef.current = {
        distance: distanceBetween([...touchPointsRef.current.values()]),
        zoom
      };
    }
  }

  function onProofPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || !touchPointsRef.current.has(event.pointerId)) return;
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...touchPointsRef.current.values()];
    const pinchStart = pinchStartRef.current;
    if (points.length !== 2 || !pinchStart || pinchStart.distance <= 0) return;
    event.preventDefault();
    const centerX = (points[0]!.x + points[1]!.x) / 2;
    const centerY = (points[0]!.y + points[1]!.y) / 2;
    focusZoomAt(centerX, centerY, pinchStart.zoom * distanceBetween(points) / pinchStart.distance);
  }

  function clearProofPointer(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    if (event.pointerType !== "touch") return;
    const wasSingleTouch = touchPointsRef.current.size === 1 && !pinchUsedRef.current;
    touchPointsRef.current.delete(event.pointerId);
    if (!cancelled && wasSingleTouch) {
      const previousTap = lastTapRef.current;
      const closeToPrevious = previousTap
        && Date.now() - previousTap.at < 320
        && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < 36;
      if (closeToPrevious) {
        focusZoomAt(event.clientX, event.clientY, zoom > 1 ? 1 : 2);
        lastTapRef.current = null;
      } else {
        lastTapRef.current = { at: Date.now(), x: event.clientX, y: event.clientY };
      }
    }
    if (touchPointsRef.current.size < 2) pinchStartRef.current = null;
    if (touchPointsRef.current.size === 0) pinchUsedRef.current = false;
  }

  if (activeKind === "download" && asset.open) {
    return (
      <div className="preview-empty">
        <FileText aria-hidden="true" />
        <strong>Full-resolution file</strong>
        <span>{version?.content_type ?? "This file type"} can’t be previewed safely in the browser. Open or download the original file to review it.</span>
        <a className="button secondary" href={asset.open} target="_blank" rel="noreferrer" aria-label={`Open ${version?.filename ?? "proof file"}`}>Open file <ExternalLink aria-hidden="true" /></a>
      </div>
    );
  }

  if (!activeSource) {
    if (refreshing) {
      return (
        <div className="preview-empty preview-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <strong>Loading current artwork…</strong>
          <span>Vornan is getting the latest proof from Lift. It will appear here automatically.</span>
        </div>
      );
    }
    return (
      <div className="preview-empty">
        <FileText aria-hidden="true" />
        <strong>Preview unavailable</strong>
        <span>The source file can’t be previewed here.</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="preview-empty" role="status">
        <RefreshCw aria-hidden="true" />
        <strong>Full-resolution preview unavailable</strong>
        <span>Use Open or Download while Vornan requests a current proof link from Lift.</span>
      </div>
    );
  }

  if (activeKind === "image") {
    const zoomStyle = { "--proof-zoom": String(zoom) } as CSSProperties;
    const nextZoomOut = [...zoomSteps].reverse().find((step) => step < zoom - 0.01) ?? zoomSteps[0]!;
    const nextZoomIn = zoomSteps.find((step) => step > zoom + 0.01) ?? zoomSteps.at(-1)!;
    return (
      <div className="proof-resolution-viewer" aria-busy={!loaded}>
        {quality === "high" ? (
          <div className="proof-zoom-controls" role="group" aria-label="Proof zoom controls">
            <button type="button" aria-label="Zoom out" disabled={zoom <= zoomSteps[0]!} onClick={() => setZoom(nextZoomOut)}><Minus aria-hidden="true" /></button>
            <button type="button" className="proof-zoom-fit" aria-label="Fit proof to viewer" onClick={fitProof}>{zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</button>
            <button type="button" aria-label="Zoom in" disabled={zoom >= zoomSteps.at(-1)!} onClick={() => setZoom(nextZoomIn)}><Plus aria-hidden="true" /></button>
          </div>
        ) : null}
        <div
          ref={viewportRef}
          className={`proof-image-viewport ${zoom > 1 ? "zoomed" : "fit"}`}
          style={zoomStyle}
          onPointerDown={onProofPointerDown}
          onPointerMove={onProofPointerMove}
          onPointerUp={(event) => clearProofPointer(event)}
          onPointerCancel={(event) => clearProofPointer(event, true)}
          onDoubleClick={(event) => focusZoomAt(event.clientX, event.clientY, zoom > 1 ? 1 : 2)}
          aria-label="Proof image viewer. Pinch or double tap to zoom."
        >
          {lowResolutionPlaceholder && !loaded ? <img className="proof-image proof-image-placeholder" src={lowResolutionPlaceholder} referrerPolicy="no-referrer" alt="" aria-hidden="true" /> : null}
          <img
            className={`proof-image proof-image-primary ${loaded ? "loaded" : "loading"}`}
            src={activeSource}
            referrerPolicy="no-referrer"
            alt={`Proof preview for ${version?.filename ?? "selected artwork"}`}
            onLoad={() => setLoadedSource(activeSource)}
            onError={usePreviewFallbackOrFail}
          />
        </div>
        {usingPreviewFallback && loaded ? <div className="proof-resolution-notice" role="status" aria-live="polite">Showing preview resolution. Full resolution is temporarily unavailable.</div> : null}
        {!loaded ? <div className="proof-resolution-status" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><strong>{usingPreviewFallback ? "Loading preview resolution…" : quality === "high" ? "Loading full-resolution proof…" : "Loading proof…"}</strong></div> : null}
      </div>
    );
  }

  if (activeKind === "pdf") {
    return (
      <div className="preview-document" aria-busy={!loaded}>
        <iframe
          className={`proof-frame ${loaded ? "loaded" : "loading"}`}
          src={activeSource}
          referrerPolicy="no-referrer"
          loading={quality === "high" ? "eager" : "lazy"}
          title={`PDF proof preview for ${version?.filename ?? "selected artwork"}`}
          onLoad={() => setLoadedSource(activeSource)}
          onError={usePreviewFallbackOrFail}
        />
        {!loaded ? <div className="proof-resolution-status proof-resolution-status--document" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><strong>{quality === "high" ? "Loading full-resolution proof…" : "Loading proof…"}</strong></div> : null}
      </div>
    );
  }

  return (
    <div className="preview-empty">
      <FileText aria-hidden="true" />
      <strong>Preview unavailable</strong>
      <span>The source file can’t be previewed here.</span>
    </div>
  );
}
