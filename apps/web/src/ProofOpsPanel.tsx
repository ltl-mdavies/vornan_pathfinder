import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Copy, Database, History, Link2, Mail, Network, RefreshCw, ShieldCheck, Unlink, UserRound } from "lucide-react";
import { proofReadOnlyPosture, type ProofIntegrationHealth } from "./proof-ops-health";

interface ProofGrant {
  grant_id: string;
  order_number: string;
  scope: "view";
  label: string | null;
  status: "active" | "revoked";
  created_at: string;
  expires_at: string;
  exchanged_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  participant_count: number;
}

interface ProofParticipant {
  participant_id: string;
  display_name: string;
  email: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface ProofOrderSummary {
  order_number: string;
  order_title: string | null;
  order_status: string | null;
  health: string;
  tasks: { state: string }[];
  last_synced_at: string;
  last_sync_diagnostics?: {
    source: "lift_read";
    completed_at: string;
    line_reads: { attempted: number; succeeded: number; failed: number; proof_rows: number };
    fallback_read: { attempted: boolean; ok: boolean | null; proof_rows: number };
    normalization_warning_count: number;
  } | null;
}

interface ProofAuditEvent {
  event_id: string;
  occurred_at: string;
  action: string;
  outcome: "succeeded" | "failed";
  actor_type: "operator" | "customer_session" | "system";
  correlation_id: string;
  metadata: { source: string };
}

async function responseJson<T>(response: Response) {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Vornan Proof request failed.");
  return body;
}

function dateLabel(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function ProofOpsPanel({ apiBaseUrl, authToken }: { apiBaseUrl: string; authToken: string | null }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [label, setLabel] = useState("");
  const [order, setOrder] = useState<ProofOrderSummary | null>(null);
  const [grants, setGrants] = useState<ProofGrant[]>([]);
  const [auditEvents, setAuditEvents] = useState<ProofAuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [health, setHealth] = useState<ProofIntegrationHealth | null>(null);
  const [oneTimeAccess, setOneTimeAccess] = useState<{ grantId: string; url: string } | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ grant: ProofGrant; action: "revoke" | "regenerate" } | null>(null);
  const [reviewerGrantId, setReviewerGrantId] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<Record<string, ProofParticipant[]>>({});

  const request = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    return fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  };

  useEffect(() => {
    void request("/api/proof/health/lift")
      .then((response) => responseJson<ProofIntegrationHealth>(response))
      .then(setHealth)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Proof health is unavailable."));
  }, [apiBaseUrl, authToken]);

  const normalizedOrderNumber = orderNumber.trim().toUpperCase();

  async function loadGrants(targetOrder = normalizedOrderNumber) {
    const payload = await responseJson<{ grants: ProofGrant[] }>(await request(`/api/proof/orders/${targetOrder}/grants`));
    setGrants(payload.grants);
  }

  async function loadAudit(targetOrder = normalizedOrderNumber, cursor: string | null = null) {
    setAuditLoading(true);
    try {
      const query = new URLSearchParams({ limit: "10" });
      if (cursor) query.set("cursor", cursor);
      const payload = await responseJson<{ events: ProofAuditEvent[]; next_cursor: string | null }>(
        await request(`/api/proof/orders/${targetOrder}/audit?${query}`)
      );
      setAuditEvents((current) => cursor ? [...current, ...payload.events] : payload.events);
      setAuditCursor(payload.next_cursor);
    } finally {
      setAuditLoading(false);
    }
  }

  async function syncOrder() {
    if (!/^A\d{7,8}$/.test(normalizedOrderNumber)) {
      setMessage("Enter a Lift order number in A######## format.");
      return;
    }
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{ order: ProofOrderSummary }>(
        await request(`/api/proof/orders/${normalizedOrderNumber}/sync`, { method: "POST", body: "{}" })
      );
      setOrder(payload.order);
      await loadGrants(payload.order.order_number);
      await loadAudit(payload.order.order_number).catch(() => undefined);
      setMessage(`Proof order ${payload.order.order_number} synchronized.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof order synchronization failed.");
    } finally {
      setState("idle");
    }
  }

  async function inspectCachedOrder() {
    if (!/^A\d{7,8}$/.test(normalizedOrderNumber)) {
      setMessage("Enter a Lift order number in A######## format.");
      return;
    }
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{ order: ProofOrderSummary }>(
        await request(`/api/proof/orders/${normalizedOrderNumber}`)
      );
      setOrder(payload.order);
      await loadGrants(payload.order.order_number);
      await loadAudit(payload.order.order_number).catch(() => undefined);
      setMessage(`Opened cached Proof order ${payload.order.order_number} without contacting Lift.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cached Proof order could not be opened.");
    } finally {
      setState("idle");
    }
  }

