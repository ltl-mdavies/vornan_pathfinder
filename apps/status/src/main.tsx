import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  LiftStepDefinition,
  NormalizedLiftOrder,
  OrderRollupDestination,
  OrderRollupHeaderFieldSource,
  OrderRollupProofSummary,
  OrderRollupShipmentSummary
} from "@pathfinder/order-rollup";
import { OrderRollup } from "@pathfinder/order-rollup-ui";
import { proofReviewProgress } from "./proof-state";
import { CustomerIntake } from "./intake";
import "./styles.css";
import "@pathfinder/order-rollup-ui/styles.css";

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
};

type StatusProof = {
  proof_filename?: string | null;
  proof_approval_status?: string | null;
  proof_link_low?: string | null;
  proof_link_high?: string | null;
};

type StatusPackage = {
  tracking_number?: string | null;
  ship_method?: string | null;
  tracker_message?: string | null;
  box_number?: string | number | null;
  package_type?: string | null;
  location_name?: string | null;
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
  proof_count: number;
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
  proof_summary?: OrderRollupProofSummary | null;
  shipment_summary?: OrderRollupShipmentSummary | null;
  lines: StatusLine[];
  lookups: {
    order: LookupStatus | null;
    proofs: LookupStatus | null;
    packages: (LookupStatus & { redacted_fields?: string[] }) | null;
  };
  issues: StatusIssue[];
  visibility_policy: {
    audience: string;
    redacted_fields: string[];
    token_required: boolean;
  };
  refreshed_at: string;
};

type PublicStatusResponse = {
  snapshot: PublicOrderStatusSnapshot;
  snapshots?: PublicOrderStatusSnapshot[];
  link: {
    status: string;
    expires_at: string;
    order_count?: number;
  };
};

