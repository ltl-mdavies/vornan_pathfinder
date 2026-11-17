/** Owns a single PDF loading task, including teardown while imports/load are pending. */
export function createPdfLoadLifetime() {
  let disposed = false;
  let task: { destroy(): unknown } | undefined;
  let destroyed = false;
  function destroy() {
    if (!task || destroyed) return;
    destroyed = true;
    try { void Promise.resolve(task.destroy()).catch(() => undefined); } catch { /* Already torn down. */ }
  }
  return {
    get disposed() { return disposed; },
    attach(next: { destroy(): unknown }) { task = next; if (disposed) destroy(); },
    dispose() { disposed = true; destroy(); }
  };
}
