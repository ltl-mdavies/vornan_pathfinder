import assert from 'node:assert/strict';
import test from 'node:test';
import { filterCustomers, reconcileCustomerDirectory, directoryFieldKey, directoryFieldLabel, parseCustomerOrderSummaries } from '../src/customer-directory';
import type { LiftCustomer, LiftCustomerDirectory } from '@pathfinder/customer-directory';

const customers: LiftCustomer[] = [
  ...Array.from({length: 30}, (_, i) => ({lift_customer_id: String(1000+i), customer_name: `Fixture Customer ${i}`})),
  {lift_customer_id: '174094', customer_name: 'Silicone Pasture', customer_number: '0000000549'}
];
const directory = (rows = customers): LiftCustomerDirectory => ({customers: rows, source:'lift-endpoint', endpoint_url:'https://example.invalid', loaded_at:'2026-09-28T00:00:00Z'});

test('directory field filters preserve missing/blank distinctions without label collisions', () => {
  assert.equal(directoryFieldLabel(undefined), 'Unavailable');
  assert.equal(directoryFieldLabel(null), 'Not recorded');
  assert.notEqual(directoryFieldKey(undefined), directoryFieldKey('Unavailable'));
  assert.notEqual(directoryFieldKey(null), directoryFieldKey('Not recorded'));
});
test('order summary validates dates and states rather than inventing no-order records', () => {
  assert.throws(() => parseCustomerOrderSummaries({}));
  assert.throws(() => parseCustomerOrderSummaries({items: [{customer_id:'1',status:'confirmed',order_number:'A1',confirmed_at:'bad'}]}));
  assert.throws(() => parseCustomerOrderSummaries({items: [{customer_id:'1',status:'none'},{customer_id:'1',status:'none'}]}));
  assert.equal(parseCustomerOrderSummaries({items: [{customer_id:'1',status:'date_unavailable'}]})['1']?.status, 'date_unavailable');
  assert.equal(parseCustomerOrderSummaries({items: []})['1'], undefined);
});

test('full directory remains available and search finds names and IDs beyond the first eight customers', () => {
  assert.equal(filterCustomers(customers, '').length, 31);
  assert.equal(filterCustomers(customers, 'fixture customer').length, 30);
  assert.deepEqual(filterCustomers(customers, '  SILICON  '), [customers[30]]);
  assert.deepEqual(filterCustomers(customers, '174094'), [customers[30]]);
  assert.deepEqual(filterCustomers(customers, '549'), [customers[30]]);
  assert.deepEqual(filterCustomers(customers, 'unmatched'), []);
});

test('seed fallback preserves a previously loaded directory and selection without exposing upstream errors', () => {
  const fallback = {...directory(customers.slice(0, 3)), source:'local-seed' as const, warning:'https://private.invalid/?token=secret'};
  const result = reconcileCustomerDirectory(customers, fallback, '174094');
  assert.deepEqual(result.customers, customers);
  assert.match(result.warning!, /previously loaded/);
  assert.ok(!result.warning!.includes('secret'));
  const cold = reconcileCustomerDirectory([], fallback, '');
  assert.equal(cold.customers.length, 3);
  assert.match(cold.warning!, /limited local/);
});

test('incomplete live refresh preserves the selected customer without keeping unrelated stale rows', () => {
  const incoming = directory(customers.slice(0, 2));
  const result = reconcileCustomerDirectory(customers, incoming, '174094');
  assert.deepEqual(result.customers, [...incoming.customers, customers[30]]);
  assert.match(result.warning!, /Keeping your current workspace/);
  assert.equal(incoming.customers.length, 2);
  const recovered = reconcileCustomerDirectory(result.customers, directory(), '174094');
  assert.equal(recovered.warning, undefined);
  assert.equal(recovered.customers.filter(c=>c.lift_customer_id==='174094').length, 1);
});

test('preselected customer identity is retained when it has never appeared in the directory', () => {
  const result = reconcileCustomerDirectory([], directory(customers.slice(0, 2)), '174094');
  assert.equal(result.customers.at(-1)?.lift_customer_id, '174094');
  assert.match(result.warning!, /not returned/);
});

test('inactive Lift customers remain selectable regardless of Pathfinder workspace existence', () => {
  const inactive = {lift_customer_id:'900001', customer_name:'Inactive account', customer_status:'Inactive'};
  const all = [...customers, inactive];
  assert.deepEqual(reconcileCustomerDirectory([], directory(all), '').customers, all);
  assert.deepEqual(filterCustomers(all, '900001'), [inactive]);
  assert.equal(filterCustomers(all, '').length, all.length);
});
