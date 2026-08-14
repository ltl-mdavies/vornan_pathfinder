import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

function functionSource(name: string, nextName: string) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test("customer route persistence uses only the focused customer endpoint", () => {
  const persistSource = functionSource("persistOutputRoute", "saveCustomerRoutes");
  const routeSaveSource = functionSource("saveCustomerRoutes", "saveTarget");

  assert.match(
    persistSource,
    /\/api\/customers\/\$\{selectedCustomer\.lift_customer_id\}\/output-routes\/\$\{route\.output_route_id\}/
  );
  assert.doesNotMatch(persistSource, /\/api\/targets\//);
  assert.match(routeSaveSource, /persistOutputRoute\(route\)/);
  assert.doesNotMatch(routeSaveSource, /\/api\/targets\/|\bwriteStore\b|\bsetTargets\b/);
});

test("the target header saves route-only drafts and blocks shared target writes", () => {
  const targetSaveSource = functionSource("saveTarget", "applyCatalogPreset");

  assert.match(targetSaveSource, /dirtyTargetIds\.includes\(target\.target_id\)/);
  assert.match(targetSaveSource, /Reusable target editing is temporarily unavailable/);
  assert.match(targetSaveSource, /dirtyOutputRouteIds\.includes\(route\.output_route_id\)/);
  assert.match(targetSaveSource, /saveCustomerRoutes\(/);
  assert.doesNotMatch(targetSaveSource, /\bfetch\s*\(|\/api\/targets\/|\bwriteStore\b/);
  assert.match(source, /Save Customer Route/);
  assert.match(source, /Save unavailable/);
});

test("the primary route environment control never mutates the reusable target", () => {
  const changeSource = functionSource("changePrimaryRouteEnvironment", "runHeaderAction");

  assert.match(changeSource, /saveOutputRoute\(\s*nextRoute/);
  assert.doesNotMatch(changeSource, /saveTarget\(|updateOutputRouteDraft\(|nextTarget|active_environment/);
  assert.match(changeSource, /New previews will use this environment/);
  assert.match(source, /\{selectedCustomer\.customer_name\} · \{primaryOutputRoute\.name\}/);
  assert.match(source, /View reusable environments/);
});

test("route save feedback is local, accessible, and sanitized", () => {
  const routeSaveSource = functionSource("saveCustomerRoutes", "saveTarget");

  assert.match(routeSaveSource, /No preview or Lift order was submitted/);
  assert.match(routeSaveSource, /catch \{/);
  assert.doesNotMatch(routeSaveSource, /error instanceof Error|error\.message/);
  assert.match(source, /className=\{`target-save-feedback/);
  assert.match(source, /role=\{targetSaveFeedback\.tone === "error" \? "alert" : "status"\}/);
  assert.match(source, /aria-live=\{targetSaveFeedback\.tone === "error" \? "assertive" : "polite"\}/);
});
