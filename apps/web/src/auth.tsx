import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { FirebaseOptions } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import { ArrowRight, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";

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

const allowedDomains: string[] = (import.meta.env.VITE_AUTH_ALLOWED_DOMAINS ?? "ltlco.com,vornan.co")
  .split(",")
  .map((domain: string) => domain.trim().toLowerCase())
  .filter(Boolean);

const authRequiredSetting = import.meta.env.VITE_AUTH_REQUIRED;
const authRequired = authRequiredSetting ? authRequiredSetting === "true" : import.meta.env.PROD;

function shouldUseRedirectSignIn() {
  const hostname = window.location.hostname;
  return import.meta.env.PROD && hostname !== "localhost" && hostname !== "127.0.0.1";
}

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
        void authModule.getRedirectResult(auth).catch((redirectError) => {
          if (!mounted) {
            return;
          }
          setError(redirectError instanceof Error ? redirectError.message : "Google sign-in could not be completed.");
        });
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
    setSigningIn(true);
    try {
      const provider = new runtime.authModule.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      if (shouldUseRedirectSignIn()) {
        await runtime.authModule.signInWithRedirect(runtime.auth, provider);
        return;
      }
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

  if (!config && !authRequired) {
    return children(null);
  }

  if (!config && authRequired) {
    return (
      <AuthScreen
        eyebrow="Vornan Pathfinder"
        title="A clearer way to move orders forward."
        description="Pathfinder turns customer order files into clean, validated production handoffs for the teams that keep work moving."
        statusLabel="Private preview"
        statusTone="warning"
        cardEyebrow="Coming Soon"
        cardTitle="Pathfinder is almost ready."
        cardDescription="Secure workspace access is being prepared for Vornan and Larger Than Life teams."
      />
    );
  }

  if (loading) {
    return (
      <AuthScreen
        eyebrow="Vornan Pathfinder"
        title="Opening the workspace."
        description="Checking your secure session before continuing."
        statusLabel="Secure handoff"
        statusTone="ready"
      />
    );
  }

  if (!user) {
    return (
      <AuthScreen
        eyebrow="Vornan Pathfinder"
        title="Translate orders with confidence."
        description="Map customer files, resolve product details, and prepare clean production handoffs from one focused workspace."
        statusLabel="Private access"
        statusTone="ready"
        error={error}
      >
        <button className="auth-google-button" type="button" onClick={handleSignIn} disabled={signingIn}>
          <span className="auth-google-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" focusable="false">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
                fill="#EA4335"
              />
            </svg>
          </span>
          <span>{signingIn ? "Opening Google..." : "Continue with Google"}</span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </AuthScreen>
    );
  }

  const domain = userDomain(user);
  if (!isAllowedDomain(domain)) {
    return (
      <AuthScreen
        eyebrow="Access Restricted"
        title="This workspace is private."
        description="Pathfinder access is currently limited to approved Vornan and Larger Than Life accounts."
        statusLabel={domain ? `Signed in as ${domain}` : "Domain unavailable"}
        statusTone="danger"
      >
        <button className="secondary-button auth-button" type="button" onClick={handleSignOut}>
          Sign out
        </button>
      </AuthScreen>
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

function AuthScreen({
  eyebrow,
  title,
  description,
  statusLabel,
  statusTone,
  cardEyebrow = "Workspace Access",
  cardTitle = "Welcome to Pathfinder.",
  cardDescription = "Use an approved Google account to continue.",
  error,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: string;
  statusTone: "ready" | "warning" | "danger";
  cardEyebrow?: string;
  cardTitle?: string;
  cardDescription?: string;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-stage" aria-label="Pathfinder sign in">
        <div className="auth-brand-panel">
          <img className="auth-vornan-wordmark" src="/brand/vornan-wordmark.svg" alt="Vornan" />
          <div className="auth-product-mark">
            <img src="/brand/pathfinder-lockup-ondark.svg" alt="Pathfinder" />
          </div>
          <div className="auth-brand-copy">
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="auth-proof-strip" aria-label="Pathfinder access scope">
            <span><CheckCircle2 size={16} aria-hidden="true" />Order intake</span>
            <span><ShieldCheck size={16} aria-hidden="true" />Product mapping</span>
            <span><LockKeyhole size={16} aria-hidden="true" />Private workspace</span>
          </div>
        </div>

        <div className="auth-action-panel">
          <div className={`auth-status-chip ${statusTone}`}>
            <span aria-hidden="true" />
            {statusLabel}
          </div>
          <div className="auth-card">
            <img className="auth-card-lockup" src="/brand/pathfinder-lockup-zinnia.svg" alt="Pathfinder" />
            <div>
              <p className="eyebrow">{cardEyebrow}</p>
              <h2>{cardTitle}</h2>
              <p>{cardDescription}</p>
            </div>
            {error ? <p className="auth-error">{error}</p> : null}
            {children}
            <div className="auth-domain-list" aria-label="Allowed email domains">
              {allowedDomains.map((domain) => (
                <span key={domain}>{domain}</span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
