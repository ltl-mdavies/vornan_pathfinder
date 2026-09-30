/** Executed in a terminable worker with a bounded V8 heap. No URLs, filesystem writes, or PDF scripts are executed. */
export const pdfWorkerSource = String.raw`
const {parentPort,workerData}=require('node:worker_threads');
const {PDFDocument,PDFName,PDFDict,PDFArray,PDFStream,PDFNumber,PDFString,PDFHexString,decodePDFRawStream}=require(workerData.library);
let resourceExceeded=false;
const fail=code=>{if(code==='PDF_RESOURCE_LIMIT')resourceExceeded=true;throw new Error(code);};
// This inspector never needs date metadata; prevent the upstream untriaged parseDate path.
require(require('node:path').join(require('node:path').dirname(workerData.library),'utils/strings.js')).parseDate=()=>fail('PDF_DATE_METADATA_UNSUPPORTED');
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
  const spots=new Set(),layers=new Set(),spaces=new Set(),profiles=[];
  let unprofiledRgb=false,colorReview=false;
  const decoded=stream=>{const b=Buffer.from(decodePDFRawStream(stream).decode());if(b.length>8*1024*1024)fail('PDF_RESOURCE_LIMIT');return b;};
  function inspectColor(raw,depth=0){
    if(!workerData.reviewColor)return false;
    if(depth>8)fail('PDF_RESOURCE_LIMIT');
    const c=context.lookup(raw);
    if(c instanceof PDFName){const n=c.decodeText();spaces.add(n);if(n==='DeviceRGB')unprofiledRgb=true;return false;}
    if(!(c instanceof PDFArray)){colorReview=true;return false;}
    const name=c.lookup(0).decodeText();spaces.add(name);
    if(name==='ICCBased'){
      const stream=c.lookup(1);if(!(stream instanceof PDFStream)){colorReview=true;return false;}
      const b=decoded(stream),n=stream.dict.lookupMaybe(PDFName.of('N'),PDFNumber)?.asNumber();
      const valid=b.length>=132 && b.readUInt32BE(0)===b.length && b.toString('ascii',36,40)==='acsp' &&
        ((n===3 && b.toString('ascii',16,20)==='RGB ') || (n===4 && b.toString('ascii',16,20)==='CMYK') || (n===1 && b.toString('ascii',16,20)==='GRAY'));
      let description=null;
      if(valid){const count=b.readUInt32BE(128);if(count>256 || 132+count*12>b.length)fail('PDF_ICC_INVALID');
        for(let i=0;i<count;i++){const pos=132+i*12,off=b.readUInt32BE(pos+4),len=b.readUInt32BE(pos+8);if(off+len>b.length)fail('PDF_ICC_INVALID');
          if(b.toString('ascii',pos,pos+4)==='desc' && len>=12 && b.toString('ascii',off,off+4)==='desc'){
            const size=b.readUInt32BE(off+8);if(size>0 && size<=256 && 12+size<=len)description=b.toString('ascii',off+12,off+12+size).replace(/\0/g,'');
          }
        }
      }
      if(profiles.length>=128)fail('PDF_RESOURCE_LIMIT');
      profiles.push({components:n??null,bytes:b.length,valid,description,sha256:require('node:crypto').createHash('sha256').update(b).digest('hex')});
      if(!valid)colorReview=true;
      return valid && n===3;
    }
    if(name==='Separation' || name==='DeviceN')return false; // Spot alternate is not the artwork's RGB policy.
    if(name==='Indexed')return inspectColor(c.get(1),depth+1);
    colorReview=true;return false;
  }
  function contentColors(raw,defaultRgb){
    if(!workerData.reviewColor)return;
    if(!raw)return;
    const obj=context.lookup(raw);
    if(obj instanceof PDFArray){for(const v of obj.asArray())contentColors(v,defaultRgb);return;}
    if(!(obj instanceof PDFStream))return;
    const data=decoded(obj).toString('latin1');
    // Conservative bounded token scan, not a full PDF graphics interpreter.
    const tokens=data.split(/\s+/);if(tokens.length>200000)fail('PDF_RESOURCE_LIMIT');
    const numeric=t=>typeof t==='string' && t.length<64 && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t);
    for(let i=0;i<tokens.length;i++){
      const op=tokens[i];
      if((op==='rg'||op==='RG') && tokens.slice(Math.max(0,i-3),i).length===3 && tokens.slice(i-3,i).every(numeric)){spaces.add('DeviceRGB');if(!defaultRgb)unprofiledRgb=true;}
      if((op==='k'||op==='K') && i>=4 && tokens.slice(i-4,i).every(numeric))spaces.add('DeviceCMYK');
      if(op==='BI')colorReview=true;
    }
  }
  const seen=new Set();let visited=0;
  const text=value=>value instanceof PDFName?value.decodeText():value instanceof PDFString || value instanceof PDFHexString?value.decodeText():null;
  function resources(raw,depth,contents){
    if(depth>12)fail('PDF_RESOURCE_LIMIT');
    const dict=context.lookup(raw);if(!(dict instanceof PDFDict)){if(workerData.reviewColor)colorReview=true;return;}
    if(++visited>10000)fail('PDF_RESOURCE_LIMIT');
    const colors=dict.lookupMaybe(PDFName.of('ColorSpace'),PDFDict);
    let defaultRgb=false;
    if(colors && colors.get(PDFName.of('DefaultRGB')))defaultRgb=inspectColor(colors.get(PDFName.of('DefaultRGB')));
    contentColors(contents,defaultRgb);
    if(seen.has(dict))return;seen.add(dict);
    if(colors)for(const [,raw]of colors.entries()){
      inspectColor(raw);
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
      if(stream instanceof PDFStream){
        if(text(stream.dict.lookup(PDFName.of('Subtype')))==='Form')resources(stream.dict.get(PDFName.of('Resources'))??dict,depth+1,stream);
        if(text(stream.dict.lookup(PDFName.of('Subtype')))==='Image')inspectColor(stream.dict.get(PDFName.of('ColorSpace')));
      }
    }
  }
  resources(page.node.Resources(),0,page.node.Contents());
  // Presence is limited to page/form resources, not an arbitrary string or unused catalog entry.
  parentPort.postMessage({ok:true,value:{pages:pages.length,media_in:box(page.getMediaBox()),trim_in:box(page.getTrimBox()),bleed_in:box(page.getBleedBox()),
    color:{spaces:[...spaces].sort(),icc_profiles:profiles,unprofiled_rgb:unprofiledRgb,review_required:colorReview},
    spot_present:spots.has(workerData.spot),layer_present:layers.has(workerData.layer),engine:'pdf-lib@1.17.1'}});
})().catch(error=>{
  const code=String(error?.message??'');
  parentPort.postMessage({ok:false,code:resourceExceeded?'PDF_RESOURCE_LIMIT':code.startsWith('PDF_')?code:code.toLowerCase().includes('encrypt')?'PDF_ENCRYPTED':'PDF_MALFORMED'});
});
`;
