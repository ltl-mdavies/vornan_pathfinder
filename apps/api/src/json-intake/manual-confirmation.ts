import { digest, scopeKey, type WebhookScope } from '../webhooks/contract.js';
import { stableJson } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';

/** Audited reconciliation of an existing Lift order; never claims a successful API submission. */
export interface ManualConfirmationEvidence {
  source: 'manual_verified';
  scope: WebhookScope;
  receipt_id: string;
  business_fingerprint: string;
  raw_sha256: string;
  source_order_number: string;
  job_id: string;
  association_id: string;
  external_order_id: string;
  order_number: string;
  confirmed_at: string;
  verified_at: string;
  line_count: number;
  provider_snapshot_sha256: string;
}
export interface ManualConfirmation {
  source: 'manual_verified';
  job_id: string;
  association_id: string;
  order_number: string;
  confirmed_at: string;
  evidence_sha256: string;
  evidence: ManualConfirmationEvidence;
}
export interface ConfirmationPermit {
  receipt_id: string;
  job_id: string;
  association_id: string;
  order_number: string;
  evidence_sha256: string;
}
const isEvidenceSha256 = (v: string) => /^[a-f0-9]{64}$/.test(v);
export function validateManualEvidence(r: Receipt, e: ManualConfirmationEvidence) {
  if (!e || e.source !== 'manual_verified' || e.scope?.environment !== 'test' ||
    scopeKey(e.scope) !== scopeKey(r.identity) || e.receipt_id !== r.receipt_id ||
    e.business_fingerprint !== r.fingerprint || e.raw_sha256 !== r.raw_sha256 ||
    e.source_order_number !== r.adapted.canonical.source.source_record_id ||
    !e.job_id || !/^loa_[a-f0-9]{64}$/.test(e.association_id) || !e.external_order_id ||
    !/^A\d{7,8}$/.test(e.order_number) || !isEvidenceSha256(e.provider_snapshot_sha256) ||
    !Number.isFinite(Date.parse(e.confirmed_at)) || !Number.isFinite(Date.parse(e.verified_at)) ||
    Date.parse(e.confirmed_at) < Date.parse(r.received_at) || Date.parse(e.verified_at) < Date.parse(e.confirmed_at) ||
    e.line_count !== r.adapted.canonical.lines.length) throw new Error('Manual confirmation evidence mismatch');
}
export function reviewedConfirmation(r: Receipt, permits: ConfirmationPermit[]) {
  const c = r.confirmation;
  if (!c || !('source' in c) || c.source !== 'manual_verified') throw new Error('Confirmation requires manual evidence');
  validateManualEvidence(r, c.evidence);
  const e = c.evidence;
  if (c.evidence_sha256 !== digest(stableJson(e)) || c.job_id !== e.job_id ||
      c.association_id !== e.association_id || c.order_number !== e.order_number || c.confirmed_at !== e.confirmed_at ||
      !permits.some(p => p.receipt_id === r.receipt_id && p.job_id === c.job_id && p.association_id === c.association_id &&
        p.order_number === c.order_number && p.evidence_sha256 === c.evidence_sha256)) throw new Error('Confirmation permit mismatch');
  return c;
}
/** Caller loads authoritative job/association and exact-case provider evidence; immutable receipt CAS is the commit. */
export async function captureManualConfirmation(store: ReceiptStore, receiptId: string,
  load: () => Promise<ManualConfirmationEvidence>, now: () => string = () => new Date().toISOString()) {
  const r = await store.get(receiptId); if (!r) throw new Error('Receipt missing');
  const evidence = structuredClone(await load()); validateManualEvidence(r, evidence);
  if (stableJson(await load()) !== stableJson(evidence)) throw new Error('Manual confirmation evidence changed');
  const proof = digest(stableJson(evidence));
  if (r.confirmation) {
    if (r.confirmation.evidence_sha256 !== proof) throw new Error('Confirmation association is immutable');
    return r;
  }
  const next: Receipt = {...r, revision: r.revision + 1, updated_at: now(), confirmation: {
    source: 'manual_verified', job_id: evidence.job_id, association_id: evidence.association_id,
    order_number: evidence.order_number, confirmed_at: evidence.confirmed_at, evidence_sha256: proof, evidence
  }};
  if (!await store.compareAndSet(r, next)) throw new Error('Receipt confirmation conflict');
  return next;
}
