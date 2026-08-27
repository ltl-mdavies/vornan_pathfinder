import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileImage,
  FileText,
  History,
  Layers3,
  Link2,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { acknowledgeFeedback, approveProof, endSession, exchangeToken, extendSession, identifyParticipant, loadDetailedReport, loadProofHistory, loadProofOrder, ProofApiError, requestProofChanges, requestProofRefresh, startDetailedReport } from "./api";
import { proofAsset, stableProofAssetUrlIdentity } from "./asset-state";
import {
  PROOF_BACKGROUND_CHECK_INTERVAL_MS,
  PROOF_FEEDBACK_CHECK_INTERVAL_MS,
  PROOF_BACKGROUND_POLL_INTERVAL_MS,
  PROOF_BACKGROUND_POLL_LIMIT,
  proofBackgroundCheckAllowed,
  proofBackgroundLiftRefreshDue
} from "./background-refresh-state";
import { demoActivityForHash, demoOrderForHash } from "./demo";
import { restoreProofDialogFocus } from "./dialog-state";
import { proofOrderDisplayStatus, proofOrderDisplayTitle } from "./display-state";
import {
  filterProofTasks,
  groupProofTasksByLine,
  lineGroupForTask,
  proofLineQueueSummary,
  queueFilterLabel,
  queueEmptyMessage,
  searchProofTasks,
  selectedVisibleTask,
  type QueueFilter
} from "./queue-state";
import { isOpenProofState, proofOrderCompletion, proofOrderHealthMessage, proofStatePresentation } from "./lifecycle-state";
import { ProofPreview } from "./proof-preview";
import { isLiftProofUpdatedError, PROOF_UPDATED_MESSAGE, replacementProofTaskId } from "./proof-update-state";
import { RevisionUploadDialog } from "./revision-upload-dialog";
import { usesAdvancedQuantityAllocation } from "./review-experience";
import {
  quantityDraftMatches,
  buildDemoTransformationSummary,
  saveQuantityDraft,
  type QuantityTransformationSummary,
  type SavedQuantityDraft
} from "./quantity-review-state";
import { summarizeQuantityAssignment } from "./quantity-assignment";
import { createFailClosedSessionTerminator, focusProofTerminalState, proofEntryState, sessionExpiryDelay, sessionSecondsRemaining, sessionWarningVisible } from "./session-state";
import type { ProofActivity, ProofDetailedReport, ProofOrder, ProofParticipant, ProofTask, ProofVersion } from "./types";

type TerminalState = "link_unavailable" | "session_ended";
type LoadState =
  | { status: "loading" }
  | { status: "ready"; order: ProofOrder; participant: ProofParticipant | null; activity: ProofActivity; session_expires_at: string }
  | { status: "error"; kind: TerminalState; message: string };
type RefreshState = "idle" | "requesting" | "queued" | "error";
type ProofLoad = {
  order: ProofOrder;
  participant: ProofParticipant | null;
  activity: ProofActivity;
  refresh_queued: boolean;
  session_expires_at: string;
};
type DetailDialog = { kind: "feedback" | "history"; task_id: string };
type HistoryState = { status: "loading" | "ready" | "error"; versions: ProofVersion[]; message?: string };
type DecisionRequestState = "idle" | "submitting" | "verifying" | "complete" | "error";
type DecisionOutcome = "confirmed" | "reconciling" | "submission_uncertain" | "failed" | "proof_updated";
type ActionOutcomeNotice = { title: string; detail: string };
type FeedbackImagePreview = { filename: string; url: string };

const demoEnabled = import.meta.env.DEV && import.meta.env.VITE_PROOF_DEMO === "true";
let bootstrapPromise: Promise<ProofLoad> | null = null;

function isImageFeedbackAttachment(filename: string, contentType: string | null) {
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType?.toLowerCase() ?? "")) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(filename);
}

function commentCountLabel(count: number) {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}

async function bootstrap() {
  if (demoEnabled) {
    const decisionFlowQa = window.location.hash === "#/proof/decision-flow-qa";
    return {
      order: demoOrderForHash(window.location.hash),
      participant: decisionFlowQa
        ? { participant_id: "demo-reviewer", display_name: "Marcus Davies", email: "mdavies@ltlco.com" }
        : null,
      activity: demoActivityForHash(window.location.hash),
      refresh_queued: false,
      session_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };
  }
  const entry = proofEntryState(window.location.hash);
  if (entry.kind === "access_token") {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/proof`);
    try {
      await exchangeToken(entry.token);
    } catch (error) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/link-unavailable`);
      throw error;
    }
  }
  return loadProofOrder();
}

function terminalState(kind: TerminalState): LoadState {
  return kind === "session_ended"
    ? { status: "error", kind, message: "Your secure review session has expired or was ended." }
    : { status: "error", kind, message: "This link is invalid, expired, or has already been used." };
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {})
  }).format(date);
}

function formatQuantity(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
}

function statusLabel(task: ProofTask) {
  return proofStatePresentation(task.state).label;
}

function decisionStateDetail(task: ProofTask) {
  return proofStatePresentation(task.state).detail;
}

function TaskStateIcon({ state }: { state: ProofTask["state"] }) {
  if (state === "approved" || state === "reference") return <CheckCircle2 aria-hidden="true" />;
  if (state === "error" || state === "missing" || state === "cancelled") return <AlertTriangle aria-hidden="true" />;
  if (state === "revised") return <RefreshCw aria-hidden="true" />;
  return <Clock3 aria-hidden="true" />;
}

function technicalCheckState(status: string | null) {
  if (/^(PASS|PASSED|OK|SUCCESS)$/i.test(status ?? "")) return "pass";
  if (/^(FAIL|FAILED|ERROR)$/i.test(status ?? "")) return "fail";
  return "notice";
}

function TaskThumbnail({ task, refreshing = false }: { task: ProofTask; refreshing?: boolean }) {
  const asset = proofAsset(task.current_version);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const stablePreview = useRef<{ identity: string | null; url: string | null }>({ identity: null, url: null });
  const nextIdentity = stableProofAssetUrlIdentity(asset.preview);
  if (
    stablePreview.current.identity !== nextIdentity ||
    (failedPreview === stablePreview.current.url && stablePreview.current.url !== asset.preview)
  ) {
    stablePreview.current = { identity: nextIdentity, url: asset.preview };
  }
  const preview = stablePreview.current.url;
  const previewAvailable = preview && asset.kind === "image" && failedPreview !== preview;
  return (
    <span className="task-thumbnail" aria-hidden="true">
      {previewAvailable
        ? <img src={preview} referrerPolicy="no-referrer" alt="" onError={() => setFailedPreview(preview)} />
        : refreshing ? <RefreshCw className="thumbnail-refreshing" /> : <FileText />}
    </span>
  );
}

