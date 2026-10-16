import assert from 'node:assert/strict';
// Historical baseline comparisons must still detect every other infrastructure change.
export function withoutJsonArtworkRead(template) {
 const prior=structuredClone(template);
 const statements=prior.Resources.PathfinderApiRole.Properties.Policies[0].PolicyDocument.Statement;
 const matching=statements.filter(s=>JSON.stringify(s).includes('/json-intake/artwork-publications/'));
 assert.deepEqual(matching,[{Effect:'Allow',Action:['s3:GetObject'],Resource:{Sub:'${PathfinderSourceEvidenceBucket.Arn}/json-intake/artwork-publications/*'}}]);
 statements.splice(statements.indexOf(matching[0]),1);
 return prior;
}
