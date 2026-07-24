import React, { useEffect, useState } from "react";
import { Check, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { pathfinderFetch as fetch } from "./api-client";

export interface ProofingApiAuditEvent {
  event_id: string;
  action: "configured" | "replaced" | "cleared";
  actor_id: string;
  occurred_at: string;
}

export interface ProofingApiConfiguration {
  base_url: string | null;
  company_id: string | null;
  action_user_name: string;
  client_id_configured: boolean;
  client_secret_configured: boolean;
  configured: boolean;
  updated_at: string | null;
  audit_events: ProofingApiAuditEvent[];
}

interface ProofingApiDraft {
  base_url: string;
  company_id: string;
  action_user_name: string;
  client_id: string;
  client_secret: string;
}

interface ProofingApiSetupProps {
  apiBaseUrl: string;
  targetId: string;
  environmentId: string;
  environmentName: string;
  orderEndpointUrl: string;
  suggestedCompanyId: string;
}

export const DEFAULT_PROOFING_API_ACTION_USER_NAME = "VORNAN_PROOF";

const emptyConfiguration: ProofingApiConfiguration = {
  base_url: null,
  company_id: null,
  action_user_name: DEFAULT_PROOFING_API_ACTION_USER_NAME,
  client_id_configured: false,
  client_secret_configured: false,
  configured: false,
  updated_at: null,
  audit_events: []
};

export function proofingApiBaseUrlFromOrderEndpoint(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return "";
    }
    const suffix = "/api/create_order";
    if (!parsed.pathname.endsWith(suffix)) {
      return "";
    }
    parsed.pathname = parsed.pathname.slice(0, -suffix.length);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function draftFromConfiguration(
  configuration: ProofingApiConfiguration,
  suggestions: { base_url?: string; company_id?: string } = {}
): ProofingApiDraft {
  return {
    base_url: configuration.base_url ?? suggestions.base_url ?? "",
    company_id: configuration.company_id ?? suggestions.company_id ?? "",
    action_user_name: configuration.action_user_name || DEFAULT_PROOFING_API_ACTION_USER_NAME,
    client_id: "",
    client_secret: ""
  };
}

export function proofingApiSaveLabel(configuration: ProofingApiConfiguration, draft: ProofingApiDraft) {
  return configuration.configured && (draft.client_id || draft.client_secret)
    ? "Replace credentials"
    : "Save Proofing API";
}

export function proofingApiSavePayload(draft: ProofingApiDraft) {
  return {
    base_url: draft.base_url,
    company_id: draft.company_id,
    action_user_name: draft.action_user_name,
    ...(draft.client_id || draft.client_secret
      ? { client_id: draft.client_id, client_secret: draft.client_secret }
      : {})
  };
}

async function readConfiguration(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as ProofingApiConfiguration & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Proofing API setup request failed.");
  }
  return payload;
}

