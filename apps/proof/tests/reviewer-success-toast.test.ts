import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const toast = readFileSync(new URL('../src/reviewer-success-toast.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
test('only the two confirmed reviewer-save paths opt into transient success', () => {
  assert.equal((app.match(/setActionOutcome\(\{ kind: "reviewer_saved"/g) ?? []).length, 2);
  assert.match(app, /actionOutcome\?\.kind === "reviewer_saved" \? <ReviewerSuccessToast/);
  assert.match(app, /current === actionOutcome \? null : current/);
  assert.match(app, /: actionOutcome \? \(\s*<div className="action-outcome-notice" role="status"/);
  assert.match(app, /We couldn’t confirm the save\. Your edits are still here/);
});
test('reviewer success retains remaining time, pauses for pointer/focus and restores safe focus only on dismissal', () => {
  assert.match(toast, /remaining = useRef\(5000\)/);
  assert.match(toast, /if \(hovered \|\| focused\) return/);
  assert.match(toast, /remaining.current - \(performance.now\(\) - started\)/);
  assert.match(toast, /window.clearTimeout\(timer\)/);
  assert.match(toast, /const onExpire = dismiss.current/);
  assert.match(toast, /onBlurCapture/);
  assert.match(toast, /role="status" aria-live="polite"/);
  assert.match(app, /if \(restoreFocus\) reviewerButton.current\?\.focus/);
  assert.match(css, /\.reviewer-success-toast\{position:fixed/);
});
test('compact dock does not hide actionable blockers or touch image/PDF renderer colors', () => {
  assert.match(app, /singleApprovalBlocked && \(mobile \|\| decisionsEnabled\)/);
  assert.match(app, /singleApprovalMessage \? <p className=/);
  assert.match(app, /changeRequestMessage \? <p className=/);
  assert.match(css, /\.preview-stage \{[^}]*background: #e9ecdf/);
  assert.match(css, /\.proof-document-viewer \{[^}]*background: #242724/);
  assert.match(css, /@media\(min-width:901px\)\{/);
});
