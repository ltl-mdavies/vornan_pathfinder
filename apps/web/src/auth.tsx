import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { FirebaseOptions } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import { AuthScreen } from "./AuthScreen";
import "./auth-screen.css";
import { PATHFINDER_SESSION_EXPIRED_MESSAGE } from "./api-client";

export interface PathfinderAuthSession {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  token: string | null;
  domain: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  expireSession: (message?: string) => Promise<void>;
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

const allowedDomains: string[] = (import.meta.env.VITE_AUTH_ALLOWED_DOMAINS ?? "ltlco.com,vornan.co")
  .split(",")
  .map((domain: string) => domain.trim().toLowerCase())
  .filter(Boolean);

const authRequiredSetting = import.meta.env.VITE_AUTH_REQUIRED;
const authRequired = authRequiredSetting ? authRequiredSetting === "true" : import.meta.env.PROD;

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
  const [signingIn, setSigningIn] = useState(false);

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
          try {
            setToken(nextUser ? await nextUser.getIdToken() : null);
          } catch {
            setToken(null);
            setError(PATHFINDER_SESSION_EXPIRED_MESSAGE);
          } finally {
            setLoading(false);
          }
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
    setSigningIn(true);
    try {
      const provider = new runtime.authModule.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await runtime.authModule.signInWithPopup(runtime.auth, provider);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Google sign-in could not be completed.");
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    if (runtime) {
      await runtime.authModule.signOut(runtime.auth);
    }
  }

  async function expireSession(message = PATHFINDER_SESSION_EXPIRED_MESSAGE) {
    setError(message);
    setToken(null);
    if (runtime) {
      await runtime.authModule.signOut(runtime.auth);
    }
  }

  if (!config && !authRequired) {
    return children(null);
  }

  if (!config && authRequired) {
    return <AuthScreen state="unconfigured" />;
  }

  if (loading) {
    return <AuthScreen state="checking" />;
  }

  if (!user) {
    const sessionExpired = error === PATHFINDER_SESSION_EXPIRED_MESSAGE;
    return (
      <AuthScreen
        state={signingIn ? "signing-in" : sessionExpired ? "expired" : error ? "error" : "signed-out"}
        error={error}
        onSignIn={handleSignIn}
      />
    );
  }

  const domain = userDomain(user);
  if (!isAllowedDomain(domain)) {
    return <AuthScreen state="restricted" onSignOut={handleSignOut} />;
  }

  return children({
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    token,
    domain,
    getIdToken: async (forceRefresh = false) => runtime?.auth.currentUser?.getIdToken(forceRefresh) ?? null,
    expireSession,
    signOut: handleSignOut
  });
}
