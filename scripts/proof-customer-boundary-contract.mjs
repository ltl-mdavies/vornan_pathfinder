const REQUIRED_OUTPUTS = Object.freeze([
  "ProofCoreTableName",
  "ProofAuditTableName",
  "ProofPublicApiEndpoint",
  "ProofWebDistributionDomainName"
]);

function entries(items, keyName, valueName) {
  return Object.fromEntries((items ?? []).map((item) => [item[keyName], item[valueName]]));
}

export function evaluateProofCustomerBoundaryStack(stack) {
  const parameters = entries(stack?.Parameters, "ParameterKey", "ParameterValue");
  const outputs = entries(stack?.Outputs, "OutputKey", "OutputValue");
  const outputGates = Object.fromEntries(REQUIRED_OUTPUTS.map((name) => [name, Boolean(outputs[name])]));
  const gates = {
    stack_complete: /^(CREATE|UPDATE)_COMPLETE$/.test(stack?.StackStatus ?? ""),
    environment_is_dev: parameters.EnvironmentName === "dev",
    public_read_window_enabled: parameters.PublicReadEnabled === "true",
    isolated_read_qa_recorded: parameters.ReadOnlyQaConfirmed === "true",
    production_public_read_unapproved: parameters.ProductionPublicReadApproved === "false",
    synthetic_worker_disabled: parameters.SyntheticQaEnabled === "false",
    custom_domain_absent: !parameters.ProofDomainName && !parameters.CertificateArn,
    waf_configured:
      parameters.ManagedWebAclEnabled === "true" || Boolean(parameters.ProofWebAclArn),
    required_outputs_available: Object.values(outputGates).every(Boolean)
  };
  const unmet = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    status: unmet.length === 0 ? "ready_for_approved_boundary_qa" : "boundary_qa_blocked",
    ready: unmet.length === 0,
    gates,
    output_gates: outputGates,
    unmet_gates: unmet,
    deployment_authorized: false,
    mutation_authorized: false
  };
}

export function proofCustomerBoundaryTargets(stack) {
  const result = evaluateProofCustomerBoundaryStack(stack);
  if (!result.ready) {
    throw new Error(`Customer-boundary QA prerequisites are not met: ${result.unmet_gates.join(", ")}.`);
  }
  const outputs = entries(stack.Outputs, "OutputKey", "OutputValue");
  return {
    core_table: outputs.ProofCoreTableName,
    audit_table: outputs.ProofAuditTableName,
    public_base_url: `https://${outputs.ProofWebDistributionDomainName}`,
    direct_api_url: String(outputs.ProofPublicApiEndpoint).replace(/\/$/, "")
  };
}
