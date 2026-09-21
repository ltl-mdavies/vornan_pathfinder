import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");

test("public status recovery resolves saved Lift order numbers before hydrating legacy history", () => {
  const lookupStart = source.indexOf("async function findPathfinderJobsByOrderNumbers");
  const lookupEnd = source.indexOf("async function createPublicStatusLinkForJobs", lookupStart);
  const lookup = source.slice(lookupStart, lookupEnd);

  const directPass = lookup.indexOf("directJobOrderLookupCandidates(job)");
  const workspaceHydration = lookup.indexOf("const workspaceForJob");
  const legacyFallback = lookup.indexOf("Retain the legacy Ext ID / submit-response lookup");

  assert.ok(lookupStart >= 0 && lookupEnd > lookupStart);
  assert.ok(directPass >= 0);
  assert.ok(workspaceHydration > directPass);
  assert.ok(legacyFallback > workspaceHydration);
});

test("public status recovery coalesces its full-store reads inside one request", () => {
  const routeStart = source.indexOf('app.post("/public/status/request-link"');
  const routeEnd = source.indexOf('app.get("/public/intake/:publicKey"', routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(route, /await withPathfinderStoreReadScope\(\(\) => handlePublicStatusLinkRequest\(req, res\)\)/);
});
