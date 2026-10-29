import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, X } from "lucide-react";
import { loadRevisionSubmissions, submitRevisionArtwork, ProofApiError, type ProofRevisionAsset, type ProofRevisionSubmission } from "./api";
import { matchesRevisionIntent, readRevisionIntents, revisionIntentKey, revisionProtectsProof, revisionSubmissionCopy, saveRevisionIntent, type RevisionIntent } from "./revision-submission-state";
import type { ProofTask } from "./types";

export function useRevisionSubmissions(orderNumber: string | null, participantId: string | null, recoveryEnabled: boolean, submissionEnabled: boolean, onSessionExpired: () => void) {
  const key = orderNumber && participantId && recoveryEnabled ? revisionIntentKey(orderNumber, participantId) : null;
  const currentKey = useRef(key); currentKey.current = key;
  const sessionExpired = useRef(onSessionExpired); sessionExpired.current = onSessionExpired;
  const [state, setState] = useState<{ key: string | null; intents: RevisionIntent[]; receipts: ProofRevisionSubmission[]; ready: boolean }>({ key: null, intents: [], receipts: [], ready: false });
  const latest = useRef(state); latest.current = state;
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);

  const check = async () => {
    const context = key;
    if (!context) return;
    setChecking(true);
    try {
      readRevisionIntents(window.sessionStorage, context); // Fail closed on unreadable recovery state.
      const { submissions } = await loadRevisionSubmissions(); // GET only. Never submit or advance.
      if (currentKey.current !== context) return;
      const receipts = new Map(submissions.map((receipt) => [receipt.submission_id, receipt]));
      for (const receipt of latest.current.key === context ? latest.current.receipts : []) {
        if (!receipts.has(receipt.submission_id) || receipt.state === "accepted") receipts.set(receipt.submission_id, receipt);
      }
      const next = { key: context, intents: readRevisionIntents(window.sessionStorage, context), receipts: [...receipts.values()], ready: true };
      latest.current = next; setState(next); setMessage(null); setLastChecked(new Date().toISOString());
    } catch (error) {
      if (currentKey.current !== context) return;
      if (error instanceof ProofApiError && error.status === 401) sessionExpired.current();
      setMessage("We couldn’t check the saved artwork status. No artwork will be sent again. Please check again shortly.");
    } finally { if (currentKey.current === context) setChecking(false); }
  };
  useEffect(() => {
    latest.current = { key, intents: [], receipts: [], ready: false };
    setState(latest.current); setOpen(false); setMessage(null); setLastChecked(null);
    if (key) void check();
  }, [key]);

  const entries = state.key === key ? [
    ...state.receipts.map((receipt) => ({ receipt, intent: state.intents.find((intent) => matchesRevisionIntent(receipt, intent)) ?? null })),
    ...state.intents.filter((intent) => !state.receipts.some((receipt) => matchesRevisionIntent(receipt, intent))).map((intent) => ({ receipt: null, intent }))
  ] : [];
  const blocked = (task: ProofTask) => {
    if (!key) return null;
    if (state.key !== key || !state.ready) return "Check saved artwork status before taking another action.";
    if (entries.some(({ receipt, intent }) => revisionProtectsProof((receipt ?? intent)!, task.attachment_id ?? null, task.current_version?.version_id ?? null))) return "Artwork submission saved. Use Artwork status before taking another action on this proof.";
    return null;
  };
  const submit = async (task: ProofTask, asset: ProofRevisionAsset, note: string) => {
    const context = key;
    if (!context || !submissionEnabled || checking || inFlight.current || blocked(task) || !task.attachment_id || !task.current_version || !task.version) throw new Error("This proof is not ready for artwork submission. Check its latest status first.");
    const intent: RevisionIntent = { task_id: task.task_id, attachment_id: task.attachment_id, version_id: task.current_version.version_id, asset_id: asset.asset_id, filename: asset.original_filename, proof_filename: task.current_version.filename, line_number: task.line_number, idempotency_key: `prevision_${crypto.randomUUID().replaceAll("-", "")}` };
    // Claim locally before POST. Every subsequent path (even 401 or lost response)
    // retains this intent and offers only read-only discovery, never another send.
    const intents = saveRevisionIntent(window.sessionStorage, context, latest.current.intents, intent);
    const next = { ...latest.current, key: context, intents };
    latest.current = next; setState(next); inFlight.current = true; setSending(true); setMessage(null); setOpen(true);
    try {
      const { submission } = await submitRevisionArtwork({ task_id: intent.task_id, attachment_id: intent.attachment_id, asset_id: intent.asset_id, expected_task_version: task.version, expected_version_id: intent.version_id, idempotency_key: intent.idempotency_key, note });
      if (currentKey.current !== context) return;
      const saved = { ...latest.current, receipts: [...latest.current.receipts.filter((r) => r.submission_id !== submission.submission_id), submission] };
      latest.current = saved; setState(saved);
    } catch (error) {
      if (currentKey.current !== context) return;
      if (error instanceof ProofApiError && error.status === 401) sessionExpired.current();
      // Discovery can recover a receipt despite an unsuccessful POST response.
      // No missing receipt, error or new proof is interpreted as permission to resend.
      // Do not keep Sending active while read-only discovery is pending.
      // The write-ahead intent remains visible and protective immediately.
      void check();
    } finally {
      inFlight.current = false;
      if (currentKey.current === context) setSending(false);
    }
  };
  return { entries, blocked, submit, check, checking, sending, message, lastChecked, open, setOpen, active: Boolean(key), recovering: Boolean(key && (state.key !== key || !state.ready)) };
}

