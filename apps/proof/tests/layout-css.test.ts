import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

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
  assert.match(styles, /\.detailed-report-viewer-dialog\s*\{[^}]*width:\s*min\(1600px, calc\(100vw - 48px\)\);/s);
  assert.match(styles, /\.detailed-report-viewer-dialog\s*\{[^}]*height:\s*min\(92dvh, 1180px\);/s);
  assert.match(styles, /\.detailed-report-viewer-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 48px\);/s);
});
