import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { FirebaseOptions } from "firebase/app";
import type { Auth, User } from "firebase/auth";

export interface PathfinderAuthSession {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  token: string | null;
  domain: string | null;
  signOut: () => Promise<void>;
}

interface AuthGateProps {
  children: (session: PathfinderAuthSession | null) => ReactNode;
}

type FirebaseAuthModule = typeof import("firebase/auth");

interface FirebaseRuntime {
  auth: Auth;
  authModule: FirebaseAuthModule;
}

const allowedDomains = (import.meta.env.VITE_AUTH_ALLOWED_DOMAINS ?? "ltlco.com,vornan.co")
  .split(",")
  .map((domain: string) => domain.trim().toLowerCase())
  .filter(Boolean);

const authRequired = import.meta.env.VITE_AUTH_REQUIRED === "true";

function firebaseConfig(): FirebaseOptions | null {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  };

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    return null;
  }

  return config;
}

function userDomain(user: User | null) {
  const email = user?.email ?? "";
  const domain = email.includes("@") ? email.split("@").pop()?.toLowerCase() ?? null : null;
  return domain;
}

function isAllowedDomain(domain: string | null) {
  return Boolean(domain && allowedDomains.includes(domain));
}

export function AuthGate({ children }: AuthGateProps) {
  const config = useMemo(firebaseConfig, []);
  const [loading, setLoading] = useState(Boolean(config));
  const [runtime, setRuntime] = useState<FirebaseRuntime | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) {
      setLoading(false);
      return undefined;
    }

    const firebaseOptions = config;
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    async function loadFirebase() {
      try {
        const [appModule, authModule] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
        const app = appModule.getApps().length ? appModule.getApps()[0] : appModule.initializeApp(firebaseOptions);
        const auth = authModule.getAuth(app);

        if (!mounted) {
          return;
        }

        setRuntime({ auth, authModule });
        unsubscribe = authModule.onIdTokenChanged(auth, async (nextUser) => {
          setLoading(true);
          setUser(nextUser);
          setToken(nextUser ? await nextUser.getIdToken() : null);
          setLoading(false);
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Firebase Auth could not be loaded.");
        setLoading(false);
      }
    }

    void loadFirebase();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [config]);

  async function handleSignIn() {
    if (!runtime) {
      setError("Firebase Auth is not configured for this environment.");
      return;
    }

    setError(null);
    const provider = new runtime.authModule.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await runtime.authModule.signInWithPopup(runtime.auth, provider);
  }

  async function handleSignOut() {
    if (runtime) {
      await runtime.authModule.signOut(runtime.auth);
    }
  }

  if (!config && !authRequired) {
    return children(null);
  }

  if (!config && authRequired) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="eyebrow">Pathfinder Auth</p>
          <h1>Firebase Auth is not configured.</h1>
          <p>Add Firebase web config environment variables before enabling production auth.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="eyebrow">Pathfinder</p>
          <h1>Checking access...</h1>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="eyebrow">Vornan Pathfinder</p>
          <h1>Sign in to continue.</h1>
          <p>Use a Google account from ltlco.com or vornan.co.</p>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="primary-button auth-button" type="button" onClick={handleSignIn}>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const domain = userDomain(user);
  if (!isAllowedDomain(domain)) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <p className="eyebrow">Access Restricted</p>
          <h1>This account is not allowed.</h1>
          <p>Pathfinder is currently limited to ltlco.com and vornan.co Google accounts.</p>
          <button className="secondary-button auth-button" type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return children({
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    token,
    domain,
    signOut: handleSignOut
  });
}
