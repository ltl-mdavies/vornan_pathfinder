import { readTargetSecrets } from "./secrets-store.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export interface TargetLiftDetailedReportCredentials {
  username: string;
  password: string;
}

function requiredUser(value: unknown) {
  if (typeof value !== "string" || !identifier.test(value.trim())) {
    throw new Error("Lift detailed-report user is not configured for this target environment.");
  }
  return value.trim();
}

function requiredPassword(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 4_096 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Lift detailed-report password is not configured for this target environment.");
  }
  return value;
}

/**
 * Detailed reports use the saved Basic credentials for the locked Lift target.
 * This is intentionally separate from the bearer-token credentials used by
 * customer Proof actions.
 */
export async function readTargetEnvironmentLiftDetailedReportCredentials(
  targetId: string,
  environmentId: string
): Promise<TargetLiftDetailedReportCredentials> {
  const secrets = await readTargetSecrets(targetId);
  const environmentCredentials = secrets.environments?.[environmentId]?.credentials;
  const fallbackCredentials = secrets.lift?.credentials;
  return {
    username: requiredUser(environmentCredentials?.User ?? fallbackCredentials?.User),
    password: requiredPassword(environmentCredentials?.Password ?? fallbackCredentials?.Password)
  };
}
