import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfLoadLifetime } from '../src/pdf-load-lifetime';

test('disposal before import completion fences task creation', () => {
  const life = createPdfLoadLifetime(); life.dispose();
  let created = false; if (!life.disposed) created = true;
  assert.equal(created, false);
});
test('loading task is destroyed once during pending load and repeated cleanup', () => {
  const life = createPdfLoadLifetime(); let calls = 0;
  life.attach({ destroy() { calls++; } }); life.dispose(); life.dispose();
  assert.equal(calls, 1); assert.equal(life.disposed, true);
});
test('late attachment is torn down and rejection is consumed', async () => {
  const life = createPdfLoadLifetime(); let calls = 0; life.dispose();
  life.attach({ destroy() { calls++; return Promise.reject(new Error('already destroyed')); } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
});
test('synchronous teardown failure is contained', () => {
  const life = createPdfLoadLifetime(); life.attach({ destroy() { throw new Error('closed'); } });
  assert.doesNotThrow(() => life.dispose());
});
test('StrictMode/source replacement lifetimes remain independent', () => {
  const old = createPdfLoadLifetime(), current = createPdfLoadLifetime(); let oldCalls = 0, newCalls = 0;
  old.attach({ destroy() { oldCalls++; } }); old.dispose();
  current.attach({ destroy() { newCalls++; } });
  assert.equal(current.disposed, false); assert.equal(newCalls, 0); assert.equal(oldCalls, 1);
  current.dispose(); assert.equal(newCalls, 1);
});
