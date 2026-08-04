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

function operatorActionScope() {
  const packed = process.env.PATHFINDER_PROOF_OPERATOR_ACTION_SCOPE;
  if (packed !== undefined) {
    const parts = packed.split("|");
    if (parts.length !== 4) {
      return {
        enabled: false,
        allowedOrders: "",
        expiresAt: "",
        advancedEnabled: false
      };
    }
    return {
      enabled: parts[0] === "true",
      allowedOrders: parts[1] ?? "",
      expiresAt: parts[2] ?? "",
      advancedEnabled: parts[3] === "true"
    };
  }
  return {
    enabled: process.env.PATHFINDER_ENABLE_PROOF_OPERATOR_ACTION_QA === "true",
    allowedOrders:
      process.env.PATHFINDER_PROOF_OPERATOR_ACTION_ALLOWED_ORDERS ?? "",
    expiresAt: process.env.PATHFINDER_PROOF_OPERATOR_ACTION_EXPIRES_AT ?? "",
    advancedEnabled:
      process.env.PATHFINDER_ENABLE_PROOF_ADVANCED_REVIEW === "true"
  };
}

export function getProofOperatorActionQaConfig(): ProofOperatorActionQaConfig {
  const scope = operatorActionScope();
  return {
    enabled: scope.enabled,
    allowed_customer_id: "1249",
    allowed_company_id: "91",
    allowed_order_numbers: orderNumbers(scope.allowedOrders),
    jwt_ttl_seconds: 60,
    advanced_quantity_allocation_enabled: scope.advancedEnabled,
    activation_expires_at: optionalTimestamp(scope.expiresAt)
  };
}
