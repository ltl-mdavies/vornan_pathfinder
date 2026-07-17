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
        title="A clearer path from order intake to production."
        description="Pathfinder helps teams turn customer order files into clean, validated production-ready orders."
        statusLabel="Coming soon"
        statusTone="warning"
        cardEyebrow="Private Preview"
        cardTitle="Pathfinder is almost ready."
        cardDescription="We are preparing secure workspace access for the Vornan and Larger Than Life teams."
      />
    );
  }

  if (loading) {
    return (
      <AuthScreen
        eyebrow="Vornan Pathfinder"
        title="Checking access."
        description="Verifying the current browser session before opening the workspace."
        statusLabel="Secure handoff"
        statusTone="ready"
      />
    );
  }

  if (!user) {
    return (
      <AuthScreen
        eyebrow="Vornan Pathfinder"
        title="Order translation, under control."
        description="Translate customer order files, resolve product mappings, and prepare production-ready submit packets from one controlled workspace."
        statusLabel="Private access"
        statusTone="ready"
        error={error}
      >
        <button className="auth-google-button" type="button" onClick={handleSignIn} disabled={signingIn}>
          <span className="auth-google-mark" aria-hidden="true">G</span>
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
        title="This account is outside the workspace."
        description="Pathfinder is currently limited to Google accounts from ltlco.com and vornan.co."
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
  cardDescription = "Use your company Google account to continue.",
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
            <span><CheckCircle2 size={16} aria-hidden="true" />Customer imports</span>
            <span><ShieldCheck size={16} aria-hidden="true" />Lift submit controls</span>
            <span><LockKeyhole size={16} aria-hidden="true" />Protected workspace</span>
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
