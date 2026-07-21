import { pathToFileURL } from "node:url";

const TRUE = "true";
const ALLOWED_ENVIRONMENTS = new Set(["dev", "qa", "prod"]);
const PRODUCTION_LIFT_HOSTS = new Set(["admin.lifterp.com", "ltlco.lifterp.com"]);
const PRODUCTION_PROOF_DOMAIN = "proof.vornan.co";
const US_EAST_1_CERTIFICATE_ARN = /^arn:aws[a-zA-Z-]*:acm:us-east-1:\d{12}:certificate\/[0-9a-fA-F-]+$/;
const DNS_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const WRITE_FLAG_NAMES = [
  "PATHFINDER_PROOF_ENABLE_APPROVE",
  "PATHFINDER_PROOF_ENABLE_REVISION",
  "PATHFINDER_PROOF_ENABLE_UNDO",
  "PATHFINDER_PROOF_ENABLE_LIFT_WRITES"
];

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === TRUE;
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function boundedInteger(env, name, fallback, minimum, maximum) {
  const value = env[name] === undefined || String(env[name]).trim() === "" ? fallback : Number(env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function futureUtcTimestamp(env, name) {
  const value = required(env, name);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`${name} must be an ISO 8601 UTC timestamp ending in Z.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new Error(`${name} must be a future timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

function customerIdCohort(env, name) {
  const value = env[name]?.trim() ?? "";
  if (!value) return [];
  if (!/^\d{1,20}(,\d{1,20}){0,19}$/.test(value)) {
    throw new Error(`${name} must contain 1 through 20 comma-separated numeric customer IDs without spaces.`);
  }
  const values = value.split(",");
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} must not contain duplicate customer IDs.`);
  }
  return values;
}

function safePublicBaseUrl(env, name) {
  const value = required(env, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash
    || parsed.hostname.endsWith(".invalid")
    || !parsed.hostname.endsWith(".cloudfront.net")
  ) {
    throw new Error(`${name} must be the direct CloudFront HTTPS origin without credentials, path, query, or fragment.`);
  }
  return parsed.origin;
}

function liftReadUrl(value, name, expectedReport) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${name} must use HTTPS and must not contain URL credentials.`);
  }
  if (!parsed.pathname.toLowerCase().includes(`/${expectedReport.toLowerCase()}/n`)) {
    throw new Error(`${name} must target the ${expectedReport}/N report.`);
  }
  return parsed;
}