function sharedProofLines(task: ProofTask) {
  return [...new Set(task.shared_line_numbers ?? [])].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function SharedProofScope({ task, compact = false }: { task: ProofTask; compact?: boolean }) {
  const lineNumbers = sharedProofLines(task);
  if (lineNumbers.length < 2) return null;
  const otherLines = lineNumbers.filter((lineNumber) => lineNumber !== task.line_number);
  return (
    <span className={`shared-proof-scope ${compact ? "compact" : ""}`}>
      <Link2 aria-hidden="true" />
      <span><strong>Shared proof.</strong> {otherLines.length ? `Also used on ${otherLines.length === 1 ? "line" : "lines"} ${otherLines.join(", ")}. ` : ""}A decision applies to every listed line.</span>
    </span>
  );
}

type QuantityAssignmentProps = {
  tasks: ProofTask[];
  values: Record<string, string>;
  mobile: boolean;
  open: boolean;
  onChange: (values: Record<string, string>) => void;
  onClose: () => void;
  onDone: () => void;
  onReview: () => void;
  saved: boolean;
  reviewEnabled: boolean;
};

function QuantityAssignmentDialog({ tasks, values, mobile, open, onChange, onClose, onDone, onReview, saved, reviewEnabled }: QuantityAssignmentProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const lineQuantity = tasks[0]?.quantity ?? null;
  const summary = summarizeQuantityAssignment(lineQuantity, tasks.map((task) => task.task_id), values);
  const invalidTasks = new Set(summary.invalid_task_ids);
  const remainingLabel = summary.remaining === null
    ? "Quantity unavailable"
    : summary.remaining === 0
      ? "Ready to approve"
      : summary.remaining > 0
        ? `${summary.remaining} remaining`
        : `${Math.abs(summary.remaining)} over`;

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      window.requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    }
  }, [open]);

  const close = () => dialog.current?.close();
  const done = () => {
    if (!summary.complete) return;
    onDone();
    close();
  };
  const review = () => {
    if (!summary.complete || !reviewEnabled) return;
    onDone();
    close();
    window.requestAnimationFrame(onReview);
  };
  const clear = () => onChange(Object.fromEntries(tasks.map((task) => [task.task_id, ""])));

  return (
    <dialog
      ref={dialog}
      className={`proof-dialog quantity-assignment-dialog ${mobile ? "mobile" : ""}`}
      aria-labelledby={`quantity-assignment-title-${mobile ? "mobile" : "desktop"}`}
      aria-describedby={`quantity-assignment-description-${mobile ? "mobile" : "desktop"}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={onClose}
    >
      <div className="dialog-heading quantity-assignment-heading">
        <div>
          <span className="eyebrow">Line {tasks[0]?.line_number ?? "—"} · Qty {formatQuantity(lineQuantity) ?? "—"}</span>
          <h2 id={`quantity-assignment-title-${mobile ? "mobile" : "desktop"}`}>Assign quantities</h2>
          <p id={`quantity-assignment-description-${mobile ? "mobile" : "desktop"}`}>Distribute the full line quantity across the selected creatives. You’ll review everything before submitting.</p>
        </div>
        <button ref={closeButton} className="icon-button subtle" type="button" aria-label="Close quantity assignment" onClick={close}><X aria-hidden="true" /></button>
      </div>

      <div className="quantity-assignment-summary" aria-live="polite">
        <span><small>Line quantity</small><strong>{formatQuantity(lineQuantity) ?? "—"}</strong></span>
        <span><small>Assigned</small><strong>{summary.assigned}</strong></span>
        <span className={summary.remaining !== null && summary.remaining < 0 ? "invalid" : summary.complete ? "complete" : ""}><small>Remaining</small><strong>{summary.remaining ?? "—"}</strong></span>
      </div>

      <div className="quantity-assignment-content">
        <div className="quantity-assignment-list" role="list" aria-label="Proof quantities">
          {tasks.map((task, index) => {
            const invalid = invalidTasks.has(task.task_id);
            return (
              <div className={`quantity-assignment-row ${invalid ? "invalid" : ""}`} role="listitem" key={task.task_id}>
                <TaskThumbnail task={task} />
                <span className="quantity-proof-copy">
                  <strong>Creative {task.sibling_index ?? index + 1}</strong>
                  <small>{task.current_version?.filename ?? "Proof pending"}</small>
                  <em>{statusLabel(task)}</em>
                </span>
                <label>
                  <span>Quantity</span>
                  <input
                    type="number"
                    min="0"
                    max={lineQuantity ?? undefined}
                    step="1"
                    inputMode="numeric"
                    aria-label={`Quantity for creative ${task.sibling_index ?? index + 1}`}
                    aria-invalid={invalid || undefined}
                    value={values[task.task_id] ?? ""}
                    onChange={(event) => onChange({ ...values, [task.task_id]: event.target.value })}
                    placeholder="0"
                  />
                  {invalid ? <small role="alert">Enter a whole number from 0 to {lineQuantity ?? "the line total"}.</small> : null}
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="quantity-assignment-footer">
        <div className={`quantity-assignment-status ${summary.complete ? "complete" : summary.remaining !== null && summary.remaining < 0 ? "invalid" : ""}`} role="status">
          <strong>{remainingLabel}</strong>
          <small>{summary.complete ? saved ? "Saved, not submitted. You can continue reviewing." : "Ready to save. Nothing is sent until final confirmation." : "All proof quantities must add up to the line quantity."}</small>
        </div>
        <div>
          <button className="button secondary" type="button" onClick={clear}>Clear all</button>
          <button className="button secondary" type="button" disabled={!summary.complete} onClick={done}>Done</button>
          <button className="button primary" type="button" disabled={!summary.complete || !reviewEnabled} onClick={review}><ShieldCheck aria-hidden="true" /> Continue to review</button>
        </div>
      </div>
    </dialog>
  );
}

type BatchDialogProps = {
  tasks: ProofTask[];
  values: Record<string, string>;
  message: string;
  stage: "confirm" | "processing" | "summary" | null;
  currentIndex: number;
  summary: QuantityTransformationSummary | null;
  onMessageChange: (message: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onClose: () => void;
};

function BatchApprovalDialog({ tasks, values, message, stage, currentIndex, summary, onMessageChange, onCancel, onConfirm, onClose }: BatchDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const total = tasks.length;

  useEffect(() => {
    if (stage && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      if (stage !== "processing") window.requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    }
    if (!stage && dialog.current?.open) dialog.current.close();
  }, [stage]);

  if (!stage) return null;
  const processingTask = tasks[Math.min(currentIndex, Math.max(0, total - 1))];
  return (
    <dialog
      ref={dialog}
      className={`proof-dialog quantity-batch-dialog ${stage}`}
      aria-labelledby="quantity-batch-title"
      onCancel={(event) => {
        event.preventDefault();
        if (stage !== "processing") onCancel();
      }}
    >
      {stage === "confirm" ? (
        <>
          <div className="dialog-heading quantity-batch-heading">
            <div><span className="eyebrow">Final review · Line {tasks[0]?.line_number ?? "—"}</span><h2 id="quantity-batch-title">Submit these approvals?</h2><p>Review every selected creative and quantity. Nothing has been sent yet.</p></div>
            <button ref={closeButton} className="icon-button subtle" type="button" aria-label="Close approval review" onClick={onCancel}><X aria-hidden="true" /></button>
          </div>
          <div className="quantity-confirm-list" role="list" aria-label="Creative quantity approvals">
            {tasks.map((task, index) => <div role="listitem" key={task.task_id}><TaskThumbnail task={task} /><span><strong>Creative {task.sibling_index ?? index + 1}</strong><small>{task.current_version?.filename ?? "Proof pending"}</small></span><b>Qty {values[task.task_id]}</b></div>)}
          </div>
          <div className="quantity-confirm-total"><span>Total quantity</span><strong>{tasks.reduce((totalQuantity, task) => totalQuantity + Number(values[task.task_id] ?? 0), 0)}</strong></div>
          <label className="quantity-confirm-message">
            <span>Message with approval <small>(optional)</small></span>
            <textarea
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder="Add context for the production team with your approval"
              maxLength={2000}
            />
          </label>
          <div className="quantity-batch-footer"><button className="button secondary" type="button" onClick={onCancel}>Back</button><button className="button primary" type="button" onClick={onConfirm}><ShieldCheck aria-hidden="true" /> Submit approvals to print</button></div>
        </>
      ) : null}

      {stage === "processing" ? (
        <div className="quantity-processing" aria-live="polite" aria-busy="true">
          <span className="processing-mark"><RefreshCw aria-hidden="true" /></span>
          <span className="eyebrow">Approval in progress</span>
          <h2 id="quantity-batch-title">Approving creative {Math.min(currentIndex + 1, total)} of {total}</h2>
          <p>{processingTask?.current_version?.filename ?? "Current proof"}</p>
          <div className="quantity-progress" aria-label={`${Math.min(currentIndex + 1, total)} of ${total} approvals processed`}><span style={{ width: `${((Math.min(currentIndex + 1, total)) / total) * 100}%` }} /></div>
          <small>Keep this window open. Pathfinder is processing each approval once, then refreshing the order.</small>
        </div>
      ) : null}

      {stage === "summary" && summary ? (
        <>
          <div className="dialog-heading quantity-batch-heading summary-heading">
            <div><span className="summary-check"><CheckCircle2 aria-hidden="true" /></span><span className="eyebrow">Approval complete</span><h2 id="quantity-batch-title">Your proofs and quantities are now approved</h2><p>Each creative now appears on its own line with the quantity you assigned. Review the updates below.</p></div>
            <button ref={closeButton} className="icon-button subtle" type="button" aria-label="Close approval summary" onClick={onClose}><X aria-hidden="true" /></button>
          </div>
          <div className="quantity-before-after">
            <div className="quantity-before"><span>Before</span><strong>Line {summary.source_line_number ?? "—"}</strong><small>{tasks.length} creatives · Qty {summary.source_line_quantity}</small></div>
            <div className="quantity-after"><span>After refresh</span><div>{summary.lines.map((line) => <div key={line.task_id}><TaskThumbnail task={tasks.find((task) => task.task_id === line.task_id)!} /><span><strong>Line {line.resulting_line_number}</strong><small>{line.filename}</small></span><b>Qty {line.quantity}</b><em><CheckCircle2 aria-hidden="true" /> Approved</em></div>)}</div></div>
          </div>
          <div className="quantity-batch-footer summary-footer"><span>Order details were refreshed after all approvals completed.</span><button className="button primary" type="button" onClick={onClose}>View updated proofs</button></div>
        </>
      ) : null}
    </dialog>
  );
}

type ActionTransportProps = {
  tasks: ProofTask[];
  selectedTaskId: string;
  stagedTaskIds: string[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  onStageApproval: (taskId: string) => void;
  onUndoApproval: (taskId: string) => void;
  draft: SavedQuantityDraft | null;
  onSaveDraft: (draft: SavedQuantityDraft) => void;
  demoBatchEnabled: boolean;
  decisionsEnabled: boolean;
  reviewExperience: "simple" | "advanced";
  revisionUploadEnabled: boolean;
  participantIdentified: boolean;
  onApproveSingle: (task: ProofTask, note: string) => Promise<DecisionOutcome>;
  onRequestChanges: (task: ProofTask, note: string) => Promise<DecisionOutcome>;
  onRequestRevision: (task: ProofTask) => void;
  mobile?: boolean;
};

type ApprovalDialogProps = {
  open: boolean;
  task: ProofTask;
  note: string;
  state: DecisionRequestState;
  message: string | null;
  onNoteChange: (note: string) => void;
  onApprove: () => void;
  onClose: () => void;
};

function ApprovalDialog({ open, task, note, state, message, onNoteChange, onApprove, onClose }: ApprovalDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const busy = state === "submitting" || state === "verifying";

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      window.requestAnimationFrame(() => noteInput.current?.focus({ preventScroll: true }));
    } else if (!open && dialog.current?.open) {
      dialog.current.close();
    }
  }, [open, task.task_id]);

  return (
    <dialog
      ref={dialog}
      className="proof-dialog approval-dialog"
      aria-labelledby="approval-dialog-title"
      aria-describedby="approval-dialog-description"
      onCancel={(event) => { if (busy) event.preventDefault(); }}
      onClose={onClose}
    >
      <div className="dialog-heading approval-dialog-heading">
        <div>
          <span className="eyebrow">Line {task.line_number} · {task.product_name ?? "Artwork proof"}</span>
          <h2 id="approval-dialog-title">Approve this proof?</h2>
          <p id="approval-dialog-description">Confirm that this is the artwork you want Vornan to produce.</p>
        </div>
        <button className="icon-button subtle" type="button" aria-label="Close approval" disabled={busy} onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>
      </div>
      <div className="dialog-content approval-dialog-content">
        <label>
          <span>Add a note <em>Optional</em></span>
          <textarea
            ref={noteInput}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Add any final context for the production team"
            maxLength={2000}
          />
        </label>
        <small>Your note will be recorded with this approval.</small>
        {message && state === "error" ? <p className="change-request-error" role="alert">{message}</p> : null}
        <div className="change-request-actions">
          <button className="button secondary" type="button" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button>
          <button className="button primary" type="button" disabled={busy} onClick={onApprove}>
            <ShieldCheck aria-hidden="true" /> {state === "submitting" ? "Approving…" : state === "verifying" ? "Checking Lift…" : "Approve proof"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

type ChangeRequestDialogProps = {
  open: boolean;
  task: ProofTask;
  note: string;
  productionBlocked: string | null;
  uploadBlocked: string | null;
  state: DecisionRequestState;
  message: string | null;
  onNoteChange: (note: string) => void;
  onSubmitProductionRequest: () => void;
  onUploadReplacement: () => void;
  onClose: () => void;
};

function ChangeRequestDialog({ open, task, note, productionBlocked, uploadBlocked, state, message, onNoteChange, onSubmitProductionRequest, onUploadReplacement, onClose }: ChangeRequestDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [path, setPath] = useState<"production" | null>(null);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      setPath(null);
      dialog.current.showModal();
      window.requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    } else if (!open && dialog.current?.open) {
      dialog.current.close();
    }
  }, [open, task.task_id]);

  return (
    <dialog
      ref={dialog}
      className="proof-dialog change-request-dialog"
      aria-labelledby="change-request-title"
      aria-describedby="change-request-description"
      onCancel={(event) => {
        if (state === "submitting" || state === "verifying") event.preventDefault();
      }}
      onClose={() => {
        setPath(null);
        onClose();
      }}
    >
      <div className="dialog-heading change-request-heading">
        <div>
          <span className="eyebrow">Line {task.line_number} · {task.product_name ?? "Artwork proof"}</span>
          <h2 id="change-request-title">Request changes</h2>
          <p id="change-request-description">Choose how this proof should be corrected.</p>
        </div>
        <button ref={closeButton} className="icon-button subtle" type="button" aria-label="Close request changes" disabled={state === "submitting" || state === "verifying"} onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>
      </div>
      <div className="dialog-content change-request-content">
        {path === null ? (
          <div className="change-request-paths" aria-label="Change request options">
            <button type="button" disabled={Boolean(productionBlocked)} onClick={() => setPath("production")}>
              <span className="change-request-path-icon"><MessageSquareText aria-hidden="true" /></span>
              <span>
                <strong>Ask production to revise this proof</strong>
                <small>Send instructions to the production team and request a new proof.</small>
                {productionBlocked ? <em>{productionBlocked}</em> : null}
              </span>
            </button>
            <button type="button" disabled={Boolean(uploadBlocked)} onClick={() => {
              dialog.current?.close();
              onUploadReplacement();
            }}>
              <span className="change-request-path-icon"><Upload aria-hidden="true" /></span>
              <span>
                <strong>Upload replacement artwork</strong>
                <small>Provide a revised file for this line and have Vornan check it.</small>
                {uploadBlocked ? <em>{uploadBlocked}</em> : null}
              </span>
            </button>
          </div>
        ) : (
          <div className="production-change-request">
            <button className="change-request-back" type="button" disabled={state === "submitting" || state === "verifying"} onClick={() => setPath(null)}><ChevronLeft aria-hidden="true" /> Choose a different option</button>
            <div>
              <strong>Tell production what needs to change</strong>
              <p>Your note will be added to the order and sent with the request for a new proof.</p>
            </div>
            <label>
              <span>Message to the production team <em>Required</em></span>
              <textarea
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Describe the exact artwork changes needed"
                maxLength={2000}
                required
                aria-invalid={!note.trim()}
                aria-describedby="change-request-note-guidance"
              />
            </label>
            <small id="change-request-note-guidance">Be specific enough for the production team to prepare the next proof without additional clarification.</small>
            {message && state === "error" ? <p className="change-request-error" role="alert">{message}</p> : null}
            <div className="change-request-actions">
              <button className="button secondary" type="button" disabled={state === "submitting" || state === "verifying"} onClick={() => dialog.current?.close()}>Cancel</button>
              <button className="button primary" type="button" disabled={Boolean(productionBlocked) || !note.trim() || state === "submitting" || state === "verifying"} onClick={onSubmitProductionRequest}>
                <MessageSquareText aria-hidden="true" /> {state === "submitting" ? "Sending…" : state === "verifying" ? "Checking Lift…" : "Send change request"}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

function ActionTransport({ tasks, selectedTaskId, stagedTaskIds, values, onChange, onStageApproval, onUndoApproval, draft, onSaveDraft, demoBatchEnabled, decisionsEnabled, reviewExperience, revisionUploadEnabled, participantIdentified, onApproveSingle, onRequestChanges, onRequestRevision, mobile = false }: ActionTransportProps) {
  const actionableTasks = tasks.filter((task) => task.state === "pending" && task.current_version?.current);
  const multiProof = usesAdvancedQuantityAllocation(actionableTasks.length, reviewExperience);
  const selectedTask = tasks.find((task) => task.task_id === selectedTaskId) ?? tasks[0]!;
  const approvedProof = !multiProof && selectedTask.state === "approved";
  const selectedCreativeNumber = tasks.findIndex((task) => task.task_id === selectedTask.task_id) + 1;
  const stagedTasks = tasks.filter((task) => stagedTaskIds.includes(task.task_id));
  const selectedIsStaged = stagedTaskIds.includes(selectedTask.task_id);
  const lineQuantity = tasks[0]?.quantity ?? null;
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [batchStage, setBatchStage] = useState<BatchDialogProps["stage"]>(null);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [transformationSummary, setTransformationSummary] = useState<QuantityTransformationSummary | null>(null);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [changeRequestNote, setChangeRequestNote] = useState("");
  const [singleApprovalState, setSingleApprovalState] = useState<DecisionRequestState>("idle");
  const [singleApprovalMessage, setSingleApprovalMessage] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [changeRequestState, setChangeRequestState] = useState<DecisionRequestState>("idle");
  const [changeRequestMessage, setChangeRequestMessage] = useState<string | null>(null);
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const approvalOpener = useRef<HTMLButtonElement>(null);
  const changeRequestOpener = useRef<HTMLButtonElement>(null);
  const assignmentOpener = useRef<HTMLButtonElement>(null);
  const summary = summarizeQuantityAssignment(lineQuantity, stagedTasks.map((task) => task.task_id), values);
  const saved = quantityDraftMatches(draft, stagedTasks, values);
  const saveDraft = () => {
    const savedDraft = saveQuantityDraft({ groupId: tasks[0]?.line_number ?? tasks[0]?.task_id ?? "line", tasks: stagedTasks, values, now: new Date() });
    onSaveDraft(savedDraft);
  };
  const beginProcessing = async () => {
    setBatchStage("processing");
    for (let index = 0; index < stagedTasks.length; index += 1) {
      setProcessingIndex(index);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
    setProcessingIndex(stagedTasks.length - 1);
    await new Promise((resolve) => window.setTimeout(resolve, 850));
    setTransformationSummary(buildDemoTransformationSummary(stagedTasks, values));
    setBatchStage("summary");
  };
  const distributionSummary = summary.remaining === null
    ? "Quantity unavailable"
    : summary.remaining === 0
      ? "Distribution complete"
      : summary.remaining > 0
        ? `${summary.remaining} remaining`
        : `${Math.abs(summary.remaining)} over`;
  const quantityGuidance = stagedTasks.length === 0
    ? "Select each creative you want to approve, then assign its quantity."
    : lineQuantity === null
      ? "Assign a quantity to each selected creative before final review."
      : `Assign the full line quantity across the ${stagedTasks.length} selected ${stagedTasks.length === 1 ? "creative" : "creatives"}, then review before submitting.`;
  const undoSelectedApproval = () => {
    const next = { ...values };
    delete next[selectedTask.task_id];
    onChange(next);
    onUndoApproval(selectedTask.task_id);
  };
  const singleApprovalBlocked = !decisionsEnabled
    ? "Approval access is not enabled for this review link."
    : !participantIdentified
      ? "Identify the reviewer before approving this proof."
      : actionableTasks.length > 1 && reviewExperience === "simple"
        ? "This line has multiple current proofs and requires the Advanced review profile."
      : selectedTask.feedback_required && !selectedTask.feedback_acknowledged
        ? "Review and acknowledge the prepress team feedback before approving."
        : selectedTask.shared_line_numbers && selectedTask.shared_line_numbers.length > 1
          ? "This proof is shared by multiple lines and requires a coordinated approval."
          : selectedTask.action_reconciliation_pending
            ? "This proof is awaiting review."
          : selectedTask.state !== "pending" || !selectedTask.attachment_id || !selectedTask.current_version?.version_id
            ? "This proof is not currently available for approval."
            : null;
  useEffect(() => {
    setDecisionMessage("");
    setApprovalNote("");
    setChangeRequestNote("");
    setSingleApprovalState("idle");
    setSingleApprovalMessage(null);
    setApprovalOpen(false);
    setChangeRequestState("idle");
    setChangeRequestMessage(null);
    setChangeRequestOpen(false);
  }, [selectedTask.task_id]);
  const productionChangeRequestBlocked = !decisionsEnabled
    ? "Change requests are not enabled for this review link."
    : !participantIdentified
      ? "Identify the reviewer before requesting changes."
      : actionableTasks.length > 1 && reviewExperience === "simple"
        ? "This line has multiple current proofs and requires coordinated support."
      : selectedTask.feedback_required && !selectedTask.feedback_acknowledged
        ? "Review and acknowledge the prepress team feedback before requesting changes."
      : selectedTask.shared_line_numbers && selectedTask.shared_line_numbers.length > 1
        ? "This proof is shared by multiple lines and requires coordinated support."
      : selectedTask.action_reconciliation_pending
        ? "This proof is awaiting review."
      : selectedTask.state !== "pending" || !selectedTask.attachment_id || !selectedTask.current_version?.version_id
        ? "This proof is not currently available for a change request."
      : null;
  const changeRequestBlocked = productionChangeRequestBlocked ?? (!changeRequestNote.trim() ? "Describe the changes the prepress team should make." : null);
  const revisionUploadBlocked = !revisionUploadEnabled
    ? "Revised artwork upload is not enabled for this review link."
    : !participantIdentified
      ? "Identify the reviewer before providing revised artwork."
      : actionableTasks.length > 1 && reviewExperience === "simple"
        ? "This line has multiple current proofs and requires coordinated support."
      : selectedTask.feedback_required && !selectedTask.feedback_acknowledged
        ? "Review and acknowledge the prepress team feedback before providing revised artwork."
      : selectedTask.shared_line_numbers && selectedTask.shared_line_numbers.length > 1
        ? "This proof is shared by multiple lines and needs coordinated support before replacement artwork can be accepted."
        : selectedTask.state !== "pending" || !selectedTask.attachment_id || !selectedTask.current_version?.version_id
          ? "This proof is not currently available for replacement artwork."
          : null;
  const changeRequestEntryBlocked = productionChangeRequestBlocked && revisionUploadBlocked
    ? "This proof is not currently available for a change request."
    : null;
  const completedDecision = singleApprovalState === "complete"
    ? { title: "Proof approved", detail: singleApprovalMessage ?? "Approval recorded." }
    : changeRequestState === "complete"
      ? { title: "Changes requested", detail: changeRequestMessage ?? "The production team received your instructions." }
      : null;
  const submitSingleApproval = async () => {
    if (singleApprovalBlocked || singleApprovalState === "submitting") return;
    setSingleApprovalState("submitting");
    setSingleApprovalMessage(null);
    try {
      const outcome = await onApproveSingle(selectedTask, approvalNote);
      if (outcome === "confirmed") {
        setSingleApprovalState("complete");
        setSingleApprovalMessage("Approval recorded. The latest Lift proof state is now shown.");
        setApprovalOpen(false);
      } else if (outcome === "reconciling" || outcome === "submission_uncertain") {
        setSingleApprovalState("verifying");
        setSingleApprovalMessage("Approval submitted. Vornan is checking the latest Lift proof status. Do not submit it again.");
        setApprovalOpen(false);
      } else if (outcome === "proof_updated") {
        setSingleApprovalState("idle");
        setSingleApprovalMessage(null);
        setApprovalNote("");
        setApprovalOpen(false);
      } else {
        setSingleApprovalState("error");
        setSingleApprovalMessage("Lift did not accept this approval. Refresh the proof before taking another action.");
      }
    } catch (error) {
      setSingleApprovalState("error");
      setSingleApprovalMessage(error instanceof Error ? error.message : "This proof could not be approved.");
    }
  };
  const submitChangeRequest = async () => {
    if (changeRequestBlocked || changeRequestState === "submitting") return;
    setChangeRequestState("submitting");
    setChangeRequestMessage(null);
    try {
      const outcome = await onRequestChanges(selectedTask, changeRequestNote.trim());
      if (outcome === "confirmed") {
        setChangeRequestState("complete");
        setChangeRequestMessage("Changes requested. The production team received your instructions.");
        setChangeRequestOpen(false);
      } else if (outcome === "reconciling" || outcome === "submission_uncertain") {
        setChangeRequestState("verifying");
        setChangeRequestMessage("Change request submitted. Vornan is checking the latest Lift proof status. Do not submit it again.");
        setChangeRequestOpen(false);
      } else if (outcome === "proof_updated") {
        setChangeRequestState("idle");
        setChangeRequestMessage(null);
        setChangeRequestNote("");
        setChangeRequestOpen(false);
      } else {
        setChangeRequestState("error");
        setChangeRequestMessage("Lift did not accept this change request. Refresh the proof before taking another action.");
      }
    } catch (error) {
      setChangeRequestState("error");
      setChangeRequestMessage(error instanceof Error ? error.message : "Changes could not be requested for this proof.");
    }
  };
  return (
    <section className={`action-transport ${mobile ? "mobile" : ""} ${multiProof ? "distribution" : "simple"} ${approvedProof ? "approved" : ""}`} aria-label={approvedProof ? "Proof approval status" : "Proof decision actions"} aria-describedby={approvedProof || mobile ? undefined : "action-lock-message"}>
      {approvedProof ? (
        <div className="decision-status-card approved-decision" role="status">
          <span><CheckCircle2 aria-hidden="true" /></span>
          <span><strong>Approved</strong><small>This proof has been approved.</small></span>
        </div>
      ) : <>
      <div className="decision-heading">
        <strong>{multiProof ? "Creative decision" : "Review decision"}</strong>
        <small className="decision-lock-status" id={mobile ? undefined : "action-lock-message"}>
          <LockKeyhole aria-hidden="true" /> {multiProof
            ? "Advanced approval remains unavailable"
            : decisionsEnabled
              ? "One current, unshared proof can be approved"
              : "Approval is not enabled for this review link"}
        </small>
      </div>
      {multiProof ? (
        <>
          <div className="creative-stage-entry">
            <span className="creative-stage-copy">
              <TaskThumbnail task={selectedTask} />
              <span>
                <small>Selected creative</small>
                <strong>Creative {selectedCreativeNumber}</strong>
                <em title={selectedTask.current_version?.filename ?? "Proof pending"}>{selectedTask.current_version?.filename ?? "Proof pending"}</em>
              </span>
            </span>
            <span className="creative-stage-actions">
              {selectedIsStaged ? <span className="staged-status"><CheckCircle2 aria-hidden="true" /> Ready to submit</span> : null}
              {selectedIsStaged
                ? <button className="button tertiary" type="button" onClick={undoSelectedApproval}>Undo</button>
                : <button className="button primary" type="button" onClick={() => onStageApproval(selectedTask.task_id)}><ShieldCheck aria-hidden="true" /> Approve this creative</button>}
              <button className="button secondary request-changes" type="button" disabled title="Multiple-proof revision requests require coordinated support."><Upload aria-hidden="true" /> Request changes</button>
            </span>
          </div>
          <div className="quantity-entry">
            <span className="quantity-entry-copy">
              <Layers3 aria-hidden="true" />
              <span>
                <span className="quantity-title">Approval quantities</span>
                <strong>{summary.complete ? "Approvals ready for final review" : `${stagedTasks.length} of ${tasks.length} selected for approval`}</strong>
                <small>{quantityGuidance}</small>
                <span className={`distribution-total ${summary.complete ? "complete" : summary.remaining !== null && summary.remaining < 0 ? "invalid" : ""}`}>
                  <strong>{summary.assigned}</strong> of <strong>{formatQuantity(lineQuantity) ?? "—"}</strong> assigned <i aria-hidden="true">·</i> <strong>{distributionSummary}</strong>
                </span>
              </span>
            </span>
            <button
              ref={assignmentOpener}
              className="button secondary"
              type="button"
              data-quantity-assignment-trigger
              disabled={stagedTasks.length === 0}
              onClick={() => summary.complete && demoBatchEnabled ? setBatchStage("confirm") : setAssignmentOpen(true)}
            >
              {summary.complete && demoBatchEnabled ? "Review approvals" : "Assign quantities"}
            </button>
          </div>
        </>
      ) : null}
      {!multiProof ? (
        <div className="single-decision-controls">
          {completedDecision ? (
            <div className="decision-status-card" role="status">
              <span><CheckCircle2 aria-hidden="true" /></span>
              <span><strong>{completedDecision.title}</strong><small>{completedDecision.detail}</small></span>
            </div>
          ) : (
            <>
              <div className="transport-buttons">
                <button ref={approvalOpener} type="button" disabled={Boolean(singleApprovalBlocked) || singleApprovalState === "submitting" || singleApprovalState === "verifying"} onClick={() => setApprovalOpen(true)}>
                  <ShieldCheck aria-hidden="true" /> {singleApprovalState === "submitting" ? "Approving…" : singleApprovalState === "verifying" ? "Checking Lift…" : "Approve"}
                </button>
                <button ref={changeRequestOpener} className="request-changes" type="button" disabled={Boolean(changeRequestEntryBlocked) || changeRequestState === "submitting" || changeRequestState === "verifying"} title={changeRequestEntryBlocked ?? "Request changes"} onClick={() => setChangeRequestOpen(true)}>
                  <MessageSquareText aria-hidden="true" /> Request changes
                </button>
              </div>
              {singleApprovalBlocked ? <small className="decision-guidance">{singleApprovalBlocked}</small> : null}
              {singleApprovalMessage ? <p className={`decision-result ${singleApprovalState}`} role="status">{singleApprovalMessage}</p> : null}
              {changeRequestMessage ? <p className={`decision-result ${changeRequestState}`} role="status">{changeRequestMessage}</p> : null}
            </>
          )}
          <ApprovalDialog
            open={approvalOpen}
            task={selectedTask}
            note={approvalNote}
            state={singleApprovalState}
            message={singleApprovalMessage}
            onNoteChange={setApprovalNote}
            onApprove={() => void submitSingleApproval()}
            onClose={() => {
              setApprovalOpen(false);
              window.requestAnimationFrame(() => approvalOpener.current?.focus({ preventScroll: true }));
            }}
          />
          <ChangeRequestDialog
            open={changeRequestOpen}
            task={selectedTask}
            note={changeRequestNote}
            productionBlocked={productionChangeRequestBlocked}
            uploadBlocked={revisionUploadBlocked}
            state={changeRequestState}
            message={changeRequestMessage}
            onNoteChange={setChangeRequestNote}
            onSubmitProductionRequest={() => void submitChangeRequest()}
            onUploadReplacement={() => onRequestRevision(selectedTask)}
            onClose={() => {
              setChangeRequestOpen(false);
              window.requestAnimationFrame(() => changeRequestOpener.current?.focus({ preventScroll: true }));
            }}
          />
        </div>
      ) : null}
      {multiProof ? (
        <QuantityAssignmentDialog
          tasks={stagedTasks}
          values={values}
          mobile={mobile}
          open={assignmentOpen}
          onChange={onChange}
          onDone={saveDraft}
          onReview={() => setBatchStage("confirm")}
          saved={saved}
          reviewEnabled={demoBatchEnabled}
          onClose={() => {
            setAssignmentOpen(false);
            window.requestAnimationFrame(() => assignmentOpener.current?.focus({ preventScroll: true }));
          }}
        />
      ) : null}
      {multiProof ? <BatchApprovalDialog tasks={stagedTasks} values={values} message={decisionMessage} stage={batchStage} currentIndex={processingIndex} summary={transformationSummary} onMessageChange={setDecisionMessage} onCancel={() => setBatchStage(null)} onConfirm={() => void beginProcessing()} onClose={() => setBatchStage(null)} /> : null}
      </>}
    </section>
  );
}

function ProofFilmstrip({ tasks, selectedTaskId, assignments = {}, stagedTaskIds = [], onSelect }: { tasks: ProofTask[]; selectedTaskId: string | null; assignments?: Record<string, string>; stagedTaskIds?: string[]; onSelect: (taskId: string) => void }) {
  if (tasks.length < 2) return null;
  return (
    <nav className="proof-filmstrip" aria-label="Proofs on this order line">
      <div className="filmstrip-heading"><Layers3 aria-hidden="true" /><span>{tasks.length} creatives</span></div>
      <div className="filmstrip-items">
        {tasks.map((task, index) => {
          const filename = task.current_version?.filename ?? "Proof pending";
          const staged = stagedTaskIds.includes(task.task_id);
          const taskStatus = staged ? assignments[task.task_id] ? `Qty ${assignments[task.task_id]} · Ready` : "Ready to submit" : statusLabel(task);
          return (
            <button
              key={task.task_id}
              type="button"
              className={`${task.task_id === selectedTaskId ? "selected" : ""} ${staged ? "staged" : ""}`.trim()}
              aria-current={task.task_id === selectedTaskId ? "true" : undefined}
              aria-label={`Creative ${index + 1}: ${filename}; ${taskStatus}`}
              onClick={() => onSelect(task.task_id)}
            >
              <TaskThumbnail task={task} />
              <span className="filmstrip-filename" title={filename}>{filename}</span>
              <span className="filmstrip-meta"><strong>{index + 1}</strong><small className={`filmstrip-status ${task.state}`}>{taskStatus}</small></span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function QueueSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="queue-search">
      <Search aria-hidden="true" />
      <input
        type="search"
        aria-label="Search proofs"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search proofs"
        autoComplete="off"
      />
      {value ? <button type="button" aria-label="Clear proof search" onClick={() => onChange("")}><X aria-hidden="true" /></button> : null}
    </div>
  );
}

function FeedbackButton({ task, onClick, compact = false }: { task: ProofTask; onClick: (event: MouseEvent<HTMLButtonElement>) => void; compact?: boolean }) {
  const unread = task.feedback_required && !task.feedback_acknowledged;
  const commentCount = task.current_version?.comments.length ?? 0;
  return (
    <button
      className={`${compact ? "button secondary compact " : ""}feedback-button${unread ? " unread" : ""}`}
      type="button"
      aria-label={`Prepress team feedback${unread ? `, new feedback, ${commentCountLabel(commentCount)}` : ""}`}
      onClick={onClick}
    >
      <MessageSquareText aria-hidden="true" />
      <span>Prepress team feedback</span>
      {unread ? <span className="feedback-badge" aria-hidden="true">New · {commentCount}</span> : null}
    </button>
  );
}

function DetailedReportButton({ task, version }: { task: ProofTask; version: ProofVersion | null }) {
  const definition = version?.current ? (version.report_definitions ?? [])[0] ?? null : null;
  const [report, setReport] = useState<ProofDetailedReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setReport(null); setMessage(null); }, [task.task_id, version?.version_id]);
  useEffect(() => {
    if (!definition || !report || !["generation_started", "running"].includes(report.state)) return;
    const timer = window.setInterval(() => {
      void loadDetailedReport(task.task_id, definition.definition_id)
        .then(({ report: next }) => {
          setReport(next);
          if (next.state === "ready" && next.view_url) window.open(next.view_url, "_blank", "noopener,noreferrer");
        })
        .catch(() => setMessage("We’re still preparing your report. Try again shortly."));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [definition?.definition_id, report?.state, task.task_id]);
  if (!definition) return null;
  const state = report?.state ?? (definition.ready ? "ready" : "unavailable");
  if (state === "ready" && report?.view_url) {
    return <a className="button secondary compact" href={report.view_url} target="_blank" rel="noreferrer"><FileText aria-hidden="true" /> View detailed report</a>;
  }
  if (["generation_started", "running"].includes(state)) return <span className="detailed-report-progress" role="status">Generating detailed report…</span>;
  return <span className="detailed-report-control"><button className="button secondary compact" type="button" onClick={() => {
    setMessage(null);
    void startDetailedReport(task.task_id, definition.definition_id)
      .then(({ report: next }) => {
        setReport(next);
        if (next.state === "ready" && next.view_url) window.open(next.view_url, "_blank", "noopener,noreferrer");
      })
      .catch(() => setMessage("We’re still preparing your report. Try again shortly."));
  }}><FileText aria-hidden="true" /> {definition.ready ? "View detailed report" : "Generate detailed report"}</button>{message ? <small role="status">{message}</small> : null}</span>;
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [quantityAssignments, setQuantityAssignments] = useState<Record<string, Record<string, string>>>({});
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, SavedQuantityDraft>>({});
  const [stagedApprovals, setStagedApprovals] = useState<Record<string, string[]>>({});
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [detailDialog, setDetailDialog] = useState<DetailDialog | null>(null);
  const [revisionUploadTaskId, setRevisionUploadTaskId] = useState<string | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackImagePreview, setFeedbackImagePreview] = useState<FeedbackImagePreview | null>(null);
  const [actionOutcome, setActionOutcome] = useState<ActionOutcomeNotice | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [sessionExtending, setSessionExtending] = useState(false);
  const [sessionExtendError, setSessionExtendError] = useState<string | null>(null);
  const [historyByTask, setHistoryByTask] = useState<Record<string, HistoryState>>({});
  const dialogElement = useRef<HTMLDialogElement>(null);
  const identityDialogElement = useRef<HTMLDialogElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const identityDialogOpener = useRef<HTMLElement | null>(null);
  const detailDialogCloseButton = useRef<HTMLButtonElement>(null);
  const identityNameInput = useRef<HTMLInputElement>(null);
  const terminalStateElement = useRef<HTMLElement>(null);
  const deferDetailFocusReturn = useRef(false);
  const refreshPollTimer = useRef<number | null>(null);
  const refreshPollAttempts = useRef(0);
  const backgroundCheckInFlight = useRef(false);
  const backgroundPollTimer = useRef<number | null>(null);
  const backgroundLastRequestedAt = useRef(0);
  const approvalIdempotencyKeys = useRef(new Map<string, string>());
  const changeRequestIdempotencyKeys = useRef(new Map<string, string>());
  const loadStateRef = useRef(loadState);
  const refreshStateRef = useRef(refreshState);
  const selectedTaskIdRef = useRef(selectedTaskId);
  loadStateRef.current = loadState;
  refreshStateRef.current = refreshState;
  selectedTaskIdRef.current = selectedTaskId;

  const endLocalSession = () => {
    bootstrapPromise = null;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/session-ended`);
    setLoadState(terminalState("session_ended"));
  };
  const sessionTerminator = useRef<ReturnType<typeof createFailClosedSessionTerminator> | null>(null);
  const terminateSession = () => {
    sessionTerminator.current ??= createFailClosedSessionTerminator(
      () => demoEnabled ? Promise.resolve() : endSession(),
      endLocalSession
    );
    void sessionTerminator.current();
  };

  function applyProofLoad(result: ProofLoad) {
    const previous = loadStateRef.current.status === "ready"
      ? loadStateRef.current.order.tasks.find((task) => task.task_id === selectedTaskIdRef.current) ?? null
      : null;
    const nextState: LoadState = {
      status: "ready",
      order: result.order,
      participant: result.participant,
      activity: result.activity,
      session_expires_at: result.session_expires_at
    };
    loadStateRef.current = nextState;
    setLoadState(nextState);
    setSelectedTaskId((current) => {
      if (current && result.order.tasks.some((task) => task.task_id === current)) return current;
      return previous ? replacementProofTaskId(result.order, previous) : result.order.tasks[0]?.task_id ?? null;
    });
  }

  function applyCompletedAction(result: ProofLoad, task: ProofTask, outcome: ActionOutcomeNotice) {
    const nextTaskId = replacementProofTaskId(result.order, task);
    const remainsInOpenQueue = Boolean(
      nextTaskId && filterProofTasks(result.order.tasks, "open").some((candidate) => candidate.task_id === nextTaskId)
    );
    const nextState: LoadState = {
      status: "ready",
      order: result.order,
      participant: result.participant,
      activity: result.activity,
      session_expires_at: result.session_expires_at
    };
    loadStateRef.current = nextState;
    setLoadState(nextState);
    setSelectedTaskId(nextTaskId);
    setSelectedVersionId(null);
    if (!remainsInOpenQueue) {
      setFilter("all");
      setSearchQuery("");
    }
    setActionOutcome(outcome);
  }

  function scheduleRefreshReload() {
    if (refreshPollTimer.current !== null) return;
    if (refreshPollAttempts.current >= 12) {
      setRefreshState("error");
      setRefreshMessage("Fresh proof details are taking longer than expected. Select refresh to check again.");
      return;
    }
    refreshPollAttempts.current += 1;
    refreshPollTimer.current = window.setTimeout(() => {
      refreshPollTimer.current = null;
      bootstrapPromise = null;
      load(true);
    }, 2_000);
  }

  const load = (silent = false) => {
    const entry = proofEntryState(window.location.hash);
    if (entry.kind === "link_unavailable" || entry.kind === "session_ended") {
      if (entry.kind === "link_unavailable" && window.location.hash !== "#/link-unavailable") {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/link-unavailable`);
      }
      setLoadState(terminalState(entry.kind));
      return;
    }
    if (!silent) setLoadState({ status: "loading" });
    bootstrapPromise ??= bootstrap();
    bootstrapPromise.then(
      (result) => {
        applyProofLoad(result);
        const { refresh_queued: refreshQueued } = result;
        if (refreshQueued) {
          setRefreshState("queued");
          setRefreshMessage("Getting fresh artwork links from Lift. This page will update automatically.");
          scheduleRefreshReload();
        } else if (silent) {
          refreshPollAttempts.current = 0;
          setRefreshState("idle");
          setRefreshMessage("Proof details checked. The latest available version is shown.");
        } else {
          refreshPollAttempts.current = 0;
        }
      },
      (error) => {
        if (error instanceof ProofApiError && error.status === 401) {
          terminateSession();
          return;
        }
        if (proofEntryState(window.location.hash).kind === "link_unavailable") {
          setLoadState(terminalState("link_unavailable"));
          return;
        }
        const message = error instanceof Error ? error.message : "Proof access is unavailable.";
        if (silent) {
          setRefreshState("error");
          setRefreshMessage(`The latest check could not be loaded. Your cached proof packet remains available. ${message}`);
          return;
        }
        setLoadState({ status: "error", kind: "link_unavailable", message });
      }
    );
  };

  async function loadProofInBackground() {
    bootstrapPromise = null;
    const result = await bootstrap();
    applyProofLoad(result);
    return result;
  }

  function scheduleBackgroundReload(previousSyncedAt: string, attempt = 0) {
    if (backgroundPollTimer.current !== null || attempt >= PROOF_BACKGROUND_POLL_LIMIT) return;
    backgroundPollTimer.current = window.setTimeout(async () => {
      backgroundPollTimer.current = null;
      if (!proofBackgroundCheckAllowed({
        visible: document.visibilityState === "visible",
        ready: loadStateRef.current.status === "ready",
        in_flight: backgroundCheckInFlight.current,
        refresh_state: refreshStateRef.current
      })) return;
      backgroundCheckInFlight.current = true;
      try {
        const result = await loadProofInBackground();
        if (result.order.last_synced_at === previousSyncedAt) {
          scheduleBackgroundReload(previousSyncedAt, attempt + 1);
        }
      } catch (error) {
        if (error instanceof ProofApiError && error.status === 401) terminateSession();
      } finally {
        backgroundCheckInFlight.current = false;
      }
    }, PROOF_BACKGROUND_POLL_INTERVAL_MS);
  }

  async function runBackgroundCheck() {
    const current = loadStateRef.current;
    if (demoEnabled || !proofBackgroundCheckAllowed({
      visible: document.visibilityState === "visible",
      ready: current.status === "ready",
      in_flight: backgroundCheckInFlight.current,
      refresh_state: refreshStateRef.current
    }) || current.status !== "ready") return;

    backgroundCheckInFlight.current = true;
    try {
      const now = Date.now();
      if (proofBackgroundLiftRefreshDue({
        last_synced_at: current.order.last_synced_at,
        last_requested_at: backgroundLastRequestedAt.current,
        now
      })) {
        await requestProofRefresh();
        backgroundLastRequestedAt.current = now;
        scheduleBackgroundReload(current.order.last_synced_at);
        return;
      }
      const result = await loadProofInBackground();
      if (result.refresh_queued) scheduleBackgroundReload(current.order.last_synced_at);
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) terminateSession();
    } finally {
      backgroundCheckInFlight.current = false;
    }
  }

  const refresh = async () => {
    if (refreshState === "requesting" || refreshState === "queued") return;
    setRefreshState("requesting");
    setRefreshMessage("Requesting the latest proof details…");
    try {
      if (!demoEnabled) await requestProofRefresh();
      refreshPollAttempts.current = 0;
      setRefreshState("queued");
      setRefreshMessage("Refresh queued. You can keep reviewing while Vornan checks Lift for updates.");
      scheduleRefreshReload();
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) {
        terminateSession();
        return;
      }
      setRefreshState("error");
      setRefreshMessage(error instanceof Error ? error.message : "Proof refresh could not be requested.");
    }
  };

  useEffect(load, []);

  useEffect(() => () => {
    if (refreshPollTimer.current !== null) window.clearTimeout(refreshPollTimer.current);
    if (backgroundPollTimer.current !== null) window.clearTimeout(backgroundPollTimer.current);
  }, []);

  useEffect(() => {
    if (loadState.status !== "ready" || demoEnabled) return;
    const check = () => void runBackgroundCheck();
    const interval = detailDialog?.kind === "feedback"
      ? PROOF_FEEDBACK_CHECK_INTERVAL_MS
      : PROOF_BACKGROUND_CHECK_INTERVAL_MS;
    const timer = window.setInterval(check, interval);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [detailDialog?.kind, loadState.status]);

  useEffect(() => {
    if (!feedbackImagePreview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFeedbackImagePreview(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [feedbackImagePreview]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    const delay = sessionExpiryDelay(loadState.session_expires_at);
    if (delay === 0) {
      terminateSession();
      return;
    }
    const timer = window.setTimeout(terminateSession, delay);
    return () => window.clearTimeout(timer);
  }, [loadState.status === "ready" ? loadState.session_expires_at : null]);

  useEffect(() => {
    if (loadState.status !== "ready") return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [loadState.status]);

  const continueSession = async () => {
    if (loadState.status !== "ready" || sessionExtending) return;
    setSessionExtending(true);
    setSessionExtendError(null);
    try {
      const result = demoEnabled
        ? { extended: true as const, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() }
        : await extendSession();
      setLoadState({ ...loadState, session_expires_at: result.expires_at });
      setClockMs(Date.now());
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) {
        terminateSession();
        return;
      }
      setSessionExtendError(error instanceof Error ? error.message : "Your session could not be continued.");
    } finally {
      setSessionExtending(false);
    }
  };

  const order = loadState.status === "ready" ? loadState.order : null;
  const participant = loadState.status === "ready" ? loadState.participant : null;
  const activity = loadState.status === "ready"
    ? loadState.activity
    : { identified_reviewers: 0, last_activity_at: null, reviewer_names_visible: false as const };
  const matchingTasks = useMemo(() => {
    return order ? searchProofTasks(filterProofTasks(order.tasks, filter), searchQuery) : [];
  }, [filter, order, searchQuery]);
  const visibleGroups = useMemo(() => {
    if (!order) return [];
    const matchingIds = new Set(matchingTasks.map((task) => task.task_id));
    return groupProofTasksByLine(order.tasks).filter((group) => group.tasks.some((task) => matchingIds.has(task.task_id)));
  }, [matchingTasks, order]);
  const visibleTasks = useMemo(() => visibleGroups.flatMap((group) => group.tasks), [visibleGroups]);
  const selectedTask = selectedVisibleTask(visibleTasks, selectedTaskId);
  const selectedGroup = lineGroupForTask(visibleGroups, selectedTask?.task_id ?? null);
  const selectedVersion =
    selectedTask?.versions.find((version) => version.version_id === selectedVersionId) ?? selectedTask?.current_version ?? null;
  const selectedAsset = proofAsset(selectedVersion);
  const artworkRefreshing = refreshState === "requesting" || refreshState === "queued";
  const completion = order ? proofOrderCompletion(order) : null;
  const completionEmpty = Boolean(completion && filter === "open" && !searchQuery.trim());
  const emptyState = completionEmpty ? completion : order ? queueEmptyMessage(filter, order.tasks, searchQuery) : null;
  const proofCounts = order?.counts ?? { pending: 0, regenerating: 0, waiting: 0, reviewed: 0, total: 0 };
  const customerProofCounts = order
    ? {
        open: order.tasks.filter((task) => isOpenProofState(task.state)).length,
        approved: order.tasks.filter((task) => task.state === "approved").length,
        awaitingProof: order.tasks.filter((task) => task.state === "waiting").length,
        updatingProof: order.tasks.filter((task) => task.state === "revised").length
      }
    : { open: 0, approved: 0, awaitingProof: 0, updatingProof: 0 };
  const orderHealthMessage = order ? proofOrderHealthMessage(order.health) : null;
  const sessionRemaining = loadState.status === "ready" ? sessionSecondsRemaining(loadState.session_expires_at, clockMs) : 0;
  const showSessionWarning = loadState.status === "ready" && sessionWarningVisible(loadState.session_expires_at, clockMs);
  const dialogTask = detailDialog ? order?.tasks.find((task) => task.task_id === detailDialog.task_id) ?? null : null;
  const revisionUploadTask = revisionUploadTaskId ? order?.tasks.find((task) => task.task_id === revisionUploadTaskId) ?? null : null;
  const dialogHistory = dialogTask ? historyByTask[dialogTask.task_id] : undefined;
  const dialogVersions = dialogTask
    ? dialogHistory?.versions ?? (dialogTask.versions.length ? dialogTask.versions : dialogTask.current_version ? [dialogTask.current_version] : [])
    : [];
  const dialogVersion = detailDialog?.kind === "feedback"
    ? dialogTask?.current_version ?? null
    : dialogVersions.find((version) => version.version_id === selectedVersionId) ?? dialogTask?.current_version ?? dialogVersions[0] ?? null;
  const feedbackCommentCount = dialogVersion?.comments.length ?? 0;

  const changeFilter = (nextFilter: QueueFilter) => {
    const nextTasks = order ? searchProofTasks(filterProofTasks(order.tasks, nextFilter), searchQuery) : [];
    setFilter(nextFilter);
    setSelectedTaskId(nextTasks[0]?.task_id ?? null);
  };

  const changeSearch = (nextQuery: string) => {
    const nextTasks = order ? searchProofTasks(filterProofTasks(order.tasks, filter), nextQuery) : [];
    setSearchQuery(nextQuery);
    setSelectedTaskId(nextTasks[0]?.task_id ?? null);
  };

  const updateQuantityAssignments = (groupId: string, values: Record<string, string>) => {
    setQuantityAssignments((current) => ({ ...current, [groupId]: values }));
  };

  const saveQuantityReview = (groupId: string, draft: SavedQuantityDraft) => {
    setQuantityDrafts((current) => ({ ...current, [groupId]: draft }));
  };

  const refreshAfterLiftProofUpdate = async (task: ProofTask) => {
    bootstrapPromise = null;
    const refreshed = await bootstrap();
    setLoadState({
      status: "ready",
      order: refreshed.order,
      participant: refreshed.participant,
      activity: refreshed.activity,
      session_expires_at: refreshed.session_expires_at
    });
    setSelectedTaskId(replacementProofTaskId(refreshed.order, task));
    setSelectedVersionId(null);
    setRefreshState("idle");
    setRefreshMessage(PROOF_UPDATED_MESSAGE);
  };

  const approveSingleProof = async (task: ProofTask, note: string) => {
    if (loadState.status !== "ready" || !task.attachment_id || !task.current_version?.version_id) {
      throw new Error("The selected proof is no longer current.");
    }
    const identity = `${task.task_id}:${task.version ?? 0}:${task.current_version.version_id}`;
    const idempotencyKey = approvalIdempotencyKeys.current.get(identity)
      ?? `pdec_${crypto.randomUUID().replaceAll("-", "")}`;
    approvalIdempotencyKeys.current.set(identity, idempotencyKey);
    try {
      const result = await approveProof({
        task_id: task.task_id,
        attachment_id: task.attachment_id,
        expected_task_version: task.version ?? 0,
        expected_version_id: task.current_version.version_id,
        idempotency_key: idempotencyKey,
        note: note.trim() || null
      });
      if (result.decision.outcome === "confirmed") {
        approvalIdempotencyKeys.current.delete(identity);
      }
      // The server already completed the authoritative per-line ProofReport
      // reconciliation before returning this outcome. Reflect that new packet
      // immediately, even when Lift has not yet confirmed the decision.
      bootstrapPromise = null;
      const refreshed = await bootstrap();
      if (result.decision.outcome === "confirmed") {
        applyCompletedAction(refreshed, task, {
          title: `Line ${task.line_number ?? "—"} approved`,
          detail: "This proof is no longer open, so it has moved to All proofs."
        });
      } else {
        applyProofLoad(refreshed);
      }
      return result.decision.outcome;
    } catch (error) {
      if (isLiftProofUpdatedError(error)) {
        approvalIdempotencyKeys.current.delete(identity);
        await refreshAfterLiftProofUpdate(task);
        return "proof_updated" as const;
      }
      if (error instanceof ProofApiError && error.status === 401) terminateSession();
      throw error;
    }
  };

  const requestSingleProofChanges = async (task: ProofTask, note: string) => {
    if (loadState.status !== "ready" || !task.attachment_id || !task.current_version?.version_id) {
      throw new Error("The selected proof is no longer current.");
    }
    const instructions = note.trim();
    if (!instructions) {
      throw new Error("Tell the prepress team what changes are needed.");
    }
    const identity = `${task.task_id}:${task.version ?? 0}:${task.current_version.version_id}`;
    const idempotencyKey = changeRequestIdempotencyKeys.current.get(identity)
      ?? `pdec_${crypto.randomUUID().replaceAll("-", "")}`;
    changeRequestIdempotencyKeys.current.set(identity, idempotencyKey);
    try {
      const result = await requestProofChanges({
        task_id: task.task_id,
        attachment_id: task.attachment_id,
        expected_task_version: task.version ?? 0,
        expected_version_id: task.current_version.version_id,
        idempotency_key: idempotencyKey,
        note: instructions
      });
      if (result.decision.outcome === "confirmed") {
        changeRequestIdempotencyKeys.current.delete(identity);
      }
      bootstrapPromise = null;
      const refreshed = await bootstrap();
      if (result.decision.outcome === "confirmed") {
        applyCompletedAction(refreshed, task, {
          title: `Line ${task.line_number ?? "—"} change request sent`,
          detail: "This proof is no longer open while the production team prepares a replacement."
        });
      } else {
        applyProofLoad(refreshed);
      }
      return result.decision.outcome;
    } catch (error) {
      if (isLiftProofUpdatedError(error)) {
        changeRequestIdempotencyKeys.current.delete(identity);
        await refreshAfterLiftProofUpdate(task);
        return "proof_updated" as const;
      }
      if (error instanceof ProofApiError && error.status === 401) terminateSession();
      throw error;
    }
  };

  const loadHistory = async (taskId: string) => {
    if (loadState.status !== "ready") return;
    const task = loadState.order.tasks.find((candidate) => candidate.task_id === taskId);
    if (!task) return;
    const cached = historyByTask[taskId]?.versions
      ?? (task.versions.length ? task.versions : task.current_version ? [task.current_version] : []);
    setHistoryByTask((current) => ({ ...current, [taskId]: { status: "loading", versions: current[taskId]?.versions ?? cached } }));
    try {
      const history = demoEnabled ? { task_id: taskId, versions: cached } : await loadProofHistory(taskId);
      setHistoryByTask((current) => ({ ...current, [taskId]: { status: "ready", versions: history.versions } }));
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) {
        terminateSession();
        return;
      }
      setHistoryByTask((current) => ({
        ...current,
        [taskId]: {
          status: "error",
          versions: current[taskId]?.versions ?? cached,
          message: error instanceof Error ? error.message : "Proof file history could not be loaded."
        }
      }));
    }
  };

  const openDetailDialog = (kind: DetailDialog["kind"], taskId: string, event: MouseEvent<HTMLElement>) => {
    dialogOpener.current = event.currentTarget;
    setSelectedTaskId(taskId);
    setFeedbackError(null);
    setFeedbackImagePreview(null);
    setDetailDialog({ kind, task_id: taskId });
    if (kind === "history") void loadHistory(taskId);
  };

  const restoreDialogFocus = (target: HTMLElement | null) => {
    window.requestAnimationFrame(() => {
      if (!restoreProofDialogFocus(target)) {
        document.getElementById("proof-detail")?.focus({ preventScroll: true });
      }
    });
  };

  const closeDetailDialog = () => {
    setFeedbackImagePreview(null);
    dialogElement.current?.close();
  };

  const openIdentityDialog = (opener: HTMLElement | null) => {
    identityDialogOpener.current = opener;
    setIdentityName(participant?.display_name ?? "");
    setIdentityEmail(participant?.email ?? "");
    setIdentityError(null);
    setIdentityOpen(true);
  };

  const saveIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loadState.status !== "ready" || identitySaving) return;
    setIdentitySaving(true);
    setIdentityError(null);
    try {
      const saved = demoEnabled
        ? { participant: { participant_id: participant?.participant_id ?? "demo-participant", display_name: identityName.trim(), email: identityEmail.trim().toLowerCase() } }
        : await identifyParticipant(identityName, identityEmail);
      setLoadState({
        ...loadState,
        participant: saved.participant,
        activity: {
          identified_reviewers: loadState.participant
            ? loadState.activity.identified_reviewers
            : loadState.activity.identified_reviewers + 1,
          last_activity_at: new Date().toISOString(),
          reviewer_names_visible: false
        }
      });
      identityDialogElement.current?.close();
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) {
        terminateSession();
        return;
      }
      setIdentityError(error instanceof Error ? error.message : "Reviewer details could not be saved.");
    } finally {
      setIdentitySaving(false);
    }
  };

  const acknowledgeCurrentFeedback = async () => {
    if (loadState.status !== "ready" || !dialogTask || feedbackSaving) return;
    setFeedbackSaving(true);
    setFeedbackError(null);
    try {
      if (!demoEnabled) await acknowledgeFeedback(dialogTask.task_id);
      setLoadState({
        ...loadState,
        order: {
          ...loadState.order,
          tasks: loadState.order.tasks.map((task) => task.task_id === dialogTask.task_id
            ? { ...task, feedback_acknowledged: true }
            : task)
        }
      });
    } catch (error) {
      if (error instanceof ProofApiError && error.status === 401) {
        terminateSession();
        return;
      }
      setFeedbackError(error instanceof Error ? error.message : "Prepress team feedback could not be acknowledged.");
    } finally {
      setFeedbackSaving(false);
    }
  };

  const identifyFromFeedback = () => {
    deferDetailFocusReturn.current = true;
    const opener = dialogOpener.current;
    dialogElement.current?.close();
    openIdentityDialog(opener);
  };

  useEffect(() => {
    setSelectedVersionId(null);
  }, [selectedTaskId]);

  useEffect(() => {
    if (detailDialog && dialogElement.current && !dialogElement.current.open) {
      dialogElement.current.showModal();
      window.requestAnimationFrame(() => detailDialogCloseButton.current?.focus({ preventScroll: true }));
    }
  }, [detailDialog]);

  useEffect(() => {
    if (identityOpen && identityDialogElement.current && !identityDialogElement.current.open) {
      identityDialogElement.current.showModal();
      window.requestAnimationFrame(() => identityNameInput.current?.focus({ preventScroll: true }));
    }
  }, [identityOpen]);

  const terminalKind = loadState.status === "error" ? loadState.kind : null;
  useEffect(() => {
    if (!terminalKind) return;
    const frame = window.requestAnimationFrame(() => {
      focusProofTerminalState(terminalStateElement.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [terminalKind]);

  if (loadState.status === "loading") {
    return (
      <main className="center-state" aria-live="polite">
        <img src="/brand/vornan-wordmark.svg" alt="Vornan" />
        <span className="spinner" aria-hidden="true" />
        <h1>Opening your proofs</h1>
        <p>Checking the secure access link…</p>
      </main>
    );
  }

  if (loadState.status === "error") {
    const sessionEnded = loadState.kind === "session_ended";
    return (
      <main
        ref={terminalStateElement}
        className="center-state error-state"
        aria-labelledby="proof-terminal-heading"
        tabIndex={-1}
      >
        <img src="/brand/vornan-wordmark.svg" alt="Vornan" />
        <div className="state-icon"><AlertTriangle aria-hidden="true" /></div>
        <div role="alert" aria-atomic="true">
          <h1 id="proof-terminal-heading">{sessionEnded ? "Your secure session has ended" : "This proof link isn’t available"}</h1>
          <p>{loadState.message}</p>
        </div>
        <p className="support-copy">Ask your Vornan contact for a new link if you still need access. No proof information remains visible in this browser.</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-row">
          <img src="/brand/vornan-wordmark.svg" alt="Vornan" />
          <span aria-hidden="true" />
          <strong>Proof</strong>
        </div>
        <div className="session-actions">
          <button className="reviewer-button" type="button" onClick={(event) => openIdentityDialog(event.currentTarget)}>
            <UserRound aria-hidden="true" />
            <span>{participant?.display_name ?? "Identify reviewer"}</span>
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="End secure session"
            title="End secure session"
            onClick={terminateSession}
          >
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </header>

      {showSessionWarning ? (
        <aside className="session-warning" role="alert" aria-live="assertive">
          <span className="session-countdown" aria-label={`${sessionRemaining} seconds remaining`}><Clock3 aria-hidden="true" />0:{String(sessionRemaining).padStart(2, "0")}</span>
          <span><strong>Your secure review session is ending soon.</strong><small>Continue to keep this order open without losing your place.</small></span>
          <div>
            <button className="button primary" type="button" disabled={sessionExtending} onClick={() => void continueSession()}>{sessionExtending ? "Continuing…" : "Continue reviewing"}</button>
            <button className="button secondary" type="button" onClick={terminateSession}>End session</button>
          </div>
          {sessionExtendError ? <p>{sessionExtendError}</p> : null}
        </aside>
      ) : null}

      <section className="order-band" aria-labelledby="order-heading">
        <div>
          <div className="eyebrow">Order {order!.order_number}</div>
          <h1 id="order-heading">{proofOrderDisplayTitle(order!)}</h1>
          <div className="order-meta">
            <span className={`health-dot ${order!.health}`} aria-hidden="true" />
            {proofOrderDisplayStatus(order!.order_status)}
            <span aria-hidden="true">·</span>
            Updated {formatDate(order!.last_synced_at, true)}
            {activity.identified_reviewers > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="review-activity"><UserRound aria-hidden="true" /> {activity.identified_reviewers} identified {activity.identified_reviewers === 1 ? "reviewer" : "reviewers"}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="order-actions">
          <dl className="order-stats" aria-label="Proof counts">
            <div><dt>Open</dt><dd>{customerProofCounts.open}</dd></div>
            <div><dt>Approved</dt><dd>{customerProofCounts.approved}/{proofCounts.total}</dd></div>
            {customerProofCounts.awaitingProof ? <div><dt>Awaiting proof</dt><dd>{customerProofCounts.awaitingProof}</dd></div> : null}
            {customerProofCounts.updatingProof ? <div><dt>Updating proof</dt><dd>{customerProofCounts.updatingProof}</dd></div> : null}
          </dl>
          <div className="view-only-badge"><ShieldCheck aria-hidden="true" /> {order!.access.decisions_enabled ? "Secure review access" : "Secure view-only access"}</div>
        </div>
      </section>

      <div className="notice-stack">
        <div className="read-only-notice" role="status">
          <ShieldCheck aria-hidden="true" />
          <span>{order!.access.decisions_enabled
            ? <><strong>Review mode.</strong> Single-proof approvals are available. Multi-proof, shared-art, revision, and upload actions remain protected.</>
            : <><strong>Review mode.</strong> Approvals and revision requests remain disabled while Vornan completes isolated lifecycle QA.</>}</span>
        </div>
        {orderHealthMessage ? (
          <div className={`order-health-notice ${order!.health}`} role="status">
            <AlertTriangle aria-hidden="true" />
            <span><strong>Cached proof packet.</strong> {orderHealthMessage}</span>
          </div>
        ) : null}
        {completion ? (
          <div className="completion-notice" role="status">
            <CheckCircle2 aria-hidden="true" />
            <span><strong>{completion.title}.</strong> {completion.detail}</span>
          </div>
        ) : null}
        {actionOutcome ? (
          <div className="action-outcome-notice" role="status" aria-live="polite">
            <CheckCircle2 aria-hidden="true" />
            <span><strong>{actionOutcome.title}.</strong> {actionOutcome.detail}</span>
            <button type="button" aria-label="Dismiss action update" onClick={() => setActionOutcome(null)}><X aria-hidden="true" /></button>
          </div>
        ) : null}
      </div>

      <main className="workspace">
        <aside className="queue-panel" aria-label="Proof queue" aria-busy={artworkRefreshing}>
          <div className="queue-heading">
            <div>
              <span className="eyebrow">Proof queue</span>
              <h2>{visibleGroups.length} {visibleGroups.length === 1 ? "line" : "lines"}</h2>
            </div>
            <button
              className={`icon-button subtle ${refreshState === "requesting" ? "refreshing" : ""}`}
              type="button"
              aria-label="Request latest proof details"
              disabled={refreshState === "requesting" || refreshState === "queued"}
              onClick={() => void refresh()}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
          {refreshMessage ? <p className={`refresh-status ${refreshState}`} role="status">{refreshMessage}</p> : null}
          <div className="segmented" role="group" aria-label="Filter proof queue">
            {(["open", "all", "approved"] as QueueFilter[]).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}>{queueFilterLabel(value)}</button>
            ))}
          </div>
          <QueueSearch value={searchQuery} onChange={changeSearch} />
          <div className="task-list" role="list" aria-label={`${filter} proof lines`}>
            {visibleGroups.map((group) => {
              const selected = selectedGroup?.group_id === group.group_id;
              const representativeTask = group.tasks[0]!;
              const queueSummary = proofLineQueueSummary(group);
              return (
                <section className={`line-group-card ${selected ? "selected" : ""}`} key={group.group_id} role="listitem" aria-label={`Line ${group.line_number ?? "unassigned"}, ${group.tasks.length} proofs, ${queueSummary.review_label}`}>
                  <button className="line-group-summary" type="button" aria-pressed={selected} onClick={() => setSelectedTaskId(group.tasks[0]!.task_id)}>
                    <span className="line-group-thumbnail" aria-hidden="true">
                      <TaskThumbnail task={representativeTask} refreshing={artworkRefreshing} />
                      {group.tasks.length > 1 ? <b>+{group.tasks.length - 1}</b> : null}
                    </span>
                    <span className="line-group-copy">
                      <span className="eyebrow">Line {group.line_number ?? "—"}</span>
                      <strong title={group.product_name ?? "Artwork proof"}>{group.product_name ?? "Artwork proof"}</strong>
                      <small>
                        <span>Qty {formatQuantity(group.quantity) ?? "—"} · </span>
                        <span className="line-group-statuses">
                          {queueSummary.status_segments.map((status) => <span className={`line-group-status ${status.tone}`} key={`${status.tone}-${status.label}`}>{status.label}</span>)}
                        </span>
                      </small>
                      {sharedProofLines(representativeTask).length > 1 ? <span className="shared-proof-queue"><Link2 aria-hidden="true" /> Shared proof</span> : null}
                    </span>
                    <span className="line-group-count">{group.tasks.length === 1 ? <FileImage aria-hidden="true" /> : <Layers3 aria-hidden="true" />}{queueSummary.proof_count_label}</span>
                  </button>
                </section>
              );
            })}
            {!visibleTasks.length && emptyState ? (
              <div className="empty-list" role={completionEmpty ? "region" : "status"} aria-label={completionEmpty ? "Proof review complete" : undefined}>
                <strong>{emptyState.title}</strong>
                <span>{emptyState.detail}</span>
                {completionEmpty ? <button className="button secondary completion-button" type="button" onClick={() => changeFilter("approved")}>View approved proofs</button> : null}
              </div>
            ) : null}
          </div>
        </aside>

        <section
          className="detail-panel"
          id="proof-detail"
          tabIndex={0}
          aria-label="Selected proof details"
          aria-live="polite"
          aria-atomic="false"
        >
          {selectedTask ? (
            <>
              <div className="detail-heading">
                <div>
                  <span className="eyebrow">Line {selectedTask.line_number ?? "—"}{formatQuantity(selectedTask.quantity) !== null ? ` · Qty ${formatQuantity(selectedTask.quantity)}` : ""}</span>
                  <h2 title={selectedTask.product_name ?? "Artwork proof"}>{selectedTask.product_name ?? "Artwork proof"}</h2>
                  <span className={`proof-status-label ${selectedTask.state}`}><TaskStateIcon state={selectedTask.state} /> {statusLabel(selectedTask)}</span>
                  {decisionStateDetail(selectedTask) ? <p className={`task-state-copy ${selectedTask.state}`}>{decisionStateDetail(selectedTask)}</p> : null}
                  <SharedProofScope task={selectedTask} />
                </div>
                <div className="detail-actions">
                  <FeedbackButton task={selectedTask} compact onClick={(event) => openDetailDialog("feedback", selectedTask.task_id, event)} />
                  <button className="button secondary compact" type="button" onClick={(event) => openDetailDialog("history", selectedTask.task_id, event)}>
                    <History aria-hidden="true" /> File history
                  </button>
                  <DetailedReportButton task={selectedTask} version={selectedVersion} />
                  {selectedAsset.download && <a className="button secondary" href={selectedAsset.download} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> Download</a>}
                  {selectedAsset.open && <a className="icon-button subtle" href={selectedAsset.open} target="_blank" rel="noreferrer" aria-label="Open proof in a new tab"><ExternalLink aria-hidden="true" /></a>}
                </div>
              </div>

              <div className={`proof-viewer ${selectedGroup && selectedGroup.tasks.length > 1 ? "has-filmstrip" : ""}`}>
                <ProofFilmstrip
                  tasks={selectedGroup?.tasks ?? [selectedTask]}
                  selectedTaskId={selectedTask.task_id}
                  assignments={quantityAssignments[selectedGroup?.group_id ?? selectedTask.task_id]}
                  stagedTaskIds={stagedApprovals[selectedGroup?.group_id ?? selectedTask.task_id]}
                  onSelect={setSelectedTaskId}
                />
                <div className="preview-column">
                  <div className="preview-filebar">
                    <span title={selectedVersion?.filename ?? "Proof pending"}>{selectedVersion?.filename ?? "Proof pending"}</span>
                    {selectedGroup && selectedGroup.tasks.length > 1 ? <small>Creative {selectedGroup.tasks.findIndex((task) => task.task_id === selectedTask.task_id) + 1} of {selectedGroup.tasks.length}</small> : null}
                  </div>
                  <div className="preview-stage"><ProofPreview version={selectedVersion} refreshing={artworkRefreshing} /></div>
                </div>
              </div>
              <ActionTransport
                key={selectedGroup?.group_id ?? selectedTask.task_id}
                tasks={selectedGroup?.tasks ?? [selectedTask]}
                selectedTaskId={selectedTask.task_id}
                stagedTaskIds={stagedApprovals[selectedGroup?.group_id ?? selectedTask.task_id] ?? []}
                values={quantityAssignments[selectedGroup?.group_id ?? selectedTask.task_id] ?? {}}
                onChange={(values) => updateQuantityAssignments(selectedGroup?.group_id ?? selectedTask.task_id, values)}
                onStageApproval={(taskId) => setStagedApprovals((current) => ({ ...current, [selectedGroup?.group_id ?? selectedTask.task_id]: [...new Set([...(current[selectedGroup?.group_id ?? selectedTask.task_id] ?? []), taskId])] }))}
                onUndoApproval={(taskId) => setStagedApprovals((current) => ({ ...current, [selectedGroup?.group_id ?? selectedTask.task_id]: (current[selectedGroup?.group_id ?? selectedTask.task_id] ?? []).filter((candidate) => candidate !== taskId) }))}
                draft={quantityDrafts[selectedGroup?.group_id ?? selectedTask.task_id] ?? null}
                onSaveDraft={(draft) => saveQuantityReview(selectedGroup?.group_id ?? selectedTask.task_id, draft)}
                demoBatchEnabled={demoEnabled && window.location.hash === "#/proof/batch-qa"}
                decisionsEnabled={order!.access.decisions_enabled}
                reviewExperience={order!.access.review_experience}
                revisionUploadEnabled={Boolean(order!.access.revision_upload_enabled)}
                participantIdentified={Boolean(participant)}
                onApproveSingle={approveSingleProof}
                onRequestChanges={requestSingleProofChanges}
                onRequestRevision={(task) => setRevisionUploadTaskId(task.task_id)}
              />
            </>
          ) : (
            <div className="preview-empty">
              {filter === "open" && order!.tasks.length ? <CheckCircle2 aria-hidden="true" /> : <FileText aria-hidden="true" />}
              <strong>{emptyState?.title ?? "Select a proof"}</strong>
              {emptyState ? <span>{emptyState.detail}</span> : null}
              {completionEmpty ? <button className="button secondary completion-button" type="button" onClick={() => changeFilter("approved")}>View approved proofs</button> : null}
            </div>
          )}
        </section>
      </main>

      <section className="mobile-review" aria-label="Proof review feed">
        <div className="mobile-dock">
          <div className="mobile-dock-heading">
            <div><span className="eyebrow">Proof inbox</span><strong>{visibleGroups.length} {visibleGroups.length === 1 ? "line" : "lines"}</strong></div>
            <button
              className={`icon-button subtle ${refreshState === "requesting" ? "refreshing" : ""}`}
              type="button"
              aria-label="Request latest proof details"
              disabled={refreshState === "requesting" || refreshState === "queued"}
              onClick={() => void refresh()}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Filter mobile proof feed">
            {(["open", "all", "approved"] as QueueFilter[]).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}>{queueFilterLabel(value)}</button>
            ))}
          </div>
          <QueueSearch value={searchQuery} onChange={changeSearch} />
          {refreshMessage ? <p className={`refresh-status ${refreshState}`} role="status">{refreshMessage}</p> : null}
        </div>

        <div className="mobile-feed">
          {visibleGroups.map((group) => {
            const task = group.tasks.find((candidate) => candidate.task_id === selectedTaskId) ?? group.tasks[0]!;
            const version = task.current_version;
            const asset = proofAsset(version);
            return (
              <article className="feed-card" key={group.group_id} aria-labelledby={`feed-title-${group.group_id}`}>
                <header className="feed-header">
                  <div>
                    <span className="eyebrow">Line {group.line_number ?? "—"}{formatQuantity(group.quantity) !== null ? ` · Qty ${formatQuantity(group.quantity)}` : ""}</span>
                    <h2 id={`feed-title-${group.group_id}`} title={group.product_name ?? "Artwork proof"}>{group.product_name ?? "Artwork proof"}</h2>
                    {decisionStateDetail(task) ? <p className={`task-state-copy ${task.state}`}>{decisionStateDetail(task)}</p> : null}
                    <SharedProofScope task={task} compact />
                  </div>
                  <span className={`status-pill ${task.state}`}>
                    <TaskStateIcon state={task.state} />
                    {statusLabel(task)}
                  </span>
                </header>
                <ProofFilmstrip tasks={group.tasks} selectedTaskId={task.task_id} assignments={quantityAssignments[group.group_id]} stagedTaskIds={stagedApprovals[group.group_id]} onSelect={setSelectedTaskId} />
                <div className="feed-meta">
                  <span><FileText aria-hidden="true" /> {version?.filename ?? "Proof pending"}</span>
                  {formatQuantity(task.quantity) !== null ? <span>Qty {formatQuantity(task.quantity)}</span> : null}
                  {group.tasks.length > 1 ? <span><Layers3 aria-hidden="true" /> Creative {group.tasks.indexOf(task) + 1} of {group.tasks.length}</span> : null}
                </div>
                <div className="feed-preview"><ProofPreview version={version} refreshing={artworkRefreshing} quality="preview" /></div>
                <div className="feed-toolbar" aria-label={`Actions for ${task.product_name ?? "proof"}`}>
                      <FeedbackButton task={task} onClick={(event) => openDetailDialog("feedback", task.task_id, event)} />
                  <button type="button" onClick={(event) => openDetailDialog("history", task.task_id, event)}><History aria-hidden="true" /> History</button>
                  {asset.open ? <a href={asset.open} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open full size</a> : null}
                </div>
                <ActionTransport
                  tasks={group.tasks}
                  selectedTaskId={task.task_id}
                  stagedTaskIds={stagedApprovals[group.group_id] ?? []}
                  values={quantityAssignments[group.group_id] ?? {}}
                  onChange={(values) => updateQuantityAssignments(group.group_id, values)}
                  onStageApproval={(taskId) => setStagedApprovals((current) => ({ ...current, [group.group_id]: [...new Set([...(current[group.group_id] ?? []), taskId])] }))}
                  onUndoApproval={(taskId) => setStagedApprovals((current) => ({ ...current, [group.group_id]: (current[group.group_id] ?? []).filter((candidate) => candidate !== taskId) }))}
                  draft={quantityDrafts[group.group_id] ?? null}
                  onSaveDraft={(draft) => saveQuantityReview(group.group_id, draft)}
                  demoBatchEnabled={demoEnabled && window.location.hash === "#/proof/batch-qa"}
                  decisionsEnabled={order!.access.decisions_enabled}
                  reviewExperience={order!.access.review_experience}
                  revisionUploadEnabled={Boolean(order!.access.revision_upload_enabled)}
                  participantIdentified={Boolean(participant)}
                  onApproveSingle={approveSingleProof}
                  onRequestChanges={requestSingleProofChanges}
                  onRequestRevision={(task) => setRevisionUploadTaskId(task.task_id)}
                  mobile
                />
              </article>
            );
          })}
          {!visibleTasks.length && emptyState ? (
            <div className="mobile-empty" role={completionEmpty ? "region" : "status"} aria-label={completionEmpty ? "Proof review complete" : undefined}>
              <CheckCircle2 aria-hidden="true" />
              <strong>{emptyState.title}</strong>
              <span>{emptyState.detail}</span>
              {completionEmpty ? <button className="button secondary completion-button" type="button" onClick={() => changeFilter("approved")}>View approved proofs</button> : null}
            </div>
          ) : null}
        </div>
      </section>

      {detailDialog && dialogTask ? (
        <dialog
          ref={dialogElement}
          className="proof-dialog"
          aria-labelledby="proof-dialog-title"
          aria-describedby="proof-dialog-description"
          onCancel={(event) => {
            event.preventDefault();
            closeDetailDialog();
          }}
          onClose={() => {
            setDetailDialog(null);
            if (deferDetailFocusReturn.current) {
              deferDetailFocusReturn.current = false;
            } else {
              restoreDialogFocus(dialogOpener.current);
            }
          }}
        >
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">{dialogTask.product_name ?? "Artwork proof"}</span>
              <h2 id="proof-dialog-title">{detailDialog.kind === "feedback" ? "Prepress team feedback" : "File history"}</h2>
              {detailDialog.kind === "feedback" && feedbackCommentCount ? <small className="feedback-comment-count">{commentCountLabel(feedbackCommentCount)}</small> : null}
              <p className="sr-only" id="proof-dialog-description">{detailDialog.kind === "feedback" ? "Review Prepress team feedback and its available attachments for this proof." : "Review the current and previous customer-safe versions of this proof."}</p>
            </div>
            <button ref={detailDialogCloseButton} className="icon-button subtle" type="button" aria-label="Close dialog" onClick={closeDetailDialog}><X aria-hidden="true" /></button>
          </div>
          {detailDialog.kind === "feedback" ? (
            <div className="dialog-content comments-list">
              {dialogVersion?.comments.length ? dialogVersion.comments.map((comment, index) => (
                <article className={`comment${dialogTask.feedback_acknowledged ? "" : " unread"}`} key={`${comment.created_at}-${index}`}>
                  <p>{comment.text ?? "Prepress team feedback attached"}</p>
                  {comment.attachments.length ? (
                    <ul className="comment-attachments" aria-label="Prepress team feedback attachments">
                      {comment.attachments.map((attachment, attachmentIndex) => (
                        <li key={`${attachment.filename}-${attachmentIndex}`}>
                          {attachment.url && isImageFeedbackAttachment(attachment.filename, attachment.content_type) ? (
                            <button className="comment-image-attachment" type="button" onClick={() => setFeedbackImagePreview({ filename: attachment.filename, url: attachment.url! })} aria-label={`Preview feedback image ${attachment.filename}`}>
                              <img src={attachment.url} alt={`Prepress attachment: ${attachment.filename}`} />
                              <span><strong>{attachment.filename}</strong><small>Preview image</small></span>
                              <ExternalLink aria-hidden="true" />
                            </button>
                          ) : attachment.url ? (
                            <a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`Open feedback attachment ${attachment.filename}`}>
                              <Paperclip aria-hidden="true" />
                              <span><strong>{attachment.filename}</strong><small>{attachment.content_type ?? "Prepress feedback file"}</small></span>
                              <ExternalLink aria-hidden="true" />
                            </a>
                          ) : (
                            <div aria-label={`Feedback attachment ${attachment.filename}; link unavailable`}>
                              <Paperclip aria-hidden="true" />
                              <span><strong>{attachment.filename}</strong><small>{attachment.content_type ?? "Attachment link unavailable"}</small></span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <time>{formatDate(comment.created_at, true)}</time>
                </article>
              )) : <p className="muted">No Prepress team feedback has been recorded for this version.</p>}
              {dialogTask.feedback_required ? (
                <div className={`feedback-ack ${dialogTask.feedback_acknowledged ? "complete" : ""}`}>
                  <div>
                    <CheckCircle2 aria-hidden="true" />
                    <span>
                      <strong>{dialogTask.feedback_acknowledged ? "Prepress team feedback reviewed" : "Confirm you reviewed the Prepress team feedback"}</strong>
                      <small>This acknowledgement is a review record only. It does not approve the proof or submit a revision.</small>
                    </span>
                  </div>
                  {dialogTask.feedback_acknowledged ? null : participant ? (
                    <button className="button primary" type="button" disabled={feedbackSaving} onClick={() => void acknowledgeCurrentFeedback()}>
                      {feedbackSaving ? "Saving…" : "Mark as reviewed"}
                    </button>
                  ) : (
                    <button className="button secondary" type="button" onClick={identifyFromFeedback}>Identify reviewer first</button>
                  )}
                  {feedbackError ? <p className="form-error" role="alert">{feedbackError}</p> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="dialog-content history-dialog-content">
              {dialogHistory?.status === "loading" ? (
                <p className="history-message" role="status"><RefreshCw className="spin" aria-hidden="true" /> Checking file history…</p>
              ) : null}
              {dialogHistory?.status === "error" ? (
                <div className="history-error" role="alert">
                  <span>{dialogHistory.message} Cached history remains available below.</span>
                  <button className="button secondary compact" type="button" onClick={() => void loadHistory(dialogTask.task_id)}>Try again</button>
                </div>
              ) : null}
              {dialogVersions.length ? (
                <div className="version-list">
                  {dialogVersions.map((version, index) => (
                    <button
                      type="button"
                      className={dialogVersion?.version_id === version.version_id ? "active" : ""}
                      key={version.version_id}
                      aria-pressed={dialogVersion?.version_id === version.version_id}
                      onClick={() => setSelectedVersionId(version.version_id)}
                    >
                      <span><strong>Version {Math.max(1, dialogVersions.length - index)}</strong><small>{version.filename ?? "Proof file"}</small></span>
                      <time>{formatDate(version.created_at)}</time>
                    </button>
                  ))}
                </div>
              ) : dialogHistory?.status === "loading" ? null : <p className="muted">No file history is available for this proof.</p>}
              {dialogVersion ? (
                <article className="history-version-detail" aria-label="Selected version details">
                  <div className="history-version-meta">
                    <span><small>Approval status</small><strong>{dialogVersion.approval_status ?? "Not recorded"}</strong></span>
                    <span><small>Approval date</small><strong>{dialogVersion.approved_at ? formatDate(dialogVersion.approved_at, true) : "Not recorded"}</strong></span>
                  </div>
                  {dialogVersion.technical_checks.length ? (
                    <section className="technical-checks" aria-labelledby="technical-checks-title">
                      <h3 id="technical-checks-title">Technical checks</h3>
                      <ul>
                        {dialogVersion.technical_checks.map((check, index) => (
                          <li key={`${check.name}-${index}`}>
                            <span>{check.name}</span>
                            <strong data-state={technicalCheckState(check.status)}>{check.status ?? "Recorded"}</strong>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : <p className="history-no-checks">No customer-facing technical checks were recorded for this version.</p>}
                </article>
              ) : null}
            </div>
          )}
          {feedbackImagePreview ? (
            <div className="feedback-image-lightbox" role="dialog" aria-modal="true" aria-label={`Feedback image preview: ${feedbackImagePreview.filename}`} onMouseDown={(event) => {
              if (event.target === event.currentTarget) setFeedbackImagePreview(null);
            }}>
              <div className="feedback-image-lightbox-card">
                <div>
                  <strong>{feedbackImagePreview.filename}</strong>
                  <button className="icon-button subtle" type="button" aria-label="Close feedback image preview" onClick={() => setFeedbackImagePreview(null)}><X aria-hidden="true" /></button>
                </div>
                <img src={feedbackImagePreview.url} alt={`Prepress attachment: ${feedbackImagePreview.filename}`} />
                <a className="button secondary" href={feedbackImagePreview.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open full size</a>
              </div>
            </div>
          ) : null}
        </dialog>
      ) : null}

      <RevisionUploadDialog
        open={Boolean(revisionUploadTaskId)}
        task={revisionUploadTask}
        enabled={Boolean(order?.access.revision_upload_enabled)}
        participantIdentified={Boolean(participant)}
        feedbackAcknowledged={Boolean(revisionUploadTask?.feedback_acknowledged)}
        onClose={() => setRevisionUploadTaskId(null)}
        onSessionExpired={terminateSession}
        onProofUpdated={refreshAfterLiftProofUpdate}
        onUploadAccepted={(task) => setActionOutcome({
          title: `Line ${task.line_number ?? "—"} revised artwork received`,
          detail: "The current proof will leave Open proofs while Vornan prepares the replacement."
        })}
      />

      {identityOpen ? (
        <dialog
          ref={identityDialogElement}
          className="proof-dialog identity-dialog"
          aria-labelledby="identity-dialog-title"
          aria-describedby="identity-dialog-description"
          onCancel={(event) => {
            event.preventDefault();
            identityDialogElement.current?.close();
          }}
          onClose={() => {
            setIdentityOpen(false);
            restoreDialogFocus(identityDialogOpener.current);
          }}
        >
          <form onSubmit={(event) => void saveIdentity(event)}>
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">Reviewer identity</span>
                <h2 id="identity-dialog-title">Tell Vornan who is reviewing</h2>
                <p className="sr-only" id="identity-dialog-description">Reviewer details are optional for viewing and visible only to authorized Vornan operators.</p>
              </div>
              <button className="icon-button subtle" type="button" aria-label="Close reviewer details" onClick={() => identityDialogElement.current?.close()}><X aria-hidden="true" /></button>
            </div>
            <div className="dialog-content identity-form">
              <p>Viewing remains available without identification. These details will be required before a future approval or revision request and are visible only to authorized Vornan operators.</p>
              <label>
                <span>Name</span>
                <input ref={identityNameInput} required minLength={2} maxLength={80} autoComplete="name" value={identityName} onChange={(event) => setIdentityName(event.target.value)} />
              </label>
              <label>
                <span>Email</span>
                <input required type="email" maxLength={254} autoComplete="email" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} />
              </label>
              {identityError ? <p className="form-error" role="alert">{identityError}</p> : null}
              <div className="identity-actions">
                <button className="button secondary" type="button" onClick={() => identityDialogElement.current?.close()}>Cancel</button>
                <button className="button primary" type="submit" disabled={identitySaving}>{identitySaving ? "Saving…" : participant ? "Update reviewer" : "Save reviewer"}</button>
              </div>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
