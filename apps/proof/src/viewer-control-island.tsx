import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { GripVertical, RotateCcw } from "lucide-react";

export type ViewerControlIslandPosition = { x: number; y: number };

type ControlIslandBounds = {
  width: number;
  height: number;
  island_width: number;
  island_height: number;
};

const SESSION_STORAGE_KEY = "vornan-proof-viewer-controls-position-v1";
const KEYBOARD_STEP_PX = 28;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampViewerControlIslandPosition(
  position: ViewerControlIslandPosition,
  bounds: ControlIslandBounds
): ViewerControlIslandPosition {
  const minimumX = bounds.width > 0 ? Math.min(.5, Math.max(0, bounds.island_width / 2 / bounds.width)) : 0;
  const maximumX = 1 - minimumX;
  const minimumY = bounds.height > 0 ? Math.min(.5, Math.max(0, bounds.island_height / 2 / bounds.height)) : 0;
  const maximumY = 1 - minimumY;
  return {
    x: Math.min(maximumX, Math.max(minimumX, position.x)),
    y: Math.min(maximumY, Math.max(minimumY, position.y))
  };
}

function savedPosition(): ViewerControlIslandPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ViewerControlIslandPosition>;
    return finite(candidate.x) && finite(candidate.y) ? { x: candidate.x, y: candidate.y } : null;
  } catch {
    return null;
  }
}

function persistPosition(position: ViewerControlIslandPosition | null) {
  if (typeof window === "undefined") return;
  try {
    if (position) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(position));
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // A private or constrained browser session can still use the control for this render.
  }
}

function boundsFor(container: HTMLElement, island: HTMLElement): ControlIslandBounds {
  const containerBounds = container.getBoundingClientRect();
  const islandBounds = island.getBoundingClientRect();
  return {
    width: containerBounds.width,
    height: containerBounds.height,
    island_width: islandBounds.width,
    island_height: islandBounds.height
  };
}

function currentPosition(container: HTMLElement, island: HTMLElement, saved: ViewerControlIslandPosition | null) {
  if (saved) return clampViewerControlIslandPosition(saved, boundsFor(container, island));
  const containerBounds = container.getBoundingClientRect();
  const islandBounds = island.getBoundingClientRect();
  return clampViewerControlIslandPosition({
    x: (islandBounds.left - containerBounds.left + islandBounds.width / 2) / containerBounds.width,
    y: (islandBounds.top - containerBounds.top + islandBounds.height / 2) / containerBounds.height
  }, boundsFor(container, island));
}

type ViewerControlIslandProps = {
  containerRef: RefObject<HTMLElement | null>;
  className: string;
  label: string;
  children: ReactNode;
};

export function ViewerControlIsland({ containerRef, className, label, children }: ViewerControlIslandProps) {
  const islandRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ client_x: number; client_y: number; position: ViewerControlIslandPosition } | null>(null);
  const [position, setPosition] = useState<ViewerControlIslandPosition | null>(savedPosition);
  const [dragging, setDragging] = useState(false);

  const positionedStyle = position
    ? { left: `${position.x * 100}%`, top: `${position.y * 100}%`, bottom: "auto", translate: "-50% -50%" }
    : undefined;

  function updatePosition(next: ViewerControlIslandPosition) {
    const container = containerRef.current;
    const island = islandRef.current;
    if (!container || !island) return;
    const bounded = clampViewerControlIslandPosition(next, boundsFor(container, island));
    setPosition(bounded);
    persistPosition(bounded);
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const container = containerRef.current;
    const island = islandRef.current;
    if (!container || !island) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      client_x: event.clientX,
      client_y: event.clientY,
      position: currentPosition(container, island, position)
    };
    setDragging(true);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const container = containerRef.current;
    const island = islandRef.current;
    if (!drag || !container || !island) return;
    const bounds = boundsFor(container, island);
    if (!bounds.width || !bounds.height) return;
    updatePosition({
      x: drag.position.x + (event.clientX - drag.client_x) / bounds.width,
      y: drag.position.y + (event.clientY - drag.client_y) / bounds.height
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function nudge(event: KeyboardEvent<HTMLButtonElement>) {
    const container = containerRef.current;
    const island = islandRef.current;
    if (!container || !island) return;
    if (event.key === "Home") {
      event.preventDefault();
      setPosition(null);
      persistPosition(null);
      return;
    }
    const offsets: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -KEYBOARD_STEP_PX, y: 0 },
      ArrowRight: { x: KEYBOARD_STEP_PX, y: 0 },
      ArrowUp: { x: 0, y: -KEYBOARD_STEP_PX },
      ArrowDown: { x: 0, y: KEYBOARD_STEP_PX }
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const bounds = boundsFor(container, island);
    if (!bounds.width || !bounds.height) return;
    const current = currentPosition(container, island, position);
    updatePosition({ x: current.x + offset.x / bounds.width, y: current.y + offset.y / bounds.height });
  }

  return (
    <div
      ref={islandRef}
      className={`${className} viewer-control-island${position ? " is-positioned" : ""}${dragging ? " is-dragging" : ""}`}
      style={positionedStyle}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className="proof-control-handle"
        aria-label="Move viewer controls. Use arrow keys to reposition or Home to reset."
        data-tooltip="Move controls"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={nudge}
      >
        <GripVertical aria-hidden="true" />
      </button>
      {position ? <button type="button" className="proof-control-reset" aria-label="Reset viewer controls position" data-tooltip="Reset controls position" onClick={() => { setPosition(null); persistPosition(null); }}><RotateCcw aria-hidden="true" /></button> : null}
      <span className="proof-control-divider" aria-hidden="true" />
      {children}
    </div>
  );
}
