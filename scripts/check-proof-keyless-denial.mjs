// Explicit live negative check only. Never prints AWS credentials or Google tokens.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const expectedRole = 'arn:aws:sts::744016783602:assumed-role/vornan-proof-dev-ProofPublicLambdaRole-Jo0ym7xP02Cf/';
const identity = JSON.parse(execFileSync('aws', ['sts','get-caller-identity','--output','json'], {encoding:'utf8'}));
if (identity.Arn.startsWith(expectedRole)) throw new Error('Negative check requires an unrelated identity. Refusing.');
const config = JSON.parse(readFileSync(new URL('../infra/google/proof-reviewer-external-account.json', import.meta.url), 'utf8'));
if (config.token_url !== 'https://sts.googleapis.com/v1/token'
  || config.audience !== '//iam.googleapis.com/projects/86194135137/locations/global/workloadIdentityPools/proof-reviewer/providers/aws-proof-public'
  || config.service_account_impersonation_url !== 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/proof-reviewer-verifier@ltl-dashboard-site.iam.gserviceaccount.com:generateAccessToken') {
  throw new Error('Unexpected federation destination. Refusing.');
}
const creds = JSON.parse(execFileSync('aws',['configure','export-credentials','--format','process'],{encoding:'utf8'}));
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = creds.AccessKeyId;
process.env.AWS_SECRET_ACCESS_KEY = creds.SecretAccessKey;
if (creds.SessionToken) process.env.AWS_SESSION_TOKEN = creds.SessionToken;
else delete process.env.AWS_SESSION_TOKEN;
try {
  const client = new GoogleAuth().fromJSON(config);
  client.scopes = ['https://www.googleapis.com/auth/cloud-platform'];
  await client.getAccessToken();
  console.error('FAIL: unrelated AWS identity was accepted. No token displayed.');
  process.exitCode = 1;
} catch (error) {
  let data = error?.response?.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
  if (['invalid_grant','unauthorized_client'].includes(data?.error) && /attribute condition/i.test(data?.error_description ?? '')) {
    console.log('PASS: Google STS rejected the unrelated AWS identity at the provider attribute condition.');
  } else {
    const code = ['invalid_grant','invalid_request','invalid_scope','unauthorized_client','permission_denied'].includes(data?.error) ? data.error : 'unclassified';
    console.error(`INCONCLUSIVE: exchange failed (${code}); no token or error payload displayed.`);
    process.exitCode = 2;
  }
} finally {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
}