export function RevisionSubmissionProgress({ model }: { model: ReturnType<typeof useRevisionSubmissions> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (model.open && dialog.current && !dialog.current.open) { dialog.current.showModal(); closeButton.current?.focus(); }
    if (!model.open && dialog.current?.open) dialog.current.close();
  }, [model.open]);
  const close = () => { model.setOpen(false); window.requestAnimationFrame(() => opener.current?.focus({ preventScroll: true })); };
  if (!model.active || (!model.entries.length && !model.message && !model.recovering)) return null;
  return <>
    <div className="creative-approval-resume revision-status-resume" role="status">
      <Clock3 aria-hidden="true" />
      <span>{model.checking ? "Checking saved artwork status" : model.message ? "Artwork status needs a check" : "Revised artwork · saved submission status"}</span>
      <button ref={opener} className="button secondary compact" onClick={() => model.setOpen(true)}>Artwork status</button>
    </div>
    <dialog ref={dialog} className="proof-dialog revision-status-dialog" aria-labelledby="revision-status-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="dialog-heading"><div><span className="eyebrow">Revised artwork</span><h2 id="revision-status-title">{model.sending ? "Sending artwork" : "Artwork status"}</h2></div><button ref={closeButton} className="icon-button subtle" aria-label="Close artwork status" onClick={close}><X aria-hidden="true" /></button></div>
      <div className="dialog-content revision-status-content">
        {model.entries.map(({ receipt, intent }) => {
          const copy = revisionSubmissionCopy(receipt);
          const lineNumber = receipt?.line_number ?? intent?.line_number;
          const proofFilename = receipt?.proof_filename ?? intent?.proof_filename;
          return <article className={`revision-upload-progress ${copy.tone === "sent" ? "ready" : "stored"}`} key={receipt?.submission_id ?? intent!.idempotency_key}>
            {copy.tone === "sent" ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            <span><strong>{model.sending && !receipt ? "Sending artwork…" : copy.title}</strong><small>{model.sending && !receipt ? "Your submission is saved. This artwork will not be sent twice." : copy.detail}</small><em>{lineNumber ? `Line ${lineNumber} · ` : ""}{receipt?.filename ?? intent?.filename}</em>{proofFilename ? <small>Original proof: {proofFilename}</small> : null}</span>
          </article>;
        })}
        {model.message ? <p role="alert">{model.message}</p> : null}
        {!model.entries.length && !model.message ? <p role="status">{model.checking ? "Checking saved artwork submissions…" : "No artwork submissions were found in this review."}</p> : null}
        {model.lastChecked ? <p className="revision-last-checked">Status checked <time dateTime={model.lastChecked}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(model.lastChecked))}</time></p> : null}
      </div>
      <div className="revision-upload-actions"><button className="button secondary" onClick={() => void model.check()} disabled={model.checking || model.sending}>{model.checking ? "Checking…" : "Check status"}</button><button className="button primary" onClick={close}>Close</button></div>
    </dialog>
  </>;
}
