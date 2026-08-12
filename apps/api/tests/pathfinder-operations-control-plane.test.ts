import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");

test("Lift dates use the configured target formatter after output mappings", () => {
  const mappingIndex = source.indexOf("const rawLiftPayload = applyLiftOrderOutputMappings");
  const dateIndex = source.indexOf("const datedLift = prepareLiftOrderDateFormat", mappingIndex);
  const normalizationIndex = source.indexOf("const normalizedLift = applyValueNormalizationToLiftPayload", dateIndex);

  assert.ok(mappingIndex > 0 && dateIndex > mappingIndex && normalizationIndex > dateIndex);
  assert.match(source.slice(dateIndex, normalizationIndex), /target\.lift\.order_date_format \?\? "MM\/DD\/YYYY"/);
  assert.match(storeSource, /order_date_format:[\s\S]*?"MM\/DD\/YYYY"/);
});

test("operator discovery reuses the scheduled discovery and preparation path without external writes", () => {
  const start = source.indexOf(
    '"/api/customers/:liftCustomerId/import-methods/:methodId/wrike/discovery-runs"'
  );
  const end = source.indexOf(
    '"/api/customers/:liftCustomerId/import-methods/:methodId/wrike/prepare-order"',
    start
  );
  assert.ok(start > 0 && end > start);
  const route = source.slice(start, end);

  assert.match(route, /runConfiguredWrikeIntakeCore/);
  assert.match(route, /lift_submit_enabled: false/);
  assert.match(route, /status_writeback_enabled: false/);
  assert.match(route, /markScheduled: false/);
  assert.match(route, /pending_order_candidates/);
  assert.doesNotMatch(route, /submitLiftOrder/);
  assert.doesNotMatch(route, /postWrikeTaskComment/);
});

test("mapping recovery preserves order identity and never invokes Lift transport", () => {
  const start = source.indexOf(
    '"/api/customers/:liftCustomerId/jobs/:jobId/re-evaluate-mappings"'
  );
  const end = source.indexOf(
    'app.patch("/api/customers/:liftCustomerId/jobs/:jobId/archive"',
    start
  );
  assert.ok(start > 0 && end > start);
  const route = source.slice(start, end);

  assert.match(route, /wrikeMappingReevaluationBlockReason/);
  assert.match(route, /existingJob/);
  assert.match(route, /pathfinder_order_id !== existingJob\.pathfinder_order_id/);
  assert.match(route, /pathfinder_canonical_order_id/);
  assert.match(route, /lift_payload\.order\.ext_id !== existingJob\.lift_payload\.order\.ext_id/);
  assert.match(route, /source_evidence\?\.task_id !== existingJob\.source_evidence\.task_id/);
  assert.match(route, /uncertain_lift_retry_allowed: false/);
  assert.doesNotMatch(route, /submitLiftOrder/);
  assert.doesNotMatch(route, /reserveSubmitAttempt/);
});

test("in-place preview regeneration reuses all idempotency identities", () => {
  assert.match(source, /const jobId = options\?\.existingJob\?\.job_id \?\?/);
  assert.match(
    source,
    /options\?\.existingJob\?\.lift_payload\.source\.pathfinder_canonical_order_id \?\?/
  );
  assert.match(
    source,
    /options\?\.existingJob\?\.pathfinder_order_id \?\? \(await reservePathfinderOrderNumber\(\)\)/
  );
  assert.match(
    source,
    /liftPayload\.order\.ext_id = options\.existingJob\.lift_payload\.order\.ext_id/
  );
});

test("scheduled Wrike preparation keeps one record per source task", () => {
  assert.match(source, /wrikeSourceOrderAnchorDisposition/);
  assert.match(source, /existingJob: sourceOrder\.anchor \?\? undefined/);
  assert.match(source, /source_change_observed_after_transport/);
  assert.match(source, /Reconcile the existing submission before taking any action/);
  assert.match(source, /sourceOrderJobProjection/);
  assert.match(source, /related_record_count/);
});

test("confirmed or uncertain source changes stop before document publication", () => {
  const prepareStart = source.indexOf("async function prepareWrikeOrderForTask");
  const transportGuard = source.indexOf("existingSourceOrder.possibleTransport", prepareStart);
  const publication = source.indexOf("publishWrikeLiftSourceDocument", prepareStart);
  assert.ok(prepareStart > 0 && transportGuard > prepareStart && publication > transportGuard);
  const protectedBranch = source.slice(transportGuard, publication);
  assert.match(protectedBranch, /createWrikeEvidencePreviewForMethod/);
  assert.match(protectedBranch, /return/);
  assert.doesNotMatch(protectedBranch, /submitLiftOrder/);
});
