export interface CatalogShellSnapshot {
  customerId: string;
  dirty: boolean;
  busy: boolean;
  unconfirmed: boolean;
}

export interface CatalogShellController {
  snapshot(): CatalogShellSnapshot;
  discardUnsaved(): boolean;
}

/** Shell reads the controller synchronously; a React render is not a save lock. */
export function catalogLeaveDisposition(state?: CatalogShellSnapshot | null) {
  if (!state) return "clear";
  if (state.busy) return "pending";
  if (state.dirty && state.unconfirmed) return "recovery-editing";
  return state.dirty ? "dirty" : "clear";
}

/** One mounted workspace, scoped to both customer and authenticated operator.
 * Registration cleanup cannot unregister a replacement instance. No recovery
 * journal is read, removed or replayed by shell navigation. */
export function createCatalogShellGuard() {
  type Binding = { customerId: string; operatorId: string; controller: CatalogShellController };
  let current: Binding | null = null;
  const matches = (customerId: string, operatorId: string) =>
    current?.customerId === customerId && current.operatorId === operatorId;
  return {
    register(customerId: string, operatorId: string, controller: CatalogShellController) {
      const binding: Binding = { customerId, operatorId, controller };
      current = binding;
      return () => { if (current === binding) current = null; };
    },
    snapshot(customerId: string, operatorId: string) {
      if (!matches(customerId, operatorId)) return null;
      const snapshot = current!.controller.snapshot();
      return snapshot.customerId === customerId ? snapshot : null;
    },
    discard(customerId: string, operatorId: string) {
      const snapshot = this.snapshot(customerId, operatorId);
      if (!snapshot || snapshot.busy || snapshot.unconfirmed) return false;
      return current!.controller.discardUnsaved();
    }
  };
}
