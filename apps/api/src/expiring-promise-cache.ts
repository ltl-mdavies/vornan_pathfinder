interface CacheEntry<T> {
  expires_at: number;
  promise: Promise<T>;
}

/**
 * Coalesces concurrent reads and briefly reuses their result. Rejected reads
 * are evicted immediately so a transient provider failure is never cached.
 */
export class ExpiringPromiseCache {
  readonly #entries = new Map<string, CacheEntry<unknown>>();

  constructor(
    readonly ttl_ms: number,
    readonly now: () => number = Date.now
  ) {
    if (!Number.isFinite(ttl_ms) || ttl_ms <= 0) {
      throw new Error("Cache TTL must be a positive number.");
    }
  }

  read<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const current = this.#entries.get(key) as CacheEntry<T> | undefined;
    if (current && current.expires_at > this.now()) {
      return current.promise;
    }

    const entry: CacheEntry<T> = {
      expires_at: this.now() + this.ttl_ms,
      promise: Promise.resolve().then(loader)
    };
    this.#entries.set(key, entry as CacheEntry<unknown>);
    entry.promise.catch(() => {
      if (this.#entries.get(key) === entry) {
        this.#entries.delete(key);
      }
    });
    return entry.promise;
  }

  set<T>(key: string, value: T) {
    this.#entries.set(key, {
      expires_at: this.now() + this.ttl_ms,
      promise: Promise.resolve(value)
    });
  }

  delete(key: string) {
    this.#entries.delete(key);
  }

  clear() {
    this.#entries.clear();
  }
}
