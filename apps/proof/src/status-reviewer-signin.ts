import type { Auth } from "firebase/auth";
import { validStatusReviewerConfig } from "./status-reviewer-config";
import { timeReviewerStage, type ReviewerStage } from "./reviewer-progress";

let reviewerAuth: Auth | null = null;
export function statusReviewerSignInConfigured() {
  return validStatusReviewerConfig(import.meta.env);
}

/** A named, memory-only Firebase app prevents changing Pathfinder sign-in.
 * No tokens are put in URLs, logs or application storage. Server authorization
 * remains authoritative; the email field/display name is never used as proof.
 */
export async function signInStatusReviewer(onStage: (stage: ReviewerStage) => void = () => undefined) {
  if (!statusReviewerSignInConfigured()) throw new Error("Reviewer sign-in is not available yet.");
  onStage("preparing");
  const [app, auth] = await timeReviewerStage("preparing", () => Promise.all([import("firebase/app"), import("firebase/auth")]));
  if (!reviewerAuth) {
    const name = "proof-status-reviewer";
    const firebaseApp = app.getApps().find(candidate => candidate.name === name) ?? app.initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID
    }, name);
    reviewerAuth = auth.initializeAuth(firebaseApp, { persistence: auth.inMemoryPersistence, popupRedirectResolver: auth.browserPopupRedirectResolver });
  }
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  onStage("google");
  const result = await timeReviewerStage("google", () => auth.signInWithPopup(reviewerAuth!, provider));
  onStage("token");
  await timeReviewerStage("token", () => result.user.getIdToken());
}

export async function statusReviewerBearer() {
  return reviewerAuth?.currentUser ? reviewerAuth.currentUser.getIdToken() : null;
}

export async function clearStatusReviewerSignIn() {
  if (reviewerAuth) {
    const { signOut } = await import("firebase/auth");
    await signOut(reviewerAuth);
  }
}
