import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(new URL("../proof-synthetic-lifecycle-qa.ts", import.meta.url), "utf8");
const fixture = readFileSync(new URL("../../apps/api/src/proof/qa-fixture.ts", import.meta.url), "utf8");

test("keeps the deployed synthetic lifecycle on one reserved non-customer identity", () => {
  assert.match(fixture, /PROOF_SYNTHETIC_QA_ORDER_NUMBER = "A00000000"/);
  assert.match(fixture, /SYNTHETIC QA — NOT A CUSTOMER/);
  assert.match(fixture, /orderNumber !== PROOF_SYNTHETIC_QA_ORDER_NUMBER/);
  assert.match(fixture, /PATHFINDER_PROOF_ENVIRONMENT_NAME !== "dev"/);
  assert.match(runner, /PATHFINDER_PROOF_QA_CONFIRM/);
  assert.match(runner, /VORNAN_PROOF_SYNTHETIC_QA/);
  assert.doesNotMatch(runner, /PurgeQueueCommand/);
  assert.doesNotMatch(runner, /AS360Orders|AS360ProofReport|lifterp\.com/);
});

test("purges only records and messages carrying the reserved synthetic order and fixture ID", () => {
  assert.match(runner, /data\?\.order_number === PROOF_SYNTHETIC_QA_ORDER_NUMBER/);
  assert.match(runner, /qa\?\.fixture_id !== fixtureId/);
  assert.match(runner, /Synthetic purge refused to delete a non-fixture queue message/);
  assert.match(runner, /remainingCore\.length, 0/);
  assert.match(runner, /remainingAudit\.length, 0/);
});
