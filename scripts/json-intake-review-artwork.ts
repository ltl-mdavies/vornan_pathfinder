/** Explicit local review of one exported receipt. Never updates cloud status or submits orders.
 * Run with node --import tsx/esm scripts/json-intake-review-artwork.ts
 * --receipt <private receipt.json> --out <private directory> --allow-host <trusted hostname>
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { stickerPressV1, sha256, stableJson } from '../apps/api/src/json-intake/adapter.js';
import { createHttpsAssetReader } from '../apps/api/src/json-intake/https-assets.js';
import { createPdfInspector } from '../apps/api/src/json-intake/pdf-inspection.js';
import { LocalReceiptStore, type Receipt } from '../apps/api/src/json-intake/local-store.js';
import { AssetCheckError } from '../apps/api/src/json-intake/asset-errors.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--receipt' || args[2] !== '--out' || args[4] !== '--allow-host')
    throw new Error('Arguments required: --receipt <file> --out <directory> --allow-host <trusted hostname>');
  const receipt = JSON.parse(await readFile(resolve(args[1]), 'utf8')) as Receipt;
  if (receipt.version !== 1 || receipt.identity.environment !== 'test') throw new Error('Test receipt required');
  const adapted = stickerPressV1.validate(receipt.adapted.evidence, receipt.identity);
  if (adapted.fingerprint !== receipt.fingerprint) throw new Error('Receipt fingerprint mismatch');
  const expectedId = `rcpt_${sha256(stableJson([receipt.identity.customer_id, receipt.identity.integration_id,
    receipt.identity.environment, receipt.identity.store, adapted.canonical.source.source_record_id]))}`;
  if (receipt.receipt_id !== expectedId) throw new Error('Receipt identity mismatch');
  const out = resolve(args[3]);
  await mkdir(out, {recursive: true, mode: 0o700});
  const retained = new LocalReceiptStore(out);
  const read = createHttpsAssetReader({allowed_hosts: [args[5]], timeout_ms: 30000, max_redirects: 0});
  const inspect = createPdfInspector({policy_id: 'local-partner-artwork-review-v1', metadata_tolerance_in: 0.001});
  const scope = `${receipt.identity.customer_id}/${receipt.identity.integration_id}/${receipt.receipt_id}`;
  const lines: Record<string, unknown>[] = [];
  for (const line of adapted.canonical.lines) {
    const art = line.source_line.artwork;
    try {
      if (Date.parse(art.artwork_expires_at) <= Date.now()) throw new AssetCheckError('ARTWORK_URL_EXPIRED');
      const bytes = await read(art.download_url, {max_bytes: art.bytes, content_types: ['application/pdf']});
      if (bytes.length !== art.bytes || sha256(bytes) !== art.artwork_sha256) throw new AssetCheckError('ARTWORK_INTEGRITY_MISMATCH');
      // Persist original bytes before parsing. A parser failure must not lose source evidence.
      const ref = await retained.retain(scope, bytes);
      const reread = await retained.readRetained(scope, ref);
      let inspection: unknown;
      try { inspection = await inspect(reread, line); }
      catch (error) { inspection = {verdict: 'fail', findings: [error instanceof AssetCheckError ? error.code : 'PDF_INSPECTION_FAILED']}; }
      lines.push({external_line_id: line.source_line.external_line_id, bytes: bytes.length, sha256: sha256(bytes),
        integrity_verified: true, retained_ref: ref, inspection});
    } catch (error) {
      lines.push({external_line_id: line.source_line.external_line_id, integrity_verified: false,
        findings: [error instanceof AssetCheckError ? error.code : 'LOCAL_REVIEW_FAILED']});
    }
  }
  const report = {schema: 'pathfinder.local-artwork-review.v1', receipt_id: receipt.receipt_id,
    receipt_revision: receipt.revision, reviewed_at: new Date().toISOString(), source_host: args[5],
    cloud_receipt_updated: false, lift_submission_enabled: false, color_conversion_performed: false,
    production_approved: false, lines};
  await writeFile(join(out, 'artwork-review.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Local artwork review failed; source URLs and payload are not logged.'); process.exitCode = 1; });
