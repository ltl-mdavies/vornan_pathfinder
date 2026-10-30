import {createHash} from 'node:crypto';
function canonicalValue(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonicalValue);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonicalValue(v)]));
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Catalog data contains a non-finite number.');
 return value;
}
/** Byte-compatible with existing immutable catalog hashes; no change to submission code. */
export const reviewedDataHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
