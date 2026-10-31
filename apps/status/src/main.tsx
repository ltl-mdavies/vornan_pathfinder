import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  LiftStepDefinition,
  NormalizedLiftOrder,
  OrderRollupDestination,
  OrderRollupHeaderFieldSource,
  OrderRollupProofSummary,
  OrderRollupProofVisibility,
  OrderRollupSourceStatus,
  OrderRollupShipmentSummary
} from "@pathfinder/order-rollup";
import { OrderRollup } from "@pathfinder/order-rollup-ui";
import { proofReviewProgress } from "./proof-state";
import { ProofReviewNotice } from "./ProofReviewNotice";
import { CustomerIntake } from "./intake";
import {
  proxyHighResolutionProofAssets,
  publicStatusOpenErrorMessage,
  publicStatusPollDelay,
  retainTransientProofAssets,
  shouldPollPublicStatus
} from "./live-refresh";
import "./styles.css";
import "@pathfinder/order-rollup-ui/styles.css";
import "../../../packages/ui/src/vornan-foundation.css";

const apiBaseUrl =
  import.meta.env.VITE_STATUS_API_BASE_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  "https://api.pathfinder.vornan.co";

type LookupStatus = {
  ok: boolean;
  http_status: number;
  fetched_at: string;
};

type StatusIssue = {
  source: string;
  severity: "warning" | "error";
  message: string;
  reason_code?: OrderRollupSourceStatus["reason_code"];
  impact?: OrderRollupSourceStatus["impact"];
  checked_at?: string;
  last_success_at?: string | null;
};

type StatusProof = {
  proof_filename?: string | null;
  proof_approval_status?: string | null;
  proof_link_low?: string | null;
  proof_link_high?: string | null;
  created_ts?: string | null;
  creation_date?: string | null;
  proof_approved_ts?: string | null;
  preview_kind?: "image" | "pdf" | "download" | "unavailable";
  proof_state?: "waiting" | "pending" | "revised" | "approved" | "reference" | "cancelled" | "missing" | "error";
};

type StatusPackage = {
  tracking_number?: string | null;
  ship_method?: string | null;
  tracker_message?: string | null;
  box_number?: string | number | null;
  package_type?: string | null;
  location_name?: string | null;
  destination?: OrderRollupDestination | null;
};

type StatusLine = {
  line_number: number;
  product_name?: string | null;
  description?: string | null;
  quantity: number | null;
  unit_number?: string | null;
  product_id?: string | number | null;
  material?: string | null;
  final_height?: number | null;
  final_width?: number | null;
  step?: LiftStepDefinition | null;
  cancelled?: boolean;
  proof_count: number;
  proof_review_required?: boolean;
  package_count: number;
  latest_proof_status: string | null;
  latest_tracking_message: string | null;
  proofs: StatusProof[];
  packages: StatusPackage[];
};

type PublicOrderStatusSnapshot = {
  snapshot_id: string;
  order_key: string;
  order_number: string;
  source_order_id: string;
  customer: {
    source_customer_name: string;
    submit_customer_name: string;
  };
  job: {
    job_id: string;
    state: string;
    import_method_name: string;
    source_file_name: string;
    created_at: string;
    updated_at: string;
    order_confirmed_at?: string | null;
  };
  route: {
    name: string;
    target: string;
    template: string;
  };
  header: {
    ext_id: string;
    po_number?: string | null;
    contract_number?: string | null;
    order_title?: string | null;
    requested_ship_date?: string | null;
    due_date?: string | null;
    actual_ship_date?: string | null;
    shipping?: OrderRollupDestination | null;
    field_sources?: {
      po_number?: OrderRollupHeaderFieldSource;
      contract_number?: OrderRollupHeaderFieldSource;
      order_title?: OrderRollupHeaderFieldSource;
      requested_ship_date?: OrderRollupHeaderFieldSource;
      due_date?: OrderRollupHeaderFieldSource;
      actual_ship_date?: OrderRollupHeaderFieldSource;
      shipping?: OrderRollupHeaderFieldSource;
    };
  };
  live_order?: NormalizedLiftOrder | null;
  order_status?: NormalizedLiftOrder["status"];
  lifecycle?: {
    state: "active" | "cancelled";
    cancellation_source?: "orders_report" | "order_lines" | null;
    observed_at?: string | null;
  };
  proof_summary?: OrderRollupProofSummary | null;
  proof_visibility: OrderRollupProofVisibility;
  proofing_enabled?: boolean;
  shipment_summary?: OrderRollupShipmentSummary | null;
  lines: StatusLine[];
  lookups: {
    order: LookupStatus | null;
    proofs: LookupStatus | null;
    packages: (LookupStatus & { redacted_fields?: string[] }) | null;
    shipping?: LookupStatus | null;
  };
  source_status?: Partial<Record<OrderRollupSourceStatus["source"], OrderRollupSourceStatus>>;
  issues: StatusIssue[];
  visibility_policy: {
    audience: string;
    redacted_fields: string[];
    token_required: boolean;
    proof_visibility: OrderRollupProofVisibility;
  };
  refreshed_at: string;
};

