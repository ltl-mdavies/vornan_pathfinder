/** Enabled intake work in Lambda must never fall back to ephemeral local state. */
export function assertIntakeLambdaPersistence(env: NodeJS.ProcessEnv, capability: string) {
  if ((env.PATHFINDER_RUNTIME === "lambda" || env.AWS_LAMBDA_FUNCTION_NAME) &&
    (env.PATHFINDER_STORAGE_DRIVER !== "dynamodb" || !env.PATHFINDER_INTAKE_ATTEMPTS_TABLE ||
      env.PATHFINDER_INTAKE_ATTEMPTS_TABLE !== env.PATHFINDER_INTAKE_ATTEMPTS_TABLE.trim())) {
    throw new Error(`Lambda intake ${capability} requires the DynamoDB driver and an intake table binding`);
  }
}
