export type ProofEntryState =
  | { kind: "access_token"; token: string }
  | { kind: "workspace" }
  | { kind: "link_unavailable" }
  | { kind: "session_ended" };

const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function proofEntryState(hash: string): ProofEntryState {
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
