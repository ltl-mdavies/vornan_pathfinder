import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("compact creative dock retains two steps and disabled revision safeguards", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(styles, /\.action-transport\.distribution\s*\{[^}]*grid-template-rows:\s*auto auto;/s);
  assert.match(styles, /\.creative-stage-actions \.button\s*\{\s*min-height:\s*44px;/);
  assert.match(app, /className="button secondary request-changes" type="button" disabled title="Multiple-proof revision requests require coordinated support."/);
  assert.match(app, /allocationBlocked \?\? \(selectedIsStaged/);
});

test("bounds thumbnail grid tracks so intrinsic portrait artwork cannot be clipped", () => {
  assert.match(styles, /\.task-thumbnail\s*\{[^}]*grid-template:\s*minmax\(0, 1fr\) \/ minmax\(0, 1fr\);/s);
  assert.match(styles, /\.task-thumbnail img\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;/s);
  assert.match(styles, /\.task-thumbnail img\s*\{[^}]*object-fit:\s*contain;[^}]*object-position:\s*center;/s);
});

test("keeps large proof queues scrollable without shrinking line cards", () => {
  assert.match(styles, /\.task-list\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(styles, /\.task-list\s*\{[^}]*grid-auto-rows:\s*max-content;/s);
  assert.match(styles, /\.task-list\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.line-group-card\s*\{[^}]*min-height:\s*82px;/s);
});

test("keeps both horizontal edges reachable while a proof is zoomed", () => {
  assert.match(styles, /\.proof-image-viewport\.zoomed\s*\{[^}]*place-items:\s*start start;/s);
  assert.doesNotMatch(styles, /\.proof-image-viewport\.zoomed\s*\{[^}]*place-items:\s*start center;/s);
  assert.match(styles, /\.proof-image-viewport\s*\{[^}]*overflow:\s*auto;/s);
});

test("uses the available viewport for detailed report viewing", () => {
  assert.match(styles, /\.proof-dialog\.detailed-report-viewer-dialog\s*\{[^}]*width:\s*min\(1600px, calc\(100vw - 48px\)\);/s);
  assert.match(styles, /\.proof-dialog\.detailed-report-viewer-dialog\s*\{[^}]*height:\s*min\(92dvh, 1180px\);/s);
  assert.match(styles, /\.proof-dialog\.detailed-report-viewer-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 48px\);/s);
});

test("reserves green status treatment for approved proofs", () => {
  assert.match(styles, /\.line-group-status\.approved\s*\{\s*color:\s*#39723f;/);
  assert.match(styles, /\.line-group-status\.reference\s*\{\s*color:\s*var\(--muted\);/);
  assert.doesNotMatch(styles, /\.line-group-status\.approved,\s*\.line-group-status\.reference/);
});

test("keeps viewer-control tooltips available on hover and keyboard focus", () => {
  assert.match(styles, /\.proof-control-island button\[data-tooltip\]::after\s*\{[^}]*content:\s*attr\(data-tooltip\);/s);
  assert.match(styles, /button\[data-tooltip\]:hover:not\(:disabled\)::after,\s*\.proof-control-island button\[data-tooltip\]:focus-visible::after/s);
});

test("clarifies the new-tab link on hover and keyboard focus without changing sharing or navigation", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /className="icon-button subtle"[^>]*target="_blank"[^>]*aria-label="Open proof in a new tab"/s);
  assert.match(app, /const open = \(hovered \|\| focused\) && !dismissed;/);
  assert.match(app, /if \(event.key === "Escape"\) setDismissed\(true\);/);
  assert.match(app, /document.removeEventListener\("keydown", dismissOnEscape\)/);
  assert.match(app, /onMouseEnter=\{\(\) => \{ setHovered\(true\); setDismissed\(false\); \}\}/);
  assert.match(app, /onFocus=\{\(\) => \{ setFocused\(true\); setDismissed\(false\); \}\}/);
  assert.match(styles, /\.proof-open-tab-tooltip\s*\{[^}]*right:\s*0;[^}]*top:\s*100%;[^}]*padding-top:\s*6px;/s);
  assert.doesNotMatch(styles, /\.proof-open-tab-tooltip\s*\{[^}]*pointer-events:\s*none/s);
});
