import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const template = parse(source("infra/aws/proof-cloudformation.yaml"), {
  customTags: ["Ref", "Sub", "GetAtt", "Condition"].map(name => ({ tag: `!${name}`, resolve: value => ({ [name]: value }) }))
    .concat(["Equals", "If", "And", "Or", "Not", "Join", "Sub"].map(name => ({ tag: `!${name}`, collection: "seq", resolve: value => ({ [name]: value.toJSON() }) })))
});
const workflow = parse(source(".github/workflows/deploy-proof.yml"));
const defaults = Object.fromEntries(Object.entries(template.Parameters).map(([key, value]) => [key, value.Default]));
function evaluate(expression, values) {
  if (expression === null || typeof expression !== "object") return expression;
  const [[operator, args]] = Object.entries(expression);
  if (operator === "Ref") return values[args];
  if (operator === "Equals") return evaluate(args[0], values) === evaluate(args[1], values);
  if (operator === "Not") return !evaluate(args[0], values);
  if (operator === "And") return args.every(arg => evaluate(arg, values));
  if (operator === "Or") return args.some(arg => evaluate(arg, values));
  throw new Error(`Unexpected operator ${operator}`);
}

test("sharing is canonically default-off with strict scopes and existing review authority", () => {
  assert.equal(defaults.SharingEnabled, "false");
  assert.equal(defaults.SharingScopes, "");
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.sharing_enabled.default, "false");
  assert.equal(inputs.sharing_scopes.default, "");
  const pattern = new RegExp(template.Parameters.SharingScopes.AllowedPattern);
  assert.ok(pattern.test("1249:A0232139"));
  for (const bad of ["*", "1249:*", "1249:A0232139,", "1249:A0232139,bad", Array(26).fill("1249:A0232139").join(",")]) assert.equal(pattern.test(bad), false);
  const rule = template.Rules.SharingRequiresReviewAuthority;
  const flags = ["PublicReadEnabled", "CustomerApprovalEnabled", "LtlDemoQaEnabled", "LtlDemoQaSessionReadEnabled", "LtlDemoQaCustomerApprovalEnabled"];
  for (let mask = 0; mask < 32; mask++) {
    const values = { ...defaults, SharingEnabled: "true", SharingScopes: "1249:A0232139",
      ...Object.fromEntries(flags.map((flag, i) => [flag, mask & (1 << i) ? "true" : "false"])) };
    assert.equal(rule.Assertions.every(({ Assert }) => evaluate(Assert, values)), (mask & 3) === 3 || (mask & 28) === 28);
    assert.equal(rule.Assertions.every(({ Assert }) => evaluate(Assert, { ...values, SharingScopes: "" })), false);
  }
});

test("sharing parameters are public-only and wired through both deploy entrypoints", () => {
  const expected = { PATHFINDER_PROOF_ENABLE_SHARING: { Ref: "SharingEnabled" }, PATHFINDER_PROOF_SHARING_SCOPES: { Ref: "SharingScopes" } };
  for (const [name, resource] of Object.entries(template.Resources)) {
    if (resource.Type !== "AWS::Lambda::Function") continue;
    for (const [key, value] of Object.entries(expected)) {
      const actual = resource.Properties.Environment?.Variables?.[key];
      if (name === "ProofPublicFunction") assert.deepEqual(actual, value); else assert.equal(actual, undefined);
    }
  }
  const shell = source("scripts/deploy-proof-stack.sh");
  assert.ok(shell.includes('SharingEnabled="${PATHFINDER_PROOF_ENABLE_SHARING:-false}"'));
  assert.ok(shell.includes('SharingScopes="${PATHFINDER_PROOF_SHARING_SCOPES:-}"'));
  const step = Object.values(workflow.jobs).flatMap(job => job.steps ?? []).find(step => step.run?.includes("SharingEnabled="));
  assert.equal(step.env.SHARING_ENABLED, "${{ inputs.sharing_enabled }}");
  assert.equal(step.env.SHARING_SCOPES, "${{ inputs.sharing_scopes }}");
  assert.ok(step.run.includes('SharingScopes="${SHARING_SCOPES}"'));
});

test("operator compatibility override preserves sync and is retained on public-only releases", () => {
  assert.equal(defaults.OperatorFunctionCodeS3Key, "");
  assert.deepEqual(template.Resources.ProofOperatorFunction.Properties.Code.S3Key, {
    If: ["HasOperatorFunctionCodeOverride", { Ref: "OperatorFunctionCodeS3Key" }, { Ref: "PublicLambdaCodeS3Key" }]
  });
  assert.deepEqual(template.Resources.ProofSyncFunction.Properties.Code.S3Key, { Ref: "PublicLambdaCodeS3Key" });
  assert.ok(source("scripts/deploy-proof-stack.sh").includes('${PATHFINDER_PROOF_OPERATOR_ARTIFACT_KEY?'));
  const step = Object.values(workflow.jobs).flatMap(job => job.steps ?? []).find(step => step.run?.includes("OperatorFunctionCodeS3Key="));
  assert.ok(step.run.includes("ParameterKey=='OperatorFunctionCodeS3Key'"));
  assert.ok(step.run.includes('OperatorFunctionCodeS3Key="${operator_artifact_key}"'));
  assert.ok(!step.run.includes('OperatorFunctionCodeS3Key="${ARTIFACT_KEY}"'));
});
