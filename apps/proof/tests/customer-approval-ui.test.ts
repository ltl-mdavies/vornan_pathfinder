import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const revisionDialogSource = readFileSync(new URL("../src/revision-upload-dialog.tsx", import.meta.url), "utf8");
const proofUpdateSource = readFileSync(new URL("../src/proof-update-state.ts", import.meta.url), "utf8");

test("keeps customer decisions inside the current Proof portal and exposes only supported customer actions", () => {
  assert.match(appSource, /One current, unshared proof can be approved/);
  assert.match(appSource, /Advanced approval remains unavailable/);
  assert.match(appSource, /Upload replacement artwork/);
  assert.match(appSource, /Choose how this proof should be corrected/);
  assert.match(appSource, /Ask production to revise this proof/);
  assert.match(appSource, /Send change request/);
  assert.match(appSource, /Message to the production team <em>Required<\/em>/);
  assert.match(appSource, /Approve this proof\?/);
  assert.match(appSource, /Add a note <em>Optional<\/em>/);
  assert.match(appSource, /Approve proof/);
  assert.match(appSource, /aria-labelledby="approval-dialog-title"/);
  assert.match(appSource, /aria-labelledby="change-request-title"/);
  assert.match(appSource, /aria-describedby="change-request-description"/);
  assert.match(appSource, /role="status"/);
  assert.match(appSource, /revisionUploadEnabled=\{Boolean\(order!\.access\.revision_upload_enabled\)\}/);
  assert.match(apiSource, /tasks\/\$\{encodeURIComponent\(input\.task_id\)\}\/decisions\/approve/);
  assert.match(apiSource, /tasks\/\$\{encodeURIComponent\(input\.task_id\)\}\/decisions\/request-changes/);
  assert.match(appSource, />Request changes<\/button>|"Request changes"/);
  assert.match(appSource, /Describe the changes the prepress team should make/);
  assert.match(appSource, /Tell the prepress team what changes are needed/);
  assert.match(appSource, /This proof has been approved/);
  assert.doesNotMatch(appSource, /> Provide revised artwork<\/button>/);
  assert.doesNotMatch(apiSource, /decisions\/reject/);
  assert.doesNotMatch(apiSource, /decisions\/revision/);
});

test("recovers from an operator-swapped Lift proof without presenting a failed customer action", () => {
  assert.match(proofUpdateSource, /This proof was updated in Lift\. The latest file is now ready for review\./);
  assert.match(proofUpdateSource, /replacementProofTaskId/);
  assert.match(appSource, /isLiftProofUpdatedError\(error\)/);
  assert.match(appSource, /return "proof_updated" as const/);
  assert.match(appSource, /setSelectedTaskId\(replacementProofTaskId\(refreshed\.order, task\)\)/);
  assert.match(revisionDialogSource, /isLiftProofUpdatedError\(error\)/);
  assert.match(revisionDialogSource, /await onProofUpdated\(task\)/);
});

test("surfaces unreviewed Prepress feedback without changing acknowledged feedback controls", () => {
  assert.match(appSource, /feedback_required && !task\.feedback_acknowledged/);
  assert.match(appSource, /feedback-button\$\{unread \? " unread" : ""\}/);
  assert.match(appSource, /feedback-badge/);
  assert.match(appSource, /New · \{commentCount\}/);
  assert.match(appSource, /isImageFeedbackAttachment/);
  assert.match(appSource, /PROOF_FEEDBACK_CHECK_INTERVAL_MS/);
  assert.match(appSource, /feedback-image-lightbox/);
  assert.match(appSource, /Preview feedback image/);
  assert.match(appSource, /Prepress team feedback\$\{unread \? `, new feedback, \$\{commentCountLabel\(commentCount\)\}` : ""\}/);
  assert.match(appSource, /comment\$\{dialogTask\.feedback_acknowledged \? "" : " unread"\}/);
  assert.match(appSource, /Review and acknowledge the prepress team feedback before providing revised artwork\./);
  assert.match(appSource, /openDetailedReportFromFeedback/);
  assert.match(appSource, /View detailed report\{dialogVersion\.report_definitions\.length === 1 \? "" : "s"\}/);
  assert.match(revisionDialogSource, /feedbackAcknowledged/);
  assert.match(revisionDialogSource, /Review and acknowledge the prepress team feedback before uploading revised artwork\./);
});

test("keeps an acted-on line in context and explains why it moved out of Open proofs", () => {
  assert.match(appSource, /function applyCompletedAction/);
  assert.match(appSource, /setFilter\("all"\)/);
  assert.match(appSource, /Line \$\{task\.line_number \?\? "—"\} approved/);
  assert.match(appSource, /change request sent/);
  assert.match(appSource, /action-outcome-notice/);
  assert.match(appSource, /The current proof will leave Open proofs while Vornan prepares the replacement/);
});

test("makes the change-request return control read as a backward navigation affordance", () => {
  assert.match(appSource, /ChevronLeft aria-hidden/);
  assert.match(appSource, /Choose a different option/);
});

test("keeps an accepted-but-unconfirmed approval visibly locked while Lift reconciliation runs", () => {
  assert.match(appSource, /singleApprovalState.*"verifying"/);
  assert.match(appSource, /Approval submitted\. Vornan is checking the latest Lift proof status\. Do not submit it again\./);
  assert.match(appSource, /singleApprovalState === "verifying" \? "Checking Lift…"/);
  assert.match(appSource, /result\.decision\.outcome === "confirmed"/);
  assert.match(appSource, /authoritative per-line ProofReport/);
  assert.match(appSource, /const refreshed = await bootstrap\(\);/);
  assert.doesNotMatch(appSource, /Lift received the approval, but the refreshed proof state still needs review/);
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
  assert.match(revisionDialogSource, /retry_asset/);
  assert.match(revisionDialogSource, /loadRevisionUploadStatus\(recoveryAssetId\)/);
  assert.match(revisionDialogSource, /without uploading it again/);
  assert.doesNotMatch(revisionDialogSource, /Private by default/);
});
