import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, X } from "lucide-react";
import { advanceProofAllocation, loadProofAllocations, prepareProofAllocation, ProofApiError, type AllocationStatus, type AllocationSubmission } from "./api";
import { protectedAllocationAttachments } from "./creative-approval-state";

// Lives above the selected creative: Lift may split/renumber the line while
// background synchronization replaces its task group.
export function AllocationProgress({ request, onClose, onComplete, onPendingChange }: {
  request: AllocationSubmission | null; onClose: () => void; onComplete: () => Promise<void>; onPendingChange: (attachments: string[]) => void;
}) {
  const [batch, setBatch] = useState<AllocationStatus | null>(null);
  const [open, setOpen] = useState(Boolean(request));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [refreshState, setRefreshState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const pendingChange = useRef(onPendingChange);
  pendingChange.current = onPendingChange;
  const latestBatch = useRef<AllocationStatus | null>(null);
  const completedId = useRef<string | null>(null);
  const refreshedId = useRef<string | null>(null);
  const mounted = useRef(true);
  const requestedId = useRef<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Only refresh the order here. Retrying this read must never advance or resend
  // any approval, whose confirmed receipt remains authoritative on failure.
  const refreshConfirmedOrder = async (current: AllocationStatus) => {
    setRefreshState("loading");
    try {
      await complete.current();
      if (!mounted.current || latestBatch.current?.batch_id !== current.batch_id) return;
      refreshedId.current = current.batch_id;
      setRefreshState("ready");
      pendingChange.current([]);
    } catch {
      if (mounted.current && latestBatch.current?.batch_id === current.batch_id) setRefreshState("error");
    }
  };
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let checks = 0;
    const show = (next: AllocationStatus) => {
      if (cancelled) return;
      latestBatch.current = next; setBatch(next); setMessage(null);
      pendingChange.current(protectedAllocationAttachments(next, refreshedId.current === next.batch_id));
      if (next.state === "completed" && completedId.current !== next.batch_id) {
        completedId.current = next.batch_id;
        void refreshConfirmedOrder(next);
      }
    };
    const failure = (error: unknown) => {
      if (cancelled) return;
      setBusy(false);
      setSessionEnded(error instanceof ProofApiError && error.status === 401);
      setMessage(error instanceof ProofApiError && [400, 403, 409, 503].includes(error.status)
        ? error.message
        : error instanceof ProofApiError && error.status === 401
          ? "Your review session ended. Reopen your review link to check these approvals."
          : "We couldn’t check the latest status. Submitted approvals will not be sent again. Please check again shortly.");
    };
    const poll = async (current: AllocationStatus) => {
      if (cancelled || current.state === "completed" || current.state === "paused") { if (!cancelled) setBusy(false); return; }
      if (++checks > 15) { setBusy(false); setMessage("Your approval is still being confirmed. You can continue reviewing and check back shortly."); return; }
      setBusy(true);
      try {
        const { batch: next } = await advanceProofAllocation(current.batch_id);
        if (cancelled) return;
        show(next);
        if (next.state === "completed" || next.state === "paused") { setBusy(false); return; }
        timer = window.setTimeout(() => void poll(next), next.state === "ready" ? 400 : 4000);
      } catch (error) { failure(error); }
    };
    const start = async () => {
      try {
        let current = latestBatch.current;
        if (request && (requestedId.current !== request.idempotency_key || !current)) {
          requestedId.current = request.idempotency_key;
          latestBatch.current = null; setBatch(null); setRefreshState("idle");
          setBusy(true); setOpen(true);
          current = (await prepareProofAllocation(request)).batch;
        } else if (!current) {
          const result = await loadProofAllocations();
          current = result.batches.find((b) => b.state === "ready" || b.state === "checking") ?? (result.batches[0]?.state === "paused" ? result.batches[0] : null);
          if (current && !cancelled) setOpen(true);
          if (!current && request) current = (await prepareProofAllocation(request)).batch;
        }
        if (!current || cancelled) return;
        show(current); await poll(current);
      } catch (error) { if (request || latestBatch.current) failure(error); }
    };
    void start();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [request, retry]);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.current.showModal(); closeButton.current?.focus({ preventScroll: true });
    } else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const dismiss = () => {
    setOpen(false); onClose();
    window.requestAnimationFrame(() => {
      // View status is recreated after dismissal; the old opener is detached.
      if (resumeButton.current) resumeButton.current.focus({ preventScroll: true });
      else if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    });
  };
  if (!batch && !open) return null;
  const confirmed = batch?.entries.filter((e) => e.state === "confirmed").length ?? 0;
  const done = batch?.state === "completed";
  return <>
    {!open && batch && (!done || refreshState !== "ready") ? <div className="creative-approval-resume" role="status"><Clock3 aria-hidden="true" /><span>{sessionEnded ? "Review session ended · approval status saved" : done ? "Approvals confirmed · proof list not yet refreshed" : batch.state === "paused" ? "Creative approvals need review" : "Creative approvals in progress"}</span><button ref={resumeButton} className="button secondary compact" onClick={() => setOpen(true)}>View status</button></div> : null}
    <dialog ref={dialog} className="proof-dialog quantity-batch-dialog creative-approval-progress-dialog" aria-labelledby="creative-approval-progress-title" onCancel={(event) => { event.preventDefault(); dismiss(); }}>
      <div className="dialog-heading quantity-batch-heading">
        <div><span className="eyebrow">Line {batch?.source_line_number ?? "—"} · Creative approvals</span><h2 id="creative-approval-progress-title">{sessionEnded ? "Review session ended" : done ? "Proofs approved" : batch?.state === "paused" ? "Approvals paused" : "Confirming your approvals"}</h2>
          <p>{sessionEnded ? "Reopen your review link to check the saved approval status. Submitted approvals will not be sent again." : done ? "All creative quantities have been confirmed." : batch?.state === "paused" ? "We stopped before sending another approval. Review the latest proofs before continuing." : "Each creative is submitted once. Keep this review page open while we confirm the quantities. If you leave, reopen your review link to continue."}</p></div>
        <button ref={closeButton} className="icon-button subtle" aria-label="Close approval status" onClick={dismiss}><X aria-hidden="true" /></button>
      </div>
      <div className="quantity-confirm-list" role="list" aria-label="Creative approval status">
        {batch?.entries.map((entry) => <div role="listitem" key={entry.task_id}><span>{entry.state === "confirmed" ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}</span><span><strong>{entry.filename ?? "Proof"}</strong><small>{entry.state === "confirmed" ? `Approved${entry.resulting_line_number ? ` · Line ${entry.resulting_line_number}` : ""}` : entry.state === "submitted" ? "Submitted · confirming" : "Not yet submitted"}</small></span><b>Qty {entry.quantity}</b></div>)}
      </div>
      <p className="creative-approval-status" role="status" aria-live="polite">{message ?? (batch ? `${confirmed} of ${batch.entries.length} approvals confirmed` : "Saving your approval quantities…")}</p>
      {done && refreshState !== "ready" ? <p className="creative-approval-status" role="status">{refreshState === "error" ? "Your approvals are confirmed. We couldn’t refresh the proof list yet." : "Your approvals are confirmed. Refreshing the proof list…"}</p> : null}
      <div className="quantity-batch-footer">
        {done && refreshState === "error" && batch ? <button className="button primary" onClick={() => void refreshConfirmedOrder(batch)}>Retry refresh</button> : null}
        {!busy && !done && !sessionEnded && batch?.state !== "paused" ? <button className="button secondary" onClick={() => setRetry((v) => v + 1)}>Check status</button> : null}
        <button className={`button ${done && refreshState === "error" ? "secondary" : "primary"}`} onClick={dismiss}>{done ? refreshState === "ready" ? "View updated proofs" : "Close" : "Continue reviewing"}</button>
      </div>
    </dialog>
  </>;
}
