import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function entries(items, keyName, valueName) {
  return Object.fromEntries((items ?? []).map((item) => [item[keyName], item[valueName]]));
}

function enabled(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function certificateCovers(name, certificate) {
  if (!name || !certificate) return false;
  const names = new Set([certificate.DomainName, ...(certificate.SubjectAlternativeNames ?? [])].filter(Boolean));
  if (names.has(name)) return true;
  return [...names].some((candidate) => {
    if (!candidate.startsWith("*.")) return false;
    const suffix = candidate.slice(1);
    return name.endsWith(suffix) && name.split(".").length === candidate.split(".").length;
  });
}

export function evaluateProofDnsReadiness({ stack, distribution, certificate, darkSmokeConfirmed = false }) {
  const outputs = entries(stack?.Outputs, "OutputKey", "OutputValue");
  const parameters = entries(stack?.Parameters, "ParameterKey", "ParameterValue");
  const recordName = outputs.ProofDnsRecordName ?? null;
  const recordTarget = outputs.ProofDnsRecordValue ?? null;
  const aliases = distribution?.DistributionConfig?.Aliases?.Items ?? [];
  const stackReady = /^(CREATE|UPDATE)_COMPLETE$/.test(stack?.StackStatus ?? "");
  const distributionReady = distribution?.Status === "Deployed";
  const aliasReady = Boolean(recordName) && aliases.includes(recordName);
  const certificateIssued = certificate?.Status === "ISSUED";
  const certificateMatches = certificateCovers(recordName, certificate);
  const publicReadDark = parameters.PublicReadEnabled === "false";
  const valuesAvailable = Boolean(recordName && recordTarget && outputs.ProofWebDistributionId);

  const gates = {
    stack_complete: stackReady,
    cname_values_available: valuesAvailable,
    cloudfront_deployed: distributionReady,
    cloudfront_alias_matches: aliasReady,
    certificate_issued: certificateIssued,
    certificate_covers_alias: certificateMatches,
    public_read_remains_off: publicReadDark,
    dark_smoke_confirmed: Boolean(darkSmokeConfirmed)
  };
  const reasons = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([gate]) => gate);
  const ready = reasons.length === 0;
  const zone = "vornan.co";
  const host = recordName?.endsWith(`.${zone}`) ? recordName.slice(0, -(zone.length + 1)) : recordName;

  return {
    status: ready ? "ready_to_add_cname" : "not_ready",
    ready_to_add_cname: ready,
    record: valuesAvailable
      ? {
          provider: "Cloudflare",
          zone,
          type: outputs.ProofDnsRecordType ?? "CNAME",
          host,
          name: recordName,
          target: recordTarget,
          proxy: outputs.ProofDnsProxyMode ?? "DNS-only",
          ttl: outputs.ProofDnsTtl ?? "Auto"
        }
      : null,
    distribution: {
      id: outputs.ProofWebDistributionId ?? null,
      domain_name: outputs.ProofWebDistributionDomainName ?? null,
      status: distribution?.Status ?? null
    },
    gates,
    unmet_gates: reasons
  };
}

function awsJson(args) {
  return JSON.parse(execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  }));
}

function githubSummary(result, stackName) {
  const lines = [
    "## Vornan Proof DNS handoff",
    "",
    `Stack: \`${stackName}\``,
    "",
    result.ready_to_add_cname
      ? "Status: **ready to add the CNAME**. The deployment remained dark and the isolated smoke passed."
      : `Status: **do not add the CNAME**. Unmet gates: ${result.unmet_gates.map((gate) => `\`${gate}\``).join(", ")}.`
  ];
  if (result.record) {
    lines.push(
      "",
      "| Setting | Value |",
      "| --- | --- |",
      `| Type | \`${result.record.type}\` |`,
      `| Host | \`${result.record.host}\` |`,
      `| Target | \`${result.record.target}\` |`,
      `| Proxy | \`${result.record.proxy}\` |`,
      `| TTL | \`${result.record.ttl}\` |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
    const environmentName = process.env.PATHFINDER_PROOF_ENVIRONMENT_NAME?.trim() || "dev";
    const stackName = process.env.PATHFINDER_PROOF_STACK_NAME?.trim() || `vornan-proof-${environmentName}`;
    const stackResponse = awsJson([
      "cloudformation", "describe-stacks", "--stack-name", stackName, "--region", region
    ]);
    const stack = stackResponse.Stacks?.[0];
    if (!stack) throw new Error(`CloudFormation stack ${stackName} was not found.`);

    const outputs = entries(stack.Outputs, "OutputKey", "OutputValue");
    const parameters = entries(stack.Parameters, "ParameterKey", "ParameterValue");
    const distributionResponse = outputs.ProofWebDistributionId
      ? awsJson(["cloudfront", "get-distribution", "--id", outputs.ProofWebDistributionId, "--region", "us-east-1"])
      : {};
    const certificateResponse = parameters.CertificateArn
      ? awsJson(["acm", "describe-certificate", "--certificate-arn", parameters.CertificateArn, "--region", "us-east-1"])
      : {};
    const result = evaluateProofDnsReadiness({
      stack,
      distribution: distributionResponse.Distribution,
      certificate: certificateResponse.Certificate,
      darkSmokeConfirmed: enabled(process.env.PATHFINDER_PROOF_DARK_SMOKE_CONFIRMED)
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (enabled(process.env.PATHFINDER_PROOF_DNS_GITHUB_SUMMARY) && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, githubSummary(result, stackName), "utf8");
    }
    if (enabled(process.env.PATHFINDER_PROOF_REQUIRE_DNS_READY) && !result.ready_to_add_cname) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`Vornan Proof DNS readiness check failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  }
}
