import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProofDnsReadiness } from "../proof-dns-readiness.mjs";

const domain = "proof.vornan.co";
const target = "d111111abcdef8.cloudfront.net";
const stack = {
  StackStatus: "UPDATE_COMPLETE",
  Parameters: [
    { ParameterKey: "PublicReadEnabled", ParameterValue: "false" },
    { ParameterKey: "CertificateArn", ParameterValue: "arn:aws:acm:us-east-1:123456789012:certificate/example" }
  ],
  Outputs: [
    { OutputKey: "ProofWebDistributionId", OutputValue: "E123EXAMPLE" },
    { OutputKey: "ProofWebDistributionDomainName", OutputValue: target },
    { OutputKey: "ProofDnsRecordType", OutputValue: "CNAME" },
    { OutputKey: "ProofDnsRecordName", OutputValue: domain },
    { OutputKey: "ProofDnsRecordValue", OutputValue: target },
    { OutputKey: "ProofDnsProxyMode", OutputValue: "DNS-only" },
    { OutputKey: "ProofDnsTtl", OutputValue: "Auto" }
  ]
};
const distribution = {
  Status: "Deployed",
  DistributionConfig: { Aliases: { Items: [domain] } }
};
const certificate = {
  Status: "ISSUED",
  DomainName: "*.vornan.co",
  SubjectAlternativeNames: ["vornan.co", "*.vornan.co"]
};

test("returns the exact Cloudflare CNAME values only after every dark cutover gate passes", () => {
  const result = evaluateProofDnsReadiness({ stack, distribution, certificate, darkSmokeConfirmed: true });
  assert.equal(result.ready_to_add_cname, true);
  assert.deepEqual(result.record, {
    provider: "Cloudflare",
    zone: "vornan.co",
    type: "CNAME",
    host: "proof",
    name: domain,
    target,
    proxy: "DNS-only",
    ttl: "Auto"
  });
});

test("blocks DNS when the dark smoke has not been confirmed", () => {
  const result = evaluateProofDnsReadiness({ stack, distribution, certificate });
  assert.equal(result.ready_to_add_cname, false);
  assert.deepEqual(result.unmet_gates, ["dark_smoke_confirmed"]);
});

test("blocks DNS for an unissued or mismatched certificate", () => {
  const result = evaluateProofDnsReadiness({
    stack,
    distribution,
    certificate: { Status: "PENDING_VALIDATION", DomainName: "unrelated.example" },
    darkSmokeConfirmed: true
  });
  assert.equal(result.ready_to_add_cname, false);
  assert.equal(result.gates.certificate_issued, false);
  assert.equal(result.gates.certificate_covers_alias, false);
});

test("does not suggest a record before the alias-specific stack outputs exist", () => {
  const noAliasStack = {
    ...stack,
    Outputs: stack.Outputs.filter(({ OutputKey }) => !OutputKey.startsWith("ProofDns"))
  };
  const result = evaluateProofDnsReadiness({
    stack: noAliasStack,
    distribution: { ...distribution, DistributionConfig: { Aliases: { Quantity: 0 } } },
    certificate: null,
    darkSmokeConfirmed: true
  });
  assert.equal(result.ready_to_add_cname, false);
  assert.equal(result.record, null);
  assert.equal(result.gates.cname_values_available, false);
});

test("requires the initial DNS handoff deployment to remain dark", () => {
  const liveStack = {
    ...stack,
    Parameters: stack.Parameters.map((parameter) =>
      parameter.ParameterKey === "PublicReadEnabled" ? { ...parameter, ParameterValue: "true" } : parameter
    )
  };
  const result = evaluateProofDnsReadiness({ stack: liveStack, distribution, certificate, darkSmokeConfirmed: true });
  assert.equal(result.ready_to_add_cname, false);
  assert.equal(result.gates.public_read_remains_off, false);
});
