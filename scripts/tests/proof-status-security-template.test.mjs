import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const template = readFileSync(new URL('../../infra/aws/proof-cloudformation.yaml', import.meta.url), 'utf8');
test('Proof allows OAuth popup callbacks only while reviewer sign-in is enabled', () => {
  assert.ok(template.includes('StatusReviewerSigninActive: !Equals [!Ref StatusReviewerSigninEnabled, "true"]'));
  const policy = template.split('  ProofWebResponseHeadersPolicy:')[1].split('  ProofApiResponseHeadersPolicy:')[0];
  assert.match(policy, /Header: Cross-Origin-Opener-Policy\n(?:\s*#[^\n]*\n)*\s*Value: !If \[StatusReviewerSigninActive, same-origin-allow-popups, same-origin\]/);
  assert.equal(policy.includes('unsafe-none'), false);
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(policy.includes("object-src 'none'"));
});
test('Status routes have separate scoped limits and do not sample authentication requests', () => {
  for (const [name, path, limit] of [['StatusTokenExchangeRateLimit', 'sessions', 100],
    ['StatusReviewerSignInRateLimit', 'reviewer-session', 30], ['StatusRefreshRateLimit', 'order/refresh', 60],
    ['StatusTaskRoutesRateLimit', 'tasks/.*', 60]]) {
    const block = template.split(`- Name: ${name}\n`)[1]?.split('\n        - Name:')[0]?.split('\n  ProofWebOriginAccessControl:')[0];
    assert.ok(block);
    assert.ok(block.includes(`Limit: ${limit}\n`));
    assert.ok(block.includes('SampledRequestsEnabled: false'));
    const pattern = block.match(/RegexString: "([^"]+)"/)[1];
    const regex = new RegExp(pattern);
    const route = path.replace('.*', 'synthetic/approve');
    assert.ok(regex.test(`/api/public/proof/status-view/${route}`));
    assert.ok(regex.test(`/api/public/proof/status-view/${route}/`));
    assert.equal(regex.test(`/api/public/proof/${route}`), false);
    for (const transform of ['URL_DECODE', 'NORMALIZE_PATH', 'LOWERCASE']) assert.ok(block.includes(`Type: ${transform}`));
  }
});
test('Firebase CSP preparation defaults off and does not activate access', () => {
  assert.match(template, /StatusReviewerFirebaseProjectId:\n    Type: String\n    Default: ""/);
  assert.ok(template.includes('https://identitytoolkit.googleapis.com https://securetoken.googleapis.com'));
  assert.ok(template.includes("script-src 'self' https://apis.google.com"));
  assert.equal(template.includes('PATHFINDER_PROOF_STATUS_REVIEWER_SIGNIN: "true"'), false);
});
