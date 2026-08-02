const BUCKET = /^vornan-pathfinder-proof-assets-[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export interface ProofAssetUploadRuntimeConfig {
  enabled: boolean;
  bucket_name: string | null;
  allowed_customer_id: "1249";
  allowed_order_numbers: string[];
  activation_expires_at: string | null;
  maximum_bytes: number;
  upload_ticket_seconds: 600;
  allowed_content_types: readonly string[];
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

export function getProofAssetUploadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): ProofAssetUploadRuntimeConfig {
  const bucket = env.PATHFINDER_PROOF_ASSET_BUCKET?.trim() || null;
  if (bucket && !BUCKET.test(bucket)) {
    throw new Error("The Proof asset bucket configuration is invalid.");
  }
  return {
    enabled: env.PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD === "true",
    bucket_name: bucket,
    allowed_customer_id: "1249",
    allowed_order_numbers: orderNumbers(
      env.PATHFINDER_PROOF_ASSET_UPLOAD_ALLOWED_ORDERS
    ),
    activation_expires_at: optionalTimestamp(
      env.PATHFINDER_PROOF_ASSET_UPLOAD_EXPIRES_AT
    ),
    maximum_bytes: 1024 * 1024 * 1024,
    upload_ticket_seconds: 600,
    allowed_content_types: Object.freeze([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/tiff",
      "image/vnd.adobe.photoshop",
      "application/postscript"
    ])
  };
}
