import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateProofReviewerDescriptor, validateProofReviewerRuntimeEnv } from '../proof-reviewer-runtime.mjs';
const descriptor = JSON.parse(readFileSync(new URL('../../infra/google/proof-reviewer-external-account.json', import.meta.url)));
test('runtime preparation rejects missing or wrong project before artifact upload', () => {
  validateProofReviewerRuntimeEnv({});
  validateProofReviewerRuntimeEnv({PATHFINDER_PROOF_STATUS_REVIEWER_RUNTIME_PREPARED:'true',PATHFINDER_PROOF_STATUS_REVIEWER_FIREBASE_PROJECT_ID:'ltl-dashboard-site'});
  for (const env of [{PATHFINDER_PROOF_STATUS_REVIEWER_RUNTIME_PREPARED:'yes'}, {PATHFINDER_PROOF_STATUS_REVIEWER_RUNTIME_PREPARED:'true'},
    {PATHFINDER_PROOF_STATUS_REVIEWER_RUNTIME_PREPARED:'true',PATHFINDER_PROOF_STATUS_REVIEWER_FIREBASE_PROJECT_ID:'other-project'}]) assert.throws(() => validateProofReviewerRuntimeEnv(env));
});
test('production verifier descriptor is exact, non-secret and keyless', () => {
  assert.equal(validateProofReviewerDescriptor(descriptor), descriptor);
  for (const change of [{private_key:'forbidden'}, {type:'service_account'}, {token_url:'https://example.com'},
    {audience:descriptor.audience.replace('aws-proof-public','aws-proof-qa-20261031')},
    {credential_source:{file:'/tmp/credential'}}, {service_account_impersonation_url:'https://example.com'}]) {
    assert.throws(() => validateProofReviewerDescriptor({...descriptor,...change}));
  }
});
test('runtime is default-off and isolated from workers and activation', () => {
  const template = readFileSync(new URL('../../infra/aws/proof-cloudformation.yaml', import.meta.url),'utf8');
  assert.match(template,/StatusReviewerRuntimePrepared:\n    Type: String\n    Default: "false"/);
  assert.match(template,/Assert: !Equals \[!Ref StatusReviewerFirebaseProjectId, "ltl-dashboard-site"\]/);
  const publicBlock = template.split('  ProofPublicFunction:\n')[1].split('  ProofSyncFunction:\n')[0];
  for (const name of ['FIREBASE_PROJECT_ID','GOOGLE_CLOUD_PROJECT','GOOGLE_APPLICATION_CREDENTIALS']) {
    assert.ok(publicBlock.includes(`${name}: !If [PrepareStatusReviewerRuntime,`));
    assert.equal(template.split(`${name}:`).length,2);
  }
  assert.ok(publicBlock.includes('/var/task/proof-reviewer-external-account.json'));
  assert.equal(template.includes('PATHFINDER_PROOF_STATUS_REVIEWER_SIGNIN:'),false);
  assert.equal(template.includes('PATHFINDER_PROOF_STATUS_HANDOFF_LTL_DEMO:'),false);
});
