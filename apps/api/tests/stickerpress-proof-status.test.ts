import test from 'node:test';
import assert from 'node:assert/strict';
import { stickerPressProofStatus } from '../src/json-intake/stickerpress-proof-status.js';
const now = new Date('2026-10-23T12:00:00Z');
const hash = 'a'.repeat(64);
const good = () => ({approval: {approved_by: 'auto', approved_at: '2026-10-15T15:13:04.361Z', artwork_sha256: hash},
  artwork_sha256: hash, artwork_bytes: 100,
  retained: [{sha256: hash, bytes: 100, retained_ref: 'synthetic-retained-original'}]});

test('confirmed auto approval bound to the retained production PDF maps to exact Approved string', () => {
  const input = good(), before = structuredClone(input);
  assert.equal(stickerPressProofStatus(input, now), 'Approved'); assert.deepEqual(input, before);
});

for (const [name, change] of Object.entries({
  'missing approval': {approval: undefined}, 'null approval': {approval: null},
  'timestamp alone': {approval: {approved_at: '2026-10-15T15:00:00Z', artwork_sha256: hash}},
  'auto without timestamp': {approval: {approved_by: 'auto', artwork_sha256: hash}},
  'operator is not auto': {approval: {...good().approval, approved_by: 'operator'}},
  'customer is not auto': {approval: {...good().approval, approved_by: 'customer'}},
  'unrecognized approver': {approval: {...good().approval, approved_by: 'other'}},
  'invalid date': {approval: {...good().approval, approved_at: '2026-02-30T15:00:00Z'}},
  'future approval': {approval: {...good().approval, approved_at: '2026-10-24T15:00:00Z'}},
  'changed production artwork': {artwork_sha256: 'b'.repeat(64)},
  'no retained original': {retained: []}, 'ambiguous retained originals': {retained: [...good().retained, ...good().retained]},
  'retained content mismatch': {retained: [{...good().retained[0], sha256: 'b'.repeat(64)}]},
  'size mismatch': {artwork_bytes: 101}, 'invalid size': {artwork_bytes: 0},
  'no retained reference': {retained: [{...good().retained[0], retained_ref: ''}]},
  'explicit internal Pending': {existing_status: 'Pending'},
  'unknown internal status': {existing_status: 'something'},
  'preexisting Approved cannot replace missing approval': {existing_status: 'Approved', approval: null}
})) test(`${name} maps explicitly to Pending`, () => {
  assert.equal(stickerPressProofStatus({...good(), ...change}, now), 'Pending');
});

test('invalid review clock cannot produce Approved', () => {
  assert.equal(stickerPressProofStatus(good(), new Date('invalid')), 'Pending');
});
