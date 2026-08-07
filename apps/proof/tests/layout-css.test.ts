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
