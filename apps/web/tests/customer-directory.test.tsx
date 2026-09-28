import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCustomers, reconcileCustomerDirectory } from '../src/customer-directory';
import type { LiftCustomer, LiftCustomerDirectory } from '@pathfinder/customer-directory';

const customers: LiftCustomer[] = [
  ...Array.from({length: 30}, (_, i) => ({lift_customer_id: String(1000+i), customer_name: `Fixture Customer ${i}`})),
  {lift_customer_id: '17409', customer_name: 'Silicon Pasture', customer_number: 'SP-TEST'}
];
const directory = (rows = customers): LiftCustomerDirectory => ({customers: rows, source:'lift-endpoint', endpoint_url:'https://example.invalid', loaded_at:'2026-09-28T00:00:00Z'});

test('full directory remains available and search finds names and IDs beyond the first eight customers', () => {
  assert.equal(filterCustomers(customers, '').length, 31);
  assert.equal(filterCustomers(customers, 'fixture customer').length, 30);
  assert.deepEqual(filterCustomers(customers, '  SILICON  '), [customers[30]]);
  assert.deepEqual(filterCustomers(customers, '17409'), [customers[30]]);
  assert.deepEqual(filterCustomers(customers, 'sp-test'), [customers[30]]);
  assert.deepEqual(filterCustomers(customers, 'unmatched'), []);
});

test('seed fallback preserves a previously loaded directory and selection without exposing upstream errors', () => {
  const fallback = {...directory(customers.slice(0, 3)), source:'local-seed' as const, warning:'https://private.invalid/?token=secret'};
  const result = reconcileCustomerDirectory(customers, fallback, '17409');
  assert.deepEqual(result.customers, customers);
  assert.match(result.warning!, /previously loaded/);
  assert.ok(!result.warning!.includes('secret'));
  const cold = reconcileCustomerDirectory([], fallback, '');
  assert.equal(cold.customers.length, 3);
  assert.match(cold.warning!, /limited local/);
});

test('incomplete live refresh preserves the selected customer without keeping unrelated stale rows', () => {
  const incoming = directory(customers.slice(0, 2));
  const result = reconcileCustomerDirectory(customers, incoming, '17409');
  assert.deepEqual(result.customers, [...incoming.customers, customers[30]]);
  assert.match(result.warning!, /Keeping your current workspace/);
  assert.equal(incoming.customers.length, 2);
  const recovered = reconcileCustomerDirectory(result.customers, directory(), '17409');
  assert.equal(recovered.warning, undefined);
  assert.equal(recovered.customers.filter(c=>c.lift_customer_id==='17409').length, 1);
});

test('preselected customer identity is retained when it has never appeared in the directory', () => {
  const result = reconcileCustomerDirectory([], directory(customers.slice(0, 2)), '17409');
  assert.equal(result.customers.at(-1)?.lift_customer_id, '17409');
  assert.match(result.warning!, /not returned/);
});
