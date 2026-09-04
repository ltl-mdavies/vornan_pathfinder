import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, CheckCircle2, ChevronDown, FileImage, LoaderCircle } from "lucide-react";
import {
  buildCarrierTrackingUrl,
  buildOrderRollupShipmentSummary,
  standardGraphicsRail,
  stepProgressIndex,
  type OrderRollupDestination,
  type OrderRollupHeaderFieldSource,
  type OrderRollupLine,
  type OrderRollupPackage,
  type OrderRollupProof,
  type OrderRollupProofSummary,
  type OrderRollupSourceStatus,
  type OrderRollupShipmentSummary,
  type OrderRollupSnapshot
} from "@pathfinder/order-rollup";

export type OrderRollupAudience = "public" | "internal";

function defaultDisplayDate(value?: string | null) {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function displayDateOnly(value?: string | null) {
  if (!value) {
    return "Not available";
  }
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function shippingDestination(shipping: unknown) {
  const record = asRecord(shipping);
  if (!record) {
    return "Not provided";
  }
  const cityAndState = [textValue(record.city), textValue(record.state)].filter(Boolean).join(", ");
  const locality = [cityAndState, textValue(record.postal_code)].filter(Boolean).join(" ");
  return [textValue(record.company), locality].filter(Boolean).join(" · ") || "Not provided";
}

function dimensions(line: OrderRollupLine) {
  if (line.final_width == null || line.final_height == null) {
    return null;
  }
  return `${line.final_height}”h x ${line.final_width}”w`;
}

function fieldSourceLabel(source?: OrderRollupHeaderFieldSource) {
  return source === "lift" ? "Confirmed by Lift" : source === "submitted" ? "Submitted order" : null;
}

function MetaItem({ label, value, detail }: { label: string; value: ReactNode; detail?: string | null }) {
  return (
    <div className="order-rollup__meta-item">
      <span>{label}</span>
      <strong>{value || "Not available"}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function StepRail({ line }: { line: OrderRollupLine }) {
  if (line.cancelled) {
    return (
      <div className="order-rollup__line-cancelled-note" role="status">
        This line was canceled in Lift. Previous proof and shipment details remain available for reference.
      </div>
    );
  }
  const progressIndex = stepProgressIndex(line.step ?? null);
  return (
    <div className="order-rollup__rail-wrap">
      <div className="order-rollup__current-step">
        <span>Current line step</span>
        <strong>
          {line.step ? `${line.step.step_number}: ${line.step.step_name}` : "Waiting for Lift step information"}
        </strong>
      </div>
      <ol className="order-rollup__rail" aria-label={`Production steps for line ${line.line_number}`}>
        {standardGraphicsRail.map((step, index) => {
          const state = progressIndex < 0 ? "upcoming" : index < progressIndex ? "complete" : index === progressIndex ? "current" : "upcoming";
          return (
            <li className={state} key={step.step_id} aria-current={state === "current" ? "step" : undefined}>
              <span className="order-rollup__rail-dot" aria-hidden="true" />
              <strong>{step.step_number}</strong>
              <small>{step.step_name}</small>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function safeProofAssetUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function inferredImageAsset(url: string | null, filename: string) {
  return Boolean(url && /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(`${url} ${filename}`));
}

function proofAssetKind(url: string | null, filename: string) {
  if (!url) return "unavailable" as const;
  try {
    const declaredKind = new URL(url).searchParams.get("asset_kind");
    if (declaredKind === "pdf" || declaredKind === "image" || declaredKind === "document") {
      return declaredKind;
    }
  } catch {
    // Fall through to the extension-based compatibility behavior.
  }
  if (/\.pdf(?:$|[?#])/i.test(`${filename} ${url}`)) return "pdf" as const;
  if (inferredImageAsset(url, filename)) return "image" as const;
  return "document" as const;
}

function proofStateLabel(proof: OrderRollupProof, creativeContext = false) {
  const approvalStatus = proof.proof_approval_status?.trim().toLowerCase();
  if (creativeContext && approvalStatus) {
    if (approvalStatus === "approved") return "Proof approved";
    if (approvalStatus === "pending" || approvalStatus === "awaiting approval") return "Proof needs approval";
    return `Proof ${approvalStatus}`;
  }
  if (proof.proof_approval_status) return proof.proof_approval_status;
  switch (proof.proof_state) {
    case "revised": return "Regenerating";
    case "approved": return creativeContext ? "Proof approved" : "Reviewed";
    case "reference": return "Reference proof";
    case "waiting": return "Waiting for proof";
    case "cancelled": return "Cancelled";
    case "missing": return "Unavailable";
    case "error": return "File unavailable";
    default: return creativeContext ? "Proof needs approval" : "Awaiting review";
  }
}

function ProofCard({ proof, displayDate, allowAssetLinks, assetsLoading, creativeContext = false }: { proof: OrderRollupProof; displayDate: (value?: string | null) => string; allowAssetLinks: boolean; assetsLoading: boolean; creativeContext?: boolean }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const dialogTitleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const lowResolutionUrl = allowAssetLinks ? safeProofAssetUrl(proof.proof_link_low) : null;
  const highResolutionUrl = allowAssetLinks ? safeProofAssetUrl(proof.proof_link_high) : null;
  const filename = proof.proof_filename ?? (creativeContext ? "Creative file" : "Proof file");
  const assetNoun = creativeContext ? "creative" : "proof";
  const previewUrl = proof.preview_kind === "image" || (!proof.preview_kind && inferredImageAsset(lowResolutionUrl, filename))
    ? lowResolutionUrl
    : null;
  const lightboxUrl = highResolutionUrl ?? previewUrl;
  const lightboxKind = proofAssetKind(lightboxUrl, filename);

  useEffect(() => {
    if (!previewOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [previewOpen]);

  useEffect(() => {
    if (!previewOpen) {
      setPreviewLoaded(false);
      setPreviewFailed(false);
    }
  }, [previewOpen, lightboxUrl]);

  return (
    <>
      <article className={`order-rollup__proof-card proof-state--${proof.proof_state ?? "pending"}`}>
        {previewUrl ? (
          lightboxUrl ? (
            <button className="order-rollup__proof-preview" type="button" onClick={() => setPreviewOpen(true)} aria-label={`Open high-resolution ${assetNoun} ${filename}`}>
              <img src={previewUrl} alt="" loading="lazy" />
            </button>
          ) : (
            <div className="order-rollup__proof-preview">
              <img src={previewUrl} alt="" loading="lazy" />
            </div>
          )
        ) : <div className={`order-rollup__proof-empty${assetsLoading ? " is-loading" : ""}`}>{assetsLoading ? "Loading current artwork…" : "Preview unavailable"}</div>}
        <div className="order-rollup__proof-card-copy">
          <strong className="order-rollup__proof-filename">{filename}</strong>
          <span className="order-rollup__proof-state">{proofStateLabel(proof, creativeContext)}</span>
          {proof.creation_date ? <small>Posted {displayDate(proof.creation_date)}</small> : null}
        </div>
      </article>
      {previewOpen && lightboxUrl ? (
        <div className="order-rollup__lightbox-backdrop" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setPreviewOpen(false);
        }}>
          <section ref={dialogRef} className="order-rollup__lightbox" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
            <header>
              <div>
                <strong id={dialogTitleId}>{filename}</strong>
              </div>
              <div className="order-rollup__lightbox-actions">
                <button ref={closeButtonRef} type="button" onClick={() => setPreviewOpen(false)}>Close</button>
              </div>
            </header>
            <div className={`order-rollup__lightbox-canvas${previewLoaded ? " is-ready" : " is-loading"}${previewFailed ? " is-error" : ""}`}>
              {!previewLoaded ? (
                <div className="order-rollup__lightbox-loading" role="status" aria-live="polite">
                  {previewFailed ? null : <LoaderCircle size={24} strokeWidth={2} aria-hidden="true" />}
                  <strong>{previewFailed ? `${creativeContext ? "Creative" : "Proof"} preview unavailable` : `Loading high-resolution ${assetNoun}…`}</strong>
                  <span>{previewFailed ? "Close this window and try again." : `Large ${assetNoun} files can take a few seconds to display.`}</span>
                </div>
              ) : null}
              {lightboxKind === "image" ? (
                <img
                  src={lightboxUrl}
                  alt={`High-resolution ${assetNoun} ${filename}`}
                  onLoad={() => setPreviewLoaded(true)}
                  onError={() => setPreviewFailed(true)}
                />
              ) : (
                <iframe
                  src={lightboxUrl}
                  title={`High-resolution ${assetNoun} ${filename}`}
                  referrerPolicy="no-referrer"
                  onLoad={() => setPreviewLoaded(true)}
                />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function proofSummaryTitle(summary: OrderRollupProofSummary) {
  if (summary.pending > 0) return "Proof review required";
  if (summary.regenerating > 0) return "Revised proof in progress";
  if (summary.waiting > 0) return "Proofs are being prepared";
  if (summary.total > 0 && summary.reviewed === summary.total) return "Proof packet reviewed";
  if (summary.health === "error" || summary.health === "missing") return "Proof status needs attention";
  return "Proof status available";
}

function ProofSummary({
  summary,
  audience,
  displayDate,
  allowAssetLinks
}: {
  summary: OrderRollupProofSummary;
  audience: OrderRollupAudience;
  displayDate: (value?: string | null) => string;
  allowAssetLinks: boolean;
}) {
  return (
    <aside className={`order-rollup__proof-summary${summary.review_required ? " is-action-required" : ""}`} aria-label="Proof review status">
      <div>
        <span>Vornan Proof</span>
        <strong>{proofSummaryTitle(summary)}</strong>
        <small>{summary.pending} pending · {summary.regenerating} regenerating · {summary.waiting} waiting · {summary.reviewed}/{summary.total} reviewed</small>
      </div>
      <p>
        {audience === "public"
          ? summary.access_mode === "review_link" && summary.review_url
            ? <a href={summary.review_url}>Open secure Vornan Proof review</a>
            : summary.access_mode === "review_link"
              ? "Use the separately issued secure Vornan Proof link to complete the review. This Status page remains view-only."
              : allowAssetLinks
                ? "Proof previews are shown here for reference. This Status page remains view-only."
                : "Proof progress is shown here. Files and review access are not included on this Status page."
          : `Normalized Proof cache synchronized ${displayDate(summary.last_synced_at)}. Decision capability remains separate.`}
      </p>
    </aside>
  );
}

function ProofList({ proofs, displayDate, allowAssetLinks, assetsLoading, creativeContext = false }: { proofs: OrderRollupProof[]; displayDate: (value?: string | null) => string; allowAssetLinks: boolean; assetsLoading: boolean; creativeContext?: boolean }) {
  if (!proofs.length) {
    return <p className="order-rollup__empty">{creativeContext ? "A creative has not been posted for this line yet." : "Proofs have not been posted for this line yet."}</p>;
  }
  return <div className="order-rollup__proofs">{proofs.map((proof, index) => <ProofCard proof={proof} displayDate={displayDate} allowAssetLinks={allowAssetLinks} assetsLoading={assetsLoading} creativeContext={creativeContext} key={`${proof.proof_filename ?? "proof"}-${proof.creation_date ?? index}`} />)}</div>;
}

function PackageList({ packages }: { packages: OrderRollupPackage[] }) {
  if (!packages.length) {
    return <p className="order-rollup__empty">No shipment activity has been recorded for this line.</p>;
  }
  const sortedPackages = [...packages].sort((left, right) => {
    const leftNumber = left.box_number == null ? "" : String(left.box_number).trim();
    const rightNumber = right.box_number == null ? "" : String(right.box_number).trim();
    if (leftNumber && rightNumber) return leftNumber.localeCompare(rightNumber, "en", { numeric: true, sensitivity: "base" });
    if (leftNumber) return -1;
    if (rightNumber) return 1;
    return (left.tracking_number ?? "").localeCompare(right.tracking_number ?? "", "en", { numeric: true, sensitivity: "base" });
  });
  return (
    <div className="order-rollup__packages">
      {sortedPackages.map((pkg, index) => {
        const packageLabel = pkg.box_number != null && pkg.box_number !== ""
          ? `Package ${pkg.box_number}`
          : pkg.package_type ?? `Package ${index + 1}`;
        const trackingUrl = buildCarrierTrackingUrl(pkg.tracking_number, pkg.ship_method);
        const event = trackingEventDetails(pkg.tracker_message);
        const eventSummary = event.location ? `${event.status} in ${event.location}` : event.status;
        return (
          <article className="order-rollup__package-card" key={`${pkg.tracking_number ?? "package"}-${pkg.box_number ?? index}`}>
            <div>
              <strong>{packageLabel}</strong>
              <span>{pkg.tracking_number ? trackingUrl
                ? <a href={trackingUrl} target="_blank" rel="noreferrer">Track {pkg.tracking_number}</a>
                : `Tracking ${pkg.tracking_number}`
                : "Tracking pending"}</span>
            </div>
            <p>{eventSummary}</p>
            <small>{[pkg.package_type, humanizeShipMethod(pkg.ship_method), pkg.location_name].filter(Boolean).join(" · ") || "Shipment details pending"}</small>
          </article>
        );
      })}
    </div>
  );
}

function destinationAddressLines(destination?: OrderRollupDestination | null) {
  if (!destination) return [];
  const locality = [destination.city, destination.state].filter(Boolean).join(", ");
  const localityWithPostal = [locality, destination.postal_code].filter(Boolean).join(" ");
  return [
    destination.company,
    destination.attention_to ? `Attn: ${destination.attention_to}` : null,
    destination.address_1,
    destination.address_2,
    [localityWithPostal, destination.country].filter(Boolean).join(" · ")
  ].filter((line): line is string => Boolean(line));
}

function lineNumberSummary(lineNumbers: number[]) {
  if (!lineNumbers.length) return null;
  if (lineNumbers.length <= 4) return `Line${lineNumbers.length === 1 ? "" : "s"} ${lineNumbers.join(", ")}`;
  return `${lineNumbers.length} order lines`;
}

function shipmentSummaryTitle(summary: OrderRollupShipmentSummary) {
  if (summary.state === "tracking_available") return "Tracking is available";
  if (summary.state === "activity_recorded") return "Package activity recorded";
  return "Shipment updates pending";
}

function humanizeShipMethod(value?: string | null) {
  if (!value) return "Shipping method pending";
  const words = value.replace(/_/g, " ").trim().split(/\s+/).map((word) => {
    const upper = word.toUpperCase();
    if (upper === "FEDEX") return "FedEx";
    if (upper === "UPS" || upper === "USPS") return upper;
    if (upper === "AM") return "A.M.";
    if (upper === "PM") return "P.M.";
    if (upper === "DAY") return "Day";
    return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
  });
  return words.join(" ").replace(/FedEx 2 Day/g, "FedEx 2Day");
}

function trackingEventDetails(message?: string | null) {
  const normalized = message?.trim();
  if (!normalized) {
    return { status: "Tracking activity is available from the carrier.", location: null };
  }
  const delivered = normalized.match(/^Delivered\s*\((\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\)\s+in\s+(.+)$/i);
  if (!delivered) return { status: normalized, location: null };
  const date = new Date(`${delivered[1]} ${delivered[2]}`);
  const deliveredAt = Number.isNaN(date.getTime())
    ? `${delivered[1]} at ${delivered[2]}`
    : `${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    }).format(date)} at ${new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(date)}`;
  return {
    status: `Delivered ${deliveredAt}`,
    location: delivered[3]?.replace(/,\s*(\d{5}(?:-\d{4})?)$/, " $1") ?? null
  };
}

function compareShipmentTrackingByPackage(
  left: OrderRollupShipmentSummary["destinations"][number]["tracking"][number],
  right: OrderRollupShipmentSummary["destinations"][number]["tracking"][number]
) {
  const leftNumbers = [...left.box_numbers].sort((first, second) =>
    first.localeCompare(second, "en", { numeric: true, sensitivity: "base" })
  );
  const rightNumbers = [...right.box_numbers].sort((first, second) =>
    first.localeCompare(second, "en", { numeric: true, sensitivity: "base" })
  );
  const leftNumber = leftNumbers[0] ?? "";
  const rightNumber = rightNumbers[0] ?? "";
  if (leftNumber && rightNumber) {
    return leftNumber.localeCompare(rightNumber, "en", { numeric: true, sensitivity: "base" });
  }
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return left.tracking_number.localeCompare(right.tracking_number, "en", { numeric: true, sensitivity: "base" });
}

function ShipmentSummary({ summary, compact = false }: { summary: OrderRollupShipmentSummary; compact?: boolean }) {
  const context = [
    summary.status_messages[0],
    summary.methods.length ? summary.methods.join(", ") : null,
    summary.locations.length ? summary.locations.join(", ") : null
  ].filter(Boolean).join(" · ");
  if (compact) {
    return (
      <aside className={`order-rollup__shipment-summary order-rollup__shipment-summary--compact shipment-state--${summary.state}`} aria-label="Shipments">
        <div className="order-rollup__shipment-compact-heading">
          <h2>Shipments</h2>
        </div>
        {summary.destinations.length ? (
          <div className="order-rollup__shipment-destinations">
            {summary.destinations.map((group, index) => {
              const addressLines = destinationAddressLines(group.destination);
              const trackedPackageCount = group.tracking.reduce(
                (total, tracking) => total + Math.max(1, tracking.box_numbers.length),
                0
              );
              const pendingTrackingCount = Math.max(0, group.package_count - trackedPackageCount);
              return (
                <section className="order-rollup__shipment-destination" key={`${group.location_name ?? "destination"}-${index}`}>
                  <header>
                    <div>
                      <strong>{addressLines[0] ?? group.location_name ?? "Destination details pending"}</strong>
                    </div>
                    <small>{group.package_count} package{group.package_count === 1 ? "" : "s"}</small>
                  </header>
                  {addressLines.length > 1 ? <address>{addressLines.slice(1).map((line) => <span key={line}>{line}</span>)}</address> : (
                    <p className="order-rollup__shipment-address-pending">The destination address has not been posted yet.</p>
                  )}
                  {group.tracking.length ? (
                    <div className="order-rollup__shipment-tracking-list">
                      {[...group.tracking].sort(compareShipmentTrackingByPackage).map((tracking, trackingIndex) => {
                        const trackingUrl = buildCarrierTrackingUrl(tracking.tracking_number, tracking.ship_method);
                        const event = trackingEventDetails(tracking.tracker_message);
                        const packageName = tracking.box_numbers.length
                          ? `Package ${tracking.box_numbers.join(", ")}`
                          : `Package ${trackingIndex + 1}`;
                        return (
                          <article key={tracking.tracking_number}>
                            <div className="order-rollup__shipment-package-meta">
                              <span>{packageName}</span>
                              <strong>{humanizeShipMethod(tracking.ship_method)}</strong>
                            </div>
                            <strong className="order-rollup__shipment-tracking-number">{trackingUrl
                              ? <a href={trackingUrl} target="_blank" rel="noreferrer">{tracking.tracking_number}<ArrowUpRight aria-hidden="true" /></a>
                              : tracking.tracking_number}</strong>
                            <div className="order-rollup__shipment-event">
                              <CheckCircle2 aria-hidden="true" />
                              <div>
                                <p>{event.status}</p>
                                {event.location ? <small>{event.location}</small> : null}
                                {lineNumberSummary(tracking.line_numbers) ? <small className="order-rollup__shipment-lines">{lineNumberSummary(tracking.line_numbers)}</small> : null}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                      {pendingTrackingCount > 0 ? (
                        <div className="order-rollup__shipment-empty">
                          <strong>{pendingTrackingCount} package{pendingTrackingCount === 1 ? "" : "s"} awaiting tracking</strong>
                          <span>Tracking will appear here when it becomes available.</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="order-rollup__shipment-empty">
                      <strong>{group.package_count} package{group.package_count === 1 ? "" : "s"} being prepared</strong>
                      <span>Tracking will appear here when it becomes available.</span>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="order-rollup__shipment-empty">
            <strong>Shipment updates pending</strong>
            <span>Packages and tracking will appear here when they become available.</span>
          </div>
        )}
        <small className="order-rollup__shipment-auto-update">Shipment details update automatically.</small>
      </aside>
    );
  }
  return (
    <aside className={`order-rollup__shipment-summary${compact ? " order-rollup__shipment-summary--compact" : ""} shipment-state--${summary.state}`} aria-label="Shipment summary">
      <div className="order-rollup__shipment-overview">
        <div>
          <span>Shipping</span>
          <strong>{shipmentSummaryTitle(summary)}</strong>
          {compact ? null : <small>{context || "Lift has not posted package or tracking activity yet."}</small>}
        </div>
        <dl>
          <div><dt>Packages</dt><dd>{summary.package_count}</dd></div>
          <div><dt>Tracking numbers</dt><dd>{summary.tracking_count}</dd></div>
          <div><dt>Destinations</dt><dd>{summary.destinations.length || "—"}</dd></div>
        </dl>
      </div>
      {summary.destinations.length ? (
        <details className="order-rollup__shipment-details" open={!compact}>
          <summary>
            <span>View shipment destinations and tracking</span>
            {compact ? null : <small>{summary.package_count} package{summary.package_count === 1 ? "" : "s"}</small>}
          </summary>
          <div className="order-rollup__shipment-destinations">
            {summary.destinations.map((group, index) => {
              const addressLines = destinationAddressLines(group.destination);
              return (
                <section className="order-rollup__shipment-destination" key={`${group.location_name ?? "destination"}-${index}`}>
                  <header>
                    <div>
                      <span>Destination {summary.destinations.length > 1 ? index + 1 : ""}</span>
                      <strong>{addressLines[0] ?? group.location_name ?? "Destination details pending"}</strong>
                    </div>
                    <small>{group.package_count} package{group.package_count === 1 ? "" : "s"}</small>
                  </header>
                  {addressLines.length > 1 ? <address>{addressLines.slice(1).map((line) => <span key={line}>{line}</span>)}</address> : (
                    <p className="order-rollup__shipment-address-pending">The current Lift status feed has not provided the street address yet.</p>
                  )}
                  <div className="order-rollup__shipment-tracking-list">
                    {[...group.tracking].sort(compareShipmentTrackingByPackage).map((tracking) => {
                      const trackingUrl = buildCarrierTrackingUrl(tracking.tracking_number, tracking.ship_method);
                      return (
                        <article key={tracking.tracking_number}>
                          <div>
                            <strong>{trackingUrl
                              ? <a href={trackingUrl} target="_blank" rel="noreferrer">{tracking.tracking_number}</a>
                              : tracking.tracking_number}</strong>
                            <span>{[tracking.ship_method, tracking.box_numbers.length ? `Package ${tracking.box_numbers.join(", ")}` : null].filter(Boolean).join(" · ")}</span>
                          </div>
                          <p>{tracking.tracker_message ?? "Tracking activity is available from the carrier."}</p>
                          {lineNumberSummary(tracking.line_numbers) ? <small>{lineNumberSummary(tracking.line_numbers)}</small> : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </details>
      ) : null}
    </aside>
  );
}

function sourceUnavailable(status: OrderRollupSourceStatus | undefined) {
  return status?.availability === "unavailable";
}

function sourceHasUsableData(status: OrderRollupSourceStatus | undefined) {
  return status?.availability === "available" || status?.availability === "stale";
}

function SectionAvailabilityNote({
  heading,
  message
}: {
  heading: string;
  message: string;
}) {
  const headingId = useId();
  return (
    <aside className="order-rollup__section-availability" aria-labelledby={headingId}>
      <strong id={headingId}>{heading}</strong>
      <span>{message}</span>
    </aside>
  );
}

function LineProofThumbnail({ line, allowProofAssetLinks }: { line: OrderRollupLine; allowProofAssetLinks: boolean }) {
  const proof = line.proofs[0];
  const filename = proof?.proof_filename ?? "Creative file";
  const latestProofStatus = line.latest_proof_status?.trim().toLowerCase();
  const proofReviewRequired = line.proof_review_required === true
    || latestProofStatus === "pending"
    || latestProofStatus === "awaiting approval"
    || line.proofs.some((candidate) => candidate.proof_state === "pending"
      || ["pending", "awaiting approval"].includes(candidate.proof_approval_status?.trim().toLowerCase() ?? ""));
  const showProofReviewRequired = !line.cancelled && proofReviewRequired;
  const lowResolutionUrl = allowProofAssetLinks ? safeProofAssetUrl(proof?.proof_link_low) : null;
  const previewUrl = proof && (proof.preview_kind === "image" || (!proof.preview_kind && inferredImageAsset(lowResolutionUrl, filename)))
    ? lowResolutionUrl
    : null;

  return (
    <span
      className={`order-rollup__line-thumbnail${showProofReviewRequired ? " needs-approval" : ""}`}
      aria-label={`${proof ? `Latest creative: ${filename}` : "Creative preview not posted"}${showProofReviewRequired ? "; proof approval required" : ""}`}
    >
      <span className="order-rollup__line-thumbnail-frame">
        {previewUrl ? <img src={previewUrl} alt="" loading="lazy" /> : <FileImage aria-hidden="true" />}
      </span>
      {showProofReviewRequired ? <span className="order-rollup__line-proof-notice">Proof needs approval</span> : null}
    </span>
  );
}

function lineStatus(line: OrderRollupLine) {
  if (line.cancelled) return "Canceled";
  return line.step?.order_status ?? line.latest_tracking_message ?? line.latest_proof_status ?? "Status pending";
}

function publicLineKey(line: OrderRollupLine) {
  return `${line.line_number}-${line.order_line_id ?? line.product_id ?? "line"}`;
}

function publicOrderSummary(
  orderStatus: OrderRollupSnapshot["order_status"],
  packageCount: number,
  destinationCount: number
) {
  const stepNumber = Number(orderStatus?.step?.step_number);
  const status = Number.isFinite(stepNumber) && stepNumber >= 18
    ? "Complete"
    : orderStatus?.label ?? "Status pending";
  if (Number.isFinite(stepNumber) && stepNumber >= 15.29 && destinationCount > 0) {
    return `${status} · Shipped to ${destinationCount} destination${destinationCount === 1 ? "" : "s"}.`;
  }
  if (packageCount > 0) {
    return `${status} · ${packageCount} package${packageCount === 1 ? "" : "s"} being prepared.`;
  }
  return `${status} · Shipment updates pending.`;
}

function LineCard({ line, displayDate, showProofs, allowProofAssetLinks, proofAssetsLoading, publicLayout = false, expanded = false, onExpandedChange }: { line: OrderRollupLine; displayDate: (value?: string | null) => string; showProofs: boolean; allowProofAssetLinks: boolean; proofAssetsLoading: boolean; publicLayout?: boolean; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void }) {
  const lineTitle = line.product_name ?? line.description ?? `Order line ${line.line_number}`;
  if (publicLayout) {
    return (
      <details
        className={`order-rollup__line-card order-rollup__line-card--public${line.cancelled ? " is-cancelled" : ""}`}
        open={expanded}
        onToggle={(event) => onExpandedChange?.(event.currentTarget.open)}
      >
        <summary className="order-rollup__line-heading order-rollup__line-heading--public">
          <span className="order-rollup__line-number">{line.line_number}</span>
          <div className="order-rollup__line-title">
            <h3>{lineTitle}</h3>
            <p>{[`Qty ${line.quantity ?? "pending"}`, dimensions(line), line.material].filter(Boolean).join(" · ")}</p>
          </div>
          <LineProofThumbnail line={line} allowProofAssetLinks={allowProofAssetLinks} />
          <div className="order-rollup__line-step-summary">
            <span>{line.cancelled ? "Line status" : "Current step"}</span>
            <strong>{line.cancelled ? "Canceled" : line.step ? `${line.step.step_number} · ${line.step.step_name}` : "Waiting for Lift"}</strong>
          </div>
          <div className="order-rollup__line-counts">
            {showProofs ? <span>{line.proof_count} creative{line.proof_count === 1 ? "" : "s"}</span> : null}
            <span>{line.package_count ? `${line.package_count} package${line.package_count === 1 ? "" : "s"}` : "No shipment yet"}</span>
          </div>
          <span className="order-rollup__status">{lineStatus(line)}</span>
          <ChevronDown className="order-rollup__line-chevron" aria-hidden="true" />
        </summary>
        <div className="order-rollup__line-expanded">
          <StepRail line={line} />
          <div className={`order-rollup__line-activity${showProofs ? "" : " is-shipping-only"}`}>
            {showProofs ? <section>
              <div className="order-rollup__subheading">
                <strong>Creative</strong>
                <span>{line.proof_count}</span>
              </div>
              <ProofList proofs={line.proofs} displayDate={displayDate} allowAssetLinks={allowProofAssetLinks} assetsLoading={proofAssetsLoading} creativeContext />
            </section> : null}
            <section>
              <div className="order-rollup__subheading">
                <strong>Shipping</strong>
                <span>{line.package_count}</span>
              </div>
              <PackageList packages={line.packages} />
            </section>
          </div>
        </div>
      </details>
    );
  }
  return (
    <article className={`order-rollup__line-card${line.cancelled ? " is-cancelled" : ""}`}>
      <div className="order-rollup__line-heading">
        <span className="order-rollup__line-number">{line.line_number}</span>
        <div className="order-rollup__line-title">
          <h3>{lineTitle}</h3>
          <p>{[`Qty ${line.quantity ?? "pending"}`, dimensions(line), line.material].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="order-rollup__status">
          {lineStatus(line)}
        </span>
      </div>
      <StepRail line={line} />
      <div className={`order-rollup__line-activity${showProofs ? "" : " is-shipping-only"}`}>
        {showProofs ? <section>
          <div className="order-rollup__subheading">
            <strong>Proofs</strong>
            <span>{line.proof_count}</span>
          </div>
          <ProofList proofs={line.proofs} displayDate={displayDate} allowAssetLinks={allowProofAssetLinks} assetsLoading={proofAssetsLoading} />
        </section> : null}
        <section>
          <div className="order-rollup__subheading">
            <strong>Shipping</strong>
            <span>{line.package_count}</span>
          </div>
          <PackageList packages={line.packages} />
        </section>
      </div>
    </article>
  );
}

export function OrderRollup({
  snapshot,
  audience = "public",
  displayDate = defaultDisplayDate,
  allowProofAssetLinks = audience === "internal",
  proofAssetsLoading = false
}: {
  snapshot: OrderRollupSnapshot;
  audience?: OrderRollupAudience;
  displayDate?: (value?: string | null) => string;
  allowProofAssetLinks?: boolean;
  proofAssetsLoading?: boolean;
}) {
  const [publicExpandedLines, setPublicExpandedLines] = useState<Set<string>>(() => new Set());
  const liveOrder = snapshot.live_order ?? null;
  const proofVisibility = audience === "internal" ? "review_link" : snapshot.proof_visibility ?? "status_only";
  const showProofs = proofVisibility !== "off";
  const orderStatus = snapshot.order_status ?? liveOrder?.status ?? null;
  const headerDestination = shippingDestination(snapshot.header.shipping);
  const proofCount = snapshot.lines.reduce((total, line) => total + line.proof_count, 0);
  const shipmentSummary = snapshot.shipment_summary ?? buildOrderRollupShipmentSummary(snapshot.lines, snapshot.header.shipping);
  const packageCount = shipmentSummary.package_count;
  const summarizedDestinations = shipmentSummary.destinations.filter((group) => group.destination || group.location_name);
  const destination = headerDestination !== "Not provided"
    ? headerDestination
    : summarizedDestinations.length === 1
      ? shippingDestination(summarizedDestinations[0]?.destination) !== "Not provided"
        ? shippingDestination(summarizedDestinations[0]?.destination)
        : summarizedDestinations[0]?.location_name ?? "Not provided"
      : summarizedDestinations.length > 1
        ? `${summarizedDestinations.length} destinations`
        : "Not provided";
  const title = liveOrder?.order_title ?? snapshot.header.order_title ?? snapshot.order_number;
  const fieldSources = snapshot.header.field_sources;
  const proofStatusUnavailable = sourceUnavailable(snapshot.source_status?.proofs);
  const shipmentSources = [snapshot.source_status?.packages, snapshot.source_status?.shipping];
  const shippingStatusUnavailable = shipmentSources.some(sourceUnavailable)
    && !shipmentSources.some(sourceHasUsableData);
  const displayedIssues = audience === "internal"
    ? snapshot.issues
    : snapshot.issues.filter((issue) => issue.source === "order" && issue.impact === "core_unavailable");
  const allPublicLinesExpanded = snapshot.lines.length > 0
    && snapshot.lines.every((line) => publicExpandedLines.has(publicLineKey(line)));
  const atAGlanceSummary = publicOrderSummary(orderStatus, packageCount, summarizedDestinations.length);

  if (audience === "public") {
    return (
      <section className="order-rollup order-rollup--public">
        {displayedIssues.length ? (
          <div className="order-rollup__issues">
            <strong>Order update</strong>
            <span>Current order status is temporarily unavailable. We’re showing the last confirmed update and will retry automatically.</span>
          </div>
        ) : null}

        <div className="order-rollup__public-workspace">
          <aside className="order-rollup__overview-column" aria-label="Order overview">
            <section className="order-rollup__at-a-glance">
              <h2>At a glance</h2>
              <p className="order-rollup__at-a-glance-summary">{atAGlanceSummary}</p>
              <dl>
                <div><dt>Requested ship</dt><dd>{displayDateOnly(snapshot.header.requested_ship_date)}</dd></div>
                <div><dt>Delivery / due</dt><dd>{displayDateOnly(snapshot.header.due_date)}</dd></div>
                {showProofs ? <div><dt>Creatives</dt><dd>{proofCount}</dd></div> : null}
                <div><dt>Packages</dt><dd>{packageCount}</dd></div>
                <div><dt>Destinations</dt><dd>{summarizedDestinations.length || "—"}</dd></div>
              </dl>
            </section>

            <ShipmentSummary summary={shipmentSummary} compact />

            {shippingStatusUnavailable ? (
              <SectionAvailabilityNote
                heading="Shipping update"
                message="Some shipment details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically."
              />
            ) : null}

            {showProofs && proofStatusUnavailable ? (
              <SectionAvailabilityNote
                heading="Proof update"
                message="Some proof details are temporarily unavailable. We’re showing the last confirmed update and will retry automatically."
              />
            ) : null}
          </aside>

          <div className="order-rollup__lines-column">
            <div className="order-rollup__lines-heading">
              <div>
                <h2>Order lines</h2>
                <p className="order-rollup__lines-count">{snapshot.lines.length} line{snapshot.lines.length === 1 ? "" : "s"}</p>
              </div>
              <div className="order-rollup__lines-heading-actions">
                <span>Line progress may vary.</span>
                <button
                  type="button"
                  onClick={() => setPublicExpandedLines(allPublicLinesExpanded
                    ? new Set()
                    : new Set(snapshot.lines.map(publicLineKey)))}
                >
                  <span>{allPublicLinesExpanded ? "Collapse all" : "Open all"}</span>
                  <ChevronDown className={allPublicLinesExpanded ? "is-expanded" : ""} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="order-rollup__lines">
              {snapshot.lines.map((line) => {
                const key = publicLineKey(line);
                return (
                  <LineCard
                    line={line}
                    displayDate={displayDate}
                    showProofs={showProofs}
                    allowProofAssetLinks={allowProofAssetLinks}
                    proofAssetsLoading={proofAssetsLoading}
                    publicLayout
                    expanded={publicExpandedLines.has(key)}
                    onExpandedChange={(nextExpanded) => setPublicExpandedLines((current) => {
                      const next = new Set(current);
                      if (nextExpanded) next.add(key);
                      else next.delete(key);
                      return next;
                    })}
                    key={key}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`order-rollup order-rollup--${audience}`}>
      <header className="order-rollup__header">
        <div>
          <p className="order-rollup__eyebrow">Order Context</p>
          <h2>{title}</h2>
          <p>{snapshot.customer.source_customer_name}</p>
        </div>
        <div className="order-rollup__header-status">
          <span>Lift order status</span>
          <strong>{orderStatus?.label ?? "Status pending"}</strong>
          {orderStatus?.step ? <small>{`${orderStatus.step.step_number}: ${orderStatus.step.step_name}`}</small> : null}
          <small className="order-rollup__freshness">
            Last checked {displayDate(snapshot.refreshed_at)}
          </small>
        </div>
      </header>

      <div className="order-rollup__meta">
        <MetaItem label="Lift order" value={snapshot.order_number} detail="Confirmed by Lift" />
        <MetaItem label="PO number" value={snapshot.header.po_number ?? "Not provided"} detail={snapshot.header.po_number ? fieldSourceLabel(fieldSources?.po_number) : null} />
        <MetaItem label="Contract number" value={snapshot.header.contract_number ?? "Not provided"} detail={snapshot.header.contract_number ? fieldSourceLabel(fieldSources?.contract_number) : null} />
        <MetaItem label="Order type" value={liveOrder?.order_type ?? "Not available"} detail={liveOrder?.order_type ? "Confirmed by Lift" : null} />
        <MetaItem label="Requested ship" value={displayDateOnly(snapshot.header.requested_ship_date)} detail={snapshot.header.requested_ship_date ? fieldSourceLabel(fieldSources?.requested_ship_date) : null} />
        <MetaItem label="Delivery / due" value={displayDateOnly(snapshot.header.due_date)} detail={snapshot.header.due_date ? fieldSourceLabel(fieldSources?.due_date) : null} />
        <MetaItem label="Actual ship" value={displayDateOnly(snapshot.header.actual_ship_date)} detail={snapshot.header.actual_ship_date ? "Confirmed by Lift" : null} />
        <MetaItem label="Destination" value={destination} detail={destination !== "Not provided" ? fieldSourceLabel(fieldSources?.shipping) : null} />
        <MetaItem label="Activity" value={showProofs ? `${proofCount} proofs · ${packageCount} packages` : `${packageCount} packages`} />
      </div>

      <ShipmentSummary summary={shipmentSummary} />

      {showProofs && snapshot.proof_summary ? (
        <ProofSummary summary={snapshot.proof_summary} audience="internal" displayDate={displayDate} allowAssetLinks={allowProofAssetLinks} />
      ) : null}

      {displayedIssues.length ? (
        <div className="order-rollup__issues" role="status">
          <strong>{displayedIssues.length} data note{displayedIssues.length === 1 ? "" : "s"}</strong>
          <span>{displayedIssues.map((issue) => issue.message).join(" ")}</span>
        </div>
      ) : null}

      <div className="order-rollup__lines-heading">
        <div>
          <p className="order-rollup__eyebrow">Order Lines</p>
          <h2>{snapshot.lines.length} line{snapshot.lines.length === 1 ? "" : "s"}</h2>
        </div>
        <span>Each line progresses independently through Lift.</span>
      </div>

      <div className="order-rollup__lines">
        {snapshot.lines.map((line) => <LineCard line={line} displayDate={displayDate} showProofs={showProofs} allowProofAssetLinks={allowProofAssetLinks} proofAssetsLoading={proofAssetsLoading} key={`${line.line_number}-${line.order_line_id ?? line.product_id ?? "line"}`} />)}
      </div>
    </section>
  );
}

export type { OrderRollupSnapshot } from "@pathfinder/order-rollup";
