import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { boundedRevisionRequest } from "../src/api.ts";

test("a hanging status GET settles even when its transport ignores abort", async () => {
  let calls = 0, signal: AbortSignal | undefined;
  await assert.rejects(boundedRevisionRequest((s) => { calls++; signal = s; return new Promise(() => {}); }, 10), /could not be confirmed in time/);
  assert.equal(calls, 1); assert.equal(signal?.aborted, true);
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
});
