/** Safe persisted codes only: never retain native errors, URLs or response bodies. */
export class AssetCheckError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly owner: 'customer' | 'internal' = 'customer') { super(code); }
}
