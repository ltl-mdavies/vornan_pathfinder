import type { LiftCustomer, LiftCustomerDirectory } from '@pathfinder/customer-directory';

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
