import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
const raw=await readFile(new URL('../../infra/aws/json-intake-artwork.yaml',import.meta.url),'utf8');
const t=parse(raw,{customTags:['Ref','Sub','GetAtt'].map(k=>({tag:'!'+k,resolve:v=>({[k]:v})})).concat(['Equals','If'].map(k=>({tag:'!'+k,collection:'seq',resolve:v=>({[k]:v.toJSON()})}))) });
test('worker is a separate disabled-by-default stack with only sandbox data permissions',()=>{
 assert.equal(t.Parameters.Enabled.Default,'false');
 assert.equal(t.Parameters.ScheduleEnabled.Default,'false');
 assert.equal(t.Resources.Function.Properties.ReservedConcurrentExecutions,1);
 assert.equal(t.Resources.Function.Properties.Timeout,120);
 assert.equal(t.Resources.Function.Properties.MemorySize,512);
 assert.deepEqual(t.Resources.Schedule.Properties.State,{If:['Active','ENABLED','DISABLED']});
 const statements=t.Resources.Role.Properties.Policies[0].PolicyDocument.Statement;
 assert.deepEqual(statements.flatMap(x=>x.Action).sort(),['dynamodb:GetItem','dynamodb:PutItem','dynamodb:Scan','s3:GetObject','s3:PutObject','logs:CreateLogStream','logs:PutLogEvents'].sort());
 assert.ok(!/secretsmanager|ses:|sqs:|apigateway|ImportValue/.test(raw));
 assert.ok(!Object.values(t.Resources).some(r=>r.Type==='AWS::DynamoDB::Table'||r.Type==='AWS::S3::Bucket'));
 assert.equal(t.Resources.AsyncConfig.Properties.MaximumRetryAttempts,0);
});
