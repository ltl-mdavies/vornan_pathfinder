import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8').split('function StatusRequestForm')[1].split('function StatusRequest()')[0];
test('status recovery separates missing order, missing email and malformed email',()=>{
  for (const copy of ['Enter at least one order number.','Enter your email address.','Enter a valid email address.']) assert.ok(source.includes(copy));
  assert.match(source,/errors.orders \? ordersInput.current : emailInput.current/);
  assert.match(source,/validity.typeMismatch/);
  assert.match(source,/orderNumbers.length > 10/);
});
test('status keeps required semantics, blocks duplicate pending requests and announces responses',()=>{
  assert.equal((source.match(/\n\s*required\n/g)||[]).length,2);
  assert.match(source,/if \(state === "sending"\) return/);
  assert.match(source,/role=\{state === "error" \? "alert" : "status"\}/);
});
