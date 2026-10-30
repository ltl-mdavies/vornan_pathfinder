import {catalogCustomer} from './customer-access.js';
import type {Customer} from '@pathfinder/catalog-domain';
import {cutKind,readDieDecision,dieDecisionProblem,applyAutomaticDie,manualDieOverride,productionData,dieRequest,dieSignature,dieSpecification,interpretDieMatch} from '@pathfinder/catalog-domain';
import {createHash} from 'node:crypto';
import {applyImport,emptyCatalog,previewImport,editItemWithReason,recordReceipt,validateChangeReasons,DEFAULT_CHANGE_REASONS,readArtworkVersion,approveArtwork,attachArtworkVersion,type Catalog,type ItemData,type ChangeReasonOption,type ArtworkVersion} from '@pathfinder/catalog-domain';
import {DraftError,type DraftRepository,type JsonRecord,type DraftState} from './storage-contract.js';
import {reviewedDataHash} from './content-hash.js';
function fail(code:string,status:number,message:string):never{throw new DraftError(code,status,message);}
export type CatalogRecord={version:1;catalog:Catalog;reasons:ChangeReasonOption[];revision:number;at:string;actor:string;action:string;previousBlob:string|null;submissionEnabled:false};
const same=(a:unknown,b:unknown)=>reviewedDataHash(a)===reviewedDataHash(b);
function catalogShape(value:any,customer:Customer):asserts value is Catalog {
 if(!value||value.version!==1||!same(value.customer,customer)||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.items)||value.items.length>10000||!Array.isArray(value.imports)||!Array.isArray(value.receipts))fail('invalid_catalog',400,'Invalid customer catalog.');
 const keys=new Set<string>();
 for(const item of value.items){
  if(typeof item.key!=='string'||!item.key||keys.has(item.key)||item.customerId!==customer.id||item.source!==customer.source||!Number.isSafeInteger(item.revision)||item.revision<1||!item.data||!item.sourceData||!item.raw||!Array.isArray(item.history))fail('invalid_catalog',400,'Catalog item identity or history is invalid.');
  keys.add(item.key);
  for(const data of [item.data,item.sourceData])if(Object.values(data).some(v=>typeof v!=='string')||typeof data.sku!=='string'||!['approved','pending'].includes(data.approval))fail('invalid_catalog',400,'Catalog fields must retain their source string values.');
 }
}
/** Reuses immutable blob/CAS storage in a separate catalog manifest, never the draft manifest. */
export class CatalogRecordService {
 readonly customer:Readonly<Customer>;
 private readonly id:string;
 private scope(state:DraftState){if(Object.keys(state.drafts).some(key=>key!==this.id))fail('storage_scope_mismatch',503,'Catalog storage belongs to another scope.');}
 private record(value:JsonRecord):CatalogRecord{catalogShape(value.catalog,this.customer);return value as CatalogRecord;}
 constructor(readonly repository:DraftRepository,readonly options:{customer:Customer;allowBrowserMigration?:boolean;matchDies?:(specifications:ReturnType<typeof dieRequest>)=>Promise<unknown>;verifyArtwork?:(url:string)=>Promise<ArtworkVersion>;now?:()=>string}){this.customer=Object.freeze(catalogCustomer(options.customer));this.id=`catalog-${this.customer.id}`;}
 async current():Promise<CatalogRecord|null>{const state=await this.repository.read();this.scope(state);const entry=state.drafts[this.id];return entry?this.record(await this.repository.blob(entry.blob)):null;}
 async history(limit=25){const state=await this.repository.read();this.scope(state);let hash:string|null=state.drafts[this.id]?.blob??null;const records=[];while(hash&&records.length<Math.min(limit,100)){const record=this.record(await this.repository.blob(hash));records.push({revision:record.revision,at:record.at,actor:record.actor,action:record.action,hash});hash=record.previousBlob;}return records;}
 async operationStatus(key:string,actor:string){
  if(!/^[A-Za-z0-9-]{8,100}$/.test(key))fail('invalid_request',400,'A valid request key is required.');
  const namespace=`catalog-write-v1:${this.customer.id}`;
  const requestKey=createHash('sha256').update(`${namespace}\0${actor}\0${key}`).digest('hex');
  const state=await this.repository.read();this.scope(state);const prior=state.requests[requestKey];
  // Absence is not proof of failure: an earlier request may still be in flight.
  return {status:prior?'recorded':'unconfirmed',revision:prior?.revision??null,submissionEnabled:false};
 }
 async apply(body:any,key:string,actor:string):Promise<CatalogRecord&{replayed:boolean;currentRevision:number}>{
  if(!/^[A-Za-z0-9_.:@-]{1,160}$/.test(actor))fail('unauthenticated',401,'An authenticated operator is required.');
  if(!/^[A-Za-z0-9-]{8,100}$/.test(key)||!body||Object.keys(body).some(k=>!['expectedRevision','operation'].includes(k))||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!body.operation||typeof body.operation.kind!=='string')fail('invalid_request',400,'A catalog operation, expected revision and stable request key are required.');
  if(Buffer.byteLength(JSON.stringify(body))>10*1024*1024)fail('too_large',413,'Catalog operation exceeds the 10 MB limit.');
  const {customer,id}=this;
  const namespace=`catalog-write-v1:${customer.id}`;
  const signature=reviewedDataHash({body,actor}),requestKey=createHash('sha256').update(`${namespace}\0${actor}\0${key}`).digest('hex');
  for(let attempt=0;attempt<8;attempt++){
   const state=await this.repository.read();this.scope(state);const prior=state.requests[requestKey];
   if(prior){if(prior.hash!==signature)fail('idempotency_conflict',409,'This request key was already used for different content.');return {...this.record(await this.repository.blob(prior.blob)),replayed:true,currentRevision:state.drafts[id].revision};}
   const entry=state.drafts[id];if((entry?.revision??0)!==body.expectedRevision)fail('revision_conflict',409,'The catalog changed elsewhere. Reload before saving.');
   const before=entry?this.record(await this.repository.blob(entry.blob)):null;
   const mappings:never[]=[];
   const at=(this.options.now??(()=>new Date().toISOString()))(),op=body.operation;
   let catalog=before?.catalog??emptyCatalog(customer),reasons=before?.reasons??structuredClone([...DEFAULT_CHANGE_REASONS]);
   try{
    if(op.kind==='import'){
     if(typeof op.name!=='string'||!op.name.trim()||!Array.isArray(op.rows)||op.rows.some((r:any)=>!Number.isSafeInteger(r.row)||!r.raw||Object.values(r.raw).some(v=>typeof v!=='string')||(r.raw['Customer Number']&&r.raw['Customer Number']!==customer.id)))fail('invalid_import',400,'Import requires named source rows for this customer.');
     catalog=applyImport(catalog,previewImport(catalog,op.rows,op.name),at);
    }else if(op.kind==='edit-item'){
     const item=catalog.items.find(i=>i.key===op.itemKey);if(!item||item.revision!==op.expectedItemRevision)fail('item_conflict',409,'This item changed. Reopen it before saving.');
     let data=(op.data ? JSON.parse(JSON.stringify(op.data)) : op.data) as ItemData;
     if(!data||Object.values(data).some(v=>typeof v!=='string')||!/^(0|[1-9]\d*)(\.\d{1,5})?$/.test(data.price))fail('invalid_item',400,'Use string item fields and a price with at most five decimals.');
     const oldData=productionData(item);
     const cuttingChanged=cutKind(data.cut)!==cutKind(oldData.cut)||(cutKind(data.cut)==='die'&&(data.die??'')!==(oldData.die??''));
     const decisionChanged=data.dieDecision!==item.data.dieDecision;
     if(cuttingChanged&&!decisionChanged)fail('cutting_decision_required',400,'Record an automatic selection or a manual override reason for this cutting change.');
     if(decisionChanged){
      const decision=readDieDecision(data),problem=dieDecisionProblem(data,mappings);
      if(!decision||problem)fail('invalid_die_decision',400,problem||'A cutting decision cannot be removed. Choose automatic matching or a reasoned manual override.');
      if(decision.mode==='automatic'){
       if(!this.options.matchDies)fail('die_matching_unavailable',503,'Server die matching is required before saving an automatic selection.');
       let payload:unknown;
       try{payload=await this.options.matchDies(dieRequest(data,mappings));}catch{fail('die_matching_unavailable',503,'Die verification could not finish. Retry; the saved item is unchanged.');}
       let verified:ItemData;
       try{verified=applyAutomaticDie({...data,dieDecision:undefined},interpretDieMatch(payload,data,at,mappings),mappings);}catch{fail('die_match_changed',409,'The die result needs review. Check dies again or record a manual override.');}
       if(cutKind(verified.cut)!==cutKind(data.cut)||(verified.die??'')!==(data.die??''))fail('die_match_changed',409,'The die library result changed. Check dies again before saving this selection.');
       data={...data,dieDecision:JSON.stringify({...readDieDecision(verified)!,actor,responseFingerprint:reviewedDataHash(payload)})};
      }else{
       data=manualDieOverride(data,decision.reason.trim(),at,mappings);
       data.dieDecision=JSON.stringify({...readDieDecision(data)!,actor});
      }
     }
     if(data.artwork!==item.data.artwork)fail('artwork_replacement_required',409,'Production artwork replacement requires the revision workflow.');
     if(['approval','artworkVersion','artworkApproval','artworkConfirmation'].some(k=>(data as any)[k]!==(item.data as any)[k]))fail('artwork_changes_disabled',423,'Artwork approval changes are disabled for this catalog pilot.');
     const evidenceChanged=['artworkVersion','artworkApproval','artworkConfirmation'].some(k=>(data as any)[k]!== (item.data as any)[k]);
     if(data.approval==='pending'){
      // Revocation is always allowed to an authorized internal editor, without trusting supplied evidence.
      data={...data,artworkVersion:item.data.artworkVersion,artworkApproval:undefined,artworkConfirmation:undefined};
     }else if(evidenceChanged||data.approval!==item.data.approval){
      if(!this.options.verifyArtwork)fail('artwork_verification_unavailable',503,'Server artwork verification is required before changing approval.');
      const proposed=readArtworkVersion(data),verified=await this.options.verifyArtwork(data.artwork);
      if(!proposed||proposed.sha256!==verified.sha256)fail('artwork_changed',409,'Artwork changed or was not verified. Verify it again before approving.');
      data=approveArtwork(attachArtworkVersion({...data,approval:'pending',artworkApproval:undefined,artworkConfirmation:undefined},verified),item.key,at,true);
      const approval=JSON.parse(data.artworkApproval!);approval.actor=actor;data.artworkApproval=JSON.stringify(approval);
     }
     catalog=editItemWithReason(catalog,op.itemKey,data,op.expectedItemRevision,op.reasonId,op.details??'',reasons,at,mappings);
    }else if(op.kind==='record-po'){
     if(op.po?.customerName!==customer.name)fail('invalid_po',400,'A PO for this customer is required.');catalog=recordReceipt(catalog,op.po,at);
    }else if(op.kind==='change-reasons'){if(!before)fail('catalog_missing',409,'Initialize the catalog first.');reasons=validateChangeReasons(op.reasons);}
    else fail('invalid_operation',400,'Unsupported catalog operation.');
   }catch(e){if(e instanceof DraftError)throw e;fail('invalid_operation',400,e instanceof Error?e.message:'Catalog operation is invalid.');}
   // Server owns timestamps/actors on newly created history; old source history stays unchanged.
   if(op.kind!=='migrate-browser')catalog={...catalog,items:catalog.items.map(item=>{const old=before?.catalog.items.find(i=>i.key===item.key);return {...item,history:item.history.map((h,index)=>index<(old?.history.length??0)?h:{...h,actor,at})};})};
   // Check the serialized result before publication as well as on reads. In
   // particular, successive imports cannot publish an unreadable oversized catalog.
   catalogShape(JSON.parse(JSON.stringify(catalog)),customer);
   const revision=(entry?.revision??0)+1;
   const result:CatalogRecord={version:1,catalog,reasons,revision,at,actor,action:op.kind,previousBlob:entry?.blob??null,submissionEnabled:false};
   const blob=await this.repository.put(result);
   const next:DraftState={revision:state.revision+1,drafts:{[id]:{id,revision,blob,poIdentities:[],holds:['live-submission-disabled'],updatedAt:at,actor,snapshots:[]}},requests:{...state.requests,[requestKey]:{hash:signature,draftId:id,blob,revision}}};
   if(await this.repository.commit(state.revision,next))return {...result,replayed:false,currentRevision:revision};
  }
  return fail('busy',503,'Catalog storage is busy. Retry the same request.');
 }
}
