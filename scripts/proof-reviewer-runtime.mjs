import assert from 'node:assert/strict';

export function validateProofReviewerRuntimeEnv(env) {
  const prepared = env.PATHFINDER_PROOF_STATUS_REVIEWER_RUNTIME_PREPARED ?? 'false';
  assert.ok(['true','false'].includes(prepared), 'Reviewer runtime preparation must be true or false');
  if (prepared === 'true') {
    assert.equal(env.PATHFINDER_PROOF_STATUS_REVIEWER_FIREBASE_PROJECT_ID, 'ltl-dashboard-site', 'Prepared verifier requires the reviewed Firebase project');
  }
}

if (process.argv.includes('--check-env')) validateProofReviewerRuntimeEnv(process.env);

// This is a non-secret, deployment-specific descriptor. Do not accept arbitrary
// credential endpoints or QA providers in a production artifact.
export function validateProofReviewerDescriptor(value) {
  assert.deepEqual(Object.keys(value).sort(), ['audience', 'credential_source', 'service_account_impersonation_url', 'subject_token_type', 'token_url', 'type', 'universe_domain'].sort());
  assert.equal(value.type, 'external_account');
  assert.equal(value.universe_domain, 'googleapis.com');
  assert.equal(value.audience, '//iam.googleapis.com/projects/86194135137/locations/global/workloadIdentityPools/proof-reviewer/providers/aws-proof-public');
  assert.equal(value.subject_token_type, 'urn:ietf:params:aws:token-type:aws4_request');
  assert.equal(value.token_url, 'https://sts.googleapis.com/v1/token');
  assert.equal(value.service_account_impersonation_url, 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/proof-reviewer-verifier@ltl-dashboard-site.iam.gserviceaccount.com:generateAccessToken');
  assert.deepEqual(value.credential_source, {
    environment_id: 'aws1',
    region_url: 'http://169.254.169.254/latest/meta-data/placement/availability-zone',
    url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials',
    regional_cred_verification_url: 'https://sts.{region}.amazonaws.com?Action=GetCallerIdentity&Version=2011-06-15'
  });
  return value;
}
