import { useEffect, useRef, useState } from "react";
import { Eye, UserRound, X } from "lucide-react";
import { reviewerProgress, type ReviewerStage } from "./reviewer-progress";
import type { ReviewerSignInOptions } from "./reviewer-account-hint";

export function StatusReviewerAccess({ verified, available, busy, stage = "preparing", error, onSignIn }: {
  verified: boolean; available: boolean; busy: boolean; stage?: ReviewerStage; error: string | null; onSignIn: (options?: ReviewerSignInOptions) => void;
}) {
  const [open, setOpen] = useState(false);
  const [emailHint, setEmailHint] = useState("");
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
  const close = (restore = false) => { setOpen(false); setEmailHint(""); setProgressDismissed(true); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const beginSignIn = (chooseAccount = false) => {
    if (busy || !available) return;
    const options = chooseAccount ? { chooseAccount: true } : { emailHint: emailHint.trim() };
    setEmailHint("");
    onSignIn(options);
  };
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
    if (verified && !wasVerified.current) { setOpen(false); setEmailHint(""); identity.current?.focus({ preventScroll: true }); }
    wasVerified.current = verified;
  }, [verified]);
  return <div className="status-reviewer-access" ref={root}>
    {verified ? <span className="reviewer-button" ref={identity} tabIndex={-1}><UserRound aria-hidden="true" /><span>Verified reviewer</span></span> : <>
      <button ref={trigger} className="reviewer-button" type="button" aria-expanded={open} aria-controls="status-access-explanation" onClick={() => open ? close(true) : setOpen(true)}>
        <Eye aria-hidden="true" /><span>View only</span>
      </button>
      {available ? <button className="reviewer-button status-signin-header" type="button" disabled={busy} aria-expanded={open} aria-controls="status-access-explanation" onClick={() => setOpen(true)}><span>{busy ? "Signing in…" : "Review access"}</span></button> : null}
      {busy && !open && !progressDismissed ? <section className="status-access-popover" aria-label="Reviewer sign-in progress">
        <button type="button" className="icon-button subtle" aria-label="Close sign-in progress" onClick={() => close(true)}><X aria-hidden="true" /></button>
        <p role="status" aria-live="polite" aria-atomic="true">{reviewerProgress(stage)}</p>
        <p>{slow ? stage === "google" ? "Complete sign-in in the Google window. Your artwork will stay open here." : "This is taking longer than usual. Your artwork is still available while we finish checking access." : "Your artwork stays open. Review actions remain locked until access is verified."}</p>
      </section> : null}
      {open ? <section className="status-access-popover" id="status-access-explanation" aria-labelledby="status-access-heading">
        <button type="button" className="icon-button subtle" aria-label="Close access explanation" onClick={() => close(true)}><X aria-hidden="true" /></button>
        <h2 id="status-access-heading" ref={heading} tabIndex={-1}>View-only access</h2>
        {busy ? <p role="status" aria-live="polite" aria-atomic="true">{reviewerProgress(stage)}</p> : null}
        <p>{busy ? slow ? "Your artwork is still available. Complete the internal Google sign-in window if it is open; we’ll return you here once access is verified." : "Your artwork stays open. Review actions remain locked until access is verified." : error || "You can view this artwork. Review actions require verified access for this customer."}</p>
        {!busy ? <p>Customer reviewer? Contact your Vornan representative for review access. Email verification isn’t available here yet.</p> : null}
        {available ? <form className="reviewer-signin-form" onSubmit={event => { event.preventDefault(); beginSignIn(); }}>
          {!busy ? <>
            <strong>Internal users only</strong>
            <label htmlFor="reviewer-email-hint">Google account email <span>(optional)</span></label>
            <input id="reviewer-email-hint" type="email" maxLength={254} value={emailHint} onChange={event => setEmailHint(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="reviewer-email-help" />
            <p id="reviewer-email-help">Used only to select your Google account; it does not grant review access.</p>
          </> : null}
          <button className="button secondary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Internal Google sign-in"}</button>
          {!busy ? <button className="reviewer-account-switch" type="button" onClick={() => beginSignIn(true)}>Use a different internal Google account</button> : null}
        </form> : null}
      </section> : null}
    </>}
    <span className="sr-only" role="alert" aria-atomic="true">{error}</span>
  </div>;
}
