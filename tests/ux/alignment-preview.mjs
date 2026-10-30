// Local-only verification of current application components; never a release entry.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
function isolated(port) {
  return { name: 'alignment-local-only', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      res.setHeader('Content-Security-Policy', `connect-src 'self' ws://127.0.0.1:${port}; form-action 'none'`);
      if (req.url.startsWith('/api/') || req.url.startsWith('/public/')) {
        res.statusCode = 403; res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Isolated QA: external actions unavailable.' })); return;
      }
      next();
    });
  }};
}
process.env.PATHFINDER_UX_PORT = '5360';
const admin = await createServer({ configFile: root + '/tests/ux/vite.config.ts', plugins: [isolated(5360)] });
await admin.listen();
for (const [name, port] of [['proof', 5361], ['status', 5362]]) {
  const server = await createServer({ configFile: false, root: root + '/apps/' + name,
    plugins: [react(), isolated(port)],
    define: { 'import.meta.env.VITE_PROOF_DEMO': '"true"', 'import.meta.env.VITE_STATUS_API_BASE_URL': JSON.stringify('http://127.0.0.1:' + port + '/api') },
    server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root] } }
  });
  await server.listen();
}
console.log('Isolated candidate: Pathfinder5360, Proof5361/#/proof/batch-qa, Status5362/design-qa');
