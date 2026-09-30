import type { CanonicalJsonLine } from '@pathfinder/canonical';
import type { PdfInspection } from './pdf-inspection.js';
import type { AssetReadOptions } from './https-assets.js';
import { AssetCheckError } from './asset-errors.js';
export { AssetCheckError } from './asset-errors.js';
import { randomUUID } from 'node:crypto';
import type { IntakeLedger, IntakeAttempt, IntakeState } from '../intake-assurance.js';
import { intakeAttemptId } from '../intake-assurance.js';
import { IntakeError, sha256, stableJson, type IntegrationIdentity, type JsonOrderAdapter, type FieldIssue } from './adapter.js';
import type { Receipt, ReceiptStore } from './local-store.js';

export interface LocalAssetTransport {
  kind: 'local-fixture' | 'review-assets';
  read(url: string, options?: AssetReadOptions): Promise<Buffer>;
  retain(scope: string, bytes: Buffer, format?: 'pdf' | 'png' | 'jpg'): Promise<string>;
  readRetained?(scope: string, ref: string): Promise<Buffer>;
  inspect?(bytes: Buffer, line: CanonicalJsonLine): Promise<PdfInspection>;
  inspection_profile?: {engine:string; policy_id:string};
}
const owned = (r: Receipt, id: IntegrationIdentity) => r.identity.customer_id === id.customer_id && r.identity.integration_id === id.integration_id && r.identity.environment === id.environment && r.identity.store === id.store;
const after = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();

