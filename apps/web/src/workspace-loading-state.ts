/** Startup presentation only. Does not select customers, grant access or fetch data. */
export function workspaceLoadingState(input: {
  operations: boolean;
  view: string;
  customerCount: number;
  customersLoading: boolean;
  directoryError?: string | null;
  selectedCustomerId: string;
  workspaceMatches: boolean;
  workspaceState: string;
  workspaceError?: string | null;
  setupCustomerId?: string | null;
  targetsPending: boolean;
  registryPending: boolean;
}) {
  const customerScope = !input.operations || input.view === "Customers";
  const customerPending = customerScope && Boolean(input.selectedCustomerId) && !input.workspaceMatches;
  const directoryError = input.customerCount === 0 && !input.customersLoading;
  const customerError = customerPending && input.workspaceState === "error";
  const error = directoryError
    ? input.directoryError || "Pathfinder could not load the customer directory."
    : customerError ? input.workspaceError || "Pathfinder could not load the selected customer workspace." : null;
  return {
    pending: !error && ((input.customerCount === 0 && input.customersLoading) || customerPending || input.targetsPending || input.registryPending),
    error,
    scope: customerPending && !directoryError ? "customer" as const : "application" as const,
    // A customer recovery action must never appear during global bootstrap.
    showDirectory: Boolean(input.operations && customerError && input.customerCount > 0),
    setupRequired: Boolean(customerError && input.setupCustomerId === input.selectedCustomerId)
  };
}
