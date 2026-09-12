const fields = {
  capture: ["PATHFINDER_INTAKE_ASSURANCE_MAX_CANDIDATES", "PATHFINDER_INTAKE_DISCOVERY_MAX_REQUESTS", "PATHFINDER_INTAKE_DISCOVERY_MAX_ELAPSED_MS"],
  recovery: ["PATHFINDER_INTAKE_SWEEP_PAGE_SIZE", "PATHFINDER_INTAKE_SWEEP_MAX_PAGES", "PATHFINDER_INTAKE_SWEEP_LEASE_SECONDS"]
} as const;
const ranges = { capture: [[1, 1000], [1, 256], [1, 120000]], recovery: [[1, 100], [1, 10], [30, 900]] } as const;

/** Version 1: three bounded integer values, with no flags or scope identifiers. */
export function resolveIntakeBudgetEnvironment(env: NodeJS.ProcessEnv, kind: "capture" | "recovery"): NodeJS.ProcessEnv {
  const packed = env[kind === "capture" ? "PATHFINDER_INTAKE_CAPTURE_LIMITS" : "PATHFINDER_INTAKE_RECOVERY_LIMITS"];
  if (packed === undefined) return env;
  const invalid = () => new Error(`Invalid or conflicting intake ${kind} budget configuration`);
  // Bound parsing and never include input contents in diagnostics.
  if (packed.length > 64) throw invalid();
  const parts = packed.split("|");
  if (parts.length !== 4 || parts[0] !== "1") throw invalid();
  const legacyCount = fields[kind].filter(field => env[field] !== undefined).length;
  if (legacyCount !== 0 && legacyCount !== fields[kind].length) throw invalid();
  const resolved = { ...env };
  for (const [index, field] of fields[kind].entries()) {
    const value = parts[index + 1]!;
    const [min, max] = ranges[kind][index]!;
    if (!/^[1-9][0-9]*$/.test(value) || value.trim() !== value || Number(value) < min || Number(value) > max) throw invalid();
    // Existing individual values remain supported, but cannot silently override compact settings.
    if (env[field] !== undefined && env[field] !== value) throw invalid();
    resolved[field] = value;
  }
  return resolved;
}
