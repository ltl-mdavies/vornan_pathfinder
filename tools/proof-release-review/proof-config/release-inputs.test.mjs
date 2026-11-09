import test from 'node:test';
import assert from 'node:assert/strict';
import {readReleaseInput,validateReleaseInput,releaseInputNames} from './release-inputs.mjs';
const name='proof-oidc-release-draft/release-plan.json';
test('fixed fixture input is verified and copied',()=>{
 const b=readReleaseInput(name),copy=validateReleaseInput(b,name);
 assert.deepEqual(copy,b);assert.notEqual(copy,b);
 assert.equal(JSON.parse(b).repository,'example/proof-review');
});
test('altered same-length input fails hash verification',()=>{
 const b=readReleaseInput(name);b[10]^=1;
 assert.throws(()=>validateReleaseInput(b,name));
});
test('truncated input fails length verification',()=>assert.throws(()=>validateReleaseInput(readReleaseInput(name).subarray(1),name)));
test('fixture bytes cannot satisfy private pin',()=>assert.throws(()=>validateReleaseInput(readReleaseInput(name),name,'private')));
for(const bad of ['../bindings.json','/etc/passwd','proof-oidc-release-draft/../release-plan.json','unknown.json'])
 test('unlisted or traversing input rejected: '+bad,()=>assert.throws(()=>readReleaseInput(bad),/Pinned release input rejected/));
test('unknown profile and non-buffer rejected',()=>{
 assert.throws(()=>validateReleaseInput(readReleaseInput(name),name,'other'));
 assert.throws(()=>validateReleaseInput('{}',name));
});
test('policy inventory is fixed and frozen',()=>{
 const names=releaseInputNames('proof-disabled-workflow/invocation-policies-proposed/');
 assert.equal(names.length,8);assert.ok(Object.isFrozen(names));
});
