import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  History,
  Layers3,
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
import { acknowledgeFeedback, endSession, exchangeToken, identifyParticipant, loadProofHistory, loadProofOrder, ProofApiError, requestProofRefresh } from "./api";
import { proofAsset } from "./asset-state";
import { demoActivityForHash, demoOrderForHash } from "./demo";
import { restoreProofDialogFocus } from "./dialog-state";
import { proofOrderDisplayStatus, proofOrderDisplayTitle } from "./display-state";
import {
  filterProofTasks,
  queueEmptyMessage,
  queueNavigationTarget,
  searchProofTasks,
  selectedVisibleTask,
  type QueueFilter,
  type QueueNavigationKey
} from "./queue-state";
import { proofOrderCompletion, proofOrderHealthMessage, proofStatePresentation } from "./lifecycle-state";
import { ProofPreview } from "./proof-preview";
import { createFailClosedSessionTerminator, focusProofTerminalState, proofEntryState, sessionExpiryDelay } from "./session-state";
import type { ProofActivity, ProofOrder, ProofParticipant, ProofTask, ProofVersion } from "./types";

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

const demoEnabled = import.meta.env.DEV && import.meta.env.VITE_PROOF_DEMO === "true";
let bootstrapPromise: Promise<ProofLoad> | null = null;

