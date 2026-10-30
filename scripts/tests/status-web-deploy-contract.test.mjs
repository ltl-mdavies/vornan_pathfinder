import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const source = readFileSync(new URL("../../.github/workflows/deploy-status-web.yml", import.meta.url), "utf8");
const workflow = parse(source);
const steps = workflow.jobs["deploy-status-web"].steps;

test("Status publishes only its built frontend, retaining prior assets before replacing HTML", () => {
  const assetIndex = steps.findIndex(step => step.name === "Sync immutable assets");
  const htmlIndex = steps.findIndex(step => step.name === "Upload SPA entrypoint");
  const invalidateIndex = steps.findIndex(step => step.name === "Invalidate CloudFront");
  assert.ok(assetIndex >= 0 && htmlIndex > assetIndex && invalidateIndex > htmlIndex);
  assert.match(steps[assetIndex].run, /aws s3 sync apps\/status\/dist /);
  assert.match(steps[assetIndex].run, /--exclude "index.html"/);
  assert.match(steps[assetIndex].run, /public,max-age=31536000,immutable/);
  assert.match(steps[htmlIndex].run, /apps\/status\/dist\/index.html/);
  assert.match(steps[htmlIndex].run, /no-cache,no-store,must-revalidate/);
  assert.doesNotMatch(source, /--delete\b|aws s3 rm\b/);
  for (const index of [assetIndex, htmlIndex]) {
    assert.match(steps[index].run, /vars\.PATHFINDER_STATUS_BUCKET/);
    assert.doesNotMatch(steps[index].run, /PATHFINDER_ADMIN_BUCKET|PATHFINDER_PROOF_WEB_BUCKET/);
  }
});

test("Status release stays manually dispatched from merged main and uses its own distribution", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const mainGuard = steps.find(step => step.name === "Require merged main branch");
  assert.match(mainGuard.if, /github.ref != 'refs\/heads\/main'/);
  assert.match(mainGuard.run, /exit 1/);
  const invalidate = steps.find(step => step.name === "Invalidate CloudFront");
  assert.match(invalidate.run, /vars\.PATHFINDER_STATUS_CLOUDFRONT_DISTRIBUTION_ID/);
  assert.doesNotMatch(source, /aws (lambda|cloudformation|dynamodb)\b/);
});
