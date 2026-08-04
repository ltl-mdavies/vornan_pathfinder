export interface ProofOperatorActionQaConfig {
  enabled: boolean;
  allowed_customer_id: "1249";
  allowed_company_id: "91";
  allowed_order_numbers: string[];
  jwt_ttl_seconds: 60;
  activation_expires_at: string | null;
  advanced_quantity_allocation_enabled: boolean;
}

function orderNumbers(value: string | undefined) {
  return [...new Set((value ?? "")
    .split(",")
    .map((candidate) => candidate.trim().toUpperCase())
    .filter((candidate) => /^A\d{7,8}$/.test(candidate)))]
    .slice(0, 25);
}

function optionalTimestamp(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function getProofOperatorActionQaConfig(): ProofOperatorActionQaConfig {
  return {
    enabled: process.env.PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA === "true",
    allowed_customer_id: "1249",
    allowed_company_id: "91",
    allowed_order_numbers: orderNumbers(
      process.env.PATHFINDER_PROOF_OPERATOR_ACTION_ALLOWED_ORDERS
    ),
    jwt_ttl_seconds: 60,
    advanced_quantity_allocation_enabled:
      process.env.PATHFINDER_ENABLE_PROOF_ADVANCED_REVIEW === "true",
    activation_expires_at: optionalTimestamp(
      process.env.PATHFINDER_PROOF_OPERATOR_ACTION_EXPIRES_AT
    )
  };
}
