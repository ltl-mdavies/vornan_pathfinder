// Local-only UI evidence server. No proxy, credentials, or Lift calls.
// Scenarios are selected through /?qa=<scenario> before entering #/proof.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { demoOrder } from '../../../apps/proof/src/demo.ts';

let scenario = 'entry';
let batch: any = null;
let refreshFailed = false;
let counts = { prepare: 0, advance: 0, order: 0 };
const base = structuredClone(demoOrder);
base.order_title = 'Isolated allocation QA — no Lift connection';
base.last_synced_at = new Date().toISOString();
base.access = { scope: 'review', decisions_enabled: true, allocation_enabled: true, review_experience: 'advanced', revision_upload_enabled: false };
base.tasks = base.tasks.slice(0, 2).map((task, index) => ({ ...task, attachment_id: String(201 + index), version: 1, line_number: '4', quantity: 12, sibling_count: 2, state: 'pending', feedback_required: false, feedback_acknowledged: true,
  current_version: { ...task.current_version!, comments: [], version_id: 'pversion_' + (201 + index) } }));
base.counts = { pending: 2, regenerating: 0, waiting: 0, reviewed: 0, total: 2 };
function savedBatch() {
  return { batch_id: 'pbatch_local_qa', state: 'checking', automatic_retry: false, source_line_number: '4', line_quantity: 12,
    entries: base.tasks.map((t, i) => ({ task_id: t.task_id, attachment_id: t.attachment_id, filename: t.current_version!.filename, quantity: i ? 7 : 5, state: i ? 'pending' : 'submitted', resulting_line_number: null })) };
}
const server = await createServer({ configFile: false, root: new URL('../../../apps/proof', import.meta.url).pathname,
  plugins: [{ name: 'isolated-proof-fixture', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url!, 'http://127.0.0.1:5184');
      if (url.pathname === '/__qa/thumbnails') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(await readFile(new URL('./proof-thumbnail-preview.html', import.meta.url), 'utf8'));
      }
      if (url.pathname === '/' && url.searchParams.has('qa') && url.searchParams.get('qa') !== scenario) {
        scenario = url.searchParams.get('qa')!; refreshFailed = false; counts = { prepare: 0, advance: 0, order: 0 };
        batch = scenario === 'entry' ? null : savedBatch();
        if (scenario === 'partial') batch.entries[0].state = 'confirmed';
        if (scenario === 'paused') { batch.state = 'paused'; batch.entries[0].state = 'confirmed'; }
      }
      // Prevent accidentally contacting non-local APIs from this test surface.
      res.setHeader('Content-Security-Policy', "connect-src 'self' ws://127.0.0.1:5184");
      const send = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
      if (url.pathname === '/__qa/counts') return send(counts);
      if (!url.pathname.startsWith('/api/')) return next();
      if (url.pathname === '/api/public/proof/order') {
        counts.order++;
        if (scenario === 'completed-error' && batch?.state === 'completed' && !refreshFailed) { refreshFailed = true; return send({ error: 'Isolated refresh failure' }, 503); }
        const order = structuredClone(base);
        if (batch?.state === 'completed') { order.tasks.forEach((t, i) => { t.state = 'approved'; t.line_number = String(i + 4); t.quantity = i ? 7 : 5; t.sibling_count = 1; t.current_version!.approval_status = 'APPROVED'; }); order.counts = { pending: 0, regenerating: 0, waiting: 0, reviewed: 2, total: 2 }; }
        return send({ order, participant: { participant_id: 'local-reviewer', display_name: 'Local QA', email: 'qa@example.invalid' }, activity: { identified_reviewers: 1, last_activity_at: null, reviewer_names_visible: false }, session_expires_at: new Date(Date.now() + 3600000).toISOString(), refresh_queued: false });
      }
      if (url.pathname.endsWith('/approval-batches') && req.method === 'GET') return send({ batches: batch ? [batch] : [] });
      if (url.pathname.endsWith('/approval-batches') && req.method === 'POST') {
        counts.prepare++;
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw); batch = savedBatch(); batch.state = 'ready';
        batch.entries.forEach((e: any) => { e.quantity = body.entries.find((r: any) => r.task_id === e.task_id).quantity; e.state = 'pending'; });
        return send({ batch });
      }
      if (url.pathname.endsWith('/advance')) {
        if (!batch) return send({ error: 'Local fixture reset; reopen the preview' }, 409);
        counts.advance++;
        if (scenario === 'expired') return send({ error: 'Review session expired' }, 401);
        if (scenario.startsWith('completed-')) { batch.state = 'completed'; batch.entries.forEach((e: any, i: number) => { e.state = 'confirmed'; e.resulting_line_number = String(i + 4); }); }
        else if (scenario === 'partial') { batch.state = 'checking'; batch.entries[1].state = 'submitted'; }
        else { batch.state = 'checking'; batch.entries[0].state = 'submitted'; }
        return send({ batch });
      }
      return send({ error: 'Outside isolated fixture scope' }, 404);
    });
  } }, react()], server: { host: '127.0.0.1', port: 5184, strictPort: true } });
await server.listen();
console.log('Isolated allocation QA: http://127.0.0.1:5184/?qa=entry#/proof');
