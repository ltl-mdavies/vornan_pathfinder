import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const revisionDialogSource = readFileSync(new URL("../src/revision-upload-dialog.tsx", import.meta.url), "utf8");
const proofUpdateSource = readFileSync(new URL("../src/proof-update-state.ts", import.meta.url), "utf8");
const allocationProgressSource = readFileSync(new URL("../src/creative-approval-progress.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("expired allocation sessions guide re-entry instead of offering another advance", () => {
  assert.match(allocationProgressSource, /!sessionEnded && batch\?\.state !== "paused"/);
  assert.match(allocationProgressSource, /Reopen your review link to check the saved approval status/);
  assert.match(allocationProgressSource, /resumeButton\.current\.focus\(\{ preventScroll: true \}\)/);
});

test("confirmed allocation refresh recovery never replays approvals", () => {
  const refreshBody = allocationProgressSource.split("const refreshConfirmedOrder = async")[1]!.split("useEffect(() =>")[0]!;
  assert.match(refreshBody, /await complete\.current\(\)/);
  assert.doesNotMatch(refreshBody, /prepareProofAllocation|advanceProofAllocation/);
  assert.match(refreshBody, /setRefreshState\("error"\)/);
  assert.match(allocationProgressSource, /Your approvals are confirmed\. We couldn’t refresh the proof list yet\./);
  assert.match(allocationProgressSource, /refreshState === "ready" \? "View updated proofs" : "Close"/);
  assert.match(allocationProgressSource, /onClick=\{\(\) => void refreshConfirmedOrder\(batch\)\}>Retry refresh/);
  assert.match(appSource, /onComplete=\{async \(\) => \{ applyProofLoad\(await loadProofOrder\(\)\); \}\}/);
});

test("durable allocation status replaces stale editable draft summaries", () => {
  assert.match(appSource, /\) : allocationInProgress \? \(/);
  assert.match(appSource, /Your approval submission is saved\. Use View status for the latest result\./);
  assert.match(appSource, /allocationInProgress=\{group\.tasks\.some/);
  assert.match(allocationProgressSource, /refreshedId\.current === next\.batch_id/);
  assert.match(allocationProgressSource, /"Approvals paused"/);
  assert.doesNotMatch(allocationProgressSource, /"The proofs have changed"/);
});

test("quantity entry uses content height and readable associated validation", () => {
  assert.match(stylesSource, /\.quantity-assignment-dialog \{[^}]*height: fit-content/);
  assert.match(stylesSource, /\.quantity-assignment-row label small \{[^}]*font-size: 12px/);
  assert.match(appSource, /onClick=\{done\}>Save quantities/);
});

test("keeps customer decisions inside the current Proof portal and exposes only supported customer actions", () => {
  assert.match(appSource, /One current, unshared proof can be approved/);
  assert.match(appSource, /Creative approvals are not enabled for this review link/);
  assert.match(appSource, /allocationEnabled/);
  assert.match(appSource, /Review every creative, then confirm its quantity/);
  assert.match(apiSource, /approval-batches/);
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
  assert.match(revisionDialogSource, /feedbackAcknowledged/);
  assert.match(revisionDialogSource, /Review and acknowledge the prepress team feedback before uploading revised artwork\./);
});

test("keeps an acted-on line in context and explains why it moved out of Open proofs", () => {
  assert.match(appSource, /function applyCompletedAction/);
  assert.match(appSource, /setFilter\("all"\)/);
  assert.match(appSource, /Line \$\{task\.line_number \?\? "—"\} approved/);
  assert.match(appSource, /change request sent/);
  assert.match(appSource, /action-outcome-notice/);
  assert.match(appSource, /Your file is saved for checking\. It has not been submitted to production/);
  assert.doesNotMatch(appSource, /The current proof will leave Open proofs while Vornan prepares the replacement/);
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

test("submitted creative allocations cannot be undone or reassigned while confirmation runs", () => {
  assert.match(appSource, /const undoSelectedApproval = \(\) => \{\s*if \(allocationInProgress\) return;/);
  assert.match(appSource, /disabled=\{allocationInProgress\}[^>]+onClick=\{undoSelectedApproval\}>Undo/);
  assert.match(appSource, /disabled=\{stagedTasks\.length === 0 \|\| Boolean\(allocationBlocked\)/);
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
  assert.match(revisionDialogSource, /Upload and check your file, then submit it to request a new proof for this line/);
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
