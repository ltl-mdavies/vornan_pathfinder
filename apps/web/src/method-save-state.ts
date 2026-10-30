/** Compare only fields sent by this save, ignoring server-owned timestamps.
 * Object key order is not meaningful; array order (including mappings) is.
 */
function equivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equivalent(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = Object.entries(left), b = Object.entries(right);
  return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && equivalent(value, (right as Record<string, unknown>)[key]));
}

export function methodSaveMatches(expected: object, actual: object | null | undefined): boolean {
  return Boolean(actual && Object.entries(expected).filter(([key]) => key !== "updated_at").every(([key, value]) => equivalent(value, (actual as Record<string, unknown>)[key])));
}
