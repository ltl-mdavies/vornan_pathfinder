import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogApi} from '../src/customer-catalog/catalog-api';
import {catalogAvailable} from '../src/customer-catalog/catalog-access';
import {emptyCatalog} from '../src/customer-catalog/catalog';

const customer = {id: 'example-b', name: 'Example B', source: 'standard-v1'};
const record = {catalog: emptyCatalog(customer), revision: 1, currentRevision: 1, reasons: [], actor: 'editor', at: ''};
const access = {record: null, customer, operatorId: 'editor', capabilities: {edit: true}, submissionEnabled: false};
class Store {
  values = new Map<string, string>();
  get length() {return this.values.size;}
  key(i: number) {return [...this.values.keys()][i] ?? null;}
  getItem(key: string) {return this.values.get(key) ?? null;}
  setItem(key: string, value: string) {this.values.set(key, value);}
  removeItem(key: string) {this.values.delete(key);}
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});

test('navigation defaults off and requires authentication plus an explicit customer', () => {
  for (const flag of [undefined, '', 'false', 'TRUE', '1']) assert.equal(catalogAvailable(flag, customer.id, customer.id, true), false);
  assert.equal(catalogAvailable('true', customer.id, customer.id, false), false);
  assert.equal(catalogAvailable('true', '*', customer.id, true), false);
  assert.equal(catalogAvailable('true', `unrelated-fixture, ${customer.id}`, customer.id, true), true);
});

test('lost response survives reload; status checks never write and retry preserves exact body/key', async () => {
  const store = new Store(), calls: {url: string; init?: RequestInit}[] = [];
  let lose = true;
  const send: typeof fetch = async (url, init) => {
    calls.push({url: String(url), init});
    if (init?.method === 'POST') {if (lose) throw new Error('lost'); return json(record);}
    if (String(url).includes('/operations/')) return json({status: 'unconfirmed', revision: null, submissionEnabled: false});
    return json(access);
  };
  const first = createCatalogApi('/test', customer.id, store, send); await first.load();
  await assert.rejects(first.save({kind: 'import', rows: []}, 0), /unconfirmed/);
  const attempted = first.pending()[0];
  const reloaded = createCatalogApi('/test', customer.id, store, send); await reloaded.load();
  assert.equal(calls.filter(c => c.init?.method === 'POST').length, 1);
  await assert.rejects(reloaded.retry(attempted), /Check status/);
  await assert.rejects(reloaded.save({kind: 'edit-item'}, 0), /unconfirmed/);
  await reloaded.check(attempted);
  assert.equal(calls.filter(c => c.init?.method === 'POST').length, 1);
  lose = false; await reloaded.retry(attempted);
  const posts = calls.filter(c => c.init?.method === 'POST');
  assert.equal(posts[0].init?.body, posts[1].init?.body); assert.deepEqual(posts[0].init?.headers, posts[1].init?.headers); assert.equal(reloaded.pending().length, 0);
});

test('a recorded save is reconciled without a second POST', async () => {
  const store = new Store(); let posts = 0;
  const send: typeof fetch = async (url, init) => {
    if (init?.method === 'POST') {posts++; throw new Error('lost after commit');}
    return json(String(url).includes('/operations/') ? {status: 'recorded', revision: 1, submissionEnabled: false} : access);
  };
  const api = createCatalogApi('', customer.id, store, send); await api.load();
  await assert.rejects(api.save({kind: 'import'}, 0));
  await api.check(api.pending()[0]); assert.equal(posts, 1); assert.equal(api.pending().length, 0);
});

test('storage failure prevents transmission and readonly grants prevent edits', async () => {
  let posts = 0;
  const store = new Store(); store.setItem = () => {throw new Error('full');};
  const send: typeof fetch = async (_, init) => {if (init?.method === 'POST') posts++; return json(access);};
  const api = createCatalogApi('', customer.id, store, send); await api.load();
  await assert.rejects(api.save({kind: 'import'}, 0), /full/); assert.equal(posts, 0);
  const reader = createCatalogApi('', customer.id, new Store(), async () => json({...access, capabilities: {edit: false}}));
  await reader.load(); await assert.rejects(reader.save({kind: 'import'}, 0), /not available/);
});

test('recovery records stay isolated by verified operator, customer and API', async () => {
  const store = new Store();
  const api = createCatalogApi('/one', customer.id, store, async (_, init) => {if (init?.method === 'POST') throw new Error('lost'); return json(access);});
  await api.load(); await assert.rejects(api.save({kind: 'import'}, 0));
  for (const [base, operatorId] of [['/one', 'other-user'], ['/two', 'editor']]) {
    const other = createCatalogApi(base, customer.id, store, async () => json({...access, operatorId}));
    await other.load(); assert.equal(other.pending().length, 0);
  }
  const wrong = createCatalogApi('', 'other-customer', store, async () => json(access));
  await assert.rejects(wrong.load(), /did not match/);
});

test('definite conflicts retain downloadable changes; unresolved requests cannot be discarded', async () => {
  for (const status of [409, 503, 200]) {
    const store = new Store();
    const api = createCatalogApi('', customer.id, store, async (_, init) => init?.method === 'POST' ? json({error: 'Conflict'}, status) : json(access));
    await api.load(); await assert.rejects(api.save({kind: 'import'}, 0));
    assert.equal(api.pending().length, 1);
    if(status===409){assert.equal(api.pending()[0].rejection,'Conflict');api.discardRejected(api.pending()[0]);assert.equal(api.pending().length,0);}
    else assert.throws(()=>api.discardRejected(api.pending()[0]),/unresolved/);
  }
});

test('a replay cannot replace a newer catalog with an older response', async () => {
  const api = createCatalogApi('', customer.id, new Store(), async (_, init) => json(init?.method === 'POST' ? {...record, currentRevision: 2} : access));
  await api.load(); await assert.rejects(api.save({kind: 'import'}, 0), /newer revision/);
});
