import type { OrderRollupProofSummary, OrderRollupProofVisibility } from "@pathfinder/order-rollup";

/** Only consume a backend-issued Proof destination. Never construct a grant from Status access. */
export function safeProofReviewUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://proof.vornan.co" && !url.username && !url.password
      && url.pathname === "/" && !url.search
      && (/^#\/access\/[A-Za-z0-9_-]+$/.test(url.hash) || /^#\/status\/A\d{7}$/.test(url.hash) || url.hash === "#/proof")
      ? url.toString() : null;
  } catch { return null; }
}

export function proofReviewEntry(summary: OrderRollupProofSummary | null | undefined,
  visibility: OrderRollupProofVisibility | undefined, cancelled: boolean, checking: boolean) {
  if (cancelled || visibility === "off" || !summary?.review_required) return null;
  if (!Number.isInteger(summary.pending) || summary.pending <= 0) return null;
  const fresh = !checking && summary.health === "active";
  const eligible = visibility === "review_link" && summary.access_mode === "review_link";
  return {
    pending: summary.pending,
    checking: !fresh,
    reviewUrl: fresh && eligible ? safeProofReviewUrl(summary.review_url) : null
  };
}
