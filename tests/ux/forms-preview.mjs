// Local-only transport fixtures. Not an application entry or release artifact.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../..', import.meta.url));
const participants = new Map();
for (const [app, port] of [['proof', 5395], ['status', 5396]]) {
  const server = await createServer({ configFile:false, root:root+'/apps/'+app,
    plugins:[{
      name:'forms-fixtures', enforce:'pre',
      transform(source,id) {
        if (app === 'proof' && id.endsWith('/apps/proof/src/api.ts')) return source.replace('...init?.headers', '...init?.headers, "X-Local-QA-Mode": new URLSearchParams(location.search).get("save") || "success", "X-Local-QA-Run": new URLSearchParams(location.search).get("run") || "default"');
        if (app === 'proof' && id.endsWith('/apps/proof/src/App.tsx')) {
          // Exercise the real identity transport, retaining the existing synthetic order.
          return source.replace(/const saved = demoEnabled\s*\? \{ participant: \{ participant_id: participant\?\.participant_id[^\n]+\n\s*: await identifyParticipant\(identityName, identityEmail\);/,
            'if (new URLSearchParams(location.search).get("save") === "late-ended") window.setTimeout(terminateSession, 100); const saved = await identifyParticipant(identityName, identityEmail);');
        }
      },
      configureServer(s) { s.middlewares.use(async (req,res,next) => {
        res.setHeader('Content-Security-Policy',`connect-src 'self' ws://127.0.0.1:${port}; form-action 'none'`);
        if (!req.url.startsWith('/api/')) return next();
        res.setHeader('Content-Type','application/json');
        const ref = new URL(req.headers.referer || `http://127.0.0.1:${port}`);
        const mode = req.headers['x-local-qa-mode'] || ref.searchParams.get('save') || 'success';
        const key = req.headers['x-local-qa-run'] || ref.searchParams.get('run') || 'default';
        const reply = (body,status=200) => { res.statusCode=status; res.end(JSON.stringify(body)); };
        if (req.method === 'GET' && req.url.endsWith('/email-capability')) return reply({available:true,contact_email:''});
        if (req.method === 'GET' && req.url.endsWith('/proof/order')) {
          if (mode === 'expired') return reply({error:'Local QA: session expired.'},401);
          if (mode === 'read-failed') return reply({error:'Local QA: read unavailable.'},503);
          return reply({participant:mode === 'mismatch' ? null : participants.get(key)||null,activity:{identified_reviewers:1,last_activity_at:null,reviewer_names_visible:false}});
        }
        if (req.method === 'POST' && (req.url.endsWith('/proof/participants') || req.url.endsWith('/status/request-link'))) {
          let body=''; for await (const chunk of req) body += chunk;
          const input=JSON.parse(body);
          await new Promise(resolve=>setTimeout(resolve,600));
          if (mode === 'failed') return reply({error:'Local QA: save rejected. No data was saved.'},400);
          if (app === 'proof') {
            const participant={participant_id:'local-only',display_name:input.display_name.trim(),email:input.email.trim().toLowerCase()};
            participants.set(key,participant);
            if (['uncertain','mismatch','expired','read-failed'].includes(mode)) return reply({error:'Local QA: response interrupted.'},503);
            return reply({participant});
          }
          return reply({message:'Local QA only: request accepted. No email was sent.'});
        }
        return reply({error:'Local QA: all other API operations blocked.'},423);
      }); }
    },react()],
    define:{'import.meta.env.VITE_PROOF_DEMO':'"true"','import.meta.env.VITE_STATUS_API_BASE_URL':JSON.stringify(`http://127.0.0.1:${port}/api`)},
    server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[root]}} });
  await server.listen();
}
console.log('Local forms QA: Proof5395, Status5396; synthetic responses only.');
