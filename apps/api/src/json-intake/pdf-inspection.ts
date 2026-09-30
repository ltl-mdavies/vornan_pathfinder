import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import type { CanonicalJsonLine } from '@pathfinder/canonical';
import { pdfWorkerSource } from './pdf-worker-source.js';
import { AssetCheckError } from './asset-errors.js';
import { sha256 } from './adapter.js';
export interface PdfBox { x:number; y:number; w:number; h:number }
export interface PdfColorMeasurements { spaces:string[]; icc_profiles:{components:number|null;bytes:number;valid:boolean;description:string|null;sha256:string}[]; unprofiled_rgb:boolean; review_required:boolean }
export interface PdfMeasurements { color?:PdfColorMeasurements; pages:number; media_in:PdfBox; trim_in:PdfBox; bleed_in:PdfBox; spot_present:boolean; layer_present:boolean; engine:string }
export interface PdfInspection {
  schema: 'pathfinder.pdf-metadata-review.v1'; sha256:string; engine:string; policy_id:string;
  verdict:'pass'|'fail'; findings:string[]; measured:PdfMeasurements;
  comparison_tolerance_in:number; production_approved:false; cut_path_verified:false; malware_scanned:false;
}
export interface PdfReviewPolicy { policy_id:string; metadata_tolerance_in:number; timeout_ms?:number; review_color?:boolean; isolated_sandbox?:boolean }
const require = createRequire(import.meta.url);
if(require('pdf-lib/package.json').version!=='1.17.1')throw new Error('PDF worker requires reviewed pinned parser version');
const library = require.resolve('pdf-lib');
let activeWorkers=0;
export function measurePdf(bytes: Buffer, spot: string, layer: string, timeout=5000, reviewColor=false): Promise<PdfMeasurements> {
  if (!Number.isInteger(timeout) || timeout<1 || timeout>10000 || bytes.length>25*1024*1024) throw new AssetCheckError('PDF_RESOURCE_LIMIT');
  if(activeWorkers>=2)return Promise.reject(new AssetCheckError('PDF_INSPECTOR_BUSY',true,'internal'));
  activeWorkers++;
  return new Promise<PdfMeasurements>((resolve,reject)=>{
    const worker=new Worker(pdfWorkerSource,{eval:true,workerData:{library,bytes,spot,layer,reviewColor},env:{},execArgv:[],
      resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4},stdout:true,stderr:true});
    // PDF parser diagnostics can contain attacker-controlled data. Drain but never log them.
    worker.stdout?.resume();worker.stderr?.resume();let settled=false;
    const finish=(error?:AssetCheckError,value?:PdfMeasurements)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      void worker.terminate().then(()=>error?reject(error):resolve(value!),()=>reject(new AssetCheckError('PDF_WORKER_FAILED',true,'internal')));
    };
    const timer=setTimeout(()=>finish(new AssetCheckError('PDF_PARSER_TIMEOUT',false,'internal')),timeout);
    worker.once('message',message=>{
      if(message?.ok && message.value) finish(undefined,message.value);
      else finish(new AssetCheckError(typeof message?.code==='string' && /^PDF_[A-Z_]+$/.test(message.code)?message.code:'PDF_MALFORMED'));
    });
    worker.once('error',()=>finish(new AssetCheckError('PDF_RESOURCE_LIMIT',false,'internal')));
    worker.once('exit',()=>{if(!settled)finish(new AssetCheckError('PDF_WORKER_FAILED',true,'internal'));});
  }).finally(()=>{activeWorkers--;});
}
/** Explicit local-review tolerance; nothing here records manufacturing/Proof approval. */
export function createPdfInspector(policy:PdfReviewPolicy) {
  if((process.env.PATHFINDER_RUNTIME==='lambda' || process.env.AWS_LAMBDA_FUNCTION_NAME) && !(policy.isolated_sandbox && process.env.SANDBOX_ARTWORK_WORKER==='true'))throw new Error('Local PDF worker is not packaged for Lambda');
  if(!policy.policy_id || !Number.isFinite(policy.metadata_tolerance_in) || policy.metadata_tolerance_in<0 || policy.metadata_tolerance_in>0.001)throw new Error('Invalid PDF review policy');
  return async (bytes:Buffer,line:CanonicalJsonLine):Promise<PdfInspection>=>{
    const measured=await measurePdf(bytes,line.source_line.cut.spot_name,line.source_line.cut.layer_name,policy.timeout_ms,policy.review_color);
    const art=line.source_line.artwork;const findings:string[]=[];const tolerance=policy.metadata_tolerance_in;
    const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance+1e-9;
    if(!near(measured.trim_in.w,art.trim_in.w)||!near(measured.trim_in.h,art.trim_in.h))findings.push('PDF_TRIM_GEOMETRY_MISMATCH');
    if(!near(measured.media_in.w,art.page_in.w)||!near(measured.media_in.h,art.page_in.h))findings.push('PDF_PAGE_GEOMETRY_MISMATCH');
    const t=measured.trim_in,b=measured.bleed_in,m=measured.media_in,bleed=line.dimensions.bleed??0;
    if(![t.x-b.x,t.y-b.y,b.x+b.w-t.x-t.w,b.y+b.h-t.y-t.h].every(v=>near(v,bleed)) ||
      b.x<m.x-tolerance || b.y<m.y-tolerance || b.x+b.w>m.x+m.w+tolerance || b.y+b.h>m.y+m.h+tolerance)findings.push('PDF_BLEED_GEOMETRY_MISMATCH');
    if(!measured.spot_present)findings.push('PDF_CUT_SPOT_MISSING');
    if(!measured.layer_present)findings.push('PDF_CUT_LAYER_MISSING');
    if(policy.review_color){
      if(!measured.color || measured.color.review_required)findings.push('PDF_COLOR_REVIEW_REQUIRED');
      if(measured.color?.unprofiled_rgb)findings.push('PDF_RGB_PROFILE_MISSING');
    }
    return {schema:'pathfinder.pdf-metadata-review.v1',sha256:sha256(bytes),engine:measured.engine,policy_id:policy.policy_id,
      verdict:findings.length?'fail':'pass',findings,measured,comparison_tolerance_in:tolerance,production_approved:false,cut_path_verified:false,malware_scanned:false};
  };
}
