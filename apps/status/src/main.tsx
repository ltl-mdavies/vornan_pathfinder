import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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
    order_title?: string | null;
    requested_ship_date?: string | null;
    due_date?: string | null;
    shipping?: unknown | null;
  };
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
  link: {
    status: string;
    expires_at: string;
  };
};

type StatusRequestResponse = {
  status: string;
  message: string;
  debug_status_url?: string;
};

const statusHighlights = [
  "Order and line-level progress",
  "Proof links when available",
  "Package and tracking activity"
];

function tokenFromLocation() {
  const url = new URL(window.location.href);
  const queryToken = url.searchParams.get("token");
  const pathToken = url.pathname
    .split("/")
    .filter(Boolean)
    .find((part) => !["status", "order"].includes(part.toLowerCase()));
  return queryToken ?? pathToken ?? "";
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

function lookupText(lookup: LookupStatus | null) {
  if (!lookup) {
    return "Not connected";
  }
  return lookup.ok ? "Loaded" : `HTTP ${lookup.http_status}`;
}

function firstTracking(snapshot: PublicOrderStatusSnapshot) {
  return snapshot.lines
    .flatMap((line) => line.packages)
    .find((pkg) => pkg.tracking_number)?.tracking_number;
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

function StatusRequestForm() {
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [debugLink, setDebugLink] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!orderNumber.trim() || !email.trim()) {
          setState("error");
          setMessage("Enter both an order number and email address.");
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
            order_number: orderNumber.trim(),
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
                : "If the order and email match, a private status link will be sent shortly."
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
        <span>Private Status Link</span>
        <strong>Sent by email</strong>
      </div>
      <label htmlFor="order-number">Order number</label>
      <input
        id="order-number"
        value={orderNumber}
        onChange={(event) => setOrderNumber(event.target.value)}
        placeholder="A0219986"
        autoComplete="off"
      />
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
        {state === "sending" ? "Sending request" : "Send secure link"}
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
        <h1>Get a private view of your order.</h1>
        <p>
          Enter your order number and email address. If they match, Pathfinder sends a secure link with current order,
          proof, and shipment details.
        </p>
        <div className="status-highlights" aria-label="Status link contents">
          {statusHighlights.map((highlight) => (
            <span key={highlight}>{highlight}</span>
          ))}
        </div>
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

function LookupCard({ label, lookup }: { label: string; lookup: LookupStatus | null }) {
  const loaded = Boolean(lookup?.ok);
  return (
    <div className={`lookup-card ${loaded ? "loaded" : ""}`}>
      <span>{label}</span>
      <strong>{lookupText(lookup)}</strong>
      <small>{lookup ? displayDate(lookup.fetched_at) : "Awaiting Lift data"}</small>
    </div>
  );
}

function ProofLinks({ proofs }: { proofs: StatusProof[] }) {
  const links = proofs.flatMap((proof) => [
    proof.proof_link_low ? { label: `${proof.proof_filename ?? "Proof"} · Low`, url: proof.proof_link_low } : null,
    proof.proof_link_high ? { label: `${proof.proof_filename ?? "Proof"} · High`, url: proof.proof_link_high } : null
  ]).filter(Boolean) as Array<{ label: string; url: string }>;

  if (!links.length) {
    return <span className="muted">No proof links yet</span>;
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
    return <span className="muted">No package activity yet</span>;
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
  const { snapshot } = payload;
  const trackingNumber = firstTracking(snapshot);
  const currentStatus = statusLabel(snapshot);
  const expiresAt = displayDate(payload.link.expires_at);

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Order Status</p>
          <h1>{snapshot.order_number}</h1>
          <p>
            {snapshot.customer.source_customer_name} order visibility from Pathfinder. Last refreshed{" "}
            {displayDate(snapshot.refreshed_at)}.
          </p>
        </div>
        <div className="status-badge">
          <span>Current status</span>
          <strong>{currentStatus}</strong>
        </div>
      </section>

      {snapshot.issues.length ? (
        <section className="issue-strip">
          <strong>{snapshot.issues.length} visibility note{snapshot.issues.length === 1 ? "" : "s"}</strong>
          <span>{snapshot.issues.map((issue) => issue.message).join(" ")}</span>
        </section>
      ) : null}

      <section className="summary-grid">
        <KeyValue label="Customer" value={snapshot.customer.source_customer_name} />
        <KeyValue label="PO / Source ID" value={snapshot.header.po_number ?? snapshot.source_order_id} />
        <KeyValue label="Requested ship" value={snapshot.header.requested_ship_date ?? snapshot.header.due_date} />
        <KeyValue label="Tracking" value={trackingNumber ?? "Pending"} />
      </section>

      <section className="lookup-grid">
        <LookupCard label="Order detail" lookup={snapshot.lookups.order} />
        <LookupCard label="Proof files" lookup={snapshot.lookups.proofs} />
        <LookupCard label="Packages" lookup={snapshot.lookups.packages} />
      </section>

      <section className="order-lines">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Line Items</p>
            <h2>{snapshot.lines.length} order line{snapshot.lines.length === 1 ? "" : "s"}</h2>
          </div>
          <span>{snapshot.route.target} · {snapshot.route.template}</span>
        </div>

        {snapshot.lines.map((line) => (
          <article className="line-card" key={`${line.line_number}-${line.product_id ?? line.unit_number ?? "line"}`}>
            <div className="line-main">
              <span className="line-number">{line.line_number}</span>
              <div>
                <h3>{line.product_name ?? line.description ?? "Order line"}</h3>
                <p>{productIdentifier(line)} · Qty {line.quantity ?? "pending"}</p>
              </div>
            </div>
            <div className="line-status">
              <KeyValue label="Proof status" value={line.latest_proof_status ?? "Pending"} />
              <KeyValue label="Shipment status" value={line.latest_tracking_message ?? "Pending"} />
            </div>
            <div className="line-detail">
              <div>
                <span className="line-detail-label">Proofs</span>
                <ProofLinks proofs={line.proofs} />
              </div>
              <div>
                <span className="line-detail-label">Packages</span>
                <PackageList packages={line.packages} />
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="privacy-note">
        <strong>Visibility note</strong>
        <span>
          This private link expires {expiresAt}. Internal costs and submit history are omitted. Redacted fields:{" "}
          {snapshot.visibility_policy.redacted_fields.join(", ")}.
        </span>
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
