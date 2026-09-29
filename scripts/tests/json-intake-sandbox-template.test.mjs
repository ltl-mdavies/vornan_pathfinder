import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
const raw=await readFile(new URL('../../infra/aws/json-intake-sandbox.yaml',import.meta.url),'utf8');
const template=parse(raw,{customTags:['Ref','Sub','GetAtt'].map(t=>({tag:'!'+t,resolve:v=>({[t]:v})}))});
test('sandbox stack owns its resources and has no shared API or provider permissions',()=>{
 const r=template.Resources,role=r.Role.Properties;
 assert.equal(template.Parameters.IntakeEnabled.Default,'false');
 assert.deepEqual(Object.keys(template.Parameters).sort(),['CodeBucket','CodeKey','IntakeEnabled']);
 assert.equal(r.Receipts.DeletionPolicy,'Retain');assert.equal(r.Evidence.DeletionPolicy,'Retain');
 const statements=role.Policies[0].PolicyDocument.Statement;
 assert.deepEqual(statements.flatMap(s=>s.Action).sort(),['dynamodb:GetItem','dynamodb:PutItem','logs:CreateLogStream','logs:PutLogEvents','s3:GetObject','s3:PutObject','secretsmanager:GetSecretValue'].sort());
 assert.deepEqual(statements[0].Resource,{GetAtt:'Receipts.Arn'});
 assert.deepEqual(statements[1].Resource,{Sub:'${Evidence.Arn}/receipts/*'});
 assert.deepEqual(statements[2].Resource,{Ref:'Credentials'});
 assert.ok(!raw.includes('ImportValue'));assert.ok(!raw.includes('vornan-pathfinder-api-prod'));assert.ok(!raw.includes('Schedule'));
 assert.equal(r.Credentials.Properties.SecretString,'[]');
});
test('sandbox exposes only bounded receipt/status routes and retains encrypted private evidence',()=>{
 const r=template.Resources;
 assert.deepEqual(Object.values(r).filter(x=>x.Type==='AWS::ApiGatewayV2::Route').map(x=>x.Properties.RouteKey).sort(),['GET /api/v1/intake/orders/{receiptId}','GET /health','POST /api/v1/intake/orders'].sort());
 assert.equal(r.Function.Properties.Timeout,25);assert.equal(r.Function.Properties.ReservedConcurrentExecutions,5);
 assert.equal(r.Evidence.Properties.VersioningConfiguration.Status,'Enabled');
 assert.ok(Object.values(r.Evidence.Properties.PublicAccessBlockConfiguration).every(v=>v===true));
 assert.equal(r.Receipts.Properties.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled,true);
});
