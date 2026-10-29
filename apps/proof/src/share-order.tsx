import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, Link2, PencilLine, Share2, X } from "lucide-react";
import { createSharedProofLink, loadSharedProofLinks, revokeSharedProofLink, shareRecoveryStorageKey, ProofApiError, type SharedProofLink, type ShareLinkRequest } from "./api";
import type { ProofOrder } from "./types";
import "./share-order.css";

const expiry = (value: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
const live = (link: SharedProofLink) => link.status === "active" && Date.parse(link.expires_at) > Date.now();

export function ShareOrder({ order }: { order: ProofOrder }) {
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null);
  const pending = useRef<ShareLinkRequest | null>(null), storageKey = useRef<string | null>(null);
  const inFlight = useRef(false), mounted = useRef(true);
  const listRequest = useRef(0), mutationVersion = useRef(0);
  const [ready, setReady] = useState(false), [recovering, setRecovering] = useState(false);
  const [scope, setScope] = useState<"view" | "review">("view"), [days, setDays] = useState(1), [description, setDescription] = useState("");
  const [links, setLinks] = useState<SharedProofLink[] | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [listError, setListError] = useState("");
  const [created, setCreated] = useState<{ link: SharedProofLink; access_url: string } | null>(null);
  const [copyState, setCopyState] = useState(""), [revokeId, setRevokeId] = useState<string | null>(null);
  const [accessChanged, setAccessChanged] = useState(false), [conflict, setConflict] = useState(false);
  const authority = { expected_order_number: order.order_number, expected_share_context: order.access.sharing_context! };
  const [, tick] = useState(0);
  useEffect(() => {
    mounted.current = true;
    void shareRecoveryStorageKey(order.order_number).then((key) => {
      if (!mounted.current) return;
      storageKey.current = key;
      try {
        const raw = key ? sessionStorage.getItem(key) : null;
        const saved = raw ? JSON.parse(raw) as ShareLinkRequest : null;
        if (saved && saved.expected_order_number === authority.expected_order_number && saved.expected_share_context === authority.expected_share_context && typeof saved.idempotency_key === "string" && (saved.scope === "view" || saved.scope === "review") && [1, 3, 7, 14].includes(saved.days) && typeof saved.description === "string") {
          pending.current = saved; setScope(saved.scope); setDays(saved.days); setDescription(saved.description); setRecovering(true);
        }
      } catch { /* The in-memory request still survives closing/reopening the panel. */ }
    }).catch(() => {}).finally(() => { if (mounted.current) setReady(true); });
    const timer = setInterval(() => tick((value) => value + 1), 30_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [order.order_number]);
  const remember = (request: ShareLinkRequest | null) => {
    pending.current = request; setRecovering(Boolean(request));
    try { if (storageKey.current) request ? sessionStorage.setItem(storageKey.current, JSON.stringify(request)) : sessionStorage.removeItem(storageKey.current); } catch { /* Memory is sufficient for same-panel retries. */ }
  };
  async function refresh() {
    const requestId = ++listRequest.current, version = mutationVersion.current;
    const current = () => mounted.current && requestId === listRequest.current && version === mutationVersion.current;
    setLoading(true); setListError("");
    try {
      const result = await loadSharedProofLinks(authority);
      if (!current()) return false;
      setLinks(result.links);
      setCreated((previous) => {
        const refreshed = result.links.find((link) => link.id === previous?.link.id);
        return previous && refreshed && live(refreshed) ? { ...previous, link: refreshed } : null;
      });
      return true;
    }
    catch (failure) {
      if (current()) {
        if (failure instanceof ProofApiError && (failure.code === "access_changed" || [401, 403].includes(failure.status))) { setAccessChanged(true); setCreated(null); setListError("Your review access changed. Close this panel and refresh the page."); }
        else setListError("Shared links could not be loaded. Try again.");
      }
      return false;
    }
    finally { if (mounted.current && requestId === listRequest.current) setLoading(false); }
  }
  const merge = (link: SharedProofLink) => {
    mutationVersion.current++;
    setLinks((current) => [link, ...(current ?? []).filter((item) => item.id !== link.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)));
  };
  async function create() {
    if (inFlight.current) return;
    if (conflict) {
      if (await refresh()) { remember(null); setConflict(false); setError("A link was already saved. Review Shared links below before creating another."); }
      return;
    }
    inFlight.current = true; mutationVersion.current++; setBusy(true); setError("");
    const request = pending.current ?? { ...authority, idempotency_key: crypto.randomUUID(), scope, days, description: description.trim() };
    remember(request);
    try {
      const result = await createSharedProofLink(request);
      if (!mounted.current) return;
      merge(result.link); setCreated(result); setCopyState(""); setDescription(""); remember(null);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ProofApiError && failure.code === "access_changed") {
        setAccessChanged(true); setCreated(null); setError("Your review changed in another tab. Close this panel and refresh the page.");
      } else if (failure instanceof ProofApiError && failure.code === "request_conflict") {
        setConflict(true); setError("A link was already saved for this request. Check saved links before starting again.");
      } else if (failure instanceof ProofApiError && failure.status === 410) {
        remember(null); setCreated(null); setError("That link is no longer active. You can create a new link."); void refresh();
      } else if (failure instanceof ProofApiError && [400, 401, 403].includes(failure.status)) {
        remember(null); setError("Sharing is not available with these settings. Refresh your review and try again.");
      } else {
        setError("We couldn’t confirm whether the link was created.");
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function revoke(id: string) {
    if (inFlight.current) return;
    inFlight.current = true; mutationVersion.current++; setBusy(true); setError("");
    try {
      const result = await revokeSharedProofLink(id, authority);
      if (!mounted.current) return;
      merge(result.link); if (created?.link.id === id) setCreated(null); setRevokeId(null);
    } catch { if (mounted.current) { setError("Revocation could not be confirmed. Check the list before trying again."); await refresh(); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const closes = () => dialog.current?.close();
  const effectiveExpiry = new Date(Math.min(Date.now() + days * 86_400_000, Date.parse(order.access.sharing_expires_at ?? "") || Infinity)).toISOString();
  return <>
    <button ref={opener} className="button secondary order-share-button" type="button" onClick={() => { dialog.current?.showModal(); void refresh(); }}><Share2 aria-hidden="true" /> Share</button>
    <dialog ref={dialog} className="proof-dialog share-order-dialog" aria-labelledby="share-order-title" onClose={() => { setRevokeId(null); opener.current?.focus({ preventScroll: true }); }}>
      <header className="share-order-heading"><div><h2 id="share-order-title">Share order</h2><p>{order.order_title || order.order_number} <span aria-hidden="true">·</span> {order.order_number}</p></div><button className="icon-button subtle" type="button" aria-label="Close share order" onClick={closes}><X aria-hidden="true" /></button></header>
      <div className="share-order-body">
        <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <fieldset className="share-permissions" disabled={accessChanged || busy || recovering || !ready}><legend>Anyone with this link can</legend><div className="share-permission-options">
            <label className={scope === "view" ? "selected" : ""}><input type="radio" name="share-permission" checked={scope === "view"} onChange={() => setScope("view")} /><Eye aria-hidden="true" /><span><strong>View</strong><small>See proofs and feedback</small></span></label>
            <label className={scope === "review" ? "selected" : ""}><input type="radio" name="share-permission" checked={scope === "review"} disabled={!order.access.sharing_review_enabled} onChange={() => setScope("review")} /><PencilLine aria-hidden="true" /><span><strong>Review &amp; act</strong><small>{order.access.sharing_review_enabled ? "Approve or request changes, where available" : "Not available for this review"}</small></span></label>
          </div></fieldset>
          <label className="share-expiry"><span>Expires</span><select value={days} disabled={accessChanged || busy || recovering} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>24 hours</option><option value={3}>3 days</option><option value={7}>7 days</option><option value={14}>14 days</option></select></label>
          <p className="share-access-note">{recovering ? "A link request is waiting for confirmation. Check status to continue." : `Until ${expiry(effectiveExpiry)}. Shared access cannot outlast your original access.`}</p>
          <label className="share-description"><span>Description <em>Optional</em></span><input maxLength={100} disabled={accessChanged || busy || recovering} value={description} aria-describedby="share-description-note" placeholder="Who is this for?" onChange={(event) => setDescription(event.target.value)} /></label>
          <p id="share-description-note" className="share-access-note">Only visible to people managing this order’s shared links.</p>
          <div className="share-form-actions"><button className="button secondary" type="button" onClick={closes}>Close</button><button className="button primary" disabled={busy || !ready || accessChanged || links === null || (Boolean(listError) && !conflict)} type="submit">{busy ? "Saving…" : conflict ? "Check saved links" : recovering ? "Check status" : "Create link"}</button></div>
        </form>
        {error ? <p className="share-error" role="alert">{error}</p> : null}
        {created && !loading && !listError && live(created.link) ? <div className="share-created" role="status"><strong>Link ready</strong><div><input aria-label="Shared order link" readOnly value={created.access_url} onFocus={(event) => event.target.select()} /><button className="button secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(created.access_url); setCopyState("Copied"); } catch { setCopyState("Select and copy this link."); } }}>{copyState === "Copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copyState === "Copied" ? "Copied" : "Copy"}</button></div><small>{copyState || `Copy this link now. Expires ${expiry(created.link.expires_at)}.`}</small></div> : null}
        <section className="shared-links" aria-labelledby="shared-links-heading"><h3 id="shared-links-heading">Shared links</h3>
          {loading ? <p role="status">Loading links…</p> : null}
          {listError ? <p role="alert">{listError} {!accessChanged ? <button className="button tertiary" type="button" onClick={() => void refresh()}>Try again</button> : null}</p> : null}
          {!loading && !listError && links?.length === 0 ? <p>No shared links yet.</p> : null}
          {links?.map((link) => <div className={`shared-link ${live(link) ? "" : "inactive"}`} key={link.id}><Link2 aria-hidden="true" /><span><strong>{link.description || (link.scope === "view" ? "View" : "Review & act")}</strong><small>{link.scope === "view" ? "View" : "Review & act"} · {link.status === "revoked" ? "Revoked" : live(link) ? `Expires ${expiry(link.expires_at)}` : "Expired"}</small></span>{live(link) ? revokeId === link.id ? <span className="share-revoke-confirm"><span>Revoke this link? Anyone using it will lose access.</span><button className="button secondary" disabled={accessChanged || busy} type="button" onClick={() => setRevokeId(null)}>Keep</button><button className="button secondary" disabled={accessChanged || busy} type="button" onClick={() => void revoke(link.id)}>Revoke</button></span> : <button className="button tertiary" disabled={accessChanged || busy} type="button" onClick={() => setRevokeId(link.id)}>Revoke link</button> : null}</div>)}
          <p className="share-access-note">Anyone with an active link can access this order. Recipients cannot create shared links. Revoking a link stops future access; it cannot recall downloaded files.</p>
        </section>
      </div>
    </dialog>
  </>;
}
