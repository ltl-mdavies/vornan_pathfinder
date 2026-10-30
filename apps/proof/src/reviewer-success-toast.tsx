import { useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

/** Only confirmed reviewer identity saves use this transient surface. */
export function ReviewerSuccessToast({ notice, onDismiss }: {
  notice: { title: string; detail: string }; onDismiss: (restoreFocus: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(5000);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => { remaining.current = 5000; }, [notice]);
  useEffect(() => {
    if (hovered || focused) return;
    const started = performance.now();
    const onExpire = dismiss.current;
    const timer = window.setTimeout(() => onExpire(false), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [notice, hovered, focused]);
  return <div className="action-outcome-notice reviewer-success-toast" role="status" aria-live="polite" aria-atomic="true"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    }}>
    <CheckCircle2 aria-hidden="true"/><span><strong>{notice.title}.</strong></span>
    <button type="button" aria-label="Dismiss reviewer update" onClick={event => onDismiss(event.currentTarget === document.activeElement)}><X aria-hidden="true"/></button>
  </div>;
}
