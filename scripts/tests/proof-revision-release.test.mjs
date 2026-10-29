import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const template = parse(source("infra/aws/proof-cloudformation.yaml"), {
  customTags: ["Ref", "Sub", "GetAtt", "Condition"].map((name) => ({
    tag: `!${name}`, resolve: (value) => ({ [name]: value })
  })).concat(["Equals", "If", "And", "Or", "Not", "Join", "Sub"].map((name) => ({
    tag: `!${name}`, collection: "seq", resolve: (value) => ({ [name]: value.toJSON() })
  })))
});
const workflow = parse(source(".github/workflows/deploy-proof.yml"));
const inputs = workflow.on.workflow_dispatch.inputs;
const defaults = Object.fromEntries(Object.entries(template.Parameters).map(([name, value]) => [name, value.Default]));

function evaluate(expression, values) {
  if (expression === null || typeof expression !== "object") return expression;
  const [[operator, args]] = Object.entries(expression);
  if (operator === "Ref") return values[args];
  if (operator === "Equals") return evaluate(args[0], values) === evaluate(args[1], values);
  if (operator === "Not") return !evaluate(args[0], values);
  if (operator === "And") return args.every((arg) => evaluate(arg, values));
  if (operator === "Or") return args.some((arg) => evaluate(arg, values));
  throw new Error(`Unexpected rule operator ${operator}`);
}
const rule = template.Rules.CustomerRevisionSubmissionRequiresAuthority;
const permits = (overrides) => {
  const values = { ...defaults, ...overrides };
  return !evaluate(rule.RuleCondition, values) || rule.Assertions.every(({ Assert }) => evaluate(Assert, values));
};

test("revision submission defaults off with exact empty scope in both deployment entrypoints", () => {
  assert.equal(defaults.CustomerRevisionSubmissionEnabled, "false");
  assert.deepEqual(template.Parameters.CustomerRevisionSubmissionEnabled.AllowedValues, ["true", "false"]);
  assert.equal(defaults.CustomerRevisionScope, "");
  assert.equal(inputs.customer_revision_submission_enabled.default, "false");
  assert.equal(inputs.customer_revision_scope.default, "");
  assert.deepEqual(inputs.customer_revision_submission_enabled.options, ["false", "true"]);
  const shell = source("scripts/deploy-proof-stack.sh");
  assert.ok(shell.includes('CustomerRevisionSubmissionEnabled="${PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_SUBMISSION:-false}"'));
  assert.ok(shell.includes('CustomerRevisionScope="${PATHFINDER_PROOF_CUSTOMER_REVISION_SCOPE:-}"'));
  const deploySteps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const deploy = deploySteps.find((step) => step.run?.includes("CustomerRevisionSubmissionEnabled="));
  assert.ok(deploy);
  assert.equal(deploy.env.CUSTOMER_REVISION_SUBMISSION_ENABLED, "${{ inputs.customer_revision_submission_enabled }}");
  assert.equal(deploy.env.CUSTOMER_REVISION_SCOPE, "${{ inputs.customer_revision_scope }}");
  assert.ok(deploy.run.includes('CustomerRevisionSubmissionEnabled="${CUSTOMER_REVISION_SUBMISSION_ENABLED}"'));
  assert.ok(deploy.run.includes('CustomerRevisionScope="${CUSTOMER_REVISION_SCOPE}"'));
});

test("revision scope excludes broad cohorts, wildcards and malformed pairs", () => {
  const pattern = new RegExp(template.Parameters.CustomerRevisionScope.AllowedPattern);
  for (const value of ["", "1249:A0232139", "1249:A0232139,284619:A0230112"]) assert.ok(pattern.test(value), value);
  for (const value of ["*", "1249:*", "LTL_DEMO_ALL", "A0232139", "1249", "1249:A0232139,", "1249: A0232139", "1249:A123", "1249:A0232139\n*", Array(26).fill("1249:A0232139").join(",")]) {
    assert.equal(pattern.test(value), false, value);
  }
});