function displayDate(value: string | null) {
  if (!value) {
    return "Not configured";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Not available" : parsed.toLocaleString();
}

export function ProofingApiSetup({
  apiBaseUrl,
  targetId,
  environmentId,
  environmentName,
  orderEndpointUrl,
  suggestedCompanyId
}: ProofingApiSetupProps) {
  const suggestedBaseUrl = proofingApiBaseUrlFromOrderEndpoint(orderEndpointUrl);
  const suggestions = {
    base_url: suggestedBaseUrl,
    company_id: suggestedCompanyId
  };
  const [configuration, setConfiguration] = useState(emptyConfiguration);
  const [draft, setDraft] = useState<ProofingApiDraft>(
    draftFromConfiguration(emptyConfiguration, suggestions)
  );
  const [state, setState] = useState<"loading" | "idle" | "saving" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const endpoint = `${apiBaseUrl}/api/targets/${encodeURIComponent(targetId)}/environments/${encodeURIComponent(environmentId)}/proofing-api`;

  useEffect(() => {
    let active = true;
    setState("loading");
    setMessage(null);
    void fetch(endpoint)
      .then(readConfiguration)
      .then((loaded) => {
        if (!active) return;
        setConfiguration(loaded);
        setDraft(draftFromConfiguration(loaded, suggestions));
        setState("idle");
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Proofing API setup could not be loaded.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [endpoint, suggestedBaseUrl, suggestedCompanyId]);

  async function save() {
    setState("saving");
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proofingApiSavePayload(draft))
      });
      const saved = await readConfiguration(response);
      setConfiguration(saved);
      setDraft(draftFromConfiguration(saved, suggestions));
      setConfirmClear(false);
      setMessage(saved.configured ? "Proofing API setup saved." : "Proofing API settings saved.");
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proofing API setup could not be saved.");
      setState("error");
    }
  }

  async function clear() {
    setState("saving");
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const cleared = await readConfiguration(response);
      setConfiguration(cleared);
      setDraft(draftFromConfiguration(cleared, suggestions));
      setConfirmClear(false);
      setMessage("Proofing API setup cleared.");
      setState("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proofing API setup could not be cleared.");
      setState("error");
    }
  }

  return (
    <section className="proofing-api-setup" aria-labelledby={`proofing-api-${environmentId}`}>
      <div className="proofing-api-heading">
        <div>
          <span className="eyebrow"><ShieldCheck size={14} /> Separate credential boundary</span>
          <h4 id={`proofing-api-${environmentId}`}>Proofing API</h4>
          <p>Environment-specific credentials for {environmentName}. They are stored separately from order-import credentials.</p>
        </div>
        <span className={configuration.configured ? "mini-pill mini-pill-success" : "mini-pill mini-pill-neutral"}>
          {configuration.configured ? <Check size={13} /> : <KeyRound size={13} />}
          {configuration.configured ? "Configured" : "Not configured"}
        </span>
      </div>

      <div className="setup-grid target-settings-grid proofing-api-grid">
        <label className="setup-control setup-control-wide">
          <span>Proofing API Base URL</span>
          <input
            type="url"
            inputMode="url"
            value={draft.base_url}
            placeholder="https://…"
            disabled={state === "loading" || state === "saving"}
            onChange={(event) => setDraft((current) => ({ ...current, base_url: event.target.value }))}
          />
          <small>
            Lift ERP root before <code>/order-management</code>. PROD uses{" "}
            <code>https://ltlco.lifterp.com/ords/api/lift/erp</code>.
          </small>
        </label>
        <label className="setup-control">
          <span>Company ID</span>
          <input
            value={draft.company_id}
            autoComplete="off"
            disabled={state === "loading" || state === "saving"}
            onChange={(event) => setDraft((current) => ({ ...current, company_id: event.target.value }))}
          />
        </label>
        <label className="setup-control">
          <span>Lift Action User</span>
          <input
            value={draft.action_user_name}
            autoComplete="off"
            placeholder={DEFAULT_PROOFING_API_ACTION_USER_NAME}
            disabled={state === "loading" || state === "saving"}
            onChange={(event) => setDraft((current) => ({ ...current, action_user_name: event.target.value }))}
          />
          <small>
            Sent as <code>userName</code> for Lift attribution; it is not an authentication credential.
          </small>
        </label>
        <label className="setup-control setup-control-wide">
          <span>Client ID</span>
          <input
            value={draft.client_id}
            autoComplete="off"
            placeholder={configuration.client_id_configured ? "Saved client ID" : "Enter client ID"}
            disabled={state === "loading" || state === "saving"}
            onChange={(event) => setDraft((current) => ({ ...current, client_id: event.target.value }))}
          />
        </label>
        <label className="setup-control setup-control-wide">
          <span>Client Secret</span>
          <input
            type="password"
            value={draft.client_secret}
            autoComplete="new-password"
            placeholder={configuration.client_secret_configured ? "Saved secret" : "Enter client secret"}
            disabled={state === "loading" || state === "saving"}
            onChange={(event) => setDraft((current) => ({ ...current, client_secret: event.target.value }))}
          />
        </label>
      </div>

      <div className="proofing-api-meta" aria-label="Proofing API credential status">
        <div>
          <span>Authentication</span>
          <strong>JWT · HS256</strong>
        </div>
        <div>
          <span>Client ID</span>
          <strong>{configuration.client_id_configured ? "Saved securely" : "Not saved"}</strong>
        </div>
        <div>
          <span>Client Secret</span>
          <strong>{configuration.client_secret_configured ? "Saved securely" : "Not saved"}</strong>
        </div>
        <div>
          <span>Last updated</span>
          <strong>{displayDate(configuration.updated_at)}</strong>
        </div>
      </div>

      {message ? <p className={state === "error" ? "proofing-api-message proofing-api-message-error" : "proofing-api-message"} role={state === "error" ? "alert" : "status"}>{message}</p> : null}

      <div className="proofing-api-actions">
        <p>
          Client ID and secret sign the Bearer JWT. No Lift user password is used by this API.
        </p>
        <button className="primary-button" type="button" disabled={state === "loading" || state === "saving"} onClick={() => void save()}>
          {state === "saving" && !confirmClear ? "Saving" : proofingApiSaveLabel(configuration, draft)}
        </button>
        {(configuration.configured || configuration.base_url || configuration.company_id) && !confirmClear ? (
          <button className="secondary-button destructive-secondary-button" type="button" disabled={state === "saving"} onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} />
            Clear setup
          </button>
        ) : null}
      </div>

      {confirmClear ? (
        <div className="proofing-api-clear-confirmation" role="group" aria-label={`Confirm clearing ${environmentName} Proofing API setup`}>
          <p>This removes the saved client ID, secret, URL, and company context for this environment only.</p>
          <div>
            <button className="secondary-button" type="button" disabled={state === "saving"} onClick={() => setConfirmClear(false)}>Cancel</button>
            <button className="secondary-button destructive-secondary-button" type="button" disabled={state === "saving"} onClick={() => void clear()}>
              {state === "saving" ? "Clearing" : "Confirm clear"}
            </button>
          </div>
        </div>
      ) : null}

      {configuration.audit_events.length ? (
        <details className="proofing-api-history">
          <summary>Configuration activity</summary>
          <ul>
            {configuration.audit_events.slice(0, 5).map((event) => (
              <li key={event.event_id}>
                <span>{event.action === "replaced" ? "Credentials replaced" : event.action === "cleared" ? "Setup cleared" : "Setup configured"}</span>
                <time dateTime={event.occurred_at}>{displayDate(event.occurred_at)}</time>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
