import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
// In-memory, strict ustar subset: no filesystem extraction, links or extensions.
export function materialize(archive,manifest,{maxBytes=32*1024*1024}={}){
 if(!Buffer.isBuffer(archive)||archive.length>32*1024*1024||!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>64*1024*1024)throw Error('Archive bounds');
 const expected=new Map();
 for(const a of manifest){if(!/^(index\.html|(?:assets|fonts|brand)\/[A-Za-z0-9_.-]+)$/.test(a.path)||! /^[a-f0-9]{64}$/.test(a.sha256)||expected.has(a.path))throw Error('Manifest');expected.set(a.path,a.sha256);}
 if(!expected.size||expected.size>256)throw Error('Manifest bounds');
 const tar=gunzipSync(archive,{maxOutputLength:maxBytes}),files=new Map(),seen=new Set();let end=false;
 const field=b=>{const z=b.indexOf(0);if(z>=0&&b.subarray(z).some(x=>x!==0))throw Error('Field padding');return b.subarray(0,z<0?b.length:z).toString('ascii');};
 const oct=b=>{const s=b.toString('latin1');if(!/^ *[0-7]+[\x00 ]*$/.test(s))throw Error('Numeric field');const n=parseInt(s,8);if(!Number.isSafeInteger(n))throw Error('Numeric overflow');return n;};
 for(let offset=0;offset<tar.length;){
  const h=tar.subarray(offset,offset+512);if(h.length!==512)throw Error('Truncated header');
  if(h.every(x=>x===0)){if(tar.length-offset<1024||tar.subarray(offset).some(x=>x!==0))throw Error('Invalid terminator');end=true;break;}
  if(seen.size>260)throw Error('Entry count');
  let sum=0;for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:h[i];if(sum!==oct(h.subarray(148,156)))throw Error('Checksum');
  if(field(h.subarray(345,500))||field(h.subarray(157,257)))throw Error('Prefix/link');
  const name=field(h.subarray(0,100));if(!name.startsWith('./')||seen.has(name))throw Error('Path/duplicate');seen.add(name);
  const size=oct(h.subarray(124,136)),type=h[156],key=name.slice(2),start=offset+512,finish=start+size,next=start+Math.ceil(size/512)*512;
  if(next>tar.length)throw Error('Truncated body');
  if(type===53){if(size!==0||!['','assets/','fonts/','brand/'].includes(key))throw Error('Directory');}
  else if(type===48||type===0){if(!expected.has(key)||files.has(key))throw Error('Unexpected file');const b=Buffer.from(tar.subarray(start,finish));if(hash(b)!==expected.get(key))throw Error('File digest');files.set(key,b);}
  else throw Error('Unsupported entry type');
  offset=next;
 }
 if(!end||files.size!==expected.size)throw Error('Incomplete archive');return files;
}