  async function createGrant() {
    if (!order) return;
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{ grant: ProofGrant; access_url: string }>(
        await request(`/api/proof/orders/${order.order_number}/grants`, {
          method: "POST",
          body: JSON.stringify({ scope: "view", label: label.trim() || null })
        })
      );
      setOneTimeAccess({ grantId: payload.grant.grant_id, url: payload.access_url });
      setLabel("");
      await loadGrants(order.order_number);
      await loadAudit(order.order_number).catch(() => undefined);
      setMessage("View-only link created. Copy it now; the raw token will not be shown again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof link creation failed.");
    } finally {
      setState("idle");
    }
  }

  async function confirmGrantAction() {
    if (!pendingAction || !order) return;
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{ grant: ProofGrant; access_url: string | null }>(
        await request(`/api/proof/grants/${pendingAction.grant.grant_id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: pendingAction.action })
        })
      );
      setOneTimeAccess(payload.access_url ? { grantId: payload.grant.grant_id, url: payload.access_url } : null);
      await loadGrants(order.order_number);
      await loadAudit(order.order_number).catch(() => undefined);
      setMessage(
        pendingAction.action === "regenerate"
          ? "The old link was revoked. Copy the replacement now; it will not be shown again."
          : "The proof link was revoked and its active sessions are no longer valid."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof access update failed.");
    } finally {
      setPendingAction(null);
      setState("idle");
    }
  }

  async function sendAccessEmail() {
    if (!oneTimeAccess) return;
    setState("loading");
    setMessage(null);
    try {
      const payload = await responseJson<{
        delivery: { mode: "log" | "ses"; status: "logged" | "sent"; recipient_masked: string };
      }>(await request(`/api/proof/grants/${oneTimeAccess.grantId}/email`, {
        method: "POST",
        body: JSON.stringify({ recipient_email: recipientEmail, access_url: oneTimeAccess.url })
      }));
      if (order) await loadAudit(order.order_number).catch(() => undefined);
      if (payload.delivery.status === "sent") {
        setOneTimeAccess(null);
        setRecipientEmail("");
        setMessage(`Proof link sent to ${payload.delivery.recipient_masked}. The raw link has been removed from this screen.`);
      } else {
        setMessage(`Proof link delivery logged for ${payload.delivery.recipient_masked}. Copy remains available because no email was sent.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof link email could not be sent.");
    } finally {
      setState("idle");
    }
  }

  async function toggleReviewers(grant: ProofGrant) {
    if (reviewerGrantId === grant.grant_id) {
      setReviewerGrantId(null);
      return;
    }
    setReviewerGrantId(grant.grant_id);
    if (reviewers[grant.grant_id]) return;
    try {
      const payload = await responseJson<{ participants: ProofParticipant[] }>(
        await request(`/api/proof/grants/${grant.grant_id}/participants`)
      );
      setReviewers((current) => ({ ...current, [grant.grant_id]: payload.participants }));
    } catch (error) {
      setReviewerGrantId(null);
      setMessage(error instanceof Error ? error.message : "Proof reviewers could not be loaded.");
    }
  }

  const pendingCount = order?.tasks.filter((task) => task.state === "pending").length ?? 0;
  const readOnlyPosture = health ? proofReadOnlyPosture(health) : null;

  return (
    <section className="proof-ops-panel" aria-labelledby="proof-ops-title">
      <div className="proof-ops-heading">
        <div>
          <p className="eyebrow">Vornan Proof</p>
          <h3 id="proof-ops-title">Sync an order and manage customer access.</h3>
          <span>Direct Lift orders are supported; a Pathfinder job is not required.</span>
        </div>
        <div className="proof-write-lock"><ShieldCheck size={16} /> Lift decisions locked</div>
      </div>

      <div className="proof-ops-form">
        <label>
          Lift order number
          <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="A0221132" />
        </label>
        <button className="primary-button" type="button" disabled={state === "loading"} onClick={() => void syncOrder()}>
          <RefreshCw size={16} /> {state === "loading" ? "Working" : "Sync Proofs"}
        </button>
        <button className="secondary-button" type="button" disabled={state === "loading"} onClick={() => void inspectCachedOrder()}>
          Open cached
        </button>
      </div>

      {message ? <div className="proof-ops-message" role="status">{message}</div> : null}

      {health && readOnlyPosture ? (
        <section className={`proof-integration-health ${readOnlyPosture.level}`} aria-labelledby="proof-integration-health-title">
          <div className="proof-integration-health-heading">
            <div className="proof-health-icon">
              {readOnlyPosture.level === "configuration_required" ? <CircleAlert size={18} /> : <ShieldCheck size={18} />}
            </div>
            <div>
              <span className="eyebrow">Integration health</span>
              <h4 id="proof-integration-health-title">{readOnlyPosture.label}</h4>
              <p>{readOnlyPosture.detail}</p>
            </div>
          </div>
          <div className="proof-integration-health-grid">
            <div>
              <Database size={16} />
              <span>Persistence</span>
              <strong>{health.storage_driver === "dynamodb" ? "Dedicated DynamoDB" : health.storage_driver === "local" ? "Local QA store" : "Disabled"}</strong>
              <small>Core {health.core_table_configured ? "configured" : "not configured"} · Audit {health.audit_table_configured ? "configured" : "not configured"}</small>
            </div>
            <div>
              <Network size={16} />
              <span>Lift reads</span>
              <strong>{health.lift_reads.order_host === health.lift_reads.report_host ? health.lift_reads.order_host : "Separate reviewed hosts"}</strong>
              <small>{health.lift_reads.concurrency} concurrent · {Math.round(health.lift_reads.timeout_ms / 1000)}s timeout</small>
            </div>
            <div>
              <RefreshCw size={16} />
              <span>Refresh boundary</span>
              <strong>{health.sync.queue_configured ? "Isolated queue configured" : "Queue not configured"}</strong>
              <small>{health.sync.stale_after_minutes}m stale · {health.sync.automatic_refresh_max_inactive_days}d activity window</small>
            </div>
            <div>
              <ShieldCheck size={16} />
              <span>Customer capability</span>
              <strong>{health.feature_flags.public_read ? "View-only public read" : "Public read off"}</strong>
              <small>Approve off · Revision off · Undo off · Lift writes off</small>
            </div>
          </div>
          {readOnlyPosture.blockers.length ? (
            <details>
              <summary>{readOnlyPosture.blockers.length} deployment {readOnlyPosture.blockers.length === 1 ? "requirement" : "requirements"} remain</summary>
              <ul>{readOnlyPosture.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {order ? (
        <>
          <div className="proof-ops-summary">
            <div><span>Order</span><strong>{order.order_number}</strong></div>
            <div><span>Health</span><strong>{order.health}</strong></div>
            <div><span>Pending proofs</span><strong>{pendingCount}</strong></div>
            <div><span>Last synchronized</span><strong>{dateLabel(order.last_synced_at)}</strong></div>
          </div>

          {order.last_sync_diagnostics ? (
            <section className="proof-sync-diagnostics" aria-label="Last read-only Lift synchronization diagnostics">
              <div>
                <span>Line reads</span>
                <strong>{order.last_sync_diagnostics.line_reads.succeeded}/{order.last_sync_diagnostics.line_reads.attempted} succeeded</strong>
              </div>
              <div>
                <span>Proof rows</span>
                <strong>{order.last_sync_diagnostics.line_reads.proof_rows + order.last_sync_diagnostics.fallback_read.proof_rows}</strong>
              </div>
              <div>
                <span>Fallback</span>
                <strong>{order.last_sync_diagnostics.fallback_read.attempted ? (order.last_sync_diagnostics.fallback_read.ok ? "Succeeded" : "Failed") : "Not needed"}</strong>
              </div>
              <div>
                <span>Normalization warnings</span>
                <strong>{order.last_sync_diagnostics.normalization_warning_count}</strong>
              </div>
              <small>Sanitized counts only. Lift URLs, errors, credentials, and customer files are excluded.</small>
            </section>
          ) : null}

          <div className="proof-grant-create">
            <label>
              Link label
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Customer review" />
            </label>
            <button className="secondary-button" type="button" disabled={!health?.feature_flags.grant_creation || state === "loading"} onClick={() => void createGrant()}>
              <Link2 size={16} /> Create view-only link
            </button>
            {!health?.feature_flags.grant_creation ? <small>Grant creation is disabled in this environment.</small> : null}
          </div>

          {oneTimeAccess ? (
            <div className="proof-one-time-link">
              <CheckCircle2 size={18} />
              <div className="proof-one-time-content">
                <span>One-time access link</span>
                <code>{oneTimeAccess.url}</code>
                <div className="proof-one-time-actions">
                  <input
                    aria-label="Proof link recipient email"
                    type="email"
                    autoComplete="email"
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    placeholder="customer@example.com"
                  />
                  <button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(oneTimeAccess.url).then(() => setMessage("Proof link copied."))}>
                    <Copy size={15} /> Copy
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!health?.feature_flags.proof_link_email || state === "loading" || !recipientEmail.trim()}
                    onClick={() => void sendAccessEmail()}
                  >
                    <Mail size={15} /> Send link
                  </button>
                </div>
                {!health?.feature_flags.proof_link_email ? <small>Email delivery is disabled in this environment. Copy the link through an approved private channel.</small> : null}
              </div>
            </div>
          ) : null}

          <div className="proof-grant-list">
            {grants.map((grant) => (
              <article key={grant.grant_id} className={grant.status === "revoked" ? "revoked" : ""}>
                <div>
                  <strong>{grant.label ?? "View-only access"}</strong>
                  <span>{grant.status} · expires {dateLabel(grant.expires_at)} · last used {dateLabel(grant.last_used_at)}</span>
                </div>
                <div className="proof-grant-actions">
                  {grant.participant_count > 0 ? (
                    <button className="secondary-button" type="button" aria-expanded={reviewerGrantId === grant.grant_id} onClick={() => void toggleReviewers(grant)}>
                      <UserRound size={14} /> {grant.participant_count} {grant.participant_count === 1 ? "reviewer" : "reviewers"}
                    </button>
                  ) : null}
                  {grant.status === "active" ? (
                    <>
                    <button className="secondary-button" type="button" onClick={() => setPendingAction({ grant, action: "regenerate" })}>Regenerate</button>
                    <button className="secondary-button danger" type="button" onClick={() => setPendingAction({ grant, action: "revoke" })}><Unlink size={14} /> Revoke</button>
                    </>
                  ) : null}
                </div>
                {reviewerGrantId === grant.grant_id ? (
                  <div className="proof-reviewer-list" aria-label="Identified reviewers">
                    {(reviewers[grant.grant_id] ?? []).map((reviewer) => (
                      <div key={reviewer.participant_id}>
                        <span><strong>{reviewer.display_name}</strong><small>{reviewer.email}</small></span>
                        <small>Last seen {dateLabel(reviewer.last_seen_at)}</small>
                      </div>
                    ))}
                    {!reviewers[grant.grant_id] ? <small>Loading restricted reviewer details…</small> : null}
                  </div>
                ) : null}
              </article>
            ))}
            {!grants.length ? <p>No customer access grants for this order.</p> : null}
          </div>

          <section className="proof-audit" aria-labelledby="proof-audit-title">
            <div className="proof-audit-heading">
              <div>
                <span className="eyebrow"><History size={14} /> Restricted audit</span>
                <h4 id="proof-audit-title">Lifecycle activity</h4>
              </div>
              <small>Identifiers only; customer files, comments, and access secrets are excluded.</small>
            </div>
            <ol>
              {auditEvents.map((event) => (
                <li key={event.event_id}>
                  <span className={`proof-audit-status ${event.outcome}`}>{event.outcome}</span>
                  <div>
                    <strong>{event.action.replace(/^proof\./, "").replaceAll("_", " ")}</strong>
                    <span>{event.actor_type.replaceAll("_", " ")} · {event.metadata.source.replaceAll("_", " ")} · {dateLabel(event.occurred_at)}</span>
                  </div>
                  <code title={event.correlation_id}>{event.correlation_id.slice(0, 12)}</code>
                </li>
              ))}
            </ol>
            {!auditEvents.length ? <p>No lifecycle activity has been recorded for this order.</p> : null}
            {auditCursor ? (
              <button className="secondary-button" type="button" disabled={auditLoading} onClick={() => void loadAudit(order.order_number, auditCursor).catch((error) => setMessage(error instanceof Error ? error.message : "Proof audit could not be loaded."))}>
                {auditLoading ? "Loading" : "Load older activity"}
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      {pendingAction ? (
        <div className="proof-action-confirm" role="alertdialog" aria-modal="true" aria-labelledby="proof-confirm-title">
          <div>
            <strong id="proof-confirm-title">{pendingAction.action === "revoke" ? "Revoke this link?" : "Regenerate this link?"}</strong>
            <span>{pendingAction.action === "revoke" ? "Existing sessions will stop working." : "The current link and sessions will be revoked before a replacement is issued."}</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setPendingAction(null)}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => void confirmGrantAction()}>Confirm</button>
        </div>
      ) : null}
    </section>
  );
}
