import { buildProofLinkEmail, maskEmailAddress, sendTransactionalEmail } from "../email.js";
import { ProofAccessFeatureDisabledError, ProofAccessValidationError, validateProofGrantAccessUrl } from "./access-service.js";
import { recordProofAuditEvent, type ProofAuditContext } from "./audit-service.js";
import { getProofRuntimeConfig } from "./runtime-config.js";
import { getProofOrder } from "./store.js";

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ProofGrantNotFoundError extends Error {
  constructor() {
    super("Proof grant was not found.");
    this.name = "ProofGrantNotFoundError";
  }
}

function validatedRecipient(value: string) {
  const email = value.trim();
  if (email.length > 254 || !EMAIL_ADDRESS.test(email)) {
    throw new ProofAccessValidationError("Enter a valid recipient email address.");
  }
  return email;
}

export async function sendProofGrantLinkEmail(input: {
  grant_id: string;
  recipient_email: string;
  access_url: string;
  audit_context?: ProofAuditContext;
  now?: Date;
}) {
  const config = getProofRuntimeConfig();
  if (!config.feature_flags.proof_link_email) {
    throw new ProofAccessFeatureDisabledError("proof link email");
  }

  const recipient = validatedRecipient(input.recipient_email);
  const now = input.now ?? new Date();
  const grant = await validateProofGrantAccessUrl(input.grant_id, input.access_url, now);
  if (!grant) {
    throw new ProofGrantNotFoundError();
  }
  const order = await getProofOrder(grant.order_number);

  let delivery;
  try {
    delivery = await sendTransactionalEmail(buildProofLinkEmail({
      to: recipient,
      accessUrl: input.access_url,
      expiresAt: grant.expires_at,
      orderNumber: grant.order_number,
      orderTitle: order?.order_title
    }));
  } catch (error) {
    await recordProofAuditEvent({
      action: "proof.link_email_failed",
      outcome: "failed",
      order_number: grant.order_number,
      grant_id: grant.grant_id,
      metadata: {
        grant_scope: grant.scope,
        grant_status: grant.status,
        delivery_status: "failed",
        failure_class: error instanceof Error ? error.name : "UnknownError"
      },
      context: input.audit_context,
      occurred_at: now.toISOString()
    }).catch(() => undefined);
    throw error;
  }

  await recordProofAuditEvent({
    action: "proof.link_email_sent",
    order_number: grant.order_number,
    grant_id: grant.grant_id,
    metadata: {
      grant_scope: grant.scope,
      grant_status: grant.status,
      delivery_mode: delivery.mode,
      delivery_status: delivery.status
    },
    context: input.audit_context,
    occurred_at: now.toISOString()
  });
  return {
    mode: delivery.mode,
    status: delivery.status,
    recipient_masked: maskEmailAddress(recipient)
  };
}
