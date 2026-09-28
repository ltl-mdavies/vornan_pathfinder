import { mkdir, open, link, unlink, readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PdfInspection } from './pdf-inspection.js';
import type { IntakeSignal, IntakeState } from '../intake-assurance.js';
import { sha256, type AdaptedOrder, type FieldIssue, type IntegrationIdentity } from './adapter.js';

export interface Receipt {
  version: 1; revision: number; receipt_id: string; identity: IntegrationIdentity;
  fingerprint: string; raw_sha256: string; received_at: string; updated_at: string;
  adapted: AdaptedOrder; signal: IntakeSignal; deadline: string;
  work: 'pending' | 'complete';
  claim: { token: string; until: string } | null;
  assets: { external_line_id: string; sha256: string; bytes: number; retained_ref: string; inspection: 'not_run' | 'metadata_pass' | 'metadata_fail'; inspection_result?: PdfInspection }[];
  previews?: { external_line_id: string; status: 'retained' | 'unavailable'; code?: string; sha256?: string; bytes?: number; retained_ref?: string }[];
  retry_attempts?: number; next_retry_at?: string | null;
  issues: FieldIssue[];
  confirmation?: {job_id:string;submit_attempt_id:string;order_number:string;confirmed_at:string;intake_revision:number;evidence_sha256:string};
  ledger_projection?: { attempt_id: string; expected_revision: number; before_state: IntakeState; before_event_id: string | null; event_id: string; state: IntakeState };
  asset_status: 'pending' | 'integrity_verified' | 'action_required' | 'internal_action_required';
}
export interface ReceiptStore {
  get(id: string): Promise<Receipt | null>;
  create(receipt: Receipt): Promise<boolean>;
  compareAndSet(before: Receipt, after: Receipt): Promise<boolean>;
  pending(): AsyncIterable<Receipt>;
}
const validId = (id: string) => /^rcpt_[a-f0-9]{64}$/.test(id);
const isExists = (e: unknown) => (e as NodeJS.ErrnoException).code === 'EEXIST';
const isMissing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

async function syncDirectory(path: string) {
  const dir = await open(path, 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}

/** Complete bytes and new directory entries are synced before returning acceptance. */
export async function publishImmutable(path: string, bytes: Buffer): Promise<boolean> {
  const folder = dirname(path);
  const firstCreated = await mkdir(folder, {recursive: true, mode: 0o700});
  if (firstCreated) {
    // Sync each newly-created directory and its entry in the existing ancestor.
    let current = folder;
    const ancestor = dirname(firstCreated);
    for (;;) {
      await syncDirectory(current);
      if (current === ancestor) break;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  const temp = join(folder, `.tmp-${randomUUID()}`);
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    let created = true;
    try { await link(temp, path); } catch (e) { if (!isExists(e)) throw e; created = false; }
    // A losing concurrent publisher must also sync the winning entry before returning a replay.
    await syncDirectory(folder);
    return created;
  } finally { await unlink(temp).catch(() => undefined); }
}
/** Local review harness only: append-only revision slots implement cross-process CAS, not a Lambda store. */
export class LocalReceiptStore implements ReceiptStore {
  constructor(readonly root: string) {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.PATHFINDER_RUNTIME === 'lambda') throw new Error('JSON intake local storage is not permitted in Lambda');
  }
  private folder(id: string) { if (!validId(id)) throw new Error('Invalid receipt identifier'); return join(this.root, 'receipts', id); }
  async get(id: string): Promise<Receipt | null> {
    if (!validId(id)) return null;
    const folder = this.folder(id);
    let names: string[];
    try { names = await readdir(folder); } catch (e) { if (isMissing(e)) return null; throw e; }
    const revisions = names.filter(x => /^\d+\.json$/.test(x)).map(x => Number(x.slice(0,-5))).sort((a,b) => a-b);
    if (!revisions.length) return null;
    if (revisions.some((r,i) => r !== i)) throw new Error('Corrupt receipt revision chain');
    const revision = revisions.at(-1)!;
    const receipt = JSON.parse(await readFile(join(folder, `${revision}.json`), 'utf8')) as Receipt;
    if (receipt.version !== 1 || receipt.receipt_id !== id || receipt.revision !== revision ||
      !receipt.identity || !receipt.signal || receipt.signal.customer_id !== receipt.identity.customer_id ||
      receipt.fingerprint !== receipt.adapted?.fingerprint || !['pending','complete'].includes(receipt.work)) throw new Error('Corrupt receipt');
    return receipt;
  }
  async create(receipt: Receipt) {
    if (receipt.revision !== 0) throw new Error('Initial revision must be zero');
    return publishImmutable(join(this.folder(receipt.receipt_id), '0.json'), Buffer.from(JSON.stringify(receipt)));
  }
  async compareAndSet(before: Receipt, after: Receipt) {
    if (before.receipt_id !== after.receipt_id || after.revision !== before.revision + 1 ||
      before.fingerprint !== after.fingerprint || JSON.stringify(before.identity) !== JSON.stringify(after.identity) ||
      before.received_at !== after.received_at || JSON.stringify(before.signal) !== JSON.stringify(after.signal)) throw new Error('Receipt immutable identity changed');
    return publishImmutable(join(this.folder(before.receipt_id), `${after.revision}.json`), Buffer.from(JSON.stringify(after)));
  }
  async *pending() {
    let ids: string[];
    try { ids = await readdir(join(this.root, 'receipts')); } catch (e) { if (isMissing(e)) return; throw e; }
    for (const id of ids.filter(validId)) { const r = await this.get(id); if (r?.work === 'pending') yield r; }
  }
  /** Immutable receipt history is the recoverable event source; never prune before outbox retention is designed. */
  async *history(): AsyncIterable<Receipt> {
    let ids:string[];
    try {ids=await readdir(join(this.root,'receipts'));} catch(e){if(isMissing(e))return;throw e;}
    for(const id of ids.filter(validId).sort()){
      const latest=await this.get(id);if(!latest)continue;
      for(let revision=0;revision<=latest.revision;revision++){
        const row=JSON.parse(await readFile(join(this.folder(id),`${revision}.json`),'utf8')) as Receipt;
        if(row.receipt_id!==id || row.revision!==revision || row.version!==1)throw new Error('Corrupt receipt history');
        yield row;
      }
    }
  }
  async retain(scope: string, bytes: Buffer, format: 'pdf' | 'png' | 'jpg' = 'pdf') {
    if (!['pdf','png','jpg'].includes(format)) throw new Error('Unsupported retained format');
    const digest = sha256(bytes);
    const ref = `assets/${sha256(scope)}/${digest}.${format}`;
    const path = join(this.root, ref);
    if (!await publishImmutable(path, bytes) && sha256(await readFile(path)) !== digest) throw new Error('Corrupt retained asset');
    return ref;
  }
  async readRetained(scope: string, ref: string) {
    const match = /^assets\/([a-f0-9]{64})\/([a-f0-9]{64})\.(pdf|png|jpg)$/.exec(ref);
    if (!match || match[1] !== sha256(scope)) throw new Error('Retained asset scope mismatch');
    if ((await stat(join(this.root,ref))).size>25*1024*1024) throw new Error('Retained asset byte limit');
    const bytes = await readFile(join(this.root, ref));
    if (sha256(bytes) !== match[2]) throw new Error('Corrupt retained asset');
    return bytes;
  }

}
