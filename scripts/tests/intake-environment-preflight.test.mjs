import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkCandidateEnvironment } from "../intake-environment-preflight.mjs";

test("complete candidate byte check counts UTF-8, accepts exact limit and rejects oversize or malformed maps", () => {
  assert.deepEqual(checkCandidateEnvironment({ KEY: "é" }), { bytes: 5, remaining_bytes: 4091, variable_count: 1 });
  assert.equal(checkCandidateEnvironment({ K: "x".repeat(4095) }).remaining_bytes, 0);
  assert.throws(() => checkCandidateEnvironment({ K: "x".repeat(4096) }), /exceeds/);
  for (const invalid of [null, [], { K: 1 }, { K: {} }]) assert.throws(() => checkCandidateEnvironment(invalid));
});

test("CLI output contains only totals or sanitized failures, never environment contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "intake-env-"));
  const path = join(dir, "candidate.json");
  const script = new URL("../intake-environment-preflight.mjs", import.meta.url);
  try {
    for (const [content, status] of [[JSON.stringify({ PRIVATE_KEY: "secret-canary" }), 0], ['{"PRIVATE_KEY":"secret-canary",broken}', 1], [JSON.stringify({ PRIVATE_KEY: "secret-canary".repeat(400) }), 1]]) {
      writeFileSync(path, content);
      const result = spawnSync(process.execPath, [script.pathname, path], { encoding: "utf8" });
      assert.equal(result.status, status);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_KEY|secret-canary/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
