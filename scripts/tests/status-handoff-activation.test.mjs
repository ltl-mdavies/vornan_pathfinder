import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseTemplate, evaluateTemplate } from '../intake-storage-template.mjs';
import { withoutStatusHandoff } from './fixtures/status-handoff.mjs';
const api = parseTemplate(readFileSync(new URL('../../infra/aws/api-cloudformation.yaml', import.meta.url), 'utf8'));
const proof = parseTemplate(readFileSync(new URL('../../infra/aws/proof-cloudformation.yaml', import.meta.url), 'utf8'));
test('main API default-off activation leaves all existing evaluated infrastructure identical', () => {
  assert.deepEqual(evaluateTemplate(api, {}), evaluateTemplate(withoutStatusHandoff(api), {}));
  const enabled = evaluateTemplate(api, { ProofStatusHandoffLtlDemoEnabled: 'true' });
  assert.equal(enabled.Resources.PathfinderApiFunction.Properties.Environment.Variables.PATHFINDER_PROOF_STATUS_HANDOFF_LTL_DEMO, 'true');
  delete enabled.Resources.PathfinderApiFunction.Properties.Environment.Variables.PATHFINDER_PROOF_STATUS_HANDOFF_LTL_DEMO;
  assert.deepEqual(enabled, evaluateTemplate(withoutStatusHandoff(api), {}));
});
test('Proof parent authority grants only GetItem on one same-account token table', () => {
  const statements = proof.Resources.ProofPublicLambdaRole.Properties.Policies.find(p => p.PolicyName === 'ProofCorePublicReadSessions').PolicyDocument.Statement;
  const addition = statements.find(s => s.If?.[0] === 'StatusHandoffActive');
  assert.deepEqual(addition.If[1], { Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: { Sub: 'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${StatusParentTokensTableName}' } });
  assert.deepEqual(addition.If[2], { Ref: 'AWS::NoValue' });
  for (const name of ['ProofSyncFunction', 'ProofOperatorFunction']) {
    const env = proof.Resources[name].Properties.Environment.Variables;
    assert.ok(!Object.keys(env).some(k => /STATUS_HANDOFF|STATUS_PARENT|STATUS_REVIEWER_SIGNIN/.test(k)));
  }
});
