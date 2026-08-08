import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

test("keeps customer approval inside the current Proof portal and limits it to one supported action", () => {
  assert.match(appSource, /One current, unshared proof can be approved/);
  assert.match(appSource, /Advanced approval remains unavailable/);
  assert.match(appSource, /Request changes<\/button>/);
  assert.match(apiSource, /tasks\/\$\{encodeURIComponent\(input\.task_id\)\}\/decisions\/approve/);
  assert.doesNotMatch(apiSource, /decisions\/reject/);
  assert.doesNotMatch(apiSource, /decisions\/revision/);
});
