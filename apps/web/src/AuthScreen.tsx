import React from "react";
import { LoaderCircle } from "lucide-react";

export type AuthScreenState = "signed-out" | "checking" | "signing-in" | "error" | "expired" | "restricted" | "unconfigured";

export interface AuthScreenProps {
  state: AuthScreenState;
  error?: string | null;
  onSignIn?: () => void;
  onSignOut?: () => void;
}

/** Presentation only. AuthGate owns all provider, session and access decisions. */
export function AuthScreen({ state, error, onSignIn, onSignOut }: AuthScreenProps) {
  const checking = state === "checking";
  const signingIn = state === "signing-in";
  const restricted = state === "restricted";
  const unconfigured = state === "unconfigured";
  const title = restricted ? "Access restricted" : unconfigured ? "Sign-in unavailable" : "Sign in to Pathfinder";
  const message = restricted
    ? "This account does not have access to Pathfinder. Sign out to use another account."
    : unconfigured
      ? "Sign-in is not configured for this environment. Contact your Pathfinder administrator."
      : state === "expired"
        ? "Your session has expired. Sign in to continue."
        : state === "error"
          ? error || "Google sign-in could not be completed. Please try again."
          : null;

  return (
    <main className="pf-auth-shell">
      <div className="pf-auth-content">
        {checking ? (
          <section className="pf-auth-checking" aria-label="Pathfinder session">
            <img className="pf-auth-logo" src="/brand/vornan-logo-and-wordmark.png" width="180" height="60" alt="Vornan" />
            <p role="status"><LoaderCircle className="pf-auth-spinner" size={18} aria-hidden="true" />Checking your session…</p>
          </section>
        ) : (
          <section className="pf-auth-card" aria-labelledby="pf-auth-title">
            <div className="pf-auth-brand">
              <img className="pf-auth-logo" src="/brand/vornan-logo-and-wordmark.png" width="180" height="60" alt="Vornan" />
            </div>
            <p className="pf-auth-eyebrow">Pathfinder</p>
            <h1 id="pf-auth-title">{title}</h1>
            {!restricted && !unconfigured && <p className="pf-auth-subtitle">Continue to your workspace.</p>}
            {message && <p className={`pf-auth-message${state === "expired" ? " pf-auth-message-expired" : ""}`} role="alert">{message}</p>}
            {!restricted && !unconfigured && (
              <button className="pf-auth-button" type="button" onClick={onSignIn} disabled={signingIn} aria-busy={signingIn}>
                {signingIn
                  ? <LoaderCircle className="pf-auth-spinner" size={20} aria-hidden="true" />
                  : <img src="/brand/google-sign-in-mark.svg" width="20" height="20" alt="" />}
                <span>{signingIn ? "Opening Google…" : "Continue with Google"}</span>
              </button>
            )}
            {signingIn && <span className="pf-auth-sr-only" role="status">Opening Google sign-in…</span>}
            {restricted && <button className="pf-auth-button" type="button" onClick={onSignOut}>Sign out</button>}
          </section>
        )}
      </div>
      <footer className="pf-auth-footer"><a href="https://vornan.co">vornan.co</a></footer>
    </main>
  );
}
