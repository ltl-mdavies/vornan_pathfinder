import { randomUUID } from 'node:crypto';
import type { IntakeLedger, IntakeAttempt, IntakeState } from '../intake-assurance.js';
import { intakeAttemptId } from '../intake-assurance.js';
import { IntakeError, sha256, stableJson, type IntegrationIdentity, type JsonOrderAdapter, type FieldIssue } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';

export interface LocalAssetTransport {
  /** Must be an explicit in-memory/local fixture map. A network transport is outside this milestone. */
  kind: 'local-fixture';
  read(url: string): Promise<Buffer>;
  retain(scope: string, bytes: Buffer): Promise<string>;
}
export class AssetCheckError extends Error {
  constructor(readonly code: string) { super(code); }
}
const owned = (r: Receipt, id: IntegrationIdentity) => r.identity.customer_id === id.customer_id && r.identity.integration_id === id.integration_id && r.identity.environment === id.environment && r.identity.store === id.store;
const after = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();

export class JsonIntakeService {
  constructor(readonly store: ReceiptStore, readonly ledger: IntakeLedger, readonly adapters: readonly JsonOrderAdapter[], readonly now = () => new Date().toISOString()) {}
  async receive(identity: IntegrationIdentity, payload: unknown, raw: Buffer) {
    if (identity.environment !== 'test') throw new IntakeError(403, 'TEST_ONLY');
    const adapter = this.adapters.find(a => a.schema === identity.schema);
    if (!adapter) throw new IntakeError(422, 'UNSUPPORTED_SCHEMA');
    const adapted = adapter.validate(payload, identity);
    const receiptId = `rcpt_${sha256(stableJson([identity.customer_id, identity.integration_id, identity.environment, identity.store, adapted.canonical.source.source_record_id]))}`;
    const now = this.now();
    const receipt: Receipt = {version: 1, revision: 0, receipt_id: receiptId, identity: structuredClone(identity), fingerprint: adapted.fingerprint,
      raw_sha256: sha256(raw), received_at: now, updated_at: now, adapted,
      signal: {schema_version: 1, customer_id: identity.customer_id, provider: 'json', connection_id: identity.integration_id,
        source_id: stableJson([identity.store, adapted.canonical.source.source_record_id]), intent_key: 'json_order', intent_occurrence: '1', observed_at: now},
      deadline: after(now, 60 * 60 * 1000), work: 'pending', claim: null, assets: [], issues: [], asset_status: 'pending'};
    if (await this.store.create(receipt)) return {receipt, replayed: false};
    for (let retries = 0; retries < 20; retries++) {
      const current = await this.store.get(receiptId);
      if (!current || !owned(current,identity)) throw new IntakeError(409, 'IDENTITY_CONFLICT');
      if (current.fingerprint !== adapted.fingerprint) throw new IntakeError(409, 'ORDER_CONTENT_CONFLICT');
      // Preserve first-seen timestamps/evidence. A separate access snapshot can refresh expired URL credentials.
      if (stableJson(current.adapted) === stableJson(adapted)) return {receipt: current, replayed: true};
      if (current.claim && Date.parse(current.claim.until) > Date.parse(now)) throw new IntakeError(503, 'RETRY_AFTER_ASSET_WORK');
      const refresh: Receipt = {...current, revision: current.revision + 1, updated_at: now, adapted,
        ...(current.asset_status !== 'integrity_verified' ? {work: 'pending' as const, claim: null, asset_status: 'pending' as const} : {})};
      if (await this.store.compareAndSet(current, refresh)) return {receipt: refresh, replayed: true};
    }
    throw new IntakeError(503, 'RECEIPT_BUSY');
  }
  async lookup(identity: IntegrationIdentity, receiptId: string) {
    const r = await this.store.get(receiptId);
    if (!r || !owned(r,identity)) throw new IntakeError(404, 'NOT_FOUND');
    return r;
  }
  /** Explicit local recovery driver. Never invoked by POST or the Wrike scheduler. */
  async process(receiptId: string, transport: LocalAssetTransport) {
    if (transport.kind !== 'local-fixture') throw new Error('Only local fixture assets are supported');
    let r = await this.store.get(receiptId);
    const now = this.now();
    if (!r || r.work === 'complete' || (r.claim && Date.parse(r.claim.until) > Date.parse(now))) return false;
    const claim = {token: randomUUID(), until: after(now, 30 * 60 * 1000)};
    const claimed: Receipt = {...r, revision: r.revision+1, claim, updated_at: now};
    if (!await this.store.compareAndSet(r, claimed)) return false;
    r = claimed;
    const assertClaim = async () => {
      const current = await this.store.get(receiptId);
      if (current?.revision !== r!.revision || current.claim?.token !== claim.token || Date.parse(claim.until) <= Date.parse(this.now())) throw new Error('Receipt claim lost');
    };
    // This is a separate durable write: pending receipt/claim is the recovery source after any interruption.
    const {attempt} = await this.ledger.reserve(r.signal, r.deadline);
    const ownsProjection = (current: IntakeAttempt) => {
      const p = r!.ledger_projection;
      return p?.attempt_id === current.attempt_id && (
        (current.revision === p.expected_revision + 1 && current.last_event?.event_id === p.event_id && current.state === p.state) ||
        (current.revision === p.expected_revision && (current.last_event?.event_id ?? null) === p.before_event_id && current.state === p.before_state));
    };
    const assertAssociation = (current: IntakeAttempt) => {
      if (current.signal.customer_id !== r!.identity.customer_id || current.signal.connection_id !== r!.identity.integration_id ||
        current.attempt_id !== intakeAttemptId(r!.signal) || current.job_id || current.submit_attempt_id || current.confirmed_order_number ||
        current.superseded_by || !['received','preparing','manual_review','internal_action_required'].includes(current.state)) throw new Error('Shared intake ownership conflict');
    };
    const project = async (current: IntakeAttempt, state: IntakeState, reason: 'pathfinder_failure' | null) => {
      await assertClaim();
      assertAssociation(current);
      const eventId = `json_${state}_${receiptId}_${current.revision}_${claim.token}`;
      // Persist the exact intended shared transition before making the separate ledger write.
      const planned: Receipt = {...r!, revision: r!.revision + 1, ledger_projection: {
        attempt_id: current.attempt_id, expected_revision: current.revision, before_state: current.state,
        before_event_id: current.last_event?.event_id ?? null, event_id: eventId, state}};
      if (!await this.store.compareAndSet(r!,planned)) throw new Error('Receipt claim lost');
      r = planned;
      await assertClaim();
      await this.ledger.transition(r.identity.customer_id, current.attempt_id, {
        event_id: eventId, expected_revision: current.revision, occurred_at: this.now(), state, reason, next_action_at: r.deadline});
    };
    await assertClaim();
    assertAssociation(attempt);
    const virgin = attempt.state === 'received' && attempt.revision === 0 && attempt.last_event === null;
    if (!virgin && !ownsProjection(attempt)) throw new Error('Shared intake ownership conflict');
    if (attempt.state !== 'preparing') await project(attempt, 'preparing', null);
    const assets: Receipt['assets'] = []; const issues: FieldIssue[] = [];
    for (const [index,line] of r.adapted.canonical.lines.entries()) {
      const art = line.source_line.artwork;
      try {
        await assertClaim();
        if (Date.parse(art.artwork_expires_at) <= Date.parse(this.now())) throw new AssetCheckError('ARTWORK_URL_EXPIRED');
        const bytes = await transport.read(art.download_url);
        if (bytes.length > 25 * 1024 * 1024 || bytes.length !== art.bytes) throw new AssetCheckError('ARTWORK_SIZE_MISMATCH');
        if (sha256(bytes) !== art.artwork_sha256 || sha256(bytes) !== line.source_line.approval.artwork_sha256) throw new AssetCheckError('ARTWORK_CHECKSUM_MISMATCH');
        if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) throw new AssetCheckError('ARTWORK_SIGNATURE_INVALID');
        await assertClaim();
        const retained_ref = await transport.retain(stableJson([r.identity.customer_id,r.identity.integration_id]), bytes);
        assets.push({external_line_id: line.source_line.external_line_id, sha256: art.artwork_sha256, bytes: bytes.length, retained_ref, inspection: 'not_run'});
      } catch (e) {
        await assertClaim();
        const code = e instanceof AssetCheckError ? e.code : 'ASSET_TRANSPORT_FAILURE';
        issues.push({issue_id: `iss_${sha256(`${receiptId}:${line.source_line.external_line_id}:${code}`).slice(0,24)}`, code,
          field: `lines[${index}].artwork`, external_line_id: line.source_line.external_line_id,
          owner: e instanceof AssetCheckError ? 'customer' : 'internal', message: 'Production artwork has not passed retention checks.',
          corrective_action: e instanceof AssetCheckError ? 'Provide access to the unchanged approved PDF or request review of replacement content.' : 'Internal review or retry is required.'});
      }
    }
    await assertClaim();
    const internal = issues.some(i => i.owner === 'internal');
    if (issues.length) {
      const current = await this.ledger.get(r.identity.customer_id, intakeAttemptId(r.signal));
      if (!current) throw new Error('Missing shared intake attempt');
      if (!ownsProjection(current)) throw new Error('Shared intake ownership conflict');
      await project(current, internal ? 'internal_action_required' : 'manual_review', internal ? 'pathfinder_failure' : null);
    }
    await assertClaim();
    const finalAttempt = await this.ledger.get(r.identity.customer_id, intakeAttemptId(r.signal));
    if (!finalAttempt || !ownsProjection(finalAttempt)) throw new Error('Shared intake ownership conflict');
    assertAssociation(finalAttempt);
    const complete: Receipt = {...r, revision: r.revision + 1, claim: null, updated_at: this.now(),
      work: internal ? 'pending' : 'complete', assets, issues,
      asset_status: issues.length ? internal ? 'internal_action_required' : 'action_required' : 'integrity_verified'};
    if (!await this.store.compareAndSet(r, complete)) throw new Error('Receipt claim lost');
    return true;
  }
  async recover(transport: LocalAssetTransport) {
    for await (const r of this.store.pending()) await this.process(r.receipt_id, transport);
  }
}
export function receiptResponse(r: Receipt, replayed: boolean) {
  return {receipt_id: r.receipt_id, order_number: r.adapted.canonical.source.source_record_id, store: r.identity.store,
    environment: r.identity.environment, status: 'received', replayed, received_at: r.received_at,
    status_url: `/api/v1/intake/orders/${r.receipt_id}`};
}
export function statusResponse(r: Receipt) {
  return {schema_version: 'pathfinder.order-status.v1', ...receiptResponse(r,false),
    order_revision: r.revision, intake_status: r.asset_status === 'action_required' ? 'manual_review' : r.asset_status === 'internal_action_required' ? 'internal_action_required' : 'processing',
    asset_status: r.asset_status, review_required: true, production_status: null, fulfillment_status: null, lift_order_number: null,
    received_at: r.received_at, updated_at: r.updated_at, issues: r.issues,
    lines: r.adapted.canonical.lines.map(l => ({external_line_id:l.source_line.external_line_id, ordered_quantity:l.quantity,
      retained: r.assets.some(a => a.external_line_id === l.source_line.external_line_id), inspection: 'not_run'})),
    shipments: [], status_page: null};
}
