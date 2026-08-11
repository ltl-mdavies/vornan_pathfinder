const BUCKET = /^vornan-pathfinder-proof-assets-[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export interface ProofAssetPublicationRuntimeConfig {
  enabled: boolean;
  bucket_name: string | null;
  delivery_base_url: "https://go.vornan.co" | null;
  allowed_order_numbers: string[];
  activation_expires_at: string | null;
}

function orderNumbers(value: string | undefined) {
  return [...new Set((value ?? "")
    .split(",")
    .map((candidate) => candidate.trim().toUpperCase())
    .filter((candidate) => /^A\d{7,8}$/.test(candidate)))]
    .slice(0, 25);
}

function timestamp(value: string | undefined) {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function getProofAssetPublicationRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): ProofAssetPublicationRuntimeConfig {
  const bucket = env.PATHFINDER_PROOF_ASSET_BUCKET?.trim() || null;
  if (bucket && !BUCKET.test(bucket)) {
    throw new Error("The Proof asset publication bucket configuration is invalid.");
  }
  const requestedDeliveryBase =
    env.PATHFINDER_PROOF_ASSET_DELIVERY_BASE_URL?.trim() || null;
  if (requestedDeliveryBase && requestedDeliveryBase !== "https://go.vornan.co") {
    throw new Error("The Proof asset delivery origin must be https://go.vornan.co.");
  }
  const deliveryBase = requestedDeliveryBase === "https://go.vornan.co"
    ? requestedDeliveryBase
    : null;
  return {
    enabled: env.PATHFINDER_ENABLE_PROOF_ASSET_PUBLICATION === "true",
    bucket_name: bucket,
    delivery_base_url: deliveryBase,
    allowed_order_numbers: orderNumbers(
      env.PATHFINDER_PROOF_ASSET_PUBLICATION_ALLOWED_ORDERS
    ),
    activation_expires_at: timestamp(
      env.PATHFINDER_PROOF_ASSET_PUBLICATION_EXPIRES_AT
    )
  };
}
