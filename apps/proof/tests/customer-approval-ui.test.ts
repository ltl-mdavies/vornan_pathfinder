import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const revisionDialogSource = readFileSync(new URL("../src/revision-upload-dialog.tsx", import.meta.url), "utf8");

test("keeps customer approval inside the current Proof portal and limits it to one supported action", () => {
  assert.match(appSource, /One current, unshared proof can be approved/);
  assert.match(appSource, /Advanced approval remains unavailable/);
  assert.match(appSource, /Provide revised artwork<\/button>/);
  assert.match(appSource, /revisionUploadEnabled=\{Boolean\(order!\.access\.revision_upload_enabled\)\}/);
  assert.match(apiSource, /tasks\/\$\{encodeURIComponent\(input\.task_id\)\}\/decisions\/approve/);
  assert.doesNotMatch(apiSource, /decisions\/reject/);
  assert.doesNotMatch(apiSource, /decisions\/revision/);
});

test("keeps revised artwork in its upload lifecycle with an accessible customer file picker", () => {
  assert.match(apiSource, /revised-assets\/uploads\/prepare/);
  assert.match(apiSource, /revised-assets\/uploads\/finalize/);
  assert.match(apiSource, /credentials: "omit"/);
  assert.match(apiSource, /redirect: "error"/);
  assert.doesNotMatch(apiSource, /REVISED_ART_WILL_BE_SENT/);
  assert.match(revisionDialogSource, /idempotencyKeys = useRef\(new Map<string, string>\(\)\)/);
  assert.match(revisionDialogSource, /task\.task_id.*task\.current_version\.version_id.*file\.name.*file\.size.*digest/);
  assert.match(revisionDialogSource, /Upload revised artwork/);
  assert.match(revisionDialogSource, /Your upload will be used to prepare a new proof for this line/);
  assert.match(revisionDialogSource, /Drop revised artwork here/);
  assert.match(revisionDialogSource, /onDrop=\{handleDrop\}/);
  assert.match(revisionDialogSource, /Choose a different file/);
  assert.match(revisionDialogSource, /Upload and check file/);
  assert.match(revisionDialogSource, /Retry file check/);
  assert.match(revisionDialogSource, /retryFinalization/);
  assert.match(revisionDialogSource, /finalizeRevisionUpload\(asset\.asset_id\)/);
  assert.doesNotMatch(revisionDialogSource, /Private by default/);
});
