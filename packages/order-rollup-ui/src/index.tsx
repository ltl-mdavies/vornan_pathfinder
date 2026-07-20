import React, { type ReactNode } from "react";
import {
  buildOrderRollupShipmentSummary,
  standardGraphicsRail,
  stepProgressIndex,
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
  return `${line.final_width} × ${line.final_height} in`;
}

function productIdentifier(line: OrderRollupLine) {
  if (line.product_id != null && line.product_id !== "") {
    return `Product ID ${line.product_id}`;
  }
  if (line.unit_number) {
    return `Unit ${line.unit_number}`;
  }
  return "Product identifier pending";
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
        <small>{line.step?.order_status ?? "No line status available"}</small>
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

function ProofCard({ proof, displayDate }: { proof: OrderRollupProof; displayDate: (value?: string | null) => string }) {
  const lowResolutionUrl = safeProofAssetUrl(proof.proof_link_low);
  const highResolutionUrl = safeProofAssetUrl(proof.proof_link_high);
  const primaryUrl = lowResolutionUrl ?? highResolutionUrl;
  const filename = proof.proof_filename ?? "Proof file";
  const previewUrl = proof.preview_kind === "image" || (!proof.preview_kind && inferredImageAsset(lowResolutionUrl, filename))
    ? lowResolutionUrl
    : null;
  return (
    <article className={`order-rollup__proof-card proof-state--${proof.proof_state ?? "pending"}`}>
      {previewUrl ? <img src={previewUrl} alt={`Preview of ${filename}`} loading="lazy" /> : <div className="order-rollup__proof-empty">Preview unavailable</div>}
      <div>
        <strong>{filename}</strong>
        <span className="order-rollup__proof-state">{proofStateLabel(proof)}</span>
        {proof.creation_date ? <small>Posted {displayDate(proof.creation_date)}</small> : null}
        <div className="order-rollup__links">
          {primaryUrl ? <a href={primaryUrl} target="_blank" rel="noreferrer">{lowResolutionUrl ? "View proof" : "Open proof"}</a> : null}
          {highResolutionUrl && highResolutionUrl !== primaryUrl ? <a href={highResolutionUrl} target="_blank" rel="noreferrer">High resolution</a> : null}
        </div>
      </div>
    </article>
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
  displayDate
}: {
  summary: OrderRollupProofSummary;
  audience: OrderRollupAudience;
  displayDate: (value?: string | null) => string;
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
          ? summary.review_required
            ? "Use the dedicated Vornan Proof email to complete the review. This order-status link remains view-only."
            : "This order-status link is view-only and does not authorize proof decisions."
          : `Normalized Proof cache synchronized ${displayDate(summary.last_synced_at)}. Decision capability remains separate.`}
      </p>
    </aside>
  );
}

function ProofList({ proofs, displayDate }: { proofs: OrderRollupProof[]; displayDate: (value?: string | null) => string }) {
  if (!proofs.length) {
    return <p className="order-rollup__empty">Proofs have not been posted for this line yet.</p>;
  }
  return <div className="order-rollup__proofs">{proofs.map((proof, index) => <ProofCard proof={proof} displayDate={displayDate} key={`${proof.proof_filename ?? "proof"}-${proof.creation_date ?? index}`} />)}</div>;
}

function PackageList({ packages }: { packages: OrderRollupPackage[] }) {
  if (!packages.length) {
    return <p className="order-rollup__empty">No shipment activity has been recorded for this line.</p>;
  }
  return (
    <div className="order-rollup__packages">
      {packages.map((pkg, index) => {
        const packageLabel = pkg.box_number != null && pkg.box_number !== ""
          ? `Package ${pkg.box_number}`
          : pkg.package_type ?? `Package ${index + 1}`;
        return (
          <article className="order-rollup__package-card" key={`${pkg.tracking_number ?? "package"}-${pkg.box_number ?? index}`}>
            <div>
              <strong>{packageLabel}</strong>
              <span>{pkg.tracking_number ? `Tracking ${pkg.tracking_number}` : "Tracking pending"}</span>
            </div>
            <p>{pkg.tracker_message ?? "Package activity recorded"}</p>
            <small>{[pkg.package_type, pkg.ship_method, pkg.location_name].filter(Boolean).join(" · ") || "Shipment details pending"}</small>
          </article>
        );
      })}
    </div>
  );
}

