/** Date-only confirmed order history, keyed by stable catalog item key in the workspace prop.
 * Review/import timestamps are deliberately not used as a fallback.
 */
export function formatLastOrdered(value?: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return '';
  return new Intl.DateTimeFormat('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);
}
