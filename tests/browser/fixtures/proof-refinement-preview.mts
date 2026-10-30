// Loopback-only, synthetic API for actual Proof components. No proxy, credentials or production connection.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { demoOrderForHash } from '../../../apps/proof/src/demo.ts';
let reviewer = { participant_id:'fixture-reviewer',display_name:'QA Reviewer',email:'qa@example.invalid' };
const server = await createServer({ configFile:false, root:new URL('../../../apps/proof',import.meta.url).pathname,
  define:{'import.meta.env.VITE_PROOF_DEMO':JSON.stringify('false')},
  plugins:[react(),{name:'proof-refinement-fixture',transformIndexHtml(){
    // Proof intentionally sends no referrer. Carry this fixture-only scenario explicitly.
    return [{tag:'script',injectTo:'head-prepend',children:`{
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (typeof input === 'string' && input.startsWith('/api/')) {
          const url = new URL(input, location.origin);
          url.searchParams.set('scenario', new URL(location.href).searchParams.get('scenario') || 'view');
          return originalFetch(url, init);
        }
        return originalFetch(input, init);
      };
    }`}];
  },configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
      const url = new URL(req.url!,'http://127.0.0.1:5407');
      res.setHeader('Content-Security-Policy',"connect-src 'self' ws://127.0.0.1:5407");
      const scenario=url.searchParams.get('scenario') ?? (req.headers.referer ? new URL(req.headers.referer).searchParams.get('scenario') : null) ?? 'view';
      const send=(body:unknown,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
      if(url.pathname==='/fixture-art.svg'){
        res.setHeader('Content-Type','image/svg+xml');
        return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">${scenario==='transparent'?'':'<rect width="800" height="500" fill="white"/>'}<rect x="200" y="120" width="400" height="260" fill="none" stroke="#191818" stroke-width="2"/><text x="400" y="260" text-anchor="middle" fill="#191818" font-size="24">Synthetic viewer boundary test</text></svg>`);
      }
      if(!url.pathname.startsWith('/api/'))return next();
      if(url.pathname==='/api/public/proof/order'){
        const multi=scenario==='multi';
        const order=structuredClone(demoOrderForHash(multi?'#/proof/batch-qa':'#/proof/decision-flow-qa'));
        order.order_number='QA-ONLY'; order.order_title='Proof refinement verification'; order.last_synced_at=new Date().toISOString();
        order.access={scope:'review',decisions_enabled:scenario==='review'||scenario==='uncertain'||multi,allocation_enabled:multi,review_experience:multi?'advanced':'simple',revision_upload_enabled:false};
        order.tasks=order.tasks.map((task,index)=>({...task,feedback_required:false,feedback_acknowledged:true,current_version:task.current_version?{...task.current_version,filename:scenario==='pdf'?'white-proof.pdf':`creative-${index+1}.svg`,content_type:scenario==='pdf'?'application/pdf':'image/svg+xml',preview_kind:scenario==='pdf'?'pdf':'image',preview_url:scenario==='pdf'?'/brand/proof-placeholder.pdf':`/fixture-art.svg?scenario=${scenario}`,download_url:scenario==='pdf'?'/brand/proof-placeholder.pdf':`/fixture-art.svg?scenario=${scenario}`} :null}));
        return send({order,participant:reviewer,activity:{identified_reviewers:1,last_activity_at:new Date().toISOString(),reviewer_names_visible:false},session_expires_at:new Date(Date.now()+3600000).toISOString(),refresh_queued:false});
      }
      if(url.pathname==='/api/public/proof/participants' && req.method==='POST'){
        if(scenario==='uncertain')return send({error:'Fixture uncertainty'},503);
        let raw='';for await(const chunk of req)raw+=chunk;
        const body=JSON.parse(raw);reviewer={...reviewer,display_name:body.display_name,email:body.email};
        return send({participant:reviewer});
      }
      if(url.pathname==='/api/public/proof/order/refresh')return send({refresh_queued:true});
      return send({error:'Fixture endpoint disabled'},403);
    });
  }}], server:{host:'127.0.0.1',port:5407,strictPort:true}});
await server.listen();server.printUrls();
