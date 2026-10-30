// Loopback-only, synthetic API for actual Proof components. No proxy, credentials or production connection.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { demoOrderForHash } from '../../../apps/proof/src/demo.ts';
const port = Number(process.env.PROOF_REFINEMENT_PORT ?? 5407);
const actualSizes: Record<string, [number, number]> = { 'actual-small':[360,180], 'actual-narrow':[180,320], 'actual-wide':[1600,180], 'actual-large':[1600,1200] };
const actualPdfs = new Map<string, Uint8Array>();
for (const [name, dimensions] of Object.entries(actualSizes)) {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage(dimensions); const [width,height] = dimensions;
  page.drawRectangle({x:1,y:1,width:width-2,height:height-2,borderWidth:2,borderColor:rgb(.22,.32,.23),color:rgb(.95,.97,.91)});
  for (const [label,x,y] of [['TOP LEFT',8,height-18],['TOP RIGHT',width-75,height-18],['BOTTOM LEFT',8,8],['BOTTOM RIGHT',width-90,8]] as const) page.drawText(label,{x,y,size:9,font});
  page.drawText(`${width} x ${height}`,{x:width/2-40,y:height/2,size:14,font});
  actualPdfs.set(name, await pdf.save());
}
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
      const url = new URL(req.url!,`http://127.0.0.1:${port}`);
      res.setHeader('Content-Security-Policy',`connect-src 'self' ws://127.0.0.1:${port}`);
      const scenario=url.searchParams.get('scenario') ?? (req.headers.referer ? new URL(req.headers.referer).searchParams.get('scenario') : null) ?? 'view';
      const send=(body:unknown,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
      if(url.pathname==='/fixture-art.pdf') {
        const bytes = actualPdfs.get(scenario);
        if (!bytes) return send({error:'Unknown synthetic dimensions'},404);
        res.setHeader('Content-Type','application/pdf'); return res.end(Buffer.from(bytes));
      }
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
        const actual = actualPdfs.has(scenario);
        const pdf = scenario==='pdf' || actual;
        const source = actual ? `/fixture-art.pdf?scenario=${scenario}` : pdf ? '/brand/proof-placeholder.pdf' : `/fixture-art.svg?scenario=${scenario}`;
        order.tasks=order.tasks.map((task,index)=>({...task,feedback_required:false,feedback_acknowledged:true,current_version:task.current_version?{...task.current_version,filename:actual?`${scenario}.jpg`:pdf?'white-proof.pdf':`creative-${index+1}.svg`,content_type:pdf?'application/pdf':'image/svg+xml',preview_kind:pdf?'pdf':'image',preview_url:source,download_url:source} :null}));
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
  }}], server:{host:'127.0.0.1',port,strictPort:true}});
await server.listen();server.printUrls();