async function bootstrap() {
  if (demoEnabled) {
    return {
      order: demoOrderForHash(window.location.hash),
      participant: null,
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

function TaskThumbnail({ task }: { task: ProofTask }) {
  const asset = proofAsset(task.current_version);
  return (
    <span className="task-thumbnail" aria-hidden="true">
      {asset.preview && asset.kind === "image"
        ? <img src={asset.preview} referrerPolicy="no-referrer" alt="" />
        : <FileText />}
    </span>
  );
}

function ActionTransport({ mobile = false }: { mobile?: boolean }) {
  return (
    <section className={`action-transport ${mobile ? "mobile" : ""}`} aria-label="Proof decision actions" aria-describedby={mobile ? undefined : "action-lock-message"}>
      <div className="action-lock">
        <LockKeyhole aria-hidden="true" />
        <span><strong>Decision actions</strong><small id={mobile ? undefined : "action-lock-message"}>Locked during isolated lifecycle QA</small></span>
      </div>
      {!mobile ? <textarea disabled aria-label="Optional note sent with this decision" placeholder="Optional note sent with this decision" /> : null}
      <div className="transport-buttons">
        <button type="button" disabled><ShieldCheck aria-hidden="true" /> Approve for Print</button>
        <button type="button" disabled><Upload aria-hidden="true" /> Upload Revised File</button>
      </div>
    </section>
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

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [filter, setFilter] = useState<QueueFilter>("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [detailDialog, setDetailDialog] = useState<DetailDialog | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [historyByTask, setHistoryByTask] = useState<Record<string, HistoryState>>({});
  const taskButtons = useRef(new Map<string, HTMLButtonElement>());
  const dialogElement = useRef<HTMLDialogElement>(null);
  const identityDialogElement = useRef<HTMLDialogElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const identityDialogOpener = useRef<HTMLElement | null>(null);
  const detailDialogCloseButton = useRef<HTMLButtonElement>(null);
  const identityNameInput = useRef<HTMLInputElement>(null);
  const terminalStateElement = useRef<HTMLElement>(null);
  const deferDetailFocusReturn = useRef(false);

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
      ({ order, participant, activity, refresh_queued: refreshQueued, session_expires_at: sessionExpiresAt }) => {
        setLoadState({ status: "ready", order, participant, activity, session_expires_at: sessionExpiresAt });
        setSelectedTaskId((current) => current ?? order.tasks[0]?.task_id ?? null);
        if (refreshQueued) {
          setRefreshState("queued");
          setRefreshMessage("A background refresh is already queued. You can keep reviewing this cached proof packet.");
        } else if (silent) {
          setRefreshState("idle");
          setRefreshMessage("Proof details checked. The latest available version is shown.");
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

  const refresh = async () => {
    if (refreshState === "requesting" || refreshState === "queued") return;
    setRefreshState("requesting");
    setRefreshMessage("Requesting the latest proof details…");
    try {
      if (!demoEnabled) await requestProofRefresh();
      setRefreshState("queued");
      setRefreshMessage("Refresh queued. You can keep reviewing while Vornan checks Lift for updates.");
      window.setTimeout(() => {
        bootstrapPromise = null;
        load(true);
      }, 3000);
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

  const order = loadState.status === "ready" ? loadState.order : null;
  const participant = loadState.status === "ready" ? loadState.participant : null;
  const activity = loadState.status === "ready"
    ? loadState.activity
    : { identified_reviewers: 0, last_activity_at: null, reviewer_names_visible: false as const };
  const visibleTasks = useMemo(() => {
    return order ? searchProofTasks(filterProofTasks(order.tasks, filter), searchQuery) : [];
  }, [filter, order, searchQuery]);
  const selectedTask = selectedVisibleTask(visibleTasks, selectedTaskId);
  const selectedVersion =
    selectedTask?.versions.find((version) => version.version_id === selectedVersionId) ?? selectedTask?.current_version ?? null;
  const selectedAsset = proofAsset(selectedVersion);
  const completion = order ? proofOrderCompletion(order) : null;
  const completionEmpty = Boolean(completion && filter === "open" && !searchQuery.trim());
  const emptyState = completionEmpty ? completion : order ? queueEmptyMessage(filter, order.tasks, searchQuery) : null;
  const proofCounts = order?.counts ?? { pending: 0, regenerating: 0, waiting: 0, reviewed: 0, total: 0 };
  const orderHealthMessage = order ? proofOrderHealthMessage(order.health) : null;
  const dialogTask = detailDialog ? order?.tasks.find((task) => task.task_id === detailDialog.task_id) ?? null : null;
  const dialogHistory = dialogTask ? historyByTask[dialogTask.task_id] : undefined;
  const dialogVersions = dialogTask
    ? dialogHistory?.versions ?? (dialogTask.versions.length ? dialogTask.versions : dialogTask.current_version ? [dialogTask.current_version] : [])
    : [];
  const dialogVersion = detailDialog?.kind === "feedback"
    ? dialogTask?.current_version ?? null
    : dialogVersions.find((version) => version.version_id === selectedVersionId) ?? dialogTask?.current_version ?? dialogVersions[0] ?? null;

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

  const navigateQueue = (event: KeyboardEvent<HTMLButtonElement>, taskId: string) => {
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const targetId = queueNavigationTarget(visibleTasks, taskId, event.key as QueueNavigationKey);
    if (!targetId) return;
    setSelectedTaskId(targetId);
    window.requestAnimationFrame(() => taskButtons.current.get(targetId)?.focus());
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

  const closeDetailDialog = () => dialogElement.current?.close();

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
      setFeedbackError(error instanceof Error ? error.message : "Feedback could not be acknowledged.");
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
            <div><dt>Pending</dt><dd>{proofCounts.pending}</dd></div>
            <div><dt>Regenerating</dt><dd>{proofCounts.regenerating}</dd></div>
            <div><dt>Waiting</dt><dd>{proofCounts.waiting}</dd></div>
            <div><dt>Reviewed</dt><dd>{proofCounts.reviewed}/{proofCounts.total}</dd></div>
          </dl>
          <div className="view-only-badge"><ShieldCheck aria-hidden="true" /> Secure view-only access</div>
        </div>
      </section>

      <div className="notice-stack">
        <div className="read-only-notice" role="status">
          <ShieldCheck aria-hidden="true" />
          <span><strong>Review mode.</strong> Approvals and revision requests remain disabled while Vornan completes isolated lifecycle QA.</span>
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
      </div>

      <main className="workspace">
        <aside className="queue-panel" aria-label="Proof queue" aria-busy={refreshState === "requesting"}>
          <div className="queue-heading">
            <div>
              <span className="eyebrow">Proof queue</span>
              <h2>{visibleTasks.length} {visibleTasks.length === 1 ? "item" : "items"}</h2>
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
            {(["open", "all", "history"] as QueueFilter[]).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}>{value}</button>
            ))}
          </div>
          <QueueSearch value={searchQuery} onChange={changeSearch} />
          <div className="task-list" role="listbox" aria-label={`${filter} proofs`}>
            {visibleTasks.map((task) => (
              <button
                className={`task-card ${selectedTask?.task_id === task.task_id ? "selected" : ""}`}
                key={task.task_id}
                type="button"
                role="option"
                aria-selected={selectedTask?.task_id === task.task_id}
                tabIndex={selectedTask?.task_id === task.task_id ? 0 : -1}
                ref={(element) => {
                  if (element) taskButtons.current.set(task.task_id, element);
                  else taskButtons.current.delete(task.task_id);
                }}
                onClick={() => setSelectedTaskId(task.task_id)}
                onKeyDown={(event) => navigateQueue(event, task.task_id)}
              >
                <TaskThumbnail task={task} />
                <div className="task-card-copy">
                  <div className="task-card-top">
                    <span>Line {task.line_number ?? "—"}</span>
                    <span className={`status-pill ${task.state}`}>
                      <TaskStateIcon state={task.state} />
                      {statusLabel(task)}
                    </span>
                  </div>
                  <strong>{task.product_name ?? "Artwork proof"}</strong>
                  <div className="task-file"><FileText aria-hidden="true" />{task.current_version?.filename ?? "Proof pending"}</div>
                  {formatQuantity(task.quantity) !== null || task.sibling_count > 1 ? (
                    <div className="task-context">
                      {formatQuantity(task.quantity) !== null ? <span>Qty {formatQuantity(task.quantity)}</span> : null}
                      {task.sibling_count > 1 ? <span className="sibling"><Layers3 aria-hidden="true" /> Panel {task.sibling_index} of {task.sibling_count}</span> : null}
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
            {!visibleTasks.length && emptyState ? (
              <div className="empty-list" role={completionEmpty ? "region" : "status"} aria-label={completionEmpty ? "Proof review complete" : undefined}>
                <strong>{emptyState.title}</strong>
                <span>{emptyState.detail}</span>
                {completionEmpty ? <button className="button secondary completion-button" type="button" onClick={() => changeFilter("history")}>View reviewed proofs</button> : null}
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
                  <h2>{selectedTask.product_name ?? "Artwork proof"}</h2>
                  {proofStatePresentation(selectedTask.state).detail ? <p className={`task-state-copy ${selectedTask.state}`}>{proofStatePresentation(selectedTask.state).detail}</p> : null}
                </div>
                <div className="detail-actions">
                  <button className="button secondary compact" type="button" onClick={(event) => openDetailDialog("feedback", selectedTask.task_id, event)}>
                    <MessageSquareText aria-hidden="true" /> Feedback
                  </button>
                  <button className="button secondary compact" type="button" onClick={(event) => openDetailDialog("history", selectedTask.task_id, event)}>
                    <History aria-hidden="true" /> File history
                  </button>
                  {selectedAsset.download && <a className="button secondary" href={selectedAsset.download} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> Download</a>}
                  {selectedAsset.open && <a className="icon-button subtle" href={selectedAsset.open} target="_blank" rel="noreferrer" aria-label="Open proof in a new tab"><ExternalLink aria-hidden="true" /></a>}
                </div>
              </div>

              <div className="preview-stage"><ProofPreview version={selectedVersion} /></div>
              <ActionTransport />
            </>
          ) : (
            <div className="preview-empty">
              {filter === "open" && order!.tasks.length ? <CheckCircle2 aria-hidden="true" /> : <FileText aria-hidden="true" />}
              <strong>{emptyState?.title ?? "Select a proof"}</strong>
              {emptyState ? <span>{emptyState.detail}</span> : null}
              {completionEmpty ? <button className="button secondary completion-button" type="button" onClick={() => changeFilter("history")}>View reviewed proofs</button> : null}
            </div>
          )}
        </section>
      </main>

      <section className="mobile-review" aria-label="Proof review feed">
        <div className="mobile-dock">
          <div className="mobile-dock-heading">
            <div><span className="eyebrow">Proof inbox</span><strong>{visibleTasks.length} {visibleTasks.length === 1 ? "item" : "items"}</strong></div>
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
            {(["open", "all", "history"] as QueueFilter[]).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}>{value}</button>
            ))}
          </div>
          <QueueSearch value={searchQuery} onChange={changeSearch} />
          {refreshMessage ? <p className={`refresh-status ${refreshState}`} role="status">{refreshMessage}</p> : null}
        </div>

        <div className="mobile-feed">
          {visibleTasks.map((task) => {
            const version = task.current_version;
            const asset = proofAsset(version);
            return (
              <article className="feed-card" key={task.task_id} aria-labelledby={`feed-title-${task.task_id}`}>
                <header className="feed-header">
                  <div>
                    <span className="eyebrow">Line {task.line_number ?? "—"}</span>
                    <h2 id={`feed-title-${task.task_id}`}>{task.product_name ?? "Artwork proof"}</h2>
                    {proofStatePresentation(task.state).detail ? <p className={`task-state-copy ${task.state}`}>{proofStatePresentation(task.state).detail}</p> : null}
                  </div>
                  <span className={`status-pill ${task.state}`}>
                    <TaskStateIcon state={task.state} />
                    {statusLabel(task)}
                  </span>
                </header>
                <div className="feed-meta">
                  <span><FileText aria-hidden="true" /> {version?.filename ?? "Proof pending"}</span>
                  {formatQuantity(task.quantity) !== null ? <span>Qty {formatQuantity(task.quantity)}</span> : null}
                  {task.sibling_count > 1 ? <span><Layers3 aria-hidden="true" /> Panel {task.sibling_index} of {task.sibling_count}</span> : null}
                </div>
                <div className="feed-preview"><ProofPreview version={version} /></div>
                <div className="feed-toolbar" aria-label={`Actions for ${task.product_name ?? "proof"}`}>
                  <button type="button" onClick={(event) => openDetailDialog("feedback", task.task_id, event)}><MessageSquareText aria-hidden="true" /> Feedback</button>
                  <button type="button" onClick={(event) => openDetailDialog("history", task.task_id, event)}><History aria-hidden="true" /> History</button>
                  {asset.open ? <a href={asset.open} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open full size</a> : null}
                </div>
                <ActionTransport mobile />
              </article>
            );
          })}
          {!visibleTasks.length && emptyState ? (
            <div className="mobile-empty" role={completionEmpty ? "region" : "status"} aria-label={completionEmpty ? "Proof review complete" : undefined}>
              <CheckCircle2 aria-hidden="true" />
              <strong>{emptyState.title}</strong>
              <span>{emptyState.detail}</span>
              {completionEmpty ? <button className="button secondary completion-button" type="button" onClick={() => changeFilter("history")}>View reviewed proofs</button> : null}
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
              <h2 id="proof-dialog-title">{detailDialog.kind === "feedback" ? "Feedback" : "File history"}</h2>
              <p className="sr-only" id="proof-dialog-description">{detailDialog.kind === "feedback" ? "Review feedback and its available attachments for this proof." : "Review the current and previous customer-safe versions of this proof."}</p>
            </div>
            <button ref={detailDialogCloseButton} className="icon-button subtle" type="button" aria-label="Close dialog" onClick={closeDetailDialog}><X aria-hidden="true" /></button>
          </div>
          {detailDialog.kind === "feedback" ? (
            <div className="dialog-content comments-list">
              {dialogVersion?.comments.length ? dialogVersion.comments.map((comment, index) => (
                <article className="comment" key={`${comment.created_at}-${index}`}>
                  <p>{comment.text ?? "Feedback attached"}</p>
                  {comment.attachments.length ? (
                    <ul className="comment-attachments" aria-label="Feedback attachments">
                      {comment.attachments.map((attachment, attachmentIndex) => (
                        <li key={`${attachment.filename}-${attachmentIndex}`}>
                          {attachment.url ? (
                            <a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`Open feedback attachment ${attachment.filename}`}>
                              <Paperclip aria-hidden="true" />
                              <span><strong>{attachment.filename}</strong><small>{attachment.content_type ?? "Feedback file"}</small></span>
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
              )) : <p className="muted">No feedback has been recorded for this version.</p>}
              {dialogTask.feedback_required ? (
                <div className={`feedback-ack ${dialogTask.feedback_acknowledged ? "complete" : ""}`}>
                  <div>
                    <CheckCircle2 aria-hidden="true" />
                    <span>
                      <strong>{dialogTask.feedback_acknowledged ? "Feedback reviewed" : "Confirm you reviewed this feedback"}</strong>
                      <small>This acknowledgement is a review record only. It does not approve the proof or submit a revision.</small>
                    </span>
                  </div>
                  {dialogTask.feedback_acknowledged ? null : participant ? (
                    <button className="button primary" type="button" disabled={feedbackSaving} onClick={() => void acknowledgeCurrentFeedback()}>
                      {feedbackSaving ? "Saving…" : "Mark feedback reviewed"}
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
        </dialog>
      ) : null}

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
