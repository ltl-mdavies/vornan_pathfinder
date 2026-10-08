import { useEffect, useState } from "react";

export function isStatusProofAsset(value: string | null) {
  if (!value) return false;
  try { return /^\/public\/status\/[^/]+\/proof-asset$/.test(new URL(value).pathname); }
  catch { return false; }
}

export function retryStatusProofAsset(value: string, attempt: number, nonce: number) {
  if (!attempt || !isStatusProofAsset(value)) return value;
  const url = new URL(value);
  url.searchParams.set("asset_retry", `${nonce}-${attempt}`);
  return url.toString();
}

/** Retry only our resolver, never modify a signed Lift URL. One automatic retry per asset. */
export function useProofAssetRecovery(url: string | null, enabled = true, deadline = 0) {
  const [attempt, setAttempt] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const recoverable = isStatusProofAsset(url);
  useEffect(() => { setAttempt(0); setNonce(Date.now()); setState("loading"); }, [url, enabled]);
  useEffect(() => {
    if (!enabled || !recoverable || state !== "failed" || attempt !== 0) return;
    const timer = window.setTimeout(() => { setAttempt(1); setState("loading"); }, 2_000);
    return () => window.clearTimeout(timer);
  }, [enabled, recoverable, state, attempt]);
  useEffect(() => {
    if (!enabled || !deadline || state !== "loading") return;
    const timer = window.setTimeout(() => setState("failed"), deadline);
    return () => window.clearTimeout(timer);
  }, [url, enabled, deadline, state, attempt]);
  return {
    src: url ? retryStatusProofAsset(url, attempt, nonce) : undefined,
    state,
    retrying: recoverable && state === "failed" && attempt === 0,
    onLoad: () => setState("ready"),
    onError: () => setState("failed"),
    retry: () => { setAttempt((value) => value + 1); setNonce(Date.now()); setState("loading"); }
  };
}
