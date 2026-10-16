import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseTemplate} from '../intake-storage-template.mjs';
test('artwork submit manifests grant only prefix-scoped read access to the API',()=>{
 const t=parseTemplate(readFileSync(new URL('../../infra/aws/api-cloudformation.yaml',import.meta.url),'utf8'));
 const matches=t.Resources.PathfinderApiRole.Properties.Policies.flatMap(p=>p.PolicyDocument.Statement).filter(s=>JSON.stringify(s).includes('/json-intake/artwork-publications/'));
 assert.deepEqual(matches,[{Effect:'Allow',Action:['s3:GetObject'],Resource:{Sub:'${PathfinderSourceEvidenceBucket.Arn}/json-intake/artwork-publications/*'}}]);
});
