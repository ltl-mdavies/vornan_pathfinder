export const DEFAULT_PUBLIC_STATUS_POLL_MS = 30_000;

export function publicStatusPollDelay(seconds: unknown) {
  const parsed = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PUBLIC_STATUS_POLL_MS;
  }
  return Math.min(60_000, Math.max(15_000, Math.round(parsed * 1_000)));
}

export function shouldPollPublicStatus(visibilityState: DocumentVisibilityState) {
  return visibilityState === "visible";
}
