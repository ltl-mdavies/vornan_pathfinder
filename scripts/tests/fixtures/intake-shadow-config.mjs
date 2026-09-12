export const shadowKeys = ["PATHFINDER_ENABLE_INTAKE_SHADOW", "PATHFINDER_INTAKE_SHADOW_SCOPE", "PATHFINDER_INTAKE_SHADOW_LIMITS"];
export function withoutShadow(template) {
  const prior = structuredClone(template);
  for (const key of ["IntakeShadowEnabled", "IntakeShadowStatusId", "IntakeShadowMaxCandidates", "IntakeShadowMaxElapsedMs"]) delete prior.Parameters[key];
  delete prior.Rules.IntakeShadowRequiresIsolatedScheduledScope;
  delete prior.Conditions.IntakeShadowActive;
  for (const key of shadowKeys) delete prior.Resources.PathfinderApiFunction.Properties.Environment.Variables[key];
  return prior;
}
