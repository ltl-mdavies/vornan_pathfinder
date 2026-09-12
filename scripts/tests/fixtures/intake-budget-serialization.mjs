// Independent test-side expected wire format. Production parsing is tested in API tests.
export const budgetGroups = {
  capture: { compact: "PATHFINDER_INTAKE_CAPTURE_LIMITS", condition: "IntakeAssuranceCaptureActive", parameters: ["IntakeAssuranceMaxCandidates", "IntakeDiscoveryMaxRequests", "IntakeDiscoveryMaxElapsedMs"], fields: ["PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES", "PATHFINDER_INTAKE_DISCOVERY_MAX_REQUESTS", "PATHFINDER_INTAKE_DISCOVERY_MAX_ELAPSED_MS"] },
  recovery: { compact: "PATHFINDER_INTAKE_RECOVERY_LIMITS", condition: "IntakeAssuranceRecoveryActive", parameters: ["IntakeSweepPageSize", "IntakeSweepMaxPages", "IntakeSweepLeaseSeconds"], fields: ["PATHFINDER_INTAKE_SWEEP_PAGE_SIZE", "PATHFINDER_INTAKE_SWEEP_MAX_PAGES", "PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS"] }
};
export function legacyFixtureVariables(variables) {
  const result = { ...variables };
  for (const group of Object.values(budgetGroups)) if (result[group.compact] !== undefined) {
    const parts = result[group.compact].split("|");
    if (parts.length !== 4 || parts[0] !== "1") throw new Error("Invalid fixture serialization");
    group.fields.forEach((field, index) => { result[field] = parts[index + 1]; });
    delete result[group.compact];
  }
  return result;
}