export class JsonIntakeService {
  constructor(readonly store: ReceiptStore, readonly ledger: IntakeLedger | null, readonly adapters: readonly JsonOrderAdapter[], readonly now = () => new Date().toISOString()) {}
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
      const internalHold = current.work === 'complete' && (current.asset_status === 'internal_action_required' || current.issues.some(issue => issue.owner === 'internal'));
      const refresh: Receipt = {...current, revision: current.revision + 1, updated_at: now, adapted,
        ...((!internalHold && (current.asset_status !== 'integrity_verified' || current.previews?.some(p=>p.status==='unavailable'))) ? {work: 'pending' as const, claim: null, next_retry_at: null, asset_status: 'pending' as const} : {})};
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
    const ledger = this.ledger;
    if (!ledger) throw new Error('Receipt-only service cannot process assets');
    if (!['local-fixture','review-assets'].includes(transport.kind) || (transport.kind === 'review-assets' && (!transport.inspect || !transport.readRetained || !transport.inspection_profile))) throw new Error('Reviewed assets require inspection and private retained reads');
    let r = await this.store.get(receiptId);
    const now = this.now();
    if (!r || r.work === 'complete' || (r.next_retry_at && Date.parse(r.next_retry_at)>Date.parse(now)) || (r.claim && Date.parse(r.claim.until) > Date.parse(now))) return false;
    const budgetExhausted=(r.retry_attempts??0)>=3;
    const claim = {token: randomUUID(), until: after(now, 30 * 60 * 1000)};
    const claimed: Receipt = {...r, revision: r.revision+1, claim, updated_at: now, retry_attempts:Math.min((r.retry_attempts??0)+1,3), next_retry_at:null};
    if (!await this.store.compareAndSet(r, claimed)) return false;
    r = claimed;
    const assertClaim = async () => {
      const current = await this.store.get(receiptId);
      if (current?.revision !== r!.revision || current.claim?.token !== claim.token || Date.parse(claim.until) <= Date.parse(this.now())) throw new Error('Receipt claim lost');
    };
    // This is a separate durable write: pending receipt/claim is the recovery source after any interruption.
    const {attempt} = await ledger.reserve(r.signal, r.deadline);
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
      await ledger.transition(r.identity.customer_id, current.attempt_id, {
        event_id: eventId, expected_revision: current.revision, occurred_at: this.now(), state, reason, next_action_at: r.deadline});
    };
    await assertClaim();
    assertAssociation(attempt);
    const virgin = attempt.state === 'received' && attempt.revision === 0 && attempt.last_event === null;
    if (!virgin && !ownsProjection(attempt)) throw new Error('Shared intake ownership conflict');
    if (attempt.state !== 'preparing') await project(attempt, 'preparing', null);
    const assets: Receipt['assets'] = [...r.assets]; const issues: FieldIssue[] = budgetExhausted ? [{issue_id:`iss_${sha256(receiptId+':retry-exhausted').slice(0,24)}`,code:'ASSET_RETRY_EXHAUSTED',field:'lines',owner:'internal',retryable:false,message:'The asset processing retry budget is exhausted.',corrective_action:'Internal review is required before further processing.'}] : [];
    const previews: NonNullable<Receipt['previews']> = [...(r.previews ?? [])];
    const scope=stableJson([r.identity.customer_id,r.identity.integration_id]);
    const checkpoint=async()=>{
      await assertClaim();
      const next:Receipt={...r!,revision:r!.revision+1,assets:[...assets],previews:[...previews],updated_at:this.now()};
      if(!await this.store.compareAndSet(r!,next))throw new Error('Receipt claim lost');
      r=next;
    };
    for (const [index,line] of (budgetExhausted?[]:r.adapted.canonical.lines).entries()) {
      const art = line.source_line.artwork;
      try {
        await assertClaim();
        const existing=assets.find(a=>a.external_line_id===line.source_line.external_line_id && a.sha256===art.artwork_sha256 && a.bytes===art.bytes);
        let bytes:Buffer;
        if(existing && transport.readRetained)bytes=await transport.readRetained(scope,existing.retained_ref);
        else {
          if (Date.parse(art.artwork_expires_at) <= Date.parse(this.now())) throw new AssetCheckError('ARTWORK_URL_EXPIRED');
          bytes = await transport.read(art.download_url,{max_bytes:art.bytes,content_types:['application/pdf']});
        }
        if (bytes.length > 25 * 1024 * 1024 || bytes.length !== art.bytes) throw new AssetCheckError('ARTWORK_SIZE_MISMATCH');
        if (sha256(bytes) !== art.artwork_sha256 || sha256(bytes) !== line.source_line.approval.artwork_sha256) throw new AssetCheckError('ARTWORK_CHECKSUM_MISMATCH');
        if (!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))) throw new AssetCheckError('ARTWORK_SIGNATURE_INVALID');
        await assertClaim();
        let asset=existing;
        if(!asset){
          const retained_ref=await transport.retain(scope,bytes);
          asset={external_line_id:line.source_line.external_line_id,sha256:art.artwork_sha256,bytes:bytes.length,retained_ref,inspection:'not_run'};
          const old=assets.findIndex(a=>a.external_line_id===asset!.external_line_id);
          if(old>=0)assets[old]=asset;else assets.push(asset);
          // Durable retained reference precedes inspection: recovery no longer depends on the source URL.
          await checkpoint();
        }
        if(transport.inspect){
          const cached=asset.inspection_result;
          const profile=transport.inspection_profile;
          const result=cached && profile && cached.sha256===asset.sha256 && cached.engine===profile.engine && cached.policy_id===profile.policy_id ? cached : await transport.inspect(bytes,line);
          if(result.sha256!==asset.sha256 || (profile && (result.engine!==profile.engine || result.policy_id!==profile.policy_id)))throw new AssetCheckError('PDF_INSPECTION_BINDING_MISMATCH',false,'internal');
          asset.inspection_result=result;asset.inspection=result.verdict==='pass'?'metadata_pass':'metadata_fail';
          await checkpoint();
          if(result.verdict!=='pass')throw new AssetCheckError(result.findings[0]??'PDF_INSPECTION_FAILED');
        }
      } catch (e) {
        await assertClaim();
        const code = e instanceof AssetCheckError ? e.code : 'ASSET_TRANSPORT_FAILURE';
        issues.push({issue_id: `iss_${sha256(`${receiptId}:${line.source_line.external_line_id}:${code}`).slice(0,24)}`, code,
          field: `lines[${index}].artwork`, external_line_id: line.source_line.external_line_id,
          owner: e instanceof AssetCheckError ? e.owner : 'internal', retryable:e instanceof AssetCheckError ? e.retryable : true,
          message: 'Production artwork has not passed retention or metadata checks.',
          corrective_action: e instanceof AssetCheckError && e.owner==='customer' ? 'Provide access to the unchanged approved PDF or request review of replacement content.' : 'Internal review or bounded retry is required.'});
      }
      // Optional reference preview is separate from the approved production original and cannot block it.
      if(transport.kind==='review-assets' && line.source_line.preview){
        const preview=line.source_line.preview;
        const prior=previews.find(p=>p.external_line_id===line.source_line.external_line_id);
        if(prior?.status==='retained')continue;
        let outcome:NonNullable<Receipt['previews']>[number];
        try{
          await assertClaim();
          if(Date.parse(preview.expires_at)<=Date.parse(this.now()))throw new AssetCheckError('PREVIEW_URL_EXPIRED');
          const format=preview.format==='png'?'png':'jpg';
          const bytes=await transport.read(preview.url,{max_bytes:5*1024*1024,content_types:[format==='png'?'image/png':'image/jpeg']});
          if(bytes.length>5*1024*1024 || (format==='png'?!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)))throw new AssetCheckError('PREVIEW_SIGNATURE_INVALID');
          await assertClaim();
          outcome={external_line_id:line.source_line.external_line_id,status:'retained',sha256:sha256(bytes),bytes:bytes.length,retained_ref:await transport.retain(scope,bytes,format)};
        }catch(e){await assertClaim();outcome={external_line_id:line.source_line.external_line_id,status:'unavailable',code:e instanceof AssetCheckError?e.code:'PREVIEW_UNAVAILABLE'};}
        const index=previews.findIndex(p=>p.external_line_id===outcome.external_line_id);if(index<0)previews.push(outcome);else previews[index]=outcome;
        await checkpoint();
      }
    }
    await assertClaim();
    const internal = issues.some(i => i.owner === 'internal');
    if (issues.length) {
      const current = await ledger.get(r.identity.customer_id, intakeAttemptId(r.signal));
      if (!current) throw new Error('Missing shared intake attempt');
      if (!ownsProjection(current)) throw new Error('Shared intake ownership conflict');
      await project(current, internal ? 'internal_action_required' : 'manual_review', internal ? 'pathfinder_failure' : null);
    }
    await assertClaim();
    const finalAttempt = await ledger.get(r.identity.customer_id, intakeAttemptId(r.signal));
    if (!finalAttempt || !ownsProjection(finalAttempt)) throw new Error('Shared intake ownership conflict');
    assertAssociation(finalAttempt);
    const attempts=r.retry_attempts??1;
    const retry=issues.some(i=>i.retryable) && attempts<3;
    const complete: Receipt = {...r, revision: r.revision + 1, claim: null, updated_at: this.now(),
      work: retry ? 'pending' : 'complete', assets, previews, issues, retry_attempts:attempts,
      next_retry_at:retry?after(this.now(),60_000 * attempts):null,
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
    order_revision: r.revision+1, intake_status: r.confirmation ? 'confirmed' : r.asset_status === 'action_required' ? 'manual_review' : r.asset_status === 'internal_action_required' ? 'internal_action_required' : 'processing',
    asset_status: r.asset_status, review_required: true, production_status: null, fulfillment_status: null, lift_order_number: r.confirmation?.order_number??null, confirmed_at:r.confirmation?.confirmed_at??null,
    received_at: r.received_at, updated_at: r.updated_at, issues: r.issues,
    lines: r.adapted.canonical.lines.map(l => ({external_line_id:l.source_line.external_line_id, ordered_quantity:l.quantity,
      retained: r.assets.some(a => a.external_line_id === l.source_line.external_line_id), inspection: r.assets.find(a=>a.external_line_id===l.source_line.external_line_id)?.inspection??'not_run',
      inspection_details:r.assets.find(a=>a.external_line_id===l.source_line.external_line_id)?.inspection_result??null,
      inspection_findings:r.assets.find(a=>a.external_line_id===l.source_line.external_line_id)?.inspection_result?.findings??[],
      preview_status:r.previews?.find(p=>p.external_line_id===l.source_line.external_line_id)?.status??'not_run'})),
    shipments: [], status_page: null};
}
