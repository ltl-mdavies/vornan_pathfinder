import React, { useState } from "react";
import type { OrderRollupProofSummary, OrderRollupProofVisibility } from "@pathfinder/order-rollup";
import { proofReviewEntry } from "./proof-review-entry";

export function ProofReviewNotice({ summary, visibility, cancelled, checking, previewAction, requestView }: {
  summary?: OrderRollupProofSummary | null;
  visibility?: OrderRollupProofVisibility;
  cancelled: boolean;
  checking: boolean;
  /** Local design fixture only. Never supplied by the live Status route. */
  previewAction?: () => void;
  requestView?: () => Promise<void>;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const entry = proofReviewEntry(summary, visibility, cancelled, checking);
  if (!entry) return null;
  const canPreview = Boolean(previewAction && !entry.checking && visibility === "review_link" && summary?.access_mode === "review_link");
  return <aside className="proof-review-notice" aria-label="Proof review" aria-live="polite">
    <div>
      <strong>{entry.checking ? checking ? "Checking proof status" : "Proof status needs an update" : `${entry.pending} proof${entry.pending === 1 ? " needs" : "s need"} review`}</strong>
      <span>{entry.checking ? checking ? "Confirming the latest artwork and review availability…" : "Latest review availability could not be confirmed. Please check again shortly."
        : entry.reviewUrl || canPreview ? "View the current artwork in Vornan Proof. Approval requires authorized reviewer access."
        : "Review access isn’t available from this status page yet."}</span>
    </div>
    {error ? <span role="alert">{error}</span> : null}
    {entry.reviewUrl && requestView ? <button type="button" disabled={opening} aria-label="Review proofs (opens in a new tab)" title="Opens view-only Proof in a new tab" onClick={async () => {
      if (opening) return;
      setOpening(true); setError("");
      try { await requestView(); } catch { setError("Proof could not be opened. Please try again shortly."); }
      finally { setOpening(false); }
    }}>{opening ? "Opening Proof…" : "Review proofs"}</button>
      : entry.reviewUrl ? <a href={entry.reviewUrl} target="_blank" rel="noopener noreferrer">Review proofs <small>(new tab)</small></a>
      : canPreview ? <button type="button" onClick={previewAction}>Review proofs</button> : null}
  </aside>;
}
