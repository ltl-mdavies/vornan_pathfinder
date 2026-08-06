export interface RefreshableSnapshot {
  refreshed_at: string;
}

export interface RecentSnapshot<T extends RefreshableSnapshot> {
  snapshot: T;
  checked_at: string;
  next_refresh_at: string;
}

export class BoundedSnapshotCache<T extends RefreshableSnapshot> {
  private readonly entries = new Map<string, { snapshot: T; cached_at_ms: number }>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxEntries = 100
  ) {}

  getRecent(key: string, now = Date.now()): RecentSnapshot<T> | null {
    const cached = this.entries.get(key);
    if (!cached || now - cached.cached_at_ms >= this.minIntervalMs) {
      return null;
    }

    return {
      snapshot: cached.snapshot,
      checked_at: cached.snapshot.refreshed_at,
      next_refresh_at: new Date(cached.cached_at_ms + this.minIntervalMs).toISOString()
    };
  }

  set(key: string, snapshot: T, cachedAt = Date.now()) {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, { snapshot, cached_at_ms: cachedAt });

    return {
      checked_at: snapshot.refreshed_at,
      next_refresh_at: new Date(cachedAt + this.minIntervalMs).toISOString()
    };
  }

  delete(key: string) {
    return this.entries.delete(key);
  }
}

export class CoalescedRefreshes<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  async run(key: string, load: () => Promise<T>) {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const refresh = load();
    this.inFlight.set(key, refresh);
    try {
      return await refresh;
    } finally {
      if (this.inFlight.get(key) === refresh) {
        this.inFlight.delete(key);
      }
    }
  }
}
