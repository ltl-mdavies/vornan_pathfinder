import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("job collections use the compact list contract", () => {
  assert.match(source, /interface JobListItem/);
  assert.match(source, /jobs: JobListRecord\[\]/);
  assert.match(source, /useState<JobListRecord\[\]>/);
  assert.match(source, /jobOrderTitle\(job\)/);
});

test("opening a compact job fetches exact full detail before rendering it", () => {
  const start = source.indexOf("async function openJobDetail");
  const end = source.indexOf("function closeJobDetail", start);
  const openJobDetail = source.slice(start, end);
  assert.match(openJobDetail, /job: JobListRecord/);
  assert.match(openJobDetail, /setSelectedJobDetail\(null\)/);
  assert.match(openJobDetail, /\/api\/customers\/\$\{job\.customer_id\}\/jobs\/\$\{job\.job_id\}/);
  assert.match(openJobDetail, /setSelectedJobDetail\(payload\.job\)/);
  assert.ok(
    openJobDetail.indexOf("setSelectedJobDetail(payload.job)") >
      openJobDetail.indexOf("readJsonResponse<{ job: ProcessingJobPreview")
  );
});

test("background list refresh cannot replace an open full-detail record", () => {
  const start = source.indexOf("async function refreshVisibleJobs");
  const end = source.indexOf("async function loadCanonicalRegistry", start);
  const refresh = source.slice(start, end);
  assert.doesNotMatch(refresh, /setSelectedJobDetail/);
});
