import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import {fileURLToPath, URL} from 'node:url';
import {createCatalogRecordRouter} from '../../apps/api/src/catalog-records/router';
import {CatalogRecordService} from '../../apps/api/src/catalog-records/service';
import {emptyDraftState,type DraftRepository,type JsonRecord} from '../../apps/api/src/catalog-records/storage-contract';
import {reviewedDataHash} from '../../apps/api/src/catalog-records/content-hash';
class MemoryRepository implements DraftRepository {
 state=emptyDraftState();blobs=new Map<string,JsonRecord>();
 async read(){return structuredClone(this.state);}
 async blob(key:string){return structuredClone(this.blobs.get(key)!);}
 async put(record:JsonRecord){const key=reviewedDataHash(record);this.blobs.set(key,JSON.parse(JSON.stringify(record)));return key;}
 async commit(expected:number,next:typeof this.state){if(expected!==this.state.revision)return false;this.state=structuredClone(next);return true;}
}
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),publicDir:fileURLToPath(new URL('../../apps/web/public',import.meta.url)),plugins:[react(),{
 name:'isolated-catalog-review',async configureServer(server){
  const app=express();app.use(express.json({limit:'10mb'}));
  app.use((req,res,next)=>{
   if(req.headers.host!=='127.0.0.1:5240'||req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5240'||req.header('x-isolated-review')!=='1')return void res.status(403).end();
   res.locals.authUser={uid:req.header('x-review-role')==='reader'?'review-reader':'review-editor'};next();
  });
  const records=new Map<string,CatalogRecordService>();
  for(const id of ['review-demo','review-empty']){
   const service=new CatalogRecordService(new MemoryRepository(),{customer:{id,name:id==='review-demo'?'Harvest Pantry · design sample':'New customer · design sample',source:'standard-v1'}});records.set(id,service);
   if(id==='review-empty')continue;
   const names=['Organic sunflower oil','Extra virgin olive oil','Cold pressed avocado oil','Coconut cooking oil','Golden sesame oil','Premium canola oil'];
   await service.apply({expectedRevision:0,operation:{kind:'import',name:'Synthetic catalog.csv',rows:Array.from({length:72},(_,i)=>({row:i+2,raw:{'Customer Number':id,'Source ID':`sample-${i}`,SKU:`LBL-${String(i+1).padStart(5,'0')}`,Name:`${names[i%6]} · ${i%2?'Back label':'Front label'} ${Math.floor(i/6)+1}`,Product:'Sample Label',Width:'4',Height:'5',Material:'Example substrate',Laminate:'None',Varnish:'Semi-gloss',Shape:'Square/Rectangle','Corner Radius':'1/8','Spacing (in)':'0.125','White Ink Required':'No','Cut Type':'Laser',Corners:'1/8" Radius Corners',Unwind:'3-Right','Roll Mode':'Max Labels per Roll','Roll Value':'1000','Unit Price':'0.056',Approval:i%7?'approved':'pending','Artwork URL':'','Preview URL':`http://127.0.0.1:5240/sample-art.svg?t=${i%6}`}}))}},'seed-review-only','review-editor');
  }
  app.use(createCatalogRecordRouter({serviceForCustomer:id=>records.get(id),enabled:true,authorize:async(uid,id,access)=>records.has(id)&&(uid==='review-editor'||uid==='review-reader'&&access==='read')}));
  server.middlewares.use('/api',app);
 }
}],server:{host:'127.0.0.1',port:5240,strictPort:true,fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}}});
