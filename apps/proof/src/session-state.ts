export type ProofEntryState =
  | { kind: "access_token"; token: string }
  | { kind: "workspace" }
  | { kind: "status_handoff"; orderNumber: string }
  | { kind: "link_unavailable" }
  | { kind: "session_ended" };

const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class ProofStatusSessionConflictError extends Error {
  constructor() {
    super("Your existing Proof session is still active and has not been changed. View-only access from Status cannot replace it yet.");
    this.name = "ProofStatusSessionConflictError";
  }
}

/** A failed link exchange is not an expired authenticated session. Never keep
 * the token or original response on this error, or use it to end a cookie's
 * existing session (which may belong to another open Proof tab).
 */
export class ProofAccessExchangeError extends Error {
  constructor(rejected: boolean) {
    super(rejected
      ? "This link is invalid, expired, or has already been used."
      : "We couldn’t open this proof link. Please contact Vornan for help accessing your proofs.");
    this.name = "ProofAccessExchangeError";
  }
}

/** A new access fragment is an explicit navigation, not a background refresh.
 * Start a fresh document so old order drafts, pending loads and the cached
 * bootstrap cannot cross into the next grant. Bootstrap still validates and
 * removes the token; this listener never reads or stores it elsewhere.
 */
export function watchProofAccessNavigation(target: {
  location: Pick<Location, "hash" | "reload">;
  addEventListener(type: "hashchange", listener: () => void): void;
  removeEventListener(type: "hashchange", listener: () => void): void;
}) {
  let navigating = false;
  const onHashChange = () => {
    if (navigating || (!target.location.hash.startsWith("#/access/") && !target.location.hash.startsWith("#/status/"))) return;
    navigating = true;
    target.location.reload();
  };
  target.addEventListener("hashchange", onHashChange);
  return () => target.removeEventListener("hashchange", onHashChange);
}

export function proofEntryState(hash: string): ProofEntryState {
  if (hash.startsWith("#/status/")) {
    const orderNumber = hash.slice("#/status/".length);
    return /^A\d{7}$/.test(orderNumber) ? { kind: "status_handoff", orderNumber } : { kind: "link_unavailable" };
  }
  const accessPrefix = "#/access/";
  if (hash.startsWith(accessPrefix)) {
    const token = hash.slice(accessPrefix.length);
    return RAW_TOKEN.test(token) ? { kind: "access_token", token } : { kind: "link_unavailable" };
  }
  if (hash === "#/link-unavailable") return { kind: "link_unavailable" };
  if (hash === "#/session-ended") return { kind: "session_ended" };
  return { kind: "workspace" };
}

export function sessionExpiryDelay(expiresAt: string, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return 0;
  return Math.max(0, expiresAtMs - nowMs);
}

export function sessionSecondsRemaining(expiresAt: string, nowMs = Date.now()) {
  return Math.max(0, Math.ceil(sessionExpiryDelay(expiresAt, nowMs) / 1000));
}

export function sessionWarningVisible(expiresAt: string, nowMs = Date.now(), warningSeconds = 60) {
  const remaining = sessionSecondsRemaining(expiresAt, nowMs);
  return remaining > 0 && remaining <= warningSeconds;
}

export function createFailClosedSessionTerminator(
  endRemoteSession: () => Promise<void>,
  endLocalSession: () => void
) {
  let started = false;
  return () => {
    if (started) return null;
    started = true;
    endLocalSession();
    let cleanup: Promise<void>;
    try {
      cleanup = Promise.resolve(endRemoteSession());
    } catch {
      cleanup = Promise.resolve();
    }
    return cleanup.catch(() => undefined);
  };
}

export function focusProofTerminalState(
  target: Pick<HTMLElement, "focus" | "isConnected"> | null
) {
  if (!target?.isConnected) return false;
  try {
    target.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}