function shipmentSummaryTitle(summary: OrderRollupShipmentSummary) {
  if (summary.state === "tracking_available") return "Tracking is available";
  if (summary.state === "activity_recorded") return "Package activity recorded";
  return "Shipment updates pending";
}

function ShipmentSummary({ summary }: { summary: OrderRollupShipmentSummary }) {
  const context = [
    summary.status_messages[0],
    summary.methods.length ? summary.methods.join(", ") : null,
    summary.locations.length ? summary.locations.join(", ") : null
  ].filter(Boolean).join(" · ");
  return (
    <aside className={`order-rollup__shipment-summary shipment-state--${summary.state}`} aria-label="Shipment summary">
      <div>
        <span>Shipping</span>
        <strong>{shipmentSummaryTitle(summary)}</strong>
        <small>{context || "Lift has not posted package or tracking activity yet."}</small>
      </div>
      <dl>
        <div><dt>Packages</dt><dd>{summary.package_count}</dd></div>
        <div><dt>Tracking numbers</dt><dd>{summary.tracking_count}</dd></div>
        <div><dt>Ship methods</dt><dd>{summary.methods.length || "—"}</dd></div>
      </dl>
    </aside>
  );
}

function LineCard({ line, displayDate }: { line: OrderRollupLine; displayDate: (value?: string | null) => string }) {
  const lineTitle = line.product_name ?? line.description ?? `Order line ${line.line_number}`;
  return (
    <article className="order-rollup__line-card">
      <div className="order-rollup__line-heading">
        <span className="order-rollup__line-number">{line.line_number}</span>
        <div className="order-rollup__line-title">
          <h3>{lineTitle}</h3>
          <p>{[productIdentifier(line), `Qty ${line.quantity ?? "pending"}`, dimensions(line), line.material].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="order-rollup__status">
          {line.step?.order_status ?? line.latest_tracking_message ?? line.latest_proof_status ?? "Status pending"}
        </span>
      </div>
      <StepRail line={line} />
      <div className="order-rollup__line-activity">
        <section>
          <div className="order-rollup__subheading">
            <strong>Proofs</strong>
            <span>{line.proof_count}</span>
          </div>
          <ProofList proofs={line.proofs} displayDate={displayDate} />
        </section>
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
  displayDate = defaultDisplayDate
}: {
  snapshot: OrderRollupSnapshot;
  audience?: OrderRollupAudience;
  displayDate?: (value?: string | null) => string;
}) {
  const liveOrder = snapshot.live_order ?? null;
  const orderStatus = snapshot.order_status ?? liveOrder?.status ?? null;
  const destination = shippingDestination(snapshot.header.shipping);
  const proofCount = snapshot.lines.reduce((total, line) => total + line.proof_count, 0);
  const packageCount = snapshot.lines.reduce((total, line) => total + line.package_count, 0);
  const shipmentSummary = snapshot.shipment_summary ?? buildOrderRollupShipmentSummary(snapshot.lines);
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
        <MetaItem label="Activity" value={`${proofCount} proofs · ${packageCount} packages`} />
      </div>

      <ShipmentSummary summary={shipmentSummary} />

      {snapshot.proof_summary ? (
        <ProofSummary summary={snapshot.proof_summary} audience={audience} displayDate={displayDate} />
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
        {snapshot.lines.map((line) => <LineCard line={line} displayDate={displayDate} key={`${line.line_number}-${line.order_line_id ?? line.product_id ?? "line"}`} />)}
      </div>
    </section>
  );
}

export type { OrderRollupSnapshot } from "@pathfinder/order-rollup";
