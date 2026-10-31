export type ReviewerStage = "preparing" | "google" | "token" | "authorizing" | "loading";

export function reviewerProgress(stage: ReviewerStage) {
  return {
    preparing: "Preparing secure sign-in…",
    google: "Complete sign-in with Google…",
    token: "Confirming your Google sign-in…",
    authorizing: "Checking reviewer access…",
    loading: "Opening your reviewer view…"
  }[stage];
}

export function reviewerSignInFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Sign-in was cancelled. You can still view the artwork and try again when ready.";
  }
  if (code === "auth/popup-blocked") {
    return "Your browser blocked the Google sign-in window. Allow popups for Proof, then try again.";
  }
  return "Reviewer access couldn’t be verified. You can still view the artwork.";
}

/** Fixed-name local Performance entries only: no identities, URLs, tokens,
 * persistent storage, or telemetry. Retain at most one duration per stage.
 * Instrumentation must never affect authorization or error handling. */
export async function timeReviewerStage<T>(stage: ReviewerStage, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await work(); }
  finally {
    try {
      const name = `proof-reviewer:${stage}`;
      performance.clearMeasures(name);
      performance.measure(name, { start, end: performance.now() });
    } catch { /* Timing is diagnostic only. */ }
  }
}
