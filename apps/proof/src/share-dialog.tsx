import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Eye, Link2, PencilLine, X } from "lucide-react";
import { createSharedLink, loadSharedLinks, ProofApiError, revokeSharedLink } from "./api";
import type { ProofSharedLink } from "./types";

type ShareScope = "view" | "review";
type ExpiryHours = 24 | 72 | 168 | 336;

const EXPIRIES: Array<{ hours: ExpiryHours; label: string }> = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" }
];

function formatExpiry(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date)
    : "the selected date";
}

async function copyLink(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function ShareDialog({
  open,
  orderTitle,
  reviewAvailable,
  onClose
}: {
  open: boolean;
  orderTitle: string;
  reviewAvailable: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState<ShareScope>("view");
  const [expiry, setExpiry] = useState<ExpiryHours>(168);
  const [shares, setShares] = useState<ProofSharedLink[]>([]);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);

  const refreshShares = async () => {
    setLoading(true);
    try {
      const result = await loadSharedLinks();
      setShares(result.shares);
    } catch (cause) {
      if (cause instanceof ProofApiError && cause.status === 401) return;
      setError(cause instanceof Error ? cause.message : "Shared links could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !dialog.current || dialog.current.open) return;
    setError(null);
    setAccessUrl(null);
    setCopyState("idle");
    dialog.current.showModal();
    window.requestAnimationFrame(() => closeButton.current?.focus({ preventScroll: true }));
    void refreshShares();
  }, [open]);

  const create = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createSharedLink({ scope, expires_in_hours: expiry });
      setAccessUrl(result.access_url);
      setShares((current) => [result.share, ...current]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shared link could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (grantId: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await revokeSharedLink(grantId);
      setShares((current) => current.map((share) => share.grant_id === grantId ? { ...share, status: "revoked" } : share));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shared link could not be turned off.");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!accessUrl) return;
    try {
      await copyLink(accessUrl);
      setCopyState("copied");
    } catch {
      setError("Copy the link from the field below.");
    }
  };

  return (
    <dialog
      ref={dialog}
      className="proof-dialog share-dialog"
      aria-labelledby="share-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        dialog.current?.close();
      }}
      onClose={onClose}
    >
      <div className="dialog-heading share-dialog-heading">
        <div>
          <span className="eyebrow">{orderTitle}</span>
          <h2 id="share-dialog-title">Share proof</h2>
        </div>
        <button ref={closeButton} className="icon-button subtle" type="button" aria-label="Close share proof" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>
      </div>
      <div className="dialog-content share-dialog-content">
        {accessUrl ? (
          <section className="share-link-ready" aria-live="polite">
            <div className="share-ready-icon"><CheckCircle2 aria-hidden="true" /></div>
            <h3>Link ready</h3>
            <p>Anyone with this link can {scope === "review" ? "review and act" : "view"} until {formatExpiry(shares[0]?.expires_at ?? "")}.</p>
            <div className="share-link-field">
              <input aria-label="Shared Proof link" value={accessUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
              <button className="button secondary" type="button" onClick={() => void copy()}><Copy aria-hidden="true" />{copyState === "copied" ? "Copied" : "Copy"}</button>
            </div>
            <p className="share-link-note">Keep this link with the reviewer. It can be turned off here at any time.</p>
            <div className="share-dialog-actions">
              <button className="button secondary" type="button" onClick={() => { setAccessUrl(null); setCopyState("idle"); }}>Create another</button>
              <button className="button primary" type="button" onClick={() => dialog.current?.close()}>Done</button>
            </div>
          </section>
        ) : (
          <>
            <section className="share-access-choice" aria-labelledby="share-access-title">
              <span id="share-access-title">Anyone with this link can</span>
              <div className="share-access-options" role="radiogroup" aria-label="Shared link access">
                <button className={scope === "view" ? "selected" : ""} type="button" role="radio" aria-checked={scope === "view"} onClick={() => setScope("view")}>
                  <Eye aria-hidden="true" /><strong>View</strong><small>See proofs and feedback</small>
                </button>
                {reviewAvailable ? <button className={scope === "review" ? "selected" : ""} type="button" role="radio" aria-checked={scope === "review"} onClick={() => setScope("review")}>
                  <PencilLine aria-hidden="true" /><strong>Review &amp; act</strong><small>Approve, request changes, or submit revised artwork</small>
                </button> : null}
              </div>
            </section>
            <label className="share-expiry">
              <span>Expires</span>
              <select value={expiry} onChange={(event) => setExpiry(Number(event.target.value) as ExpiryHours)}>
                {EXPIRIES.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}
              </select>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="share-dialog-actions">
              <button className="button secondary" type="button" onClick={() => dialog.current?.close()}>Cancel</button>
              <button className="button primary" type="button" disabled={saving} onClick={() => void create()}>{saving ? "Creating…" : "Create link"}</button>
            </div>
          </>
        )}

        {!accessUrl && (loading || shares.length > 0) ? (
          <section className="shared-link-list" aria-label="Shared links">
            <h3>Shared links</h3>
            {loading ? <p>Checking shared links…</p> : shares.map((share) => (
              <article key={share.grant_id} className={share.status === "active" ? "active" : "inactive"}>
                <span><Link2 aria-hidden="true" /></span>
                <div><strong>{share.scope === "review" ? "Review & act" : "View"}</strong><small>{share.status === "active" ? `Expires ${formatExpiry(share.expires_at)}` : "Turned off"}</small></div>
                {share.status === "active" ? <button className="share-link-revoke" type="button" disabled={saving} onClick={() => void revoke(share.grant_id)}>Turn off</button> : null}
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </dialog>
  );
}
