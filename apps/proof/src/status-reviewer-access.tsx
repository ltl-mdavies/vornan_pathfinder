import { useEffect, useRef, useState } from "react";
import { Eye, UserRound, X } from "lucide-react";
import { reviewerProgress, type ReviewerStage } from "./reviewer-progress";

export function StatusReviewerAccess({ verified, available, busy, stage = "preparing", error, onSignIn }: {
  verified: boolean; available: boolean; busy: boolean; stage?: ReviewerStage; error: string | null; onSignIn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [slow, setSlow] = useState(false);
  const [progressDismissed, setProgressDismissed] = useState(false);
  useEffect(() => { if (busy) setProgressDismissed(false); }, [busy]);
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [busy, stage]);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const identity = useRef<HTMLSpanElement>(null);
  const wasVerified = useRef(verified);
  const close = (restore = false) => { setOpen(false); setProgressDismissed(true); if (restore) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => { if (error) { setOpen(true); heading.current?.focus({ preventScroll: true }); } }, [error]);
  useEffect(() => {
    if (!open && !(busy && !progressDismissed)) return;
    if (open) heading.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, busy, progressDismissed]);
  useEffect(() => {
    if (verified && !wasVerified.current) { setOpen(false); identity.current?.focus({ preventScroll: true }); }
    wasVerified.current = verified;
  }, [verified]);
  return <div className="status-reviewer-access" ref={root}>
    {verified ? <span className="reviewer-button" ref={identity} tabIndex={-1}><UserRound aria-hidden="true" /><span>Verified reviewer</span></span> : <>
      <button ref={trigger} className="reviewer-button" type="button" aria-expanded={open} aria-controls="status-access-explanation" onClick={() => open ? close(true) : setOpen(true)}>
        <Eye aria-hidden="true" /><span>View only</span>
      </button>
      {available ? <button className="reviewer-button status-signin-header" type="button" disabled={busy} onClick={onSignIn}><span>{busy ? "Signing in…" : "Sign in to review"}</span></button> : null}
      {busy && !open && !progressDismissed ? <section className="status-access-popover" aria-label="Reviewer sign-in progress">
        <button type="button" className="icon-button subtle" aria-label="Close sign-in progress" onClick={() => close(true)}><X aria-hidden="true" /></button>
        <p role="status" aria-live="polite" aria-atomic="true">{reviewerProgress(stage)}</p>
        <p>{slow ? stage === "google" ? "Complete sign-in in the Google window. Your artwork will stay open here." : "This is taking longer than usual. Your artwork is still available while we finish checking access." : "Your artwork stays open. Review actions remain locked until access is verified."}</p>
      </section> : null}
      {open ? <section className="status-access-popover" id="status-access-explanation" aria-labelledby="status-access-heading">
        <button type="button" className="icon-button subtle" aria-label="Close access explanation" onClick={() => close(true)}><X aria-hidden="true" /></button>
        <h2 id="status-access-heading" ref={heading} tabIndex={-1}>View-only access</h2>
        {busy ? <p role="status" aria-live="polite" aria-atomic="true">{reviewerProgress(stage)}</p> : null}
        <p>{busy ? slow ? "Your artwork is still available. Complete the Google window if it is open; we’ll return you here once access is verified." : "Your artwork stays open. Review actions remain locked until access is verified." : error || "You can view this order’s artwork. Sign in with an authorized reviewer account to approve or request changes."}</p>
        {available ? <button className="button secondary" type="button" disabled={busy} onClick={onSignIn}>{busy ? "Signing in…" : error ? "Try again" : "Sign in to review"}</button> : null}
      </section> : null}
    </>}
    <span className="sr-only" role="alert" aria-atomic="true">{error}</span>
  </div>;
}
