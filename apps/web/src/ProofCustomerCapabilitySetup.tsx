import React, { useEffect, useState } from "react";
import { Eye, EyeOff, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

export type CustomerProofAccessMode = "disabled" | "view_only" | "review";
export type CustomerProofReviewExperience = "simple" | "advanced";

export interface CustomerProofOrderOverride {
  order_number: string;
  access_mode: CustomerProofAccessMode;
  review_experience: CustomerProofReviewExperience;
  updated_at: string;
  updated_by: string;
}

export interface CustomerProofCapabilityPolicy {
  access_mode: CustomerProofAccessMode;
  review_experience: CustomerProofReviewExperience;
  customer_identity: {
    proof_customer_id: string;
    verified_order_number: string;
    verified_at: string;
    verified_by: string;
  } | null;
  order_overrides: CustomerProofOrderOverride[];
  updated_at: string;
  updated_by: string;
}

export interface CustomerProofCapabilityAuditEntry {
  change_id: string;
  scope: "customer" | "order" | "identity";
  order_number: string | null;
  previous_access_mode: CustomerProofAccessMode;
  next_access_mode: CustomerProofAccessMode;
  previous_review_experience: CustomerProofReviewExperience;
  next_review_experience: CustomerProofReviewExperience;
  actor_id: string;
  created_at: string;
  previous_proof_customer_id?: string | null;
  next_proof_customer_id?: string | null;
  verification_order_number?: string | null;
}

const accessOptions: Array<{
  value: CustomerProofAccessMode;
  title: string;
  description: string;
  icon: typeof Eye;
}> = [
  {
    value: "disabled",
    title: "Proof off",
    description: "Do not offer Proof viewing or review access for this customer.",
    icon: EyeOff
  },
  {
    value: "view_only",
    title: "View only",
    description: "Customers can inspect current proofs, but cannot submit a decision.",
    icon: Eye
  },
  {
    value: "review",
    title: "Review enabled",
    description: "Customers can review proofs using the experience selected below.",
    icon: ShieldCheck
  }
];

function normalizedExperience(
  accessMode: CustomerProofAccessMode,
  experience: CustomerProofReviewExperience
) {
  return accessMode === "review" ? experience : "simple";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ProofCustomerCapabilitySetup({
  policy,
  audit,
  busy,
  onSave,
  onUpsertOverride,
  onRemoveOverride,
  onVerifyIdentity
}: {
  policy: CustomerProofCapabilityPolicy;
  audit: CustomerProofCapabilityAuditEntry[];
  busy: boolean;
  onSave: (value: Pick<CustomerProofCapabilityPolicy, "access_mode" | "review_experience">) => Promise<void>;
  onUpsertOverride: (
    orderNumber: string,
    value: Pick<CustomerProofOrderOverride, "access_mode" | "review_experience">
  ) => Promise<void>;
  onRemoveOverride: (orderNumber: string) => Promise<void>;
  onVerifyIdentity: (orderNumber: string) => Promise<void>;
}) {
  const [accessMode, setAccessMode] = useState(policy.access_mode);
  const [experience, setExperience] = useState(policy.review_experience);
  const [orderNumber, setOrderNumber] = useState("");
  const [overrideAccess, setOverrideAccess] = useState<CustomerProofAccessMode>("review");
  const [overrideExperience, setOverrideExperience] =
    useState<CustomerProofReviewExperience>("simple");
  const [identityOrderNumber, setIdentityOrderNumber] = useState("");

  useEffect(() => {
    setAccessMode(policy.access_mode);
    setExperience(policy.review_experience);
  }, [policy.access_mode, policy.review_experience, policy.updated_at]);

  const chooseAccess = (next: CustomerProofAccessMode) => {
    setAccessMode(next);
    setExperience((current) => normalizedExperience(next, current));
  };

  return (
    <div className="proof-capability-body">
      <div className="proof-capability-intro">
        <div>
          <span className="section-eyebrow">Customer default</span>
          <h3>Choose how this customer uses Vornan Proof.</h3>
          <p>Start simple. Add an order exception only when a specific job needs different controls. Changes apply to newly issued links; revoke any active links when turning Proof off.</p>
        </div>
        <span className="proof-capability-safe-default"><ShieldCheck size={15} /> Advanced is never automatic</span>
      </div>

      <div className="proof-experience-choice">
        <div>
          <span className="section-eyebrow">Verified Proof identity</span>
          <strong>{policy.customer_identity ? `Proof customer ${policy.customer_identity.proof_customer_id}` : "Verification required"}</strong>
          <small>{policy.customer_identity
            ? `Verified from ${policy.customer_identity.verified_order_number} on ${formatTimestamp(policy.customer_identity.verified_at)}.`
            : "Verify one associated current Lift order once. Future customer enablement then uses saved settings without a deployment allowlist."}</small>
        </div>
        <div className="proof-segmented-control">
          <input
            value={identityOrderNumber}
            aria-label="Lift order used to verify Proof customer identity"
            placeholder="A0226753"
            onChange={(event) => setIdentityOrderNumber(event.target.value.toUpperCase())}
          />
          <button
            type="button"
            disabled={busy || !/^A\d{7,8}$/.test(identityOrderNumber)}
            onClick={async () => {
              await onVerifyIdentity(identityOrderNumber);
              setIdentityOrderNumber("");
            }}
          >Verify</button>
        </div>
      </div>

      <div className="proof-capability-options" role="radiogroup" aria-label="Customer Proof access">
        {accessOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={accessMode === option.value}
              className={accessMode === option.value ? "is-selected" : ""}
              onClick={() => chooseAccess(option.value)}
            >
              <Icon size={19} />
              <span><strong>{option.title}</strong><small>{option.description}</small></span>
            </button>
          );
        })}
      </div>

      <div className={`proof-experience-choice ${accessMode !== "review" ? "is-disabled" : ""}`}>
        <div>
          <span className="section-eyebrow">Review experience</span>
          <strong>{experience === "advanced" ? "Advanced review" : "Simple review"}</strong>
          <small>
            {experience === "advanced"
              ? "Shows quantity allocation when multiple current creatives share one Lift line."
              : "Keeps review focused on a clear Approve action without quantity controls."}
          </small>
        </div>
        <div className="proof-segmented-control" aria-label="Customer Proof review experience">
          <button
            type="button"
            className={experience === "simple" ? "is-selected" : ""}
            disabled={accessMode !== "review"}
            onClick={() => setExperience("simple")}
          >Simple</button>
          <button
            type="button"
            className={experience === "advanced" ? "is-selected" : ""}
            disabled={accessMode !== "review"}
            onClick={() => setExperience("advanced")}
          ><Sparkles size={14} /> Advanced</button>
        </div>
      </div>

      <div className="proof-capability-actions">
        <small>Saved {formatTimestamp(policy.updated_at)} · Changes are audited.</small>
        <button
          className="primary-button"
          type="button"
        disabled={busy || (accessMode !== "disabled" && !policy.customer_identity)}
          onClick={() => void onSave({
            access_mode: accessMode,
            review_experience: normalizedExperience(accessMode, experience)
          })}
        >{busy ? "Saving" : "Save Proof Settings"}</button>
      </div>

      <div className="proof-order-overrides">
        <div className="proof-order-overrides-heading">
          <div>
            <span className="section-eyebrow">Order exceptions</span>
            <strong>Use a different experience for one Lift order.</strong>
            <small>Order settings override the customer default and can be removed at any time.</small>
          </div>
        </div>
        <div className="proof-order-override-form">
          <label className="setup-control">
            <span>Lift order</span>
            <input
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value.toUpperCase())}
              placeholder="A0226753"
            />
          </label>
          <label className="setup-control">
            <span>Access</span>
            <select
              value={overrideAccess}
              onChange={(event) => {
                const next = event.target.value as CustomerProofAccessMode;
                setOverrideAccess(next);
                setOverrideExperience((current) => normalizedExperience(next, current));
              }}
            >
              <option value="disabled">Proof off</option>
              <option value="view_only">View only</option>
              <option value="review">Review enabled</option>
            </select>
          </label>
          <label className="setup-control">
            <span>Experience</span>
            <select
              value={overrideExperience}
              disabled={overrideAccess !== "review"}
              onChange={(event) => setOverrideExperience(event.target.value as CustomerProofReviewExperience)}
            >
              <option value="simple">Simple</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={busy || !/^A\d{7,8}$/.test(orderNumber)}
            onClick={async () => {
              await onUpsertOverride(orderNumber, {
                access_mode: overrideAccess,
                review_experience: normalizedExperience(overrideAccess, overrideExperience)
              });
              setOrderNumber("");
            }}
          >Add Exception</button>
        </div>

        {policy.order_overrides.length ? (
          <div className="proof-order-override-list">
            {policy.order_overrides.map((override) => (
              <div key={override.order_number}>
                <span><strong>{override.order_number}</strong><small>{override.access_mode === "review" ? `${override.review_experience} review` : override.access_mode === "view_only" ? "view only" : "Proof off"}</small></span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove Proof exception for ${override.order_number}`}
                  disabled={busy}
                  onClick={() => void onRemoveOverride(override.order_number)}
                ><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        ) : <p className="empty-state">No order exceptions. The customer default applies everywhere.</p>}
      </div>

      {audit.length ? (
        <details className="proof-capability-audit">
          <summary>Recent Proof setting changes</summary>
          <div>
            {audit.slice(0, 8).map((entry) => (
              <p key={entry.change_id}>
                <strong>{entry.scope === "identity" ? "Proof identity" : entry.order_number ?? "Customer default"}</strong>
                <span>{entry.scope === "identity"
                  ? `Verified customer ${entry.next_proof_customer_id ?? "—"}`
                  : entry.next_access_mode === "review" ? `${entry.next_review_experience} review` : entry.next_access_mode.replace("_", " ")}</span>
                <small>{formatTimestamp(entry.created_at)}</small>
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
