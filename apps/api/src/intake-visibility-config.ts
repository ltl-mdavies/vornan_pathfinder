import { assertIntakeLambdaPersistence } from "./intake-runtime-persistence.js";

export function getIntakeVisibilityConfig(env: NodeJS.ProcessEnv) {
  if (env.PATHFINDER_ENABLE_INTAKE_EXCEPTIONS !== "true") return { enabled: false, customer_ids: [] as string[] };
  assertIntakeLambdaPersistence(env, "visibility");
  const customer = env.PATHFINDER_INTAKE_EXCEPTIONS_CUSTOMER_IDS ?? "";
  if (env.PATHFINDER_REQUIRE_AUTH !== "true" || customer !== customer.trim() || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(customer)) {
    throw new Error("Intake visibility requires authentication and one explicit safe customer ID");
  }
  return { enabled: true, customer_ids: [customer] };
}
