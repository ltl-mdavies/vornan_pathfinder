/** Jason's exact Lift LOV labels. Mapping belongs to Sticker Press, never the shared template. */
export type StickerPressProofStatus = 'Approved' | 'Pending';

const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

/** Only Andy's confirmed `auto` meaning permits approval. A timestamp alone never does.
 * Missing/untrusted evidence produces an explicit Pending value, not an ambiguous blank.
 * This does not relax intake validation, authorize transport, or modify an existing job.
 */
export function stickerPressProofStatus(input: {
  approval: unknown;
  artwork_sha256: unknown;
  artwork_bytes: unknown;
  retained: readonly { sha256: string; bytes: number; retained_ref: string }[];
  existing_status?: unknown;
}, now = new Date()): StickerPressProofStatus {
  // Preserve a trusted internal Pending decision; never trust a pre-existing Approved value.
  if (input.existing_status !== undefined && input.existing_status !== null && input.existing_status !== 'Approved') return 'Pending';
  if (!Number.isFinite(now.getTime()) || !input.approval || typeof input.approval !== 'object' || Array.isArray(input.approval)) return 'Pending';
  const approval = input.approval as Record<string, unknown>;
  if (approval.approved_by !== 'auto' || !timestamp(approval.approved_at) || Date.parse(approval.approved_at) > now.getTime()) return 'Pending';
  if (!hash(input.artwork_sha256) || !hash(approval.artwork_sha256) || input.artwork_sha256 !== approval.artwork_sha256) return 'Pending';
  if (input.retained.length !== 1) return 'Pending';
  const asset = input.retained[0];
  if (asset.sha256 !== input.artwork_sha256 || !Number.isSafeInteger(input.artwork_bytes) ||
      (input.artwork_bytes as number) <= 0 || asset.bytes !== input.artwork_bytes || !asset.retained_ref.trim()) return 'Pending';
  return 'Approved';
}
