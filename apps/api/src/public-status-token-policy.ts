const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_PUBLIC_STATUS_TOKEN_DAYS = 60;
export const DEFAULT_PUBLIC_STATUS_EXPIRED_TOKEN_RETENTION_DAYS = 90;

function positiveWholeDays(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

export function publicStatusTokenDeadlines(args: {
  now?: Date;
  activeDays?: unknown;
  expiredRetentionDays?: unknown;
}) {
  const now = args.now ?? new Date();
  const activeDays = positiveWholeDays(args.activeDays, DEFAULT_PUBLIC_STATUS_TOKEN_DAYS);
  const expiredRetentionDays = positiveWholeDays(
    args.expiredRetentionDays,
    DEFAULT_PUBLIC_STATUS_EXPIRED_TOKEN_RETENTION_DAYS
  );
  const expiresAt = new Date(now.getTime() + activeDays * DAY_MS);
  const purgeAt = new Date(expiresAt.getTime() + expiredRetentionDays * DAY_MS);

  return {
    expires_at: expiresAt.toISOString(),
    expires_at_epoch: Math.floor(expiresAt.getTime() / 1000),
    purge_at_epoch: Math.floor(purgeAt.getTime() / 1000)
  };
}
