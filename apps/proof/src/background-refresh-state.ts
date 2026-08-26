export const PROOF_BACKGROUND_CHECK_INTERVAL_MS = 60_000;
export const PROOF_FEEDBACK_CHECK_INTERVAL_MS = 15_000;
export const PROOF_BACKGROUND_LIFT_REFRESH_INTERVAL_MS = 5 * 60_000;
export const PROOF_BACKGROUND_POLL_INTERVAL_MS = 2_000;
export const PROOF_BACKGROUND_POLL_LIMIT = 12;

export function proofBackgroundCheckAllowed(input: {
  visible: boolean;
  ready: boolean;
  in_flight: boolean;
  refresh_state: "idle" | "requesting" | "queued" | "error";
}) {
  return input.visible &&
    input.ready &&
    !input.in_flight &&
    input.refresh_state !== "requesting" &&
    input.refresh_state !== "queued";
}

export function proofBackgroundLiftRefreshDue(input: {
  last_synced_at: string;
  last_requested_at: number;
  now: number;
}) {
  const syncedAt = Date.parse(input.last_synced_at);
  const reference = Math.max(Number.isFinite(syncedAt) ? syncedAt : 0, input.last_requested_at);
  return input.now - reference >= PROOF_BACKGROUND_LIFT_REFRESH_INTERVAL_MS;
}
