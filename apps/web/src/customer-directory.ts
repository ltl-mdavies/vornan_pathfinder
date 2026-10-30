import type { LiftCustomer, LiftCustomerDirectory } from '@pathfinder/customer-directory';

export type CustomerOrderSummary = { customer_id: string; status: 'confirmed' | 'none' | 'date_unavailable'; order_number?: string; confirmed_at?: string };
export function parseCustomerOrderSummaries(value: unknown): Record<string, CustomerOrderSummary> {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) throw new Error('Invalid order summary');
  const result: Record<string, CustomerOrderSummary> = Object.create(null);
  for (const item of value.items) {
    if (!item || typeof item.customer_id !== 'string' || !['confirmed', 'none', 'date_unavailable'].includes(item.status) || result[item.customer_id]) throw new Error('Invalid order summary');
    if (item.status === 'confirmed' && (typeof item.order_number !== 'string' || !item.order_number || typeof item.confirmed_at !== 'string' || !Number.isFinite(Date.parse(item.confirmed_at)))) throw new Error('Invalid confirmation');
    result[item.customer_id] = { customer_id: item.customer_id, status: item.status, order_number: item.order_number, confirmed_at: item.confirmed_at };
  }
  return result;
}

// Distinguish a missing column from an explicitly blank value without colliding with real labels.
export const directoryFieldKey = (value: string | null | undefined) => value === undefined ? 'missing:' : !value?.trim() ? 'blank:' : `value:${value.trim()}`;
export const directoryFieldLabel = (value: string | null | undefined) => value === undefined ? 'Unavailable' : value?.trim() || 'Not recorded';

export function reconcileCustomerDirectory(
  previous: LiftCustomer[], directory: LiftCustomerDirectory, selectedId: string
) {
  const fallback = directory.source === 'local-seed';
  const customers = fallback && previous.length ? [...previous] : [...directory.customers];
  const missingSelection = Boolean(selectedId && !customers.some(c => c.lift_customer_id === selectedId));
  if (missingSelection) {
    customers.push(previous.find(c => c.lift_customer_id === selectedId) ?? {
      lift_customer_id: selectedId, customer_name: `Lift Customer ${selectedId}`
    });
  }
  const warning = fallback
    ? previous.length
      ? 'Lift could not be refreshed. Showing the previously loaded customer list. Retry refresh.'
      : 'Lift could not be loaded. Showing a limited local customer list. Retry refresh.'
    : missingSelection
      ? 'The selected customer was not returned by Lift. Keeping your current workspace; retry refresh.'
      : directory.warning
        ? 'Customers loaded, but some customer status details are unavailable. Retry refresh.'
        : undefined;
  return {customers, warning};
}

export function filterCustomers(customers: LiftCustomer[], search: string) {
  const query = search.trim().toLowerCase();
  return query ? customers.filter(customer => [customer.customer_name, customer.lift_customer_id,
    customer.customer_number, customer.crm_id, customer.terms, customer.terms_status]
    .some(value => value?.toLowerCase().includes(query))) : customers;
}
