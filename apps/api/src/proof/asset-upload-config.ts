import { getProofLtlDemoQaProfile, LTL_DEMO_ALL_ORDERS } from "./ltl-demo-qa-profile.js";

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

// A persistent review profile does not grant an unbounded upload window.
// This override is deliberately one exact order; invalid/expired values must
// not fall back to the broader profile or legacy upload allowlist.
function uploadQaWindow(value: string, now: Date) {
  const parts = value.split("|");
  const [expiry = "", order = ""] = parts;
  const parsed = Date.parse(expiry);
  const valid = parts.length === 2 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry) &&
    Number.isFinite(parsed) && parsed > now.getTime() &&
    parsed <= now.getTime() + 24 * 60 * 60 * 1_000 &&
    /^A\d{7,8}$/.test(order);
  return {
    allowed_order_numbers: valid ? [order] : [],
    activation_expires_at: valid ? new Date(parsed).toISOString() : null
  };
}

export function proofAssetUploadGateActive(config: ProofAssetUploadRuntimeConfig, now = new Date()) {
  const expiry = config.activation_expires_at ? Date.parse(config.activation_expires_at) : NaN;
  return config.enabled && !!config.bucket_name && Number.isFinite(expiry) && expiry > now.getTime();
}

export function proofAssetUploadOrderAllowed(config: Pick<ProofAssetUploadRuntimeConfig, "allowed_order_numbers">, order: string) {
  return /^A\d{7,8}$/.test(order) &&
    (config.allowed_order_numbers.includes(order) || config.allowed_order_numbers.includes(LTL_DEMO_ALL_ORDERS));
}

export function proofAssetUploadAllowed(config: ProofAssetUploadRuntimeConfig, customerId: string, order: string, now = new Date()) {
  return customerId === config.allowed_customer_id && proofAssetUploadGateActive(config, now) && proofAssetUploadOrderAllowed(config, order);
}

export function getProofAssetUploadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): ProofAssetUploadRuntimeConfig {
  const ltlDemoQa = getProofLtlDemoQaProfile(env, now);
  const bucket = env.PATHFINDER_PROOF_ASSET_BUCKET?.trim() || null;
  if (bucket && !BUCKET.test(bucket)) {
    throw new Error("The Proof asset bucket configuration is invalid.");
  }
  const qaWindow = env.PATHFINDER_PROOF_ASSET_UPLOAD_QA_WINDOW?.trim();
  const scope = qaWindow ? uploadQaWindow(qaWindow, now) : {
    allowed_order_numbers: ltlDemoQa.asset_upload_enabled
      ? ltlDemoQa.allowed_order_numbers
      : orderNumbers(env.PATHFINDER_PROOF_ASSET_UPLOAD_ALLOWED_ORDERS),
    activation_expires_at: ltlDemoQa.asset_upload_enabled
      ? ltlDemoQa.activation_expires_at
      : optionalTimestamp(env.PATHFINDER_PROOF_ASSET_UPLOAD_EXPIRES_AT)
  };
  return {
    enabled:
      env.PATHFINDER_ENABLE_PROOF_ASSET_UPLOAD === "true" ||
      ltlDemoQa.asset_upload_enabled,
    bucket_name: bucket,
    allowed_customer_id: "1249",
    ...scope,
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
