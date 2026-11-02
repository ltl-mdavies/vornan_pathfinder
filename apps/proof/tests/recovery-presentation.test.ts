import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
test("desktop and mobile empty-state success icons depend on actual completion", () => {
  const guarded = source.match(/completionEmpty \? <CheckCircle2 aria-hidden="true" \/> : <Search aria-hidden="true" \/>/g);
  assert.equal(guarded?.length, 2);
});
test("access styling does not remove terminal semantics or generic error state", () => {
  assert.match(source, /loadState.kind === "session_ended" \|\| loadState.kind === "link_unavailable" \? " access-recovery-state" : ""/);
  assert.match(source, /ref=\{terminalStateElement\}/);
  assert.match(source, /aria-labelledby="proof-terminal-heading"/);
  assert.match(source, /tabIndex=\{-1\}/);
});

test("session-ended copy is concise while other error messages remain available", () => {
  assert.match(source, /sessionEnded \? "Your session has ended"/);
  assert.match(source, /!sessionEnded && <p>\{loadState.message\}<\/p>/);
  assert.match(source, /Ask your Vornan contact for a new link if you still need access\./);
  assert.doesNotMatch(source, /No proof information remains visible in this browser/);
  assert.match(source, /role="alert" aria-atomic="true"/);
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.access-recovery-state\[tabindex="-1"\]:focus,/);
  assert.match(styles, /\.access-recovery-state #proof-terminal-heading:focus \{ outline: none; \}/);
  assert.match(styles, /button:focus-visible, a:focus-visible,[^\n]+outline: 3px solid/);
});
