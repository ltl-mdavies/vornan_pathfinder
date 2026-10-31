/** Initial cohort uses the configured Firebase app's canonical auth domain only. */
export function validStatusReviewerConfig(env: Record<string, string | undefined>) {
  const firebaseProjectId = env.VITE_FIREBASE_PROJECT_ID;
  return env.VITE_PROOF_STATUS_REVIEWER_SIGNIN === "true"
    && Boolean(firebaseProjectId && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId)
      && env.VITE_FIREBASE_AUTH_DOMAIN === `${firebaseProjectId}.firebaseapp.com`
      && env.VITE_FIREBASE_API_KEY?.trim() && env.VITE_FIREBASE_APP_ID?.trim());
}
