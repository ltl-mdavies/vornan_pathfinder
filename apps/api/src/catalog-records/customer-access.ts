import type {Customer} from '@pathfinder/catalog-domain';

export type CatalogAccess = 'read' | 'write';
export type CustomerAccessEntry = {customer: Customer; readers: string[]; editors: string[]};
const uidPattern = /^[A-Za-z0-9_.:@-]{1,160}$/;
export const validCatalogCustomerId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);

export function catalogCustomer(value: unknown): Customer {
  const c = value as Customer;
  if (!c || !validCatalogCustomerId(c.id) || typeof c.name !== 'string' ||
      !c.name.trim() || c.name !== c.name.trim() || c.name.length > 200 ||
      c.source !== 'standard-v1') {
    throw new Error('A trusted catalog customer ID, name and source namespace are required.');
  }
  return {id: c.id, name: c.name, source: c.source};
}

/** Internal verified-user grants only; not customer-portal membership or authentication. */
export function catalogCustomerAccess(env: NodeJS.ProcessEnv) {
  const configured = env.PATHFINDER_CATALOG_CUSTOMER_ACCESS;
  let entries: CustomerAccessEntry[];
  if (configured !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(configured); }
    catch { throw new Error('Catalog customer access must be valid JSON.'); }
    if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) {
      throw new Error('Catalog customer access requires 1–100 explicit customer entries.');
    }
    entries = parsed.map(entry => {
      if (!entry || Object.keys(entry).some(k => !['customer', 'readers', 'editors'].includes(k))) {
        throw new Error('Invalid catalog customer access entry.');
      }
      const customer = catalogCustomer(entry.customer);
      const users = (value: unknown): string[] => {
        if (!Array.isArray(value) || value.length > 500 || value.some(uid => typeof uid !== 'string' || !uidPattern.test(uid))) {
          throw new Error('Catalog grants require explicit verified user IDs.');
        }
        return [...new Set(value)] as string[];
      };
      const readers = users(entry.readers), editors = users(entry.editors);
      if (!readers.length && !editors.length) throw new Error('Catalog customer access cannot be empty.');
      return {customer, readers, editors};
    });
  } else {
    throw new Error('Catalog persistence requires explicit verified-user customer grants.');
  }
  const registry = new Map(entries.map(entry => [entry.customer.id, entry]));
  if (registry.size !== entries.length) throw new Error('Duplicate catalog customer access entries.');
  return {
    customer: (id: string) => {
      const entry = registry.get(id);
      return entry ? {...entry.customer} : undefined;
    },
    authorize: async (uid: string, id: string, access: CatalogAccess = 'write') => {
      const entry = registry.get(id);
      return Boolean(entry && (entry.editors.includes(uid) || (access === 'read' && entry.readers.includes(uid))));
    }
  };
}