type PublicStatusResponse = {
  snapshot: PublicOrderStatusSnapshot;
  snapshots?: PublicOrderStatusSnapshot[];
  refresh?: {
    status: "live" | "degraded";
    checked_at: string;
    next_refresh_at: string;
    poll_after_seconds: number;
  };
  link: {
    status: string;
    expires_at: string;
    order_count?: number;
  };
};

type PublicStatusRefreshState = "live" | "checking" | "degraded";

type StatusRequestResponse = {
  status: string;
  message: string;
  debug_status_url?: string;
};

type StatusEmailCapability = {
  available: boolean;
  order_identifier: string;
  contact_email: string;
  message: string;
};

type PublicStatusErrorResponse = {
  error?: string;
  order_numbers?: string[];
};

function tokenFromLocation() {
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get("token");
  const pathToken = url.pathname
    .split("/")
    .filter(Boolean)
    .find((part) => !["status", "order"].includes(part.toLowerCase()));
  return queryToken ?? pathToken ?? "";
}

function intakeKeyFromLocation() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() !== "intake" || !parts[1]) {
    return "";
  }
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return "";
  }
}

function displayDate(value?: string | null) {
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
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function displayMilestoneDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function statusLabel(snapshot: PublicOrderStatusSnapshot) {
  if (snapshot.lifecycle?.state === "cancelled") {
    return "Canceled";
  }
  if (snapshot.order_status?.label ?? snapshot.live_order?.status?.label) {
    return snapshot.order_status?.label ?? snapshot.live_order?.status?.label ?? "Received";
  }
  if (snapshot.issues.some((issue) => issue.severity === "error")) {
    return "Needs attention";
  }
  if (snapshot.lines.some((line) => line.latest_tracking_message || line.package_count > 0)) {
    return "In motion";
  }
  if (snapshot.lines.some((line) => line.latest_proof_status || line.proof_count > 0)) {
    return "Proofs available";
  }
  return "Received";
}

function countProofs(snapshot: PublicOrderStatusSnapshot) {
  return snapshot.lines.reduce((total, line) => total + line.proof_count, 0);
}

function countPackages(snapshot: PublicOrderStatusSnapshot) {
  return snapshot.lines.reduce((total, line) => total + line.package_count, 0);
}

function countApprovedProofs(snapshot: PublicOrderStatusSnapshot) {
  return snapshot.lines.reduce(
    (total, line) => total + line.proofs.filter(
      (proof) => proof.proof_approval_status?.trim().toLowerCase() === "approved"
    ).length,
    0
  );
}

function progressSteps(snapshot: PublicOrderStatusSnapshot) {
  const proofs = countProofs(snapshot);
  const approvedProofs = countApprovedProofs(snapshot);
  const packages = countPackages(snapshot);
  const trackingCount = snapshot.shipment_summary?.tracking_count
    ?? new Set(snapshot.lines.flatMap((line) => line.packages).map((pkg) => pkg.tracking_number).filter(Boolean)).size;
  const hasError = snapshot.issues.some((issue) => issue.severity === "error");
  const headerStepNumber = Number(snapshot.order_status?.step?.step_number ?? snapshot.live_order?.status?.step?.step_number);
  const hasHeaderStep = Number.isFinite(headerStepNumber);
  const proofPhase = hasHeaderStep && headerStepNumber < 10;
  const productionPhase = hasHeaderStep && headerStepNumber >= 10 && headerStepNumber < 15.29;
  const shippingPhase = hasHeaderStep && headerStepNumber >= 15.29;
  const completed = hasHeaderStep && headerStepNumber >= 18;
  const confirmedAt = snapshot.job.order_confirmed_at
    ? displayMilestoneDate(snapshot.job.order_confirmed_at)
    : null;

  const steps = [
    {
      label: "Received",
      detail: confirmedAt ? `Confirmed ${confirmedAt}` : "Order confirmed",
      state: "complete"
    },
    ...(snapshot.proof_visibility === "off" ? [] : [proofReviewProgress(snapshot.proof_summary, {
      proof_files: proofs,
      approved_proofs: approvedProofs,
      proof_phase: proofPhase,
      production_phase: productionPhase,
      shipping_phase: shippingPhase,
      completed,
      has_error: hasError
    })]),
    {
      label: "Production",
      detail: completed
        ? "Production complete"
        : productionPhase || packages || trackingCount || shippingPhase
          ? "Your order is being produced"
          : proofs
            ? "Ready after proof approval"
            : "Not started",
      state: packages || trackingCount || shippingPhase || completed ? "complete" : productionPhase ? "current" : proofs ? "current" : "pending"
    },
    {
      label: "Shipping",
      detail: trackingCount
        ? `${trackingCount} tracking number${trackingCount === 1 ? "" : "s"}`
        : packages
          ? `${packages} package${packages === 1 ? "" : "s"}`
          : "Tracking pending",
      state: completed ? "complete" : trackingCount || shippingPhase ? "current" : "pending"
    }
  ];
  return steps;
}

function productIdentifier(line: StatusLine) {
  if (line.product_id != null && line.product_id !== "") {
    return `Product ID ${line.product_id}`;
  }
  if (line.unit_number) {
    return `Unit ${line.unit_number}`;
  }
  return "Product identifier pending";
}

function parseOrderNumbers(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,;]+/)
    .map((orderNumber) => orderNumber.trim())
    .filter((orderNumber) => {
      const normalized = orderNumber.toUpperCase().replace(/\s+/g, "");
      if (!normalized || seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function StatusRequestForm({ initialOrderNumbers = [] }: { initialOrderNumbers?: string[] }) {
  const [orderNumberInput, setOrderNumberInput] = useState(initialOrderNumbers.join("\n"));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [debugLink, setDebugLink] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ orders?: string; email?: string }>({});
  const ordersInput = useRef<HTMLTextAreaElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const [emailCapability, setEmailCapability] = useState<
    { state: "checking" } | { state: "ready"; value: StatusEmailCapability } | { state: "unavailable"; value: StatusEmailCapability | null }
  >({ state: "checking" });

  useEffect(() => {
    let ignore = false;
    void fetch(`${apiBaseUrl}/public/status/email-capability`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("status_email_capability_unavailable");
        return response.json() as Promise<StatusEmailCapability>;
      })
      .then((value) => {
        if (!ignore) {
          setEmailCapability(value.available ? { state: "ready", value } : { state: "unavailable", value });
        }
      })
      .catch(() => {
        if (!ignore) setEmailCapability({ state: "unavailable", value: null });
      });
    return () => {
      ignore = true;
    };
  }, []);

  if (emailCapability.state !== "ready") {
    const checking = emailCapability.state === "checking";
    const contactEmail = emailCapability.state === "unavailable"
      ? emailCapability.value?.contact_email
      : null;
    return (
      <div className="status-email-availability" role="status" aria-live="polite">
        <div className="request-form-header">
          <span>Private status link</span>
          <strong>{checking ? "Checking availability" : "Contact Vornan"}</strong>
        </div>
        <h2>{checking ? "Checking secure email delivery…" : "Email delivery is temporarily unavailable."}</h2>
        <p>
          {checking
            ? "Please wait while we confirm that private status links can be delivered."
            : "Please contact your Vornan representative for help with your order status."}
        </p>
        {!checking && contactEmail ? (
          <a className="status-email-contact" href={`mailto:${contactEmail}`}>Request a new link from {contactEmail}</a>
        ) : null}
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (state === "sending") return;
        const orderNumbers = parseOrderNumbers(orderNumberInput);
        const errors = {
          orders: !orderNumbers.length ? "Enter at least one order number." : orderNumbers.length > 10 ? "Enter no more than 10 order numbers." : undefined,
          email: !email.trim() ? "Enter your email address." : emailInput.current?.validity.typeMismatch ? "Enter a valid email address." : undefined
        };
        setFieldErrors(errors);
        if (errors.orders || errors.email) {
          setMessage("");
          (errors.orders ? ordersInput.current : emailInput.current)?.focus();
          return;
        }
        setState("sending");
        setMessage("");
        setDebugLink("");
        void fetch(`${apiBaseUrl}/public/status/request-link`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            order_number: orderNumbers[0],
            order_numbers: orderNumbers,
            email: email.trim()
          })
        })
          .then(async (response) => {
            const payload = (await response.json().catch(() => null)) as StatusRequestResponse | { error?: string } | null;
            if (!response.ok) {
              throw new Error(payload && "error" in payload ? payload.error : "We could not send this request.");
            }
            setState("sent");
            setMessage(
              payload && "message" in payload
                ? payload.message
                : "If we can match that order, a private status link will arrive by email."
            );
            setDebugLink(payload && "debug_status_url" in payload && payload.debug_status_url ? payload.debug_status_url : "");
          })
          .catch((error) => {
            setState("error");
            setMessage(error instanceof Error ? error.message : "We could not send this request.");
          });
      }}
    >
      <div className="request-form-header">
        <span>Private status link</span>
        <strong>Delivery by email</strong>
      </div>
      <label htmlFor="order-numbers" className="vn-field-label">Lift order numbers <small className="vn-required">Required</small></label>
      <textarea
        id="order-numbers"
        ref={ordersInput}
        required
        disabled={state === "sending"}
        aria-invalid={Boolean(fieldErrors.orders)}
        aria-describedby={`order-numbers-hint${fieldErrors.orders ? " order-numbers-error" : ""}`}
        value={orderNumberInput}
        onChange={(event) => { setOrderNumberInput(event.target.value); setFieldErrors((current) => ({ ...current, orders: undefined })); setMessage(""); }}
        placeholder={"A0219986\nA0219987"}
        autoComplete="off"
      />
      <small className="field-hint" id="order-numbers-hint">Use the A-number shown in Lift or your order confirmation. One per line, up to 10.</small>
      {fieldErrors.orders ? <small className="vn-field-error" id="order-numbers-error" role="alert">{fieldErrors.orders}</small> : null}
      <label htmlFor="request-email" className="vn-field-label">Email address <small className="vn-required">Required</small></label>
      <input
        id="request-email"
        ref={emailInput}
        required
        disabled={state === "sending"}
        aria-invalid={Boolean(fieldErrors.email)}
        aria-describedby={fieldErrors.email ? "request-email-error" : undefined}
        value={email}
        onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: undefined })); setMessage(""); }}
        placeholder="name@company.com"
        type="email"
        autoComplete="email"
      />
      {fieldErrors.email ? <small className="vn-field-error" id="request-email-error" role="alert">{fieldErrors.email}</small> : null}
      <button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending link" : "Email my status link"}
      </button>
      {message ? <p role={state === "error" ? "alert" : "status"} className={`request-message ${state === "error" ? "error" : ""}`}>{message}</p> : null}
      {debugLink ? (
        <a className="debug-link" href={debugLink}>
          Open test status link
        </a>
      ) : null}
    </form>
  );
}

