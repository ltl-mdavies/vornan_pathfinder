// Isolated frontend/recovery evidence; no credentials, proxy or Lift connection.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { demoOrder } from '../../../apps/proof/src/demo.ts';
const assetId = 'passet_' + 'a'.repeat(64);
let scenario = 'accepted', receipt: any = null;
let sends = 0, reads = 0;
const base = structuredClone(demoOrder);
base.order_title = 'Revised artwork QA — no Lift connection';
base.last_synced_at = new Date().toISOString();
base.access = { scope: 'review', decisions_enabled: true, allocation_enabled: false, review_experience: 'advanced', revision_upload_enabled: true, revision_submission_enabled: true, revision_recovery_enabled: true };
const task = { ...base.tasks[0], attachment_id: '123', version: 1, line_number: '3', quantity: 10, sibling_count: 1, state: 'pending', feedback_required: false, feedback_acknowledged: true,
  current_version: { ...base.tasks[0].current_version!, filename: 'Original-proof.jpg', preview_kind: 'image', content_type: 'image/svg+xml', download_url: null, preview_url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#dce8cc"/><text x="200" y="270" text-anchor="middle" font-size="64">QA 3</text></svg>'), comments: [], version_id: 'pversion_original' } };
base.tasks = [task as any];
base.counts = { pending: 1, regenerating: 0, waiting: 0, reviewed: 0, total: 1 };
const asset = { asset_id: assetId, revision_id: 'revision', task_id: task.task_id, attachment_id: '123', order_number: base.order_number, original_filename: 'QA-revised-artwork.pdf', content_type: 'application/pdf', content_length: 8192, sha256: 'b'.repeat(64), state: 'ready_for_lift', verification_status: 'cleared', publication_status: 'delivery_verified', record_version: 4, initialized_at: new Date().toISOString(), upload_completed_at: new Date().toISOString() };
const server = await createServer({ configFile: false, root: new URL('../../../apps/proof', import.meta.url).pathname, plugins: [{ name: 'isolated-revision-qa', configureServer(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url!, 'http://127.0.0.1:5185');
    if (url.pathname === '/' && url.searchParams.has('qa') && scenario !== url.searchParams.get('qa')) { scenario = url.searchParams.get('qa')!; receipt = null; sends = 0; reads = 0; }
    res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:5185");
    const send = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname === '/__qa/counts') { res.setHeader('Content-Type', 'text/html'); return res.end(`<pre>Submissions: ${sends}\nRead checks: ${reads}</pre>`); }
    if (!url.pathname.startsWith('/api/')) return next();
    if (url.pathname === '/api/public/proof/order') {
      const order = structuredClone(base);
      if (scenario === 'replacement' && receipt) { order.tasks[0].attachment_id = '456'; order.tasks[0].current_version!.version_id = 'pversion_replacement'; order.tasks[0].current_version!.filename = 'New-proof.jpg'; }
      if (scenario === 'removed' && receipt) { order.tasks = []; order.counts = { pending: 0, regenerating: 0, waiting: 1, reviewed: 0, total: 1 }; }
      return send({ order, participant: { participant_id: 'revision-reviewer-' + scenario, display_name: 'Local QA', email: 'qa@example.invalid' }, activity: { identified_reviewers: 1 }, session_expires_at: new Date(Date.now() + 3600000).toISOString(), refresh_queued: false });
    }
    if (url.pathname.includes('/revised-assets/uploads/')) return send({ asset });
    if (url.pathname.endsWith('/revised-art/submissions') && req.method === 'POST') {
      sends++;
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      receipt = { submission_id: 'prevision_send_' + 'b'.repeat(64), task_id: task.task_id, attachment_id: body.attachment_id, version_id: body.expected_version_id, asset_id: body.asset_id, filename: asset.original_filename, state: scenario === 'unknown' || scenario === 'replacement' ? 'checking' : 'accepted', automatic_retry: false, lift_outcome_confirmed: false };
      if (scenario === 'lost') { receipt = null; return send({ error: 'Simulated lost response' }, 504); }
      return send({ submission: receipt });
    }
    if (url.pathname.endsWith('/revised-art/submissions') && req.method === 'GET') { reads++; if (scenario === 'hanging') return; if (scenario === 'read-failure') return send({ error: 'Temporarily unavailable' }, 503); return scenario === 'expired' ? send({ error: 'Session expired' }, 401) : send({ submissions: receipt ? [receipt] : [] }); }
    if (url.pathname.endsWith('/refresh')) return send({ queued: false, order: base });
    return send({ error: 'Outside local fixture' }, 404);
  });
} }, react()], server: { host: '127.0.0.1', port: 5185, strictPort: true } });
await server.listen();
console.log('Local revised-art fixture: http://127.0.0.1:5185/?qa=accepted&retry_asset=' + assetId + '#/proof');