export function validateProofDeployment(env = process.env) {
  const environmentName = (env.PATHFINDER_PROOF_ENVIRONMENT_NAME ?? "dev").trim().toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(environmentName)) {
    throw new Error("PATHFINDER_PROOF_ENVIRONMENT_NAME must be dev, qa, or prod.");
  }
  const liftEnvironment = required(env, "PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT").toLowerCase();
  if (liftEnvironment !== environmentName) {
    throw new Error("PATHFINDER_PROOF_LIFT_READ_ENVIRONMENT must match PATHFINDER_PROOF_ENVIRONMENT_NAME.");
  }

  const orderReadUrl = liftReadUrl(
    required(env, "PATHFINDER_PROOF_LIFT_ORDER_READ_URL"),
    "PATHFINDER_PROOF_LIFT_ORDER_READ_URL",
    "AS360Orders"
  );
  const reportReadUrl = liftReadUrl(
    required(env, "PATHFINDER_PROOF_LIFT_REPORT_READ_URL"),
    "PATHFINDER_PROOF_LIFT_REPORT_READ_URL",
    "AS360ProofReport"
  );
  const productionReads = [orderReadUrl, reportReadUrl].some((url) => PRODUCTION_LIFT_HOSTS.has(url.hostname));
  if (environmentName !== "prod" && productionReads && !enabled(env.PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS)) {
    throw new Error(
      "Non-production deployment targets a production Lift hostname; set PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS=true only after explicit review."
    );
  }
  if ((env.PATHFINDER_PROOF_EDGE_SHARED_SECRET?.trim().length ?? 0) < 32) {
    throw new Error("PATHFINDER_PROOF_EDGE_SHARED_SECRET must contain at least 32 characters for every deployed Proof stack.");
  }
  const automaticRefreshMaxInactiveDays = boundedInteger(
    env,
    "PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS",
    14,
    1,
    365
  );

  const proofDomain = env.PATHFINDER_PROOF_DOMAIN_NAME?.trim().toLowerCase() ?? "";
  const certificateArn = env.PATHFINDER_PROOF_CERTIFICATE_ARN?.trim() ?? "";
  if (Boolean(proofDomain) !== Boolean(certificateArn)) {
    throw new Error("PATHFINDER_PROOF_DOMAIN_NAME and PATHFINDER_PROOF_CERTIFICATE_ARN must be supplied together.");
  }
  if (proofDomain && !DNS_NAME.test(proofDomain)) {
    throw new Error("PATHFINDER_PROOF_DOMAIN_NAME must be a valid lowercase DNS name.");
  }
  if (certificateArn && !US_EAST_1_CERTIFICATE_ARN.test(certificateArn)) {
    throw new Error("PATHFINDER_PROOF_CERTIFICATE_ARN must be an ACM certificate ARN in us-east-1.");
  }
  if (environmentName === "prod" && proofDomain && proofDomain !== PRODUCTION_PROOF_DOMAIN) {
    throw new Error(`The production Proof domain must be ${PRODUCTION_PROOF_DOMAIN}.`);
  }

  const requestedWriteFlag = WRITE_FLAG_NAMES.find((name) => enabled(env[name]));
  if (requestedWriteFlag) {
    throw new Error(`${requestedWriteFlag} cannot be enabled in the read-only Vornan Proof deployment.`);
  }

  const publicReadEnabled = enabled(env.PATHFINDER_PROOF_ENABLE_PUBLIC_READ);
  const syntheticQaEnabled = enabled(env.PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA);
  const operatorGrantCreationEnabled = enabled(env.PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED);
  const grantAllowedCustomerIds = customerIdCohort(env, "PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS");
  const managedWafEnabled = enabled(env.PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED);
  const sharedWebAclConfigured = Boolean(env.PATHFINDER_PROOF_WEB_ACL_ARN?.trim());
  let readOnlyActivationExpiresAt = null;
  if (
    syntheticQaEnabled
    && (
      environmentName !== "dev"
      || publicReadEnabled
      || enabled(env.PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED)
      || enabled(env.PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED)
      || enabled(env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL)
      || Boolean(proofDomain)
      || Boolean(certificateArn)
    )
  ) {
    throw new Error(
      "PATHFINDER_PROOF_ENABLE_SYNTHETIC_QA=true is allowed only in the fully dark dev stack."
    );
  }
  if (publicReadEnabled) {
    readOnlyActivationExpiresAt = futureUtcTimestamp(env, "PATHFINDER_PROOF_READ_ONLY_ACTIVATION_EXPIRES_AT");
    if (!enabled(env.PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED)) {
      throw new Error("PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED=true is required before public read can be enabled.");
    }
    if (!managedWafEnabled && !sharedWebAclConfigured) {
      throw new Error("A managed or shared WAF is required before public read can be enabled.");
    }
    if (environmentName === "prod" && !enabled(env.PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED)) {
      throw new Error("PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED=true is required for production public read.");
    }
  }
  let operatorPublicBaseUrl = null;
  if (operatorGrantCreationEnabled) {
    if (
      environmentName !== "dev"
      || !publicReadEnabled
      || !enabled(env.PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED)
      || enabled(env.PATHFINDER_PROOF_PRODUCTION_PUBLIC_READ_APPROVED)
      || syntheticQaEnabled
      || enabled(env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL)
      || Boolean(proofDomain)
      || Boolean(certificateArn)
    ) {
      throw new Error(
        "PATHFINDER_PROOF_OPERATOR_GRANT_CREATION_ENABLED=true requires the bounded dev-only read window with synthetic QA, production approval, email, and DNS disabled."
      );
    }
    if (grantAllowedCustomerIds.length === 0) {
      throw new Error("PATHFINDER_PROOF_GRANT_ALLOWED_CUSTOMER_IDS is required for the operator window.");
    }
    operatorPublicBaseUrl = safePublicBaseUrl(env, "PATHFINDER_PROOF_PUBLIC_BASE_URL");
  }

  return {
    environment_name: environmentName,
    lift_environment: liftEnvironment,
    lift_order_host: orderReadUrl.hostname,
    lift_report_host: reportReadUrl.hostname,
    production_reads_acknowledged:
      environmentName === "prod" || !productionReads || enabled(env.PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS),
    public_read_enabled: publicReadEnabled,
    read_only_activation_expires_at: readOnlyActivationExpiresAt,
    read_only_qa_confirmed: enabled(env.PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED),
    waf_configured: managedWafEnabled || sharedWebAclConfigured,
    proof_alias_configured: Boolean(proofDomain),
    proof_domain: proofDomain || null,
    automatic_refresh_max_inactive_days: automaticRefreshMaxInactiveDays,
    synthetic_qa_enabled: syntheticQaEnabled,
    operator_grant_creation_enabled: operatorGrantCreationEnabled,
    operator_cohort_size: grantAllowedCustomerIds.length,
    operator_public_base_url: operatorPublicBaseUrl,
    lift_writes_enabled: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(validateProofDeployment(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Vornan Proof deployment preflight failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  }
}
