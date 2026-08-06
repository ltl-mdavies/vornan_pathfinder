import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, ZoomIn } from "lucide-react";
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

function proofStateLabel(proof: OrderRollupProof) {
  if (proof.proof_approval_status) return proof.proof_approval_status;
  switch (proof.proof_state) {
    case "revised": return "Regenerating";
    case "approved": return "Reviewed";
    case "reference": return "Reference proof";
    case "waiting": return "Waiting for proof";
    case "cancelled": return "Cancelled";
    case "missing": return "Unavailable";
    case "error": return "File unavailable";
    default: return "Awaiting review";
  }
}

function ProofCard({ proof, displayDate, allowAssetLinks, assetsLoading }: { proof: OrderRollupProof; displayDate: (value?: string | null) => string; allowAssetLinks: boolean; assetsLoading: boolean }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const dialogTitleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const lowResolutionUrl = allowAssetLinks ? safeProofAssetUrl(proof.proof_link_low) : null;
  const highResolutionUrl = allowAssetLinks ? safeProofAssetUrl(proof.proof_link_high) : null;
  const filename = proof.proof_filename ?? "Proof file";
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
            <button className="order-rollup__proof-preview" type="button" onClick={() => setPreviewOpen(true)} aria-label={`Open high-resolution proof ${filename}`}>
              <img src={previewUrl} alt="" loading="lazy" />
              <span aria-hidden="true"><ZoomIn size={17} strokeWidth={2.15} /></span>
            </button>
          ) : (
            <div className="order-rollup__proof-preview">
              <img src={previewUrl} alt="" loading="lazy" />
            </div>
          )
        ) : <div className={`order-rollup__proof-empty${assetsLoading ? " is-loading" : ""}`}>{assetsLoading ? "Loading current artwork…" : "Preview unavailable"}</div>}
        <div className="order-rollup__proof-card-copy">
          <strong className="order-rollup__proof-filename">{filename}</strong>
          <span className="order-rollup__proof-state">{proofStateLabel(proof)}</span>
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
                  <strong>{previewFailed ? "Proof preview unavailable" : "Loading high-resolution proof…"}</strong>
                  <span>{previewFailed ? "Close this window and try again." : "Large proof files can take a few seconds to display."}</span>
                </div>
              ) : null}
              {lightboxKind === "image" ? (
                <img
                  src={lightboxUrl}
                  alt={`High-resolution proof ${filename}`}
                  onLoad={() => setPreviewLoaded(true)}
                  onError={() => setPreviewFailed(true)}
                />
              ) : (
                <iframe
                  src={lightboxUrl}
                  title={`High-resolution proof ${filename}`}
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

function ProofList({ proofs, displayDate, allowAssetLinks, assetsLoading }: { proofs: OrderRollupProof[]; displayDate: (value?: string | null) => string; allowAssetLinks: boolean; assetsLoading: boolean }) {
  if (!proofs.length) {
    return <p className="order-rollup__empty">Proofs have not been posted for this line yet.</p>;
  }
  return <div className="order-rollup__proofs">{proofs.map((proof, index) => <ProofCard proof={proof} displayDate={displayDate} allowAssetLinks={allowAssetLinks} assetsLoading={assetsLoading} key={`${proof.proof_filename ?? "proof"}-${proof.creation_date ?? index}`} />)}</div>;
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
        return (
          <article className="order-rollup__package-card" key={`${pkg.tracking_number ?? "package"}-${pkg.box_number ?? index}`}>
            <div>
              <strong>{packageLabel}</strong>
              <span>{pkg.tracking_number ? trackingUrl
                ? <a href={trackingUrl} target="_blank" rel="noreferrer">Track {pkg.tracking_number}</a>
                : `Tracking ${pkg.tracking_number}`
                : "Tracking pending"}</span>
            </div>
            <p>{pkg.tracker_message ?? "Package activity recorded"}</p>
            <small>{[pkg.package_type, pkg.ship_method, pkg.location_name].filter(Boolean).join(" · ") || "Shipment details pending"}</small>
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

function ShipmentSummary({ summary }: { summary: OrderRollupShipmentSummary }) {
  const context = [
    summary.status_messages[0],
    summary.methods.length ? summary.methods.join(", ") : null,
    summary.locations.length ? summary.locations.join(", ") : null
  ].filter(Boolean).join(" · ");
  return (
    <aside className={`order-rollup__shipment-summary shipment-state--${summary.state}`} aria-label="Shipment summary">
      <div className="order-rollup__shipment-overview">
        <div>
          <span>Shipping</span>
          <strong>{shipmentSummaryTitle(summary)}</strong>
          <small>{context || "Lift has not posted package or tracking activity yet."}</small>
        </div>
        <dl>
          <div><dt>Packages</dt><dd>{summary.package_count}</dd></div>
          <div><dt>Tracking numbers</dt><dd>{summary.tracking_count}</dd></div>
          <div><dt>Destinations</dt><dd>{summary.destinations.length || "—"}</dd></div>
        </dl>
      </div>
      {summary.destinations.length ? (
        <details className="order-rollup__shipment-details" open>
          <summary>
            <span>View shipment destinations and tracking</span>
            <small>{summary.package_count} package{summary.package_count === 1 ? "" : "s"} grouped without duplicates</small>
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

function LineCard({ line, displayDate, showProofs, allowProofAssetLinks, proofAssetsLoading }: { line: OrderRollupLine; displayDate: (value?: string | null) => string; showProofs: boolean; allowProofAssetLinks: boolean; proofAssetsLoading: boolean }) {
  const lineTitle = line.product_name ?? line.description ?? `Order line ${line.line_number}`;
  return (
    <article className="order-rollup__line-card">
      <div className="order-rollup__line-heading">
        <span className="order-rollup__line-number">{line.line_number}</span>
        <div className="order-rollup__line-title">
          <h3>{lineTitle}</h3>
          <p>{[`Qty ${line.quantity ?? "pending"}`, dimensions(line), line.material].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="order-rollup__status">
          {line.step?.order_status ?? line.latest_tracking_message ?? line.latest_proof_status ?? "Status pending"}
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

  return (
    <section className={`order-rollup order-rollup--${audience}`}>
      <header className="order-rollup__header">
        <div>
          <p className="order-rollup__eyebrow">Order Context</p>
          <h2>{title}</h2>
          <p>{snapshot.customer.source_customer_name}{destination !== "Not provided" ? ` · ${destination}` : ""}</p>
        </div>
        <div className="order-rollup__header-status">
          <span>Lift order status</span>
          <strong>{orderStatus?.label ?? "Status pending"}</strong>
          {orderStatus?.step ? <small>{`${orderStatus.step.step_number}: ${orderStatus.step.step_name}`}</small> : null}
          <small className="order-rollup__freshness">
            {audience === "internal" ? "Last checked" : "Snapshot captured"} {displayDate(snapshot.refreshed_at)}
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
        <ProofSummary summary={snapshot.proof_summary} audience={audience} displayDate={displayDate} allowAssetLinks={allowProofAssetLinks} />
      ) : null}

      {snapshot.issues.length ? (
        <div className="order-rollup__issues" role="status">
          <strong>{snapshot.issues.length} data note{snapshot.issues.length === 1 ? "" : "s"}</strong>
          <span>{snapshot.issues.map((issue) => issue.message).join(" ")}</span>
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
