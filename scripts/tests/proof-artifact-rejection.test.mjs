import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const textExtensions = new Set([".css", ".html", ".json", ".mjs", ".svg", ".ts", ".tsx"]);

const customerBoundary = [
  "apps/proof/package.json",
  "apps/proof/src",
  "apps/proof/public/brand",
  "apps/proof/tests",
  "apps/api/src/proof/public-router.ts",
  "apps/api/src/proof/public-server.ts",
  "apps/api/src/proof/feedback-service.ts",
  "apps/api/src/proof/participant-service.ts",
  "packages/proof-domain/package.json",
  "packages/proof-domain/src",
  "packages/proof-domain/tests",
  "packages/lift-proof-adapter/package.json",
  "packages/lift-proof-adapter/src",
  "packages/lift-proof-adapter/tests"
];

async function sourceFiles(relativePath) {
  const absolutePath = resolve(repositoryRoot, relativePath);
  if (extname(absolutePath)) return [absolutePath];
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = resolve(absolutePath, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return textExtensions.has(extname(entry.name)) ? [child] : [];
  }));
  return nested.flat();
}

async function boundarySources() {
  const files = (await Promise.all(customerBoundary.map(sourceFiles))).flat();
  return Promise.all(files.map(async (path) => ({
    path: path.slice(repositoryRoot.length + 1),
    source: await readFile(path, "utf8")
  })));
}

function violations(sources, rules) {
  return sources.flatMap(({ path, source }) => rules.flatMap(({ label, expression }) => {
    const matches = [...source.matchAll(new RegExp(expression.source, expression.flags))];
    return matches.map((match) => `${path}: ${label} (${JSON.stringify(match[0])})`);
  }));
}

test("rejects Adspace identity, domains, resource names, and imports from the Proof customer boundary", async () => {
  const sources = await boundarySources();
  const found = violations(sources, [
    { label: "Adspace identity", expression: /\badspace(?:360)?\b/giu },
    { label: "Adspace domain", expression: /\badspace(?:360)?\.[a-z]{2,}\b/giu },
    { label: "Adspace integration identity", expression: /\bADSPACE360\b/gu },
    { label: "Adspace runtime import", expression: /(?:from\s+|import\s*\()["'][^"']*adspace[^"']*["']/giu },
    { label: "Adspace-style sample identifier", expression: /\b(?:proj|venue|tenant|campaign)_[a-z0-9_-]+\b/giu }
  ]);
  assert.deepEqual(found, [], `Forbidden Adspace artifacts crossed into Vornan Proof:\n${found.join("\n")}`);
});

test("rejects excluded Adspace business concepts from customer UI and public DTO source", async () => {
  const allSources = await boundarySources();
  const sources = allSources.filter(({ path }) =>
    path.startsWith("apps/proof/src/") ||
    path === "apps/api/src/proof/public-router.ts" ||
    path.startsWith("packages/proof-domain/src/")
  );
  const found = violations(sources, [
    {
      label: "excluded project/venue/allocation concept",
      expression: /\b(?:project|venue|inventory|room|allocation|transit|campaign|tenant)\b|\bassigned[ _-]?location\b|\blocation[ _-]?assignment\b/giu
    }
  ]);
  assert.deepEqual(found, [], `Excluded business concepts crossed into the customer contract:\n${found.join("\n")}`);
});