type StatusRequestResponse = {
  status: string;
  message: string;
  debug_status_url?: string;
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

function statusLabel(snapshot: PublicOrderStatusSnapshot) {
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

function firstTracking(snapshot: PublicOrderStatusSnapshot) {
  return snapshot.lines
    .flatMap((line) => line.packages)
    .find((pkg) => pkg.tracking_number)?.tracking_number;
}

function countProofs(snapshot: PublicOrderStatusSnapshot) {
  return snapshot.lines.reduce((total, line) => total + line.proof_count, 0);
}

function countPackages(snapshot: PublicOrderStatusSnapshot) {
  return snapshot.lines.reduce((total, line) => total + line.package_count, 0);
}

function progressSteps(snapshot: PublicOrderStatusSnapshot) {
  const proofs = countProofs(snapshot);
  const packages = countPackages(snapshot);
  const tracking = firstTracking(snapshot);
  const hasError = snapshot.issues.some((issue) => issue.severity === "error");
  const headerStepNumber = Number(snapshot.order_status?.step?.step_number ?? snapshot.live_order?.status?.step?.step_number);
  const hasHeaderStep = Number.isFinite(headerStepNumber);
  const proofPhase = hasHeaderStep && headerStepNumber < 10;
  const productionPhase = hasHeaderStep && headerStepNumber >= 10 && headerStepNumber < 15.29;
  const shippingPhase = hasHeaderStep && headerStepNumber >= 15.29;
  const completed = hasHeaderStep && headerStepNumber >= 18;

  return [
    {
      label: "Received",
      detail: statusLabel(snapshot),
      state: "complete"
    },
    proofReviewProgress(snapshot.proof_summary, {
      proof_files: proofs,
      proof_phase: proofPhase,
      production_phase: productionPhase,
      shipping_phase: shippingPhase,
      completed,
      has_error: hasError
    }),
    {
      label: "Production",
      detail: packages || tracking ? "Production activity recorded" : "Production updates pending",
      state: packages || tracking || shippingPhase || completed ? "complete" : productionPhase ? "current" : proofs ? "current" : "pending"
    },
    {
      label: "Shipping",
      detail: tracking ? `Tracking ${tracking}` : "Tracking pending",
      state: completed ? "complete" : tracking || shippingPhase ? "current" : "pending"
    }
  ];
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

function StatusRequestForm() {
  const [orderNumberInput, setOrderNumberInput] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [debugLink, setDebugLink] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const orderNumbers = parseOrderNumbers(orderNumberInput);
        if (!orderNumbers.length || !email.trim()) {
          setState("error");
          setMessage("Enter at least one order number and an email address.");
          return;
        }
        if (orderNumbers.length > 10) {
          setState("error");
          setMessage("Enter no more than 10 order numbers at a time.");
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
        <strong>Sent by email</strong>
      </div>
      <label htmlFor="order-numbers">Order numbers</label>
      <textarea
        id="order-numbers"
        value={orderNumberInput}
        onChange={(event) => setOrderNumberInput(event.target.value)}
        placeholder={"A0219986\nA0219987"}
        autoComplete="off"
      />
      <small className="field-hint">One per line, up to 10 orders.</small>
      <label htmlFor="request-email">Email address</label>
      <input
        id="request-email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@company.com"
        type="email"
        autoComplete="email"
      />
      <button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending link" : "Email my status link"}
      </button>
      {message ? <p className={`request-message ${state === "error" ? "error" : ""}`}>{message}</p> : null}
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
        <p>Enter one or more order numbers and your email. We will send one private link when the request matches our records.</p>
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

function StatusView({ payload }: { payload: PublicStatusResponse }) {
  const snapshots = payload.snapshots?.length ? payload.snapshots : [payload.snapshot];
  const [selectedOrderKey, setSelectedOrderKey] = useState(snapshots[0].order_key);
  const snapshot = snapshots.find((candidate) => candidate.order_key === selectedOrderKey) ?? snapshots[0];
  const currentStatus = statusLabel(snapshot);
  const expiresAt = displayDate(payload.link.expires_at);
  const steps = progressSteps(snapshot);

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
          <p className="eyebrow">Order Status</p>
          <h1>{snapshot.order_number}</h1>
          <p>Latest available update for {snapshot.customer.source_customer_name}.</p>
        </div>
        <div className="status-badge">
          <span>Current status</span>
          <strong>{currentStatus}</strong>
          <small>Updated {displayDate(snapshot.refreshed_at)}</small>
        </div>
      </section>

      <section className="progress-panel" aria-label="Order progress">
        {steps.map((step, index) => (
          <ProgressStep key={step.label} step={step} index={index} />
        ))}
      </section>

      <OrderRollup snapshot={snapshot} audience="public" displayDate={displayDate} />

      <section className="privacy-note">
        <strong>Private link</strong>
        <span>This view expires {expiresAt}. For questions, reply to the email that sent this link.</span>
      </section>
    </>
  );
}

function App() {
  const initialToken = useMemo(tokenFromLocation, []);
  const [payload, setPayload] = useState<PublicStatusResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">(initialToken ? "loading" : "idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!initialToken) {
      return;
    }

    let ignore = false;
    async function loadStatus() {
      setState("loading");
      try {
        const response = await fetch(`${apiBaseUrl}/public/status/${encodeURIComponent(initialToken)}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "This status link could not be opened.");
        }
        if (!ignore) {
          setPayload(data);
          setState("idle");
        }
      } catch (error) {
        if (!ignore) {
          setMessage(error instanceof Error ? error.message : "This status link could not be opened.");
          setState("error");
        }
      }
    }

    void loadStatus();
    return () => {
      ignore = true;
    };
  }, [initialToken]);

  return (
    <main className="status-shell">
      <header className="brand-header">
        <img src="/brand/vornan-wordmark.svg" alt="Vornan" className="vornan-wordmark" />
        <img src="/brand/pathfinder-lockup-zinnia.svg" alt="Pathfinder" className="pathfinder-lockup" />
      </header>

      {!initialToken ? <StatusRequest /> : null}

      {state === "loading" ? (
        <section className="loading-card">
          <span className="loading-dot" />
          <strong>Loading order status</strong>
          <p>Opening the latest Pathfinder order view.</p>
        </section>
      ) : null}

      {state === "error" ? (
        <section className="status-request">
          <div className="status-error-card">
            <p className="eyebrow">Status Link</p>
            <h1>This link could not be opened.</h1>
            <p>{message || "Request a new secure link to see the latest available order status."}</p>
          </div>
          <StatusRequestForm />
        </section>
      ) : null}

      {payload ? <StatusView payload={payload} /> : null}
    </main>
  );
}

function RootApp() {
  const intakeKey = useMemo(intakeKeyFromLocation, []);
  if (!intakeKey) {
    return <App />;
  }

  return (
    <main className="status-shell intake-shell">
      <header className="brand-header">
        <img src="/brand/vornan-wordmark.svg" alt="Vornan" className="vornan-wordmark" />
        <img src="/brand/pathfinder-lockup-zinnia.svg" alt="Pathfinder" className="pathfinder-lockup" />
      </header>
      <CustomerIntake apiBaseUrl={apiBaseUrl} publicKey={intakeKey} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
