// Local-only recovery QA. Never a release entry; mutations and external connections blocked.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
function boundary(port) { return { name: 'secondary-qa-isolation', configureServer(s) {
  s.middlewares.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', `connect-src 'self' ws://127.0.0.1:${port}; form-action 'none'`);
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/public/')) return next();
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'GET') {
      res.statusCode = 423; res.end(JSON.stringify({error:'Local QA: mutations blocked.'})); return;
    }
    if (req.url.endsWith('/email-capability')) {
      res.end(JSON.stringify({available: !(req.headers.referer || '').includes('unavailable=1'), contact_email:''})); return;
    }
    if (req.url.endsWith('/review-loading')) return;
    res.statusCode = 410; res.end(JSON.stringify({error:'status_link_expired',order_numbers:['A0000001']}));
  });
}}; }
process.env.PATHFINDER_UX_PORT = '5390';
const web = await createServer({configFile: root + '/tests/ux/vite.config.ts', plugins:[boundary(5390)]});
await web.listen();
for (const [app, port] of [['proof',5391],['status',5392]]) {
  const server = await createServer({configFile:false, root:root+'/apps/'+app,
    plugins:[react(),boundary(port)],
    define:{'import.meta.env.VITE_PROOF_DEMO':'"true"','import.meta.env.VITE_STATUS_API_BASE_URL':JSON.stringify(`http://127.0.0.1:${port}/api`)},
    server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[root]}}});
  await server.listen();
}
console.log('Secondary candidate QA:5390 Pathfinder,5391 Proof,5392 Status. Local fixtures only.');
