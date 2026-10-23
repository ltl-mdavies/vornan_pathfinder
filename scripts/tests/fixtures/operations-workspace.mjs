// Remove only the independently tested additive operations toggle when comparing
// historical infrastructure contracts. Historical expected hashes stay unchanged.
export function withoutOperationsWorkspace(template) {
  const prior = structuredClone(template);
  delete prior.Parameters.OperationsWorkspaceEnabled;
  delete prior.Rules.OperationsWorkspaceRequiresAuth;
  delete prior.Conditions.OperationsWorkspaceActive;
  delete prior.Resources.PathfinderApiFunction.Properties.Environment.Variables.PATHFINDER_ENABLE_OPERATIONS_WORKSPACE;
  return prior;
}
