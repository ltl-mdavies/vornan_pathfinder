// Independent legacy template representation for rollback and historical comparisons.
export const legacyWorkspaceBindings = {
  PATHFINDER_CUSTOMERS_TABLE: "PathfinderCustomersTable",
  PATHFINDER_CUSTOMER_WORKSPACES_TABLE: "PathfinderCustomerWorkspacesTable",
  PATHFINDER_IMPORT_METHODS_TABLE: "PathfinderImportMethodsTable",
  PATHFINDER_OUTPUT_ROUTES_TABLE: "PathfinderOutputRoutesTable",
  PATHFINDER_PRODUCT_MAPPINGS_TABLE: "PathfinderProductMappingsTable",
  PATHFINDER_JOBS_TABLE: "PathfinderJobsTable",
  PATHFINDER_ORDER_IDS_TABLE: "PathfinderOrderIdsTable",
  PATHFINDER_SUBMIT_ATTEMPTS_TABLE: "PathfinderSubmitAttemptsTable"
};
export function withoutWorkspacePacking(template) {
  const prior = structuredClone(template);
  const env = prior.Resources.PathfinderApiFunction.Properties.Environment.Variables;
  delete env.PATHFINDER_TABLE_NAMESPACE;
  for (const [binding, resource] of Object.entries(legacyWorkspaceBindings)) env[binding] = { Ref: resource };
  return prior;
}
