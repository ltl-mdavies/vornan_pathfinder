import { timingSafeEqual } from 'node:crypto';
import { sha256, IntakeError, type IntegrationIdentity } from './adapter.js';

export interface TestCredential {
  token_sha256: string;
  identity: IntegrationIdentity;
  expires_at: string;
  revoked: boolean;
  scopes: ('orders:write' | 'orders:read')[];
}
/** Config is injected by the local harness. No credential is accepted from an order payload. */
export function authenticate(header: string | undefined, credentials: readonly TestCredential[], scope: TestCredential['scopes'][number], now: string): IntegrationIdentity {
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header ?? '');
  if (!match) throw new IntakeError(401, 'UNAUTHORIZED');
  const digest = Buffer.from(sha256(match[1]), 'hex');
  const key = credentials.find(k => /^[a-f0-9]{64}$/.test(k.token_sha256) && timingSafeEqual(digest, Buffer.from(k.token_sha256,'hex')));
  if (!key || key.revoked || !Number.isFinite(Date.parse(key.expires_at)) || Date.parse(key.expires_at) <= Date.parse(now)) throw new IntakeError(401, 'UNAUTHORIZED');
  if (!key.scopes.includes(scope) || key.identity.environment !== 'test') throw new IntakeError(403, 'FORBIDDEN');
  for (const value of [key.identity.customer_id, key.identity.integration_id, key.identity.store, key.identity.schema]) {
    if (!value || value !== value.trim()) throw new IntakeError(403, 'INVALID_INTEGRATION_CONFIGURATION');
  }
  return structuredClone(key.identity);
}
