// Synthetic test inputs only; these are not operating recommendations or defaults.
export const captureParameters = {
  IntakeAssuranceStorageEnabled: "true", IntakeAssuranceCaptureEnabled: "true",
  IntakeAssuranceCustomerId: "synthetic", IntakeAssuranceImportMethodId: "method", IntakeAssuranceConnectionId: "connection",
  IntakeAssuranceSlaSeconds: "3600", IntakeAssuranceMaxCandidates: "10", IntakeAssuranceSnapshotLimit: "100",
  IntakeDiscoveryMaxRequests: "100", IntakeDiscoveryMaxElapsedMs: "10000"
};
export const captureFields = {
  IntakeAssuranceCustomerId: "PATHFINDER_INTAKE_ASSURANCE_CUSTOMER_ID",
  IntakeAssuranceImportMethodId: "PATHFINDER_INTAKE_ASSURANCE_IMPORT_METHOD_ID",
  IntakeAssuranceConnectionId: "PATHFINDER_INTAKE_ASSURANCE_CONNECTION_ID",
  IntakeAssuranceSlaSeconds: "PATHFINDER_INTAKE_ASSURANCE_SLA_SECONDS",
  IntakeAssuranceMaxCandidates: "PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES",
  IntakeAssuranceSnapshotLimit: "PATHFINDER_INTAKE_SWEEP_SNAPSHOT_LIMIT",
  IntakeDiscoveryMaxRequests: "PATHFINDER_INTAKE_DISCOVERY_MAX_REQUESTS",
  IntakeDiscoveryMaxElapsedMs: "PATHFINDER_INTAKE_DISCOVERY_MAX_ELAPSED_MS"
};
export const captureRanges = {
  IntakeAssuranceSlaSeconds: [60, 604800], IntakeAssuranceMaxCandidates: [1, 1000], IntakeAssuranceSnapshotLimit: [1, 10000],
  IntakeDiscoveryMaxRequests: [1, 256], IntakeDiscoveryMaxElapsedMs: [1, 120000]
};
export const captureValidation = { validateParameters: true, rules: ["IntakeCaptureRequiresStorageAndScope", "IntakeCaptureMatchesScheduledScope"] };
export const captureVariables = (evaluated) => evaluated.Resources.PathfinderApiFunction.Properties.Environment.Variables;