function StatusRequest() {
  return (
    <section className="status-request">
      <div>
        <p className="eyebrow">Order Status</p>
        <h1>Check your order status.</h1>
        <p>Access your order details through a private status link.</p>
        <p className="request-note">Order details, proof files, and shipment updates are shown when available.</p>
      </div>
      <StatusRequestForm />
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong>{value || "Not available"}</strong>
    </div>
  );
}

function ProgressStep({ step, index }: { step: ReturnType<typeof progressSteps>[number]; index: number }) {
  return (
    <div className={`progress-step ${step.state}`}>
      <span>{index + 1}</span>
      <div>
        <strong>{step.label}</strong>
        <small>{step.detail}</small>
      </div>
    </div>
  );
}

function ProofLinks({ proofs }: { proofs: StatusProof[] }) {
  const links = proofs.flatMap((proof) => [
    proof.proof_link_low ? { label: `${proof.proof_filename ?? "Proof"} · Low`, url: proof.proof_link_low } : null,
    proof.proof_link_high ? { label: `${proof.proof_filename ?? "Proof"} · High`, url: proof.proof_link_high } : null
  ]).filter(Boolean) as Array<{ label: string; url: string }>;

  if (!links.length) {
    return <span className="muted">Not posted yet</span>;
  }

  return (
    <div className="inline-links">
      {links.map((link) => (
        <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">
          {link.label}
        </a>
      ))}
    </div>
  );
}

