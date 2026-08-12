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
