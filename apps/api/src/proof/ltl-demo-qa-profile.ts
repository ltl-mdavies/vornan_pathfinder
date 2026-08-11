const LTL_DEMO_CUSTOMER_ID = "1249" as const;
const PROFILE_SESSION_TTL_MINUTES = 12 * 60;
const MAXIMUM_PROFILE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface ProofLtlDemoQaProfile {
  configured: boolean;
  active: boolean;
  allowed_customer_id: typeof LTL_DEMO_CUSTOMER_ID;
  allowed_order_numbers: string[];
  activation_expires_at: string | null;
  grant_creation_enabled: boolean;
  public_read_enabled: boolean;
  customer_approval_enabled: boolean;
  asset_upload_enabled: boolean;
  session_ttl_minutes: typeof PROFILE_SESSION_TTL_MINUTES;
  automatic_retry: false;
}

function enabled(value: string | undefined) {
  return value === "true";
}

function timestamp(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function orderNumbers(value: string | undefined) {
  return [...new Set((value ?? "")
    .split(",")
    .map((candidate) => candidate.trim().toUpperCase())
    .filter((candidate) => /^A\d{7,8}$/.test(candidate)))]
    .slice(0, 25);
}

/**
 * One packed, default-off QA profile. The profile never enables publication,
 * scan processing, operator Lift actions, email, or automatic retry.
 */
export function getProofLtlDemoQaProfile(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): ProofLtlDemoQaProfile {
  const [
    packedEnabled,
    packedExpiry,
    packedOrders,
    packedGrantCreation,
    packedPublicRead,
    packedCustomerApproval,
    packedAssetUpload
  ] =
    (env.PATHFINDER_PROOF_LTL_DEMO_QA_SCOPE ?? "").split("|");
  const configured = enabled(packedEnabled);
  const activationExpiresAt = timestamp(packedExpiry);
  const allowedOrderNumbers = orderNumbers(packedOrders);
  const expiry = activationExpiresAt ? Date.parse(activationExpiresAt) : Number.NaN;
  const active = Boolean(
    configured &&
    allowedOrderNumbers.length > 0 &&
    Number.isFinite(expiry) &&
    expiry > now.getTime() &&
    expiry <= now.getTime() + MAXIMUM_PROFILE_WINDOW_MS
  );

  return {
    configured,
    active,
    allowed_customer_id: LTL_DEMO_CUSTOMER_ID,
    allowed_order_numbers: allowedOrderNumbers,
    activation_expires_at: activationExpiresAt,
    grant_creation_enabled: active && enabled(packedGrantCreation),
    public_read_enabled: active && enabled(packedPublicRead),
    customer_approval_enabled: active && enabled(packedCustomerApproval),
    asset_upload_enabled: active && enabled(packedAssetUpload),
    session_ttl_minutes: PROFILE_SESSION_TTL_MINUTES,
    automatic_retry: false
  };
}