function PackageList({ packages }: { packages: StatusPackage[] }) {
  if (!packages.length) {
    return <span className="muted">No shipment activity yet</span>;
  }

  return (
    <div className="package-list">
      {packages.map((pkg, index) => (
        <div key={`${pkg.tracking_number ?? "package"}-${pkg.box_number ?? index}`}>
          <strong>{pkg.tracking_number ?? "Tracking pending"}</strong>
          <span>{[pkg.ship_method, pkg.tracker_message, pkg.location_name].filter(Boolean).join(" · ")}</span>
        </div>
      ))}
    </div>
  );
}

function StatusView({
  payload,
  refreshState,
  statusToken,
  previewProofAction
}: {
  payload: PublicStatusResponse;
  refreshState: PublicStatusRefreshState;
  statusToken?: string;
  previewProofAction?: () => void;
}) {
  const snapshots = payload.snapshots?.length ? payload.snapshots : [payload.snapshot];
  const [selectedOrderKey, setSelectedOrderKey] = useState(snapshots[0].order_key);
  const snapshot = snapshots.find((candidate) => candidate.order_key === selectedOrderKey) ?? snapshots[0];
  const currentStatus = statusLabel(snapshot);
  const orderTitle = snapshot.live_order?.order_title ?? snapshot.header.order_title ?? snapshot.order_number;
  const expiresAt = displayDate(payload.link.expires_at);
  const steps = progressSteps(snapshot);
  const orderCancelled = snapshot.lifecycle?.state === "cancelled";

  return (
    <>
      {snapshots.length > 1 ? (
        <section className="order-collection" aria-label="Requested orders">
          <div className="collection-heading">
            <div>
              <p className="eyebrow">Order Summary</p>
              <h1>{snapshots.length} orders</h1>
            </div>
            <p>Select an order to see its progress, proofs, and shipment activity.</p>
          </div>
          <div className="order-selector">
            {snapshots.map((candidate) => (
              <button
                type="button"
                className={candidate.order_key === snapshot.order_key ? "selected" : ""}
                key={candidate.order_key}
                onClick={() => setSelectedOrderKey(candidate.order_key)}
                aria-pressed={candidate.order_key === snapshot.order_key}
              >
                <span>
                  <strong>{candidate.order_number}</strong>
                  <small>{candidate.customer.source_customer_name}</small>
                </span>
                <span>
                  <strong>{statusLabel(candidate)}</strong>
                  <small>Updated {displayDate(candidate.refreshed_at)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="hero">
        <div>
          <p className="eyebrow">Order {snapshot.order_number}</p>
          <h1>{orderTitle}</h1>
          <div className="hero-meta" aria-label="Order identifiers">
            <span>{snapshot.customer.source_customer_name}</span>
            <span>PO {snapshot.header.po_number ?? "Not provided"}</span>
            <span>Contract {snapshot.header.contract_number ?? "Not provided"}</span>
          </div>
        </div>
        <div className={`status-badge${orderCancelled ? " is-cancelled" : ""}`}>
          <span>Current status</span>
          <strong>{currentStatus}</strong>
          {orderCancelled ? (
            <small>Order no longer active in Lift</small>
          ) : snapshot.order_status?.step ?? snapshot.live_order?.status?.step ? (
            <small>{`${snapshot.order_status?.step?.step_number ?? snapshot.live_order?.status?.step?.step_number} · ${snapshot.order_status?.step?.step_name ?? snapshot.live_order?.status?.step?.step_name}`}</small>
          ) : null}
          <small className="status-updated-at">Updated {displayDate(snapshot.refreshed_at)}</small>
        </div>
      </section>

      {orderCancelled ? (
        <aside className="order-cancelled-notice" role="status" aria-label="Order canceled">
          <strong>Order canceled</strong>
          <span>This order is no longer active in Lift. Previous order, proof, and shipment details are shown below for reference.</span>
        </aside>
      ) : (
        <section className="progress-panel" aria-label="Order progress">
          {steps.map((step, index) => (
            <ProgressStep key={step.label} step={step} index={index} />
          ))}
        </section>
      )}

      <ProofReviewNotice summary={snapshot.proof_summary} visibility={snapshot.proof_visibility}
        key={snapshot.order_key} cancelled={orderCancelled} checking={refreshState === "checking"} previewAction={previewProofAction}
        requestView={statusToken ? async () => {
          const proofTab = window.open("about:blank", "_blank");
          if (!proofTab) throw new Error("Proof tab could not be opened");
          proofTab.opener = null;
          proofTab.document.title = "Opening Vornan Proof";
          proofTab.document.body.textContent = "Opening Vornan Proof…";
          try {
          const response = await fetch(`${apiBaseUrl}/public/status/${encodeURIComponent(statusToken)}/proof-view`, {
            method: "POST", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({order_number:snapshot.order_number})
          });
          if (!response.ok) throw new Error("Proof viewing access unavailable");
          const result = await response.json();
          if (result.scope !== "view" || typeof result.access_url !== "string"
            || !/^https:\/\/proof\.vornan\.co\/\?statusView=1&statusOrder=A\d{7,8}#\/access\/[A-Za-z0-9_-]{43}$/.test(result.access_url)
            || new URL(result.access_url).searchParams.get("statusOrder") !== snapshot.order_number) throw new Error("Invalid Proof destination");
          proofTab.location.replace(result.access_url);
          } catch (error) { proofTab.close(); throw error; }
        } : undefined} />

      <OrderRollup
        snapshot={snapshot}
        audience="public"
        displayDate={displayDate}
        allowProofAssetLinks
        proofAssetsLoading={refreshState === "checking"}
        shipmentsLoading={refreshState === "checking"}
      />

      <section className="privacy-note">
        <span>Available until {expiresAt}</span>
      </section>
    </>
  );
}

function PublicStatusHeader({
  productName,
  refreshState
}: {
  productName: "Order status" | "Order intake";
  refreshState?: PublicStatusRefreshState;
}) {
  return (
    <header className="brand-header">
      <div className="brand-product">
        <img src="/brand/vornan-wordmark.svg" alt="Vornan" className="vornan-wordmark" />
        <span aria-hidden="true" />
        <strong>{productName}</strong>
      </div>
      {refreshState ? (
        <span className={`brand-live ${refreshState}`} role="status" aria-live="polite">
          <i aria-hidden="true" />
          <span className="brand-live-label brand-live-label--full">
            {refreshState === "checking"
              ? "Syncing latest status…"
              : refreshState === "degraded"
                ? "Updates temporarily delayed"
                : "Live updates on"}
          </span>
          <span className="brand-live-label brand-live-label--compact">
            {refreshState === "checking"
              ? "Syncing…"
              : refreshState === "degraded"
                ? "Updates delayed"
                : "Live"}
          </span>
        </span>
      ) : null}
    </header>
  );
}

function DesignQaApp() {
  const entryReview = new URLSearchParams(window.location.search).has("proofEntry");
  const [reviewScenario, setReviewScenario] = useState("many");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [previewAssetsReady, setPreviewAssetsReady] = useState(false);
  useEffect(() => {
    if (!entryReview || !navigator.serviceWorker) return;
    const ready = () => setPreviewAssetsReady(Boolean(navigator.serviceWorker.controller));
    navigator.serviceWorker.addEventListener("controllerchange", ready);
    void navigator.serviceWorker.register("/qa-proof-preview-worker.js", { scope: "/design-qa" }).then(ready);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", ready);
  }, [entryReview]);
  const handoffDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (handoffOpen) handoffDialog.current?.showModal();
    else handoffDialog.current?.close();
  }, [handoffOpen]);
  const [refreshState, setRefreshState] = useState<PublicStatusRefreshState>("checking");
  useEffect(() => {
    const timer = window.setTimeout(() => setRefreshState("live"), 1_800);
    return () => window.clearTimeout(timer);
  }, []);

  const packageOne: StatusPackage = {
    tracking_number: "383464350227",
    box_number: "1",
    ship_method: "PRIORITY_OVERNIGHT",
    tracker_message: "Delivered (09/08/2026 11:28 AM) in Cincinnati, OH, 45202",
    location_name: "Cincinnati",
    destination: {
      company: "Christopher Crabtree",
      address_1: "500 Elliott Ave",
      city: "Haileyville",
      state: "OK",
      postal_code: "74546"
    }
  };
  const checking = refreshState === "checking";
  const printStep: LiftStepDefinition = {
    step_id: "1005",
    step_number: "14",
    job_flow_id: "1006",
    step_name: "Print",
    step_code: "PRINT",
    order_status: "Ready to Print",
    order_status_code: "READY_TO_PRINT",
    order_status_color: "blue",
    active: true
  };
  const lines: StatusLine[] = [1, 2].map((lineNumber) => ({
    line_number: lineNumber,
    product_name: lineNumber === 1 ? "Pump topper (Clip)" : "Pump topper (Citgo)",
    quantity: lineNumber === 1 ? 40 : 8,
    material: ".015 Styrene",
    final_height: 12,
    final_width: 20.125,
    step: printStep,
    proof_count: 1,
    proof_review_required: false,
    package_count: !checking && lineNumber === 1 ? 1 : 0,
    latest_proof_status: "APPROVED",
    latest_tracking_message: !checking && lineNumber === 1 ? packageOne.tracker_message ?? null : null,
    packages: !checking && lineNumber === 1 ? [packageOne] : [],
    proofs: [{
      proof_filename: `PFMTLOIWSFEFAF_line_${lineNumber}.jpg`,
      proof_approval_status: "APPROVED",
      proof_state: "approved",
      created_ts: `03-SEP-2026 0${lineNumber + 1}:48:31 PM`,
      proof_approved_ts: `04-SEP-2026 0${lineNumber + 8}:12:05 AM`,
      preview_kind: "unavailable"
    }]
  }));
  const snapshot: PublicOrderStatusSnapshot = {
    snapshot_id: "design-qa-snapshot",
    order_key: "design-qa-order",
    order_number: "A0230112",
    source_order_id: "PFMTLOIWSFEFAF",
    customer: { source_customer_name: "Empirical – Momentara", submit_customer_name: "Momentara" },
    job: {
      job_id: "design-qa-job",
      state: "accepted",
      import_method_name: "Design QA",
      source_file_name: "design-qa.json",
      created_at: "2026-09-03T15:28:00.000Z",
      updated_at: "2026-09-09T16:00:00.000Z",
      order_confirmed_at: "2026-09-03T15:30:00.000Z"
    },
    route: { name: "Design QA", target: "Lift", template: "Design QA" },
    header: {
      ext_id: "PFMTLOIWSFEFAF",
      order_title: "C316905 – Momentara Web Order – 20260903",
      po_number: "C316905",
      contract_number: "C316905",
      requested_ship_date: "2026-09-09",
      due_date: "2026-09-09"
    },
    live_order: null,
    order_status: { label: "Ready to Print", code: "READY_TO_PRINT", color: "blue", step: printStep },
    lifecycle: { state: "active" },
    proof_summary: {
      source: "proof_cache",
      health: "complete",
      pending: 0,
      regenerating: 0,
      waiting: 0,
      reviewed: 2,
      total: 2,
      review_required: false,
      last_synced_at: "2026-09-09T16:00:00.000Z",
      decisions_enabled: false,
      access_mode: "status_only"
    },
    proof_visibility: "status_only",
    shipment_summary: null,
    lines,
    lookups: { order: null, proofs: null, packages: null, shipping: null },
    source_status: {},
    issues: [],
    visibility_policy: {
      audience: "design_qa",
      redacted_fields: [],
      token_required: false,
      proof_visibility: "status_only"
    },
    refreshed_at: "2026-09-09T16:00:00.000Z"
  };
  const payload: PublicStatusResponse = {
    snapshot,
    snapshots: [snapshot],
    refresh: {
      status: "live",
      checked_at: snapshot.refreshed_at,
      next_refresh_at: "2026-09-09T16:01:00.000Z",
      poll_after_seconds: 60
    },
    link: { status: "active", expires_at: "2026-10-09T16:00:00.000Z", order_count: 1 }
  };

  if (entryReview) {
    snapshot.order_number = "QA-PROOF-ENTRY";
    snapshot.header.order_title = "Packaging artwork · local review";
    snapshot.customer = { source_customer_name: "LTL Demo", submit_customer_name: "LTL Demo" };
    snapshot.header.po_number = "QA-ONLY";
    snapshot.header.contract_number = null;
    const approvalStep = { ...printStep, step_id: "1037", step_number: "7.02", step_name: "Approve Art", step_code: "APPROVE_ART", order_status: "Pending Art Approval", order_status_code: "PENDING_ART_APPROVAL" };
    snapshot.order_status = { ...snapshot.order_status!, label: "Pending Art Approval", code: "PENDING_ART_APPROVAL", step: approvalStep };
    snapshot.refreshed_at = "2026-10-31T16:00:00.000Z";
    snapshot.header.requested_ship_date = "2026-11-05";
    snapshot.header.due_date = "2026-11-06";
    payload.link.expires_at = "2026-12-30T16:00:00.000Z";
    const pending = reviewScenario === "none" ? 0 : reviewScenario === "one" ? 1 : 3;
    snapshot.proof_summary = { ...snapshot.proof_summary!, health: reviewScenario === "unavailable" ? "stale" : "active",
      pending, reviewed: 4 - pending, total: 4, review_required: pending > 0, access_mode: "review_link", review_url: null };
    snapshot.proof_visibility = reviewScenario === "ineligible" ? "status_only" : "review_link";
    snapshot.proofing_enabled = reviewScenario !== "ineligible";
    if (reviewScenario === "ineligible") snapshot.proof_summary.access_mode = "status_only";
    snapshot.lines.forEach((line, lineIndex) => {
      line.product_name = lineIndex === 0 ? "Paper Label · retail packaging" : "Paper Label · shipping carton";
      line.material = "White paper";
      line.step = snapshot.order_status!.step;
      if (reviewScenario === "none" || (reviewScenario === "one" && lineIndex !== 0)) line.step = printStep;
      line.packages = []; line.package_count = 0; line.latest_tracking_message = null;
      line.proofs = Array.from({length: lineIndex === 0 ? 3 : 1}, (_, index) => {
        const approved = reviewScenario === "none" || (reviewScenario === "one" ? lineIndex !== 0 || index !== 0 : lineIndex === 0 && index === 2);
        return { proof_filename: ["Retail_front_panel_ingredient_and_handling_information_revision_03.pdf", "Retail_back_panel_nutrition_information_revision_02.pdf", "Retail_barcode_and_batch_label_approved.pdf"][index],
          proof_state: approved ? "approved" : "pending", proof_approval_status: approved ? "APPROVED" : "PENDING",
          created_ts: `30-OCT-2026 0${index+1}:15:00 PM`, proof_approved_ts: approved ? "31-OCT-2026 08:10:00 AM" : null,
          preview_kind: "image", proof_link_low: previewAssetsReady ? `https://status-preview.invalid/public/status/synthetic/proof-asset?line=${lineIndex+1}&creative=${index+1}` : null,
          proof_link_high: null };
      });
      line.proof_count = line.proofs.length;
      line.proof_review_required = line.proofs.some(proof => proof.proof_state === "pending");
      line.latest_proof_status = line.proof_review_required ? "PENDING" : "APPROVED";
    });
    if (reviewScenario === "mixed") {
      const first = snapshot.lines[0]!;
      const second = snapshot.lines[1]!;
      first.step = {...approvalStep,step_number:"7.01",step_name:"PDF Proof",order_status:"To Be Proofed"};
      second.step = printStep;
      second.proofs = second.proofs.map(proof => ({...proof,proof_state:"approved",proof_approval_status:"APPROVED"}));
      second.proof_review_required = false;
      snapshot.lines.push({...second,line_number:3,product_name:"Paper Label · outer case",
        step:approvalStep,proof_review_required:true,latest_proof_status:"PENDING",proofs:[{...first.proofs[0]!,proof_link_low:previewAssetsReady ? "https://status-preview.invalid/public/status/synthetic/proof-asset?line=3&creative=1" : null}]});
      snapshot.proof_summary = {...snapshot.proof_summary!,total:5,pending:3,reviewed:2};
    }
  }

  return (
    <main className="status-shell">
      <PublicStatusHeader productName="Order status" refreshState={refreshState} />
      {entryReview ? <div className="proof-entry-qa-controls"><strong>Local review · synthetic artwork</strong><label>Proof state <select value={reviewScenario} onChange={event => setReviewScenario(event.target.value)}>
        <option value="many">3 pending · review available</option><option value="one">1 pending</option><option value="none">None pending</option>
        <option value="mixed">Mixed 7.01 / production / 7.02</option><option value="checking">Checking availability</option><option value="unavailable">Status unavailable</option><option value="ineligible">Review access not connected</option>
      </select></label></div> : null}
      <StatusView payload={payload} refreshState={entryReview ? reviewScenario === "checking" ? "checking" : "live" : refreshState}
        previewProofAction={entryReview ? () => setHandoffOpen(true) : undefined} />
      {entryReview ? <dialog className="proof-entry-qa-dialog" ref={handoffDialog} onCancel={() => setHandoffOpen(false)} onClose={() => setHandoffOpen(false)} aria-labelledby="proof-entry-preview-title">
        <h2 id="proof-entry-preview-title">Continue to Vornan Proof</h2>
        <p>This local preview demonstrates the review handoff. No proof session has been created.</p>
        <p>Open the current artwork in Proof with view-only access. Approval and change requests require separate, verified reviewer authorization. Entering a name or email does not grant permission.</p>
        <p>Opening Proof does not approve anything. Status access alone does not grant approval permission.</p>
        <button type="button" autoFocus onClick={() => setHandoffOpen(false)}>Back to order status</button>
      </dialog> : null}
    </main>
  );
}

function App() {
  const initialToken = useMemo(tokenFromLocation, []);
  const [payload, setPayload] = useState<PublicStatusResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">(initialToken ? "loading" : "idle");
  const [refreshState, setRefreshState] = useState<PublicStatusRefreshState>("checking");
  const [message, setMessage] = useState("");
  const [recoveryOrderNumbers, setRecoveryOrderNumbers] = useState<string[]>([]);

  useEffect(() => {
    if (!initialToken) {
      return;
    }

    let ignore = false;
    let loaded = false;
    let requestActive = false;
    let latestPayload: PublicStatusResponse | null = null;
    let pollTimer: number | null = null;
    let consecutiveDegraded = 0;

    function clearPollTimer() {
      if (pollTimer != null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function schedulePoll(seconds?: number) {
      clearPollTimer();
      if (ignore || !shouldPollPublicStatus(document.visibilityState)) {
        return;
      }
      pollTimer = window.setTimeout(() => {
        void loadStatus(false);
      }, publicStatusPollDelay(seconds, { degradedAttempts: consecutiveDegraded }));
    }

    async function loadStatus(initial: boolean) {
      if (ignore || requestActive) {
        return;
      }
      requestActive = true;
      let refreshImmediately = false;
      let responseStatus = 0;
      if (initial) {
        setState("loading");
      } else {
        setRefreshState("checking");
      }
      try {
        const endpoint = `${apiBaseUrl}/public/status/${encodeURIComponent(initialToken)}${initial ? "" : "/refresh"}`;
        const response = await fetch(endpoint, {
          method: initial ? "GET" : "POST",
          cache: "no-store"
        });
        responseStatus = response.status;
        const rawData = await response.json().catch(() => ({})) as PublicStatusResponse | PublicStatusErrorResponse;
        if (!response.ok) {
          const errorPayload = rawData as PublicStatusErrorResponse;
          if (response.status === 410 && Array.isArray(errorPayload.order_numbers)) {
            setRecoveryOrderNumbers(errorPayload.order_numbers.filter((value) => typeof value === "string"));
          }
          throw new Error("public_status_request_failed");
        }
        if (!ignore) {
          const incoming = rawData as PublicStatusResponse;
          const incomingSnapshots = incoming.snapshots?.length ? incoming.snapshots : [incoming.snapshot];
          const retainedSnapshots = initial
            ? incomingSnapshots
            : retainTransientProofAssets(
                latestPayload?.snapshots?.length ? latestPayload.snapshots : latestPayload ? [latestPayload.snapshot] : undefined,
                incomingSnapshots
              ) as PublicOrderStatusSnapshot[];
          const proxiedSnapshots = proxyHighResolutionProofAssets(retainedSnapshots, apiBaseUrl, initialToken) as PublicOrderStatusSnapshot[];
          const data: PublicStatusResponse = {
            ...incoming,
            snapshot: proxiedSnapshots[0] ?? incoming.snapshot,
            snapshots: proxiedSnapshots
          };
          latestPayload = data;
          setPayload(data);
          setState("idle");
          const degraded = !initial && data.refresh?.status === "degraded";
          consecutiveDegraded = degraded ? Math.min(4, consecutiveDegraded + 1) : 0;
          setRefreshState(initial ? "checking" : degraded ? "degraded" : "live");
          setMessage("");
          loaded = true;
          if (initial) {
            // Render the durable snapshot immediately, then refresh Lift once
            // in the background so shipment details do not wait for the first poll.
            refreshImmediately = true;
          } else {
            schedulePoll(data.refresh?.poll_after_seconds);
          }
        }
      } catch {
        if (!ignore) {
          if (loaded) {
            consecutiveDegraded = Math.min(4, consecutiveDegraded + 1);
            setRefreshState("degraded");
            schedulePoll();
          } else {
            setMessage(publicStatusOpenErrorMessage(responseStatus));
            setState("error");
          }
        }
      } finally {
        requestActive = false;
        if (refreshImmediately && !ignore) {
          if (shouldPollPublicStatus(document.visibilityState)) {
            void loadStatus(false);
          } else {
            setRefreshState("live");
          }
        }
      }
    }

    function handleVisibilityChange() {
      clearPollTimer();
      if (shouldPollPublicStatus(document.visibilityState)) {
        void loadStatus(false);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("online", handleVisibilityChange);
    void loadStatus(true);
    return () => {
      ignore = true;
      clearPollTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("online", handleVisibilityChange);
    };
  }, [initialToken]);

  return (
    <main className="status-shell">
      <PublicStatusHeader productName="Order status" refreshState={payload ? refreshState : undefined} />

      {!initialToken ? <StatusRequest /> : null}

      {state === "loading" ? (
        <section className="loading-card">
          <div className="loading-copy">
            <span className="loading-dot" />
            <div>
              <strong>Opening your order status</strong>
              <p>Please wait while we open your private status link.</p>
            </div>
          </div>
          <div className="status-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      ) : null}

      {state === "error" ? (
        <section className="status-request">
          <div className="status-error-card">
            <p className="eyebrow">Status Link</p>
            <h1>We couldn’t open this status link.</h1>
            <p>{message || "Request a new secure link to see the latest available order status."}</p>
          </div>
          <StatusRequestForm initialOrderNumbers={recoveryOrderNumbers} />
        </section>
      ) : null}

      {payload ? <StatusView payload={payload} refreshState={refreshState} statusToken={initialToken ?? undefined} /> : null}
    </main>
  );
}

function RootApp() {
  const intakeKey = useMemo(intakeKeyFromLocation, []);
  if (import.meta.env.DEV && window.location.pathname.replace(/\/+$/, "") === "/design-qa") {
    return <DesignQaApp />;
  }
  if (!intakeKey) {
    return <App />;
  }

  return (
    <main className="status-shell intake-shell">
      <PublicStatusHeader productName="Order intake" />
      <CustomerIntake apiBaseUrl={apiBaseUrl} publicKey={intakeKey} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
