/** Initial internal LTL Demo cohort, explicitly approved by the operator.
 * This policy is not an authentication provider and never mints access.
 */
export const LTL_DEMO_STATUS_REVIEWER = "mdavies@ltlco.com";

export interface VerifiedReviewerIdentity {
  uid: string;
  email?: string;
  email_verified?: boolean;
  auth_time: number;
  exp: number;
}

export async function verifyStatusReviewerToken(token: string, checkRevoked: true): Promise<VerifiedReviewerIdentity> {
  // Named app: never alter Pathfinder's existing default Firebase app.
  const config = validateStatusReviewerFirebaseConfig(process.env);
  const { getApps, initializeApp, cert, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const name = "proof-status-reviewer";
  const app = getApps().find(candidate => candidate.name === name) ?? initializeApp({
    projectId: config.projectId,
    credential: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) : applicationDefault()
  }, name);
  if (app.options.projectId !== config.projectId) throw new Error("Reviewer sign-in is not configured.");
  return getAuth(app).verifyIdToken(token, checkRevoked);
}

export function validateStatusReviewerFirebaseConfig(env: Record<string, string | undefined>) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const deny = () => new Error("Reviewer sign-in is not configured.");
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || env.FIREBASE_AUTH_EMULATOR_HOST) throw deny();
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let credential;
    try { credential = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); } catch { throw deny(); }
    if (credential?.project_id !== projectId || credential?.type !== "service_account") throw deny();
  }
  return { projectId };
}

/** The verifier MUST perform signature/issuer/audience/expiry AND revocation
 * verification server-side (e.g. Firebase Admin verifyIdToken(token, true)).
 * Never supply decoded-but-unverified client claims as this dependency.
 * A successful result establishes identity only: exact order, current customer
 * capability, parent Status authority, CSRF and decision-version checks remain
 * required before any review grant/action can be authorized.
 */
export async function verifyLtlDemoStatusReviewer(input: {
  enabled: boolean;
  customerId: string;
  bearer: string;
  verifyToken: (token: string, checkRevoked: true) => Promise<VerifiedReviewerIdentity>;
  now?: Date;
}) {
  const deny = () => new Error("Verified reviewer authorization is unavailable.");
  if (!input.enabled || input.customerId !== "1249" || !input.bearer || input.bearer.length > 16384) throw deny();
  let identity: VerifiedReviewerIdentity;
  try { identity = await input.verifyToken(input.bearer, true); } catch { throw deny(); }
  const now = (input.now ?? new Date()).getTime() / 1000;
  if (!Number.isFinite(now) || !identity.uid?.trim() || identity.email_verified !== true
    || identity.email?.trim().toLowerCase() !== LTL_DEMO_STATUS_REVIEWER
    || !Number.isFinite(identity.auth_time) || identity.auth_time > now + 30 || now - identity.auth_time > 15 * 60
    || !Number.isFinite(identity.exp) || identity.exp <= now) throw deny();
  return { uid: identity.uid, email: LTL_DEMO_STATUS_REVIEWER, verified_at: new Date(now * 1000).toISOString(),
    expires_at: new Date(Math.min(identity.exp, identity.auth_time + 15 * 60) * 1000).toISOString() };
}