test("submission requires a complete existing authority path, not mixed partial gates", () => {
  const flags = ["CustomerApprovalEnabled", "CustomerRevisionUploadEnabled", "LtlDemoQaEnabled", "LtlDemoQaSessionReadEnabled", "LtlDemoQaCustomerApprovalEnabled", "LtlDemoQaRevisionUploadEnabled"];
  for (let mask = 0; mask < 64; mask += 1) {
    const overrides = Object.fromEntries(flags.map((flag, index) => [flag, (mask & (1 << index)) ? "true" : "false"]));
    overrides.CustomerRevisionSubmissionEnabled = "true";
    overrides.CustomerRevisionScope = "1249:A0232139";
    const normal = (mask & 3) === 3;
    const qa = (mask & 60) === 60;
    assert.equal(permits(overrides), normal || qa, JSON.stringify(overrides));
    assert.equal(permits({ ...overrides, CustomerRevisionScope: "" }), false);
  }
});

test("disabling submission allows retained scope for read-only receipt recovery", () => {
  assert.equal(permits({}), true);
  assert.equal(permits({ CustomerRevisionScope: "1249:A0232139" }), true);
});

test("upload QA window is empty by default and accepts exactly one order with a UTC timestamp", () => {
  assert.equal(defaults.ProofAssetUploadQaWindow, "");
  assert.equal(inputs.proof_asset_upload_qa_window.default, "");
  const pattern = new RegExp(template.Parameters.ProofAssetUploadQaWindow.AllowedPattern);
  for (const value of ["", "2026-10-29T20:00:00Z|A0232139", "2026-10-29T20:00:00.123Z|A0232139"]) assert.ok(pattern.test(value), value);
  for (const value of ["*", "LTL_DEMO_ALL", "2026-10-29T20:00:00Z|LTL_DEMO_ALL", "2026-10-29T20:00:00Z|A0232139,A0233367", "2026-10-29T20:00:00Z|*", "2026-10-29T20:00:00+00:00|A0232139", "2026-10-29T20:00:00Z|A123", "2026-10-29T20:00:00Z| A0232139"]) assert.equal(pattern.test(value), false, value);
});

test("upload QA override is public-only and wired through both isolated deployment entrypoints", () => {
  const key = "PATHFINDER_PROOF_ASSET_UPLOAD_QA_WINDOW";
  for (const [name, resource] of Object.entries(template.Resources)) {
    if (resource.Type !== "AWS::Lambda::Function") continue;
    const actual = resource.Properties.Environment?.Variables?.[key];
    if (name === "ProofPublicFunction") assert.deepEqual(actual, {Ref: "ProofAssetUploadQaWindow"});
    else assert.equal(actual, undefined, name);
  }
  assert.ok(source("scripts/deploy-proof-stack.sh").includes('ProofAssetUploadQaWindow="${PATHFINDER_PROOF_ASSET_UPLOAD_QA_WINDOW:-}"'));
  const step = Object.values(workflow.jobs).flatMap(job => job.steps ?? []).find(step => step.run?.includes('ProofAssetUploadQaWindow='));
  assert.equal(step.env.PROOF_ASSET_UPLOAD_QA_WINDOW, "${{ inputs.proof_asset_upload_qa_window }}");
  assert.ok(step.run.includes('ProofAssetUploadQaWindow="${PROOF_ASSET_UPLOAD_QA_WINDOW}"'));
  assert.equal(source("infra/aws/api-cloudformation.yaml").includes(key), false);
});

test("revision variables are confined to the public function without changing worker artifacts", () => {
  const expected = {
    PATHFINDER_PROOF_ENABLE_CUSTOMER_REVISION_SUBMISSION: { Ref: "CustomerRevisionSubmissionEnabled" },
    PATHFINDER_PROOF_CUSTOMER_REVISION_SCOPE: { Ref: "CustomerRevisionScope" }
  };
  for (const [name, resource] of Object.entries(template.Resources)) {
    if (resource.Type !== "AWS::Lambda::Function") continue;
    const env = resource.Properties.Environment?.Variables ?? {};
    for (const [key, value] of Object.entries(expected)) {
      if (name === "ProofPublicFunction") assert.deepEqual(env[key], value);
      else assert.equal(env[key], undefined, `${name} must not receive ${key}`);
    }
  }
  for (const name of ["ProofSyncFunction", "ProofOperatorFunction"]) {
    assert.deepEqual(template.Resources[name].Properties.Code.S3Key, { Ref: "PublicLambdaCodeS3Key" });
  }
});
