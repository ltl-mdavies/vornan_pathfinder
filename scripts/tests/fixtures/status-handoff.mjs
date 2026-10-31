// Remove only the independently verified additive Status toggle for historical contracts.
// Never update historical hashes to bless unrelated infrastructure changes.
export function withoutStatusHandoff(template) {
  const prior = structuredClone(template);
  delete prior.Parameters.ProofStatusHandoffLtlDemoEnabled;
  delete prior.Conditions.ProofStatusHandoffActive;
  delete prior.Resources.PathfinderApiFunction.Properties.Environment.Variables.PATHFINDER_PROOF_STATUS_HANDOFF_LTL_DEMO;
  return prior;
}
