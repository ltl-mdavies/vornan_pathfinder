import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../apps/web/src/styles.css";
import "../../apps/web/src/auth-screen.css";
import { AuthScreen, type AuthScreenState } from "../../apps/web/src/AuthScreen";

const states: AuthScreenState[] = ["signed-out", "checking", "signing-in", "error", "expired", "restricted", "unconfigured"];
const requested = new URLSearchParams(location.search).get("state") as AuthScreenState;

function AuthPreview() {
  const [state, setState] = useState<AuthScreenState>(states.includes(requested) ? requested : "signed-out");
  return <>
    <AuthScreen state={state} error="Google sign-in could not be completed. Please try again."
      onSignIn={() => setState("signing-in")} onSignOut={() => setState("signed-out")} />
    <details style={{ padding: "12px 20px", background: "#fff", fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 13 }}>
      <summary>Local review controls · no provider calls</summary>
      <label style={{ display: "block", marginTop: 12 }}>Preview state{" "}
        <select value={state} onChange={e => setState(e.target.value as AuthScreenState)}>
          {states.map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
      <p>Continue with Google simulates the busy state only. Sign out returns to signed out. No authentication, API calls, emails or production changes.</p>
    </details>
  </>;
}
createRoot(document.getElementById("root")!).render(<AuthPreview />);
