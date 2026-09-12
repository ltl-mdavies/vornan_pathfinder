import { captureParameters, captureFields, captureValidation } from "./intake-capture-config.mjs";
export const recoveryFields = {
  IntakeSweepPageSize: "PATHFINDER_INTAKE_SWEEP_PAGE_SIZE",
  IntakeSweepMaxPages: "PATHFINDER_INTAKE_SWEEP_MAX_PAGES",
  IntakeSweepLeaseSeconds: "PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS"
};
export const recoveryRanges = { IntakeSweepPageSize: [1, 100], IntakeSweepMaxPages: [1, 10], IntakeSweepLeaseSeconds: [30, 900] };
export const sharedFields = Object.fromEntries(Object.entries(captureFields).filter(([name]) => ["IntakeAssuranceCustomerId", "IntakeAssuranceImportMethodId", "IntakeAssuranceConnectionId", "IntakeAssuranceSlaSeconds", "IntakeAssuranceSnapshotLimit"].includes(name)));
// Synthetic inputs only; not production defaults or operating recommendations.
export const recoveryParameters = {
  IntakeAssuranceStorageEnabled: "true", IntakeAssuranceRecoveryEnabled: "true",
  ...Object.fromEntries(Object.keys(sharedFields).map((name) => [name, captureParameters[name]])),
  IntakeSweepPageSize: "10", IntakeSweepMaxPages: "2", IntakeSweepLeaseSeconds: "60"
};
export const recoveryRules = ["IntakeRecoveryRequiresDurableScope", "IntakeRecoveryMatchesScheduledScope"];
export const recoveryValidation = { validateParameters: true, rules: [...captureValidation.rules, ...recoveryRules] };
