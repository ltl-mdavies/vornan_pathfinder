import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL('../src/App.tsx', import.meta.url),'utf8');
test('reviewer validation retains native constraints and focuses the first invalid field', () => {
  assert.match(source,/required minLength=\{2\} maxLength=\{80\}/);
  assert.match(source,/required type="email" maxLength=\{254\}/);
  assert.match(source,/errors.name \? identityNameInput.current : identityEmailInput.current/);
  for (const id of ['identity-name-error','identity-email-error']) assert.ok(source.includes(`id="${id}"`));
});
test('late identity responses cannot revive a terminal or expired session',()=>{
  const save=source.split('const saveIdentity = async')[1].split('const acknowledgeCurrentFeedback')[0];
  assert.equal((save.match(/sessionExpiryDelay\(latest.session_expires_at\) === 0/g)||[]).length,2);
  assert.match(save,/\.\.\.latest,/);
  assert.doesNotMatch(save,/\.\.\.loadState,/);
  assert.match(source,/loadStateRef.current = ended;\s*setLoadState\(ended\)/);
});
test('reviewer dirty closing is guarded, with no save action in discard confirmation', () => {
  const guard = source.split('{identityDiscardOpen ? (')[1]?.split(') : <form')[0];
  assert.ok(guard);
  assert.match(guard,/Keep editing/);
  assert.match(guard,/Discard changes/);
  assert.doesNotMatch(guard,/saveIdentity|type="submit"/);
  assert.match(source,/if \(identitySaving\) return;\s*if \(!identityDirty\)/);
});
test('uncertain identity save is verified by a read, not an automatic repeated mutation', () => {
  const check = source.split('const checkIdentitySave = async')[1]?.split('const acknowledgeCurrentFeedback')[0];
  assert.match(check,/await loadProofOrder\(\)/);
  assert.doesNotMatch(check,/identifyParticipant\(/);
  assert.match(source,/identitySaving \|\| identitySaveUncertain\) return/);
});
