import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("Lift target settings expose four-digit order date formats", () => {
  assert.match(source, /Order Date Format/);
  assert.match(source, /order_date_format: event\.target\.value/);
  assert.match(source, /<option value="MM\/DD\/YYYY">MM\/DD\/YYYY<\/option>/);
  assert.match(source, /prepareLiftOrderDateFormat/);
});

test("Jobs refreshes only while a Jobs view and the browser tab are visible", () => {
  assert.match(source, /const isJobViewVisible/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /window\.setInterval\(\(\) => void refresh\(\), 15_000\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /Auto-refreshing while visible/);
});

test("Wrike Import Method exposes safe discovery and actionable pending intake", () => {
  assert.match(source, /Run discovery now/);
  assert.match(source, /\/wrike\/discovery-runs/);
  assert.match(source, /same saved folders, qualification rules, evidence capture, document publication/);
  assert.match(source, /Pending intake/);
  assert.match(source, /candidate\.reasons\.map/);
  assert.match(source, /Likely candidates/);
  assert.match(source, /All Placard Orders/);
  assert.match(source, /candidate\.readiness_score/);
  assert.match(source, /wrikePendingPageSize = 25/);
  assert.match(source, /No Lift order was submitted and no Wrike status was changed/);
});

test("Jobs presents one source-order identity with nontechnical state filters", () => {
  assert.match(source, /Current orders/);
  assert.match(source, /Ready to submit/);
  assert.match(source, /Confirmation needed/);
  assert.match(source, /Order confirmed/);
  assert.match(source, /Wrike Order/);
  assert.match(source, /jobContractNumber/);
  assert.match(source, /jobCampaignName/);
  assert.match(source, /Source order activity/);
  assert.match(source, /Historical record/);
});

test("blocked Wrike jobs expose in-place mapping recovery and audit history", () => {
  assert.match(source, /Check current mappings/);
  assert.match(source, /\/re-evaluate-mappings/);
  assert.match(source, /Recovery history/);
  assert.match(source, /No Lift order was created or retried/);
});

test("Jobs remembers separate views and explains operational timestamps", () => {
  assert.match(source, /pathfinder\.jobs\.view\.global\.v1/);
  assert.match(source, /pathfinder\.jobs\.view\.customer\.v1/);
  assert.match(source, /window\.localStorage\.setItem/);
  assert.match(source, /Reset view/);
  assert.match(source, /Pathfinder Intake/);
  assert.match(source, /Last Activity/);
  assert.match(source, /Lift created/);
});

test("Jobs exposes compact triage signals and durable Wrike candidate review", () => {
  assert.match(source, /OperationsTriageStrip/);
  assert.match(source, /Orders confirmed/);
  assert.match(source, /Intake review/);
  assert.match(source, /Waiting to submit/);
  assert.match(source, /Confirmation needed/);
  assert.match(source, /Failed or blocked/);
  assert.match(source, /Latest durable discovery evidence/);
  assert.match(source, /wrike_operations_snapshots/);
});

test("confirmed jobs compare source, prepared, and current Lift lines without retrying", () => {
  assert.match(source, /Compare order lines/);
  assert.match(source, /Input order/);
  assert.match(source, /Prepared for Lift/);
  assert.match(source, /Current in Lift/);
  assert.match(source, /This read-only view aligns product and quantity by line number/);
  assert.match(source, /No retry is required/);
  assert.match(source, /Historical timeout retained for audit/);
});

test("Jobs shows durable Lift order-header status and the line comparison uses the full width", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /<th>Order Status<\/th>/);
  assert.match(source, /job\.target_order_status\.label/);
  assert.match(source, /Lift order header last checked/);
  assert.match(source, /job\.target_order_number \? "Not checked" : "Not in Lift"/);
  assert.match(styles, /\.order-line-comparison table \{[\s\S]*?width: 100%;[\s\S]*?table-layout: fixed;/);
});

test("Job detail prioritizes order identity, attention, and progressive disclosure", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(source, /Wrike order · \{displayJobId\(selectedJobDetail\.job_id\)\}/);
  assert.match(source, /\{selectedJobContractNumber\} · \{selectedJobCampaignName\}/);
  assert.match(source, /aria-label="Order needs review"/);
  assert.match(source, /Refresh Lift status/);
  assert.match(source, /aria-label="Job actions"/);
  assert.match(source, /Current Lift order/);
  assert.match(source, /Technical evidence/);
  assert.match(source, /Snapshot diagnostics/);
  assert.doesNotMatch(source, /<details className="job-recovery-history" open>/);
  assert.match(styles, /\.job-detail-primary-summary \{[\s\S]*?grid-template-columns: repeat\(4,/);
  assert.match(styles, /\.job-detail-technical-evidence-body \{/);
});

test("Job line comparison summarizes matches and shows resolved Lift product identity", () => {
  assert.match(source, /matchingLineCount/);
  assert.match(source, /of \$\{lineNumbers\.length\} lines match/);
  assert.match(source, /resolution\?\.product_name \|\| prepared\?\.product_name/);
  assert.match(source, /Lift ID \{preparedIdentifier\}/);
});
