import { useEffect, useRef, useState } from "react";
import { Eye, UserRound, X } from "lucide-react";

export function StatusReviewerAccess({ verified, available, busy, error, onSignIn }: {
  verified: boolean; available: boolean; busy: boolean; error: string | null; onSignIn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const identity = useRef<HTMLSpanElement>(null);
  const wasVerified = useRef(verified);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => { if (error) { setOpen(true); heading.current?.focus({ preventScroll: true }); } }, [error]);
  useEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(true); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => {
    if (verified && !wasVerified.current) { setOpen(false); identity.current?.focus({ preventScroll: true }); }
    wasVerified.current = verified;
  }, [verified]);
  return <div className="status-reviewer-access" ref={root}>
    {verified ? <span className="reviewer-button" ref={identity} tabIndex={-1}><UserRound aria-hidden="true" /><span>Verified reviewer</span></span> : <>
      <button ref={trigger} className="reviewer-button" type="button" aria-expanded={open} aria-controls="status-access-explanation" onClick={() => open ? close(true) : setOpen(true)}>
        <Eye aria-hidden="true" /><span>View only</span>
      </button>
      {available ? <button className="reviewer-button status-signin-header" type="button" disabled={busy} onClick={onSignIn}><span>{busy ? "Verifying reviewer…" : "Sign in to review"}</span></button> : null}
      {open ? <section className="status-access-popover" id="status-access-explanation" aria-labelledby="status-access-heading">
        <button type="button" className="icon-button subtle" aria-label="Close access explanation" onClick={() => close(true)}><X aria-hidden="true" /></button>
        <h2 id="status-access-heading" ref={heading} tabIndex={-1}>View-only access</h2>
        <p>{error || "You can view this order’s artwork. Sign in with an authorized reviewer account to approve or request changes."}</p>
        {available ? <button className="button secondary" type="button" disabled={busy} onClick={onSignIn}>{busy ? "Verifying reviewer…" : error ? "Try another account" : "Sign in to review"}</button> : null}
      </section> : null}
    </>}
    <span className="sr-only" role="alert" aria-atomic="true">{error}</span>
  </div>;
}
