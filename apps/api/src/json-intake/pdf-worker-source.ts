/** Executed in a terminable worker with a bounded V8 heap. No URLs, filesystem writes, or PDF scripts are executed. */
export const pdfWorkerSource = String.raw`
const {parentPort,workerData}=require('node:worker_threads');
const {PDFDocument,PDFName,PDFDict,PDFArray,PDFStream,PDFNumber,PDFString,PDFHexString}=require(workerData.library);
let resourceExceeded=false;
const fail=code=>{if(code==='PDF_RESOURCE_LIMIT')resourceExceeded=true;throw new Error(code);};
// Pinned parser adaptation: cap decoded object/xref stream buffers before allocation.
// V8 resourceLimits do not by themselves bound external ArrayBuffer allocations.
const DecodeStream=require(require('node:path').join(require('node:path').dirname(workerData.library),'core/streams/DecodeStream.js')).default;
const ensureBuffer=DecodeStream.prototype.ensureBuffer;let cumulativeDecodedAllocation=0;
DecodeStream.prototype.ensureBuffer=function(requested){
  if(!Number.isSafeInteger(requested) || requested<0 || requested>8*1024*1024)fail('PDF_RESOURCE_LIMIT');
  if(requested>this.buffer.byteLength){
    let size=this.minBufferLength;while(size<requested)size*=2;
    if(!Number.isFinite(size) || size>8*1024*1024 || (cumulativeDecodedAllocation+=size)>64*1024*1024)fail('PDF_RESOURCE_LIMIT');
  }
  return ensureBuffer.call(this,requested);
};
(async()=>{
  const bytes=Buffer.from(workerData.bytes);
  if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-')) || !/%%EOF\s*$/.test(bytes.subarray(-2048).toString('latin1')))fail('PDF_MALFORMED');
  const doc=await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false});
  if(doc.isEncrypted)fail('PDF_ENCRYPTED');
  const context=doc.context;
  if(context.enumerateIndirectObjects().length>50000)fail('PDF_RESOURCE_LIMIT');
  const pages=doc.getPages();
  if(pages.length!==1)fail('PDF_PAGE_COUNT');
  const page=pages[0];
  const unit=page.node.lookupMaybe(PDFName.of('UserUnit'),PDFNumber);
  if((unit && unit.asNumber()!==1) || page.getRotation().angle!==0)fail('PDF_TRANSFORM_UNSUPPORTED');
  for(const key of ['MediaBox','TrimBox','BleedBox']){
    const value=key==='MediaBox'?page.node.MediaBox():page.node.lookupMaybe(PDFName.of(key),PDFArray);
    if(!value || value.size()!==4)fail('PDF_BOX_MISSING');
    const coords=value.asArray().map(v=>context.lookup(v,PDFNumber).asNumber());
    if(coords.some(v=>!Number.isFinite(v)) || coords[2]<=coords[0] || coords[3]<=coords[1])fail('PDF_BOX_INVALID');
  }
  const box=value=>({x:value.x/72,y:value.y/72,w:value.width/72,h:value.height/72});
  const spots=new Set(),layers=new Set();
  const seen=new Set();let visited=0;
  const text=value=>value instanceof PDFName?value.decodeText():value instanceof PDFString || value instanceof PDFHexString?value.decodeText():null;
  function resources(raw,depth){
    if(depth>12)fail('PDF_RESOURCE_LIMIT');
    const dict=context.lookup(raw);if(!(dict instanceof PDFDict))return;
    if(seen.has(dict))return;seen.add(dict);
    if(++visited>10000)fail('PDF_RESOURCE_LIMIT');
    const colors=dict.lookupMaybe(PDFName.of('ColorSpace'),PDFDict);
    if(colors)for(const [,raw]of colors.entries()){
      const color=context.lookup(raw);if(!(color instanceof PDFArray))continue;
      const type=text(color.lookup(0));
      if(type==='Separation') {const name=text(color.lookup(1));if(name)spots.add(name);}
      if(type==='DeviceN'){const names=color.lookup(1);if(names instanceof PDFArray)for(const value of names.asArray()){const name=text(context.lookup(value));if(name)spots.add(name);}}
    }
    const properties=dict.lookupMaybe(PDFName.of('Properties'),PDFDict);
    if(properties)for(const [,raw]of properties.entries()){
      const entry=context.lookup(raw);
      if(entry instanceof PDFDict && text(entry.lookup(PDFName.of('Type')))==='OCG'){
        const name=text(entry.lookup(PDFName.of('Name')));if(name)layers.add(name);
      }
    }
    const forms=dict.lookupMaybe(PDFName.of('XObject'),PDFDict);
    if(forms)for(const [,raw]of forms.entries()){
      const stream=context.lookup(raw);
      if(stream instanceof PDFStream && text(stream.dict.lookup(PDFName.of('Subtype')))==='Form')resources(stream.dict.get(PDFName.of('Resources')),depth+1);
    }
  }
  resources(page.node.Resources(),0);
  // Presence is limited to page/form resources, not an arbitrary string or unused catalog entry.
  parentPort.postMessage({ok:true,value:{pages:pages.length,media_in:box(page.getMediaBox()),trim_in:box(page.getTrimBox()),bleed_in:box(page.getBleedBox()),
    spot_present:spots.has(workerData.spot),layer_present:layers.has(workerData.layer),engine:'pdf-lib@1.17.1'}});
})().catch(error=>{
  const code=String(error?.message??'');
  parentPort.postMessage({ok:false,code:resourceExceeded?'PDF_RESOURCE_LIMIT':code.startsWith('PDF_')?code:code.toLowerCase().includes('encrypt')?'PDF_ENCRYPTED':'PDF_MALFORMED'});
});
`;
