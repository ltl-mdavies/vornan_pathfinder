import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { boundedRevisionRequest } from "../src/api.ts";

test("a hanging status GET settles even when its transport ignores abort", async () => {
  let calls = 0, signal: AbortSignal | undefined;
  await assert.rejects(boundedRevisionRequest((s) => { calls++; signal = s; return new Promise(() => {}); }, 10), /could not be confirmed in time/);
  assert.equal(calls, 1); assert.equal(signal?.aborted, true);
});
test("unsent drafts remain in memory per proof binding across task switches", () => {
  const upload = readFileSync(new URL("../src/revision-upload-dialog.tsx", import.meta.url), "utf8");
  assert.match(upload, /drafts\.current\.set\(draftBinding\.current, latestDraft\.current\)/);
  assert.match(upload, /const saved = drafts\.current\.get\(binding\)/);
  assert.match(upload, /setFile\(saved\?\.file \?\? null\)/);
  assert.match(upload, /setNote\(saved\?\.note \?\? ""\)/);
  assert.doesNotMatch(upload, /sessionStorage\.setItem\([^\n]*JSON\.stringify\([^\n]*file/);
});
test("multiple receipt cards keep content-sized rows inside a scrolling dialog", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.revision-status-content \{[^}]*grid-auto-rows: max-content;[^}]*overflow-y: auto;/);
});
test("late upload polling and completion cannot overwrite a different proof draft", () => {
  const upload = readFileSync(new URL("../src/revision-upload-dialog.tsx", import.meta.url), "utf8");
  assert.match(upload, /if \(!active \|\| draftBinding.current !== binding\) return;/);
  assert.match(upload, /active = false; window.clearTimeout\(timer\)/);
  assert.match(upload, /mounted.current && draftBinding.current === binding/);
  assert.match(upload, /await finalizeRevisionUpload\(prepared.asset.asset_id\);\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(upload, /await uploadRevisionFile\(prepared.upload, file\);\s*if \(!stillCurrent\(\)\) return;/);
});
test("successful or failed I/O is never retried by the timeout guard", async () => {
  let calls = 0;
  assert.equal(await boundedRevisionRequest(async () => { calls++; return "saved"; }, 100), "saved");
  await assert.rejects(boundedRevisionRequest(async () => { calls++; throw new Error("response lost"); }, 100), /response lost/);
  assert.equal(calls, 2);
});
test("both receipt GETs are bounded and failed POST recovery never holds Sending or repeats POST", () => {
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const progress = readFileSync(new URL("../src/revision-submission-progress.tsx", import.meta.url), "utf8");
  assert.match(api, /loadRevisionSubmissions = \(\) => boundedRevisionRequest/);
  assert.match(api, /loadRevisionSubmission = \(submissionId: string\) => boundedRevisionRequest/);
  assert.match(progress, /void check\(\);\s*\} finally/);
  assert.equal((progress.match(/await submitRevisionArtwork\(/g) ?? []).length, 1);
  assert.match(progress, /model.checking \? "Checking saved artwork status" : model.message \? "Artwork status needs a check"/);
});
