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
  const managedWafEnabled = enabled(env.PATHFINDER_PROOF_MANAGED_WEB_ACL_ENABLED);
  const sharedWebAclConfigured = Boolean(env.PATHFINDER_PROOF_WEB_ACL_ARN?.trim());
  if (publicReadEnabled) {
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

  return {
    environment_name: environmentName,
    lift_environment: liftEnvironment,
    lift_order_host: orderReadUrl.hostname,
    lift_report_host: reportReadUrl.hostname,
    production_reads_acknowledged:
      environmentName === "prod" || !productionReads || enabled(env.PATHFINDER_PROOF_ACKNOWLEDGE_PRODUCTION_READS),
    public_read_enabled: publicReadEnabled,
    read_only_qa_confirmed: enabled(env.PATHFINDER_PROOF_READ_ONLY_QA_CONFIRMED),
    waf_configured: managedWafEnabled || sharedWebAclConfigured,
    proof_alias_configured: Boolean(proofDomain),
    proof_domain: proofDomain || null,
    automatic_refresh_max_inactive_days: automaticRefreshMaxInactiveDays,
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
