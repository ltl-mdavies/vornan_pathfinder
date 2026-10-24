/** Test-only deterministic gates. Every response stays in the synthetic adapter. */
export function createStartupReview(query: URLSearchParams) {
  const held = new Set((query.get("startupHold") ?? "").split(",").filter(Boolean));
  const failure = query.get("startupFail");
  const failed = new Set<string>();
  let released = false;
  const pending = new Set<() => void>();
  const resource = (path: string) => path === "/api/lift/customers" ? "directory"
    : path === "/api/targets" ? "targets"
    : path === "/api/canonical-registry" ? "registry"
    : /^\/api\/customers\/[^/]+\/workspace$/.test(path) ? "workspace" : null;
  return {
    active: held.size > 0 || Boolean(failure),
    release() { released = true; for (const resolve of pending) resolve(); pending.clear(); },
    async intercept(path: string, method: string): Promise<Response | null> {
      const key = resource(path);
      if (method !== "GET" || !key) return null;
      if (!released && held.has(key)) await new Promise<void>(resolve => pending.add(resolve));
      if (key === failure && !failed.has(path)) {
        failed.add(path);
        return new Response(JSON.stringify({ error: `Synthetic ${key} startup failure; retry is available.` }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      return null;
    }
  };
}
