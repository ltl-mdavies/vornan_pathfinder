import type { Auth } from "firebase/auth";
import { validStatusReviewerConfig } from "./status-reviewer-config";

let reviewerAuth: Auth | null = null;
export function statusReviewerSignInConfigured() {
  return validStatusReviewerConfig(import.meta.env);
}

/** A named, memory-only Firebase app prevents changing Pathfinder sign-in.
 * No tokens are put in URLs, logs or application storage. Server authorization
 * remains authoritative; the email field/display name is never used as proof.
 */
export async function signInStatusReviewer() {
  if (!statusReviewerSignInConfigured()) throw new Error("Reviewer sign-in is not available yet.");
  const [app, auth] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
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
  await auth.signInWithPopup(reviewerAuth, provider);
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
