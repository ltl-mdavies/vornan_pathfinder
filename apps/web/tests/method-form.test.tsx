import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { methodSaveMatches } from '../src/method-save-state';
const source = readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
test('method title cache uses native Map rather than the Map icon',()=>{
  assert.match(source,/savedMethodTitles = useRef\(new globalThis.Map<string, string>\(\)\)/);
  assert.match(source,/title=\{activeImportMethod.name.trim\(\) \|\| savedMethodTitles.current.get/);
});
test('save completion compares current drafts, not the pre-await snapshot',()=>{
  const submitted = {name:'First',mappings:[{source:'A',target:'title'}],updated_at:'old'};
  assert.equal(methodSaveMatches(submitted,{...submitted,updated_at:'server'}),true);
  assert.equal(methodSaveMatches(submitted,{...submitted,name:'New edit'}),false);
  assert.equal(methodSaveMatches(submitted,{...submitted,mappings:[{source:'B',target:'title'}]}),false);
  assert.equal(methodSaveMatches(submitted,{...submitted,mappings:[{target:'title',source:'A'}]}),true);
  assert.equal(methodSaveMatches(submitted,null),false);
  const save=source.split('async function saveImportMethod')[1].split('async function createPreviewJob')[0];
  assert.match(save,/methodSaveInFlight.current\) return false/);
  assert.match(save,/workspaceEpoch === workspaceRequestIdRef.current/);
  assert.match(save,/methodSaveMatches\(submittedMethod, currentDraft\(\)\)/);
  assert.doesNotMatch(save,/setWorkspace\(nextWorkspace\)/);
});
test('invalid method names retain the draft and focus associated field feedback',()=>{
  const save=source.split('async function saveImportMethod')[1].split('async function createPreviewJob')[0];
  assert.match(save,/methodNameInput.current\?\.focus\(\)/);
  const validation=save.split('const normalizedName = method.name.trim()')[1];
  assert.ok(validation.indexOf('return false')<validation.indexOf('await fetch'));
  assert.match(source,/aria-labelledby="method-name-label"/);
  assert.match(source,/id="method-name-error"/);
});
test('an uncertain method save has a read-only confirmation path and keeps newer edits',()=>{
  const check=source.split('const pending = unconfirmedMethodSave;')[1].split('const normalizedName = method.name.trim()')[0];
  assert.match(check,/\/workspace`/);
  assert.doesNotMatch(check,/method: "PUT"/);
  assert.match(check,/currentMatches/);
  assert.match(source,/Check saved method/);
});
