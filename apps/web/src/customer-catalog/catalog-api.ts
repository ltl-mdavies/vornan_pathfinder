import type {Catalog, Customer, ChangeReasonOption} from '@pathfinder/catalog-domain';
import {pathfinderFetch} from '../api-client';

export type CatalogRecord = {catalog: Catalog; revision: number; reasons: ChangeReasonOption[]; at: string; actor: string};
export type CatalogAccess = {record: CatalogRecord | null; customer: Customer; operatorId: string; capabilities: {edit: boolean}; submissionEnabled: false};
export type PendingCatalogSave = {key: string; body: string; at: string; rejection?: string};
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const uncertain = 'Save outcome unconfirmed. Check status before retrying. Your attempted changes are retained in this browser.';
const safeId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** No automatic writes, including on mount, reload, authentication recovery or status checks. */
export function createCatalogApi(apiBase: string, customerId: string, storage: Store, send: typeof fetch = pathfinderFetch) {
  if (!safeId.test(customerId)) throw new Error('Invalid customer identity.');
  const endpoint = `${apiBase.replace(/\/$/, '')}/api/customers/${encodeURIComponent(customerId)}/catalog-records`;
  let prefix = '', editable = false;
  const checked = new Set<string>();
  async function read(url: string) {
    const r = await send(url, {cache: 'no-store', signal: AbortSignal.timeout(20000)});
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || 'Catalog unavailable. Check your access and try again.');
    return value;
  }
  function pending(): PendingCatalogSave[] {
    if (!prefix) return [];
    const values: PendingCatalogSave[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const p = JSON.parse(storage.getItem(key)!);
      if (!p || typeof p.body !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(p.key) || key !== prefix + p.key || typeof p.at !== 'string') throw new Error('A catalog recovery record needs support. Do not clear browser storage.');
      values.push(p);
    }
    return values;
  }
  async function load(): Promise<CatalogAccess> {
    const value = await read(endpoint) as CatalogAccess;
    if (value.customer?.id !== customerId || typeof value.operatorId !== 'string' || !value.operatorId ||
        typeof value.capabilities?.edit !== 'boolean' || value.submissionEnabled !== false ||
        (value.record && (value.record.catalog?.customer.id !== customerId || !Number.isSafeInteger(value.record.revision)))) {
      throw new Error('Catalog response did not match this customer. Reload before continuing.');
    }
    prefix = `pathfinder.catalog.save.v1:${encodeURIComponent(endpoint)}:${encodeURIComponent(value.operatorId)}:`;
    editable = value.capabilities.edit;
    return value;
  }
  async function transmit(request: PendingCatalogSave): Promise<CatalogRecord> {
    if (!editable || !prefix) throw new Error('Editing is not available for this customer.');
    let r: Response;
    try { r = await send(endpoint, {method: 'POST', signal: AbortSignal.timeout(30000), headers: {'Content-Type': 'application/json', 'Idempotency-Key': request.key}, body: request.body}); }
    catch { throw new Error(uncertain); }
    // Definite pre-commit rejections keep a downloadable copy; transport/server failures remain unresolved.
    if ([400, 401, 403, 409, 413, 422, 423].includes(r.status)) {
      const value = await r.json();
      const message = value.error || 'Save rejected. Reload and review your changes.';
      storage.setItem(prefix + request.key, JSON.stringify({...request, rejection:message}));
      throw new Error(message);
    }
    let value: CatalogRecord & {currentRevision: number};
    try { value = await r.json(); } catch { throw new Error(uncertain); }
    if (!r.ok || value.catalog?.customer.id !== customerId || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.currentRevision)) throw new Error(uncertain);
    storage.removeItem(prefix + request.key);
    if (value.currentRevision !== value.revision) throw new Error('Your save was recorded, but a newer revision exists. Reload before editing.');
    return value;
  }
  return {
    load, pending,
    discardRejected(request: PendingCatalogSave) {
      if (!pending().some(p => p.key === request.key && p.body === request.body && p.rejection)) throw new Error('An unresolved save cannot be discarded. Check its status first.');
      storage.removeItem(prefix + request.key);
    },
    async save(operation: Record<string, unknown>, expectedRevision: number) {
      if (!editable || !prefix) throw new Error('Editing is not available for this customer.');
      if (pending().some(p => !p.rejection)) throw new Error(uncertain);
      const request = {key: crypto.randomUUID(), body: JSON.stringify({operation, expectedRevision}), at: new Date().toISOString()};
      // A full or unavailable browser store prevents transmission, never creates an unrecoverable write.
      storage.setItem(prefix + request.key, JSON.stringify(request));
      return transmit(request);
    },
    async check(request: PendingCatalogSave) {
      if (!pending().some(p => p.key === request.key && p.body === request.body)) throw new Error('Recovery record changed. Reload before continuing.');
      const result = await read(`${endpoint}/operations/${encodeURIComponent(request.key)}`);
      if (!['recorded', 'unconfirmed'].includes(result.status) || result.submissionEnabled !== false) throw new Error('Status is unavailable. Try checking again.');
      if (result.status === 'recorded') storage.removeItem(prefix + request.key);
      else checked.add(request.key);
      return result as {status: 'recorded' | 'unconfirmed'; revision: number | null};
    },
    async retry(request: PendingCatalogSave) {
      if (!checked.has(request.key) || !pending().some(p => p.key === request.key && p.body === request.body && !p.rejection)) throw new Error('Check status before retrying this save.');
      checked.delete(request.key);
      return transmit(request);
    }
  };
}
