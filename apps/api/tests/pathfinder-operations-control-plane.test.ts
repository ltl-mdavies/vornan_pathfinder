import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

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
