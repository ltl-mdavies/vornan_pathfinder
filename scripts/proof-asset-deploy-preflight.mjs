import { pathToFileURL } from "node:url";

const ALLOWED_ENVIRONMENTS = new Set(["dev", "qa", "prod"]);
const BUCKET_NAME = /^vornan-pathfinder-proof-assets-[a-z0-9-]+$/;
const WRIKE_DELIVERY_BUCKET_NAME = /^vornan-pathfinder-wrike-delivery-[a-z0-9-]+$/;
const DISALLOWED_CAPABILITY_FLAGS = [
  "PATHFINDER_PROOF_ASSET_ENABLE_UPLOADS",
  "PATHFINDER_PROOF_ASSET_ENABLE_PUBLIC_DELIVERY",
  "PATHFINDER_PROOF_ASSET_ENABLE_SIGNED_URLS",
  "PATHFINDER_PROOF_ASSET_ENABLE_LIFT_PUBLICATION",
  "PATHFINDER_PROOF_ASSET_ENABLE_EXTERNAL_INGEST",
  "PATHFINDER_ENABLE_WRIKE_LIFT_DOCUMENT_PUBLICATION"
];

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function boundedInteger(env, name, fallback, minimum, maximum) {
  const raw = env[name] === undefined || String(env[name]).trim() === "" ? fallback : Number(env[name]);
  if (!Number.isInteger(raw) || raw < minimum || raw > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return raw;
}

export function validateProofAssetDeployment(env = process.env) {
  const environmentName = (env.PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME ?? "dev").trim().toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(environmentName)) {
    throw new Error("PATHFINDER_PROOF_ASSET_ENVIRONMENT_NAME must be dev, qa, or prod.");
  }

  const bucketName = (
    env.PATHFINDER_PROOF_ASSET_BUCKET
    ?? `vornan-pathfinder-proof-assets-${environmentName}-${env.AWS_ACCOUNT_ID ?? "744016783602"}`
  ).trim().toLowerCase();
  if (
    !BUCKET_NAME.test(bucketName)
    || !bucketName.startsWith(`vornan-pathfinder-proof-assets-${environmentName}-`)
  ) {
    throw new Error(
      "PATHFINDER_PROOF_ASSET_BUCKET must use the vornan-pathfinder-proof-assets-{environment}-* boundary."
    );
  }

  const domainName = env.PATHFINDER_PROOF_ASSET_DOMAIN_NAME?.trim() ?? "";
  const certificateArn = env.PATHFINDER_PROOF_ASSET_CERTIFICATE_ARN?.trim() ?? "";
  if (domainName || certificateArn) {
    throw new Error(
      "The dark Proof asset foundation must not configure a DNS alias or certificate; activate those only after resolver/signing readiness."
    );
  }

  const requestedCapability = DISALLOWED_CAPABILITY_FLAGS.find((name) => enabled(env[name]));
  if (requestedCapability) {
    throw new Error(`${requestedCapability} cannot be enabled by the dark Proof asset foundation.`);
  }

  const wrikeDeliveryBucketName = (
    env.PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET
    ?? `vornan-pathfinder-wrike-delivery-${environmentName}-${env.AWS_ACCOUNT_ID ?? "744016783602"}`
  ).trim().toLowerCase();
  if (
    !WRIKE_DELIVERY_BUCKET_NAME.test(wrikeDeliveryBucketName)
    || !wrikeDeliveryBucketName.startsWith(`vornan-pathfinder-wrike-delivery-${environmentName}-`)
  ) {
    throw new Error(
      "PATHFINDER_WRIKE_LIFT_DOCUMENT_DELIVERY_BUCKET must use the vornan-pathfinder-wrike-delivery-{environment}-* boundary."
    );
  }

  const retainedSourceDays = boundedInteger(
    env,
    "PATHFINDER_PROOF_ASSET_RETAINED_SOURCE_DAYS",
    90,
    60,
    90
  );
  const outboundCopyDays = boundedInteger(env, "PATHFINDER_PROOF_ASSET_OUTBOUND_DAYS", 14, 14, 14);
  const proofPacketDays = boundedInteger(env, "PATHFINDER_PROOF_ASSET_PACKET_DAYS", 30, 30, 30);
  const unfinalizedUploadDays = boundedInteger(
    env,
    "PATHFINDER_PROOF_ASSET_UNFINALIZED_DAYS",
    7,
    7,
    7
  );
  const incompleteMultipartDays = boundedInteger(
    env,
    "PATHFINDER_PROOF_ASSET_INCOMPLETE_MULTIPART_DAYS",
    1,
    1,
    1
  );
  const guardDutyMalwareProtectionEnabled = enabled(
    env.PATHFINDER_PROOF_ASSET_MALWARE_PROTECTION_ENABLED
  );
  if (guardDutyMalwareProtectionEnabled && environmentName !== "dev") {
    throw new Error("Proof asset malware protection may be activated only in dev.");
  }

  return {
    environment_name: environmentName,
    stack_name: `vornan-proof-assets-${environmentName}`,
    bucket_name: bucketName,
    wrike_delivery_bucket_name: wrikeDeliveryBucketName,
    retained_source_cleanup_eligibility_days: retainedSourceDays,
    outbound_copy_days: outboundCopyDays,
    proof_packet_days: proofPacketDays,
    unfinalized_upload_days: unfinalizedUploadDays,
    incomplete_multipart_days: incompleteMultipartDays,
    alias_configured: false,
    upload_capability_enabled: false,
    signed_delivery_enabled: false,
    lift_publication_enabled: false,
    external_repository_ingest_enabled: false,
    wrike_document_delivery_enabled: false,
    guardduty_malware_protection_enabled: guardDutyMalwareProtectionEnabled,
    guardduty_protected_prefix: guardDutyMalwareProtectionEnabled ? "orders/" : null,
    guardduty_result_tagging_enabled: guardDutyMalwareProtectionEnabled
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(validateProofAssetDeployment(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Vornan Proof asset deployment preflight failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
    );
    process.exitCode = 1;
  }
}
