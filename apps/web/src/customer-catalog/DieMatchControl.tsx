import {useMaterialMappings} from './MaterialMappingContext';
import React,{useEffect,useRef,useState} from 'react';
import type {ItemData} from './catalog';
import {dieTierLabel,laserDieOpportunity,applyAutomaticDie,dieDecisionProblem,dieRequest,dieSignature,interpretDieMatch,manualDieOverride,readDieDecision,type DieMatchResult} from './die-matching';

export function DieMatchControl({data,onChange,url,disabled}:{data:ItemData;onChange:React.Dispatch<React.SetStateAction<ItemData>>;url?:string;disabled:boolean}){
 const mappings=useMaterialMappings();
 const [result,setResult]=useState<DieMatchResult|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0),[showAll,setShowAll]=useState(false);
 const latest=useRef(data);latest.current=data;
 const signature=dieSignature(data,mappings),decision=readDieDecision(data);
 let incomplete='';try{dieRequest(data,mappings);}catch(e){incomplete=(e as Error).message;}
 useEffect(()=>{
  if(disabled||!url||incomplete){setLoading(false);return;}
  let active=true;const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>;
  setLoading(true);setError('');setResult(null);setShowAll(false);
  const captured=data;
  const timer=setTimeout(()=>{
   timeout=setTimeout(()=>controller.abort(),15000);
   fetch(url,{method:'POST',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(dieRequest(captured,mappings))})
    .then(async response=>{if(!response.ok)throw new Error('Die check failed. Retry; your selection is preserved.');return response.json();})
    .then(payload=>{
     if(!active||dieSignature(latest.current,mappings)!==signature)return;
     const next=interpretDieMatch(payload,captured,new Date().toISOString(),mappings);setResult(next);
     if(next.kind!=='review')onChange(current=>{
      if(dieSignature(current,mappings)!==signature||readDieDecision(current)?.mode!=='automatic')return current;
      // Refresh automatic decisions only after a genuine specification change.
      if(readDieDecision(current)?.signature===signature)return current;
      return applyAutomaticDie(current,next,mappings);
     });
    }).catch(e=>{if(active)setError(e?.name==='AbortError'?'Die check timed out. Retry; your selection is preserved.':e instanceof Error?e.message:'Die check failed. Retry.');})
    .finally(()=>{clearTimeout(timeout);if(active)setLoading(false);});
  },400);
  return()=>{active=false;clearTimeout(timer);clearTimeout(timeout);controller.abort();};
 },[signature,url,disabled,retry,incomplete]);
 const current=result?.signature===signature?result:null;
 const eligible=current&&current.kind!=='review'&&!loading&&!error;
 const problem=dieDecisionProblem(data,mappings);
 const opportunity=!loading&&!error?laserDieOpportunity(data,current,mappings):'';
 return <section className="ci-die-matching" aria-label="Die matching">
  <div className="ci-die-toolbar"><strong>Die matching</strong><button type="button" disabled={disabled||!url||!!incomplete||loading} onClick={()=>setRetry(n=>n+1)}>{loading?'Checking…':'Check again'}</button>
   <button type="button" disabled={disabled||!eligible} onClick={()=>current&&onChange(value=>applyAutomaticDie({...value,dieDecision:undefined},current,mappings))}>{decision?.mode==='manual'?'Return to automatic':current?.kind==='exact'?'Use matched die':'Use Laser Cut'}</button>
   {decision?.mode!=='manual'&&<button type="button" disabled={disabled} onClick={()=>onChange(value=>manualDieOverride(value,'',new Date().toISOString(),mappings))}>Manual override</button>}
  </div>
  <p role="status">{!url?'Die matching is not connected.':incomplete||error||(loading?'Checking current specifications…':current?.message||'Preparing die check…')}</p>
  {opportunity&&<p className="ci-die-warning">{opportunity}</p>}
  {current&&!loading&&!error&&<small>Last checked {new Date(current.checkedAt).toLocaleString()}</small>}
  {!current?.candidates?.length&&current?.kind==='review'&&current.ids.length>0&&<p className="ci-die-candidates">Candidates: {current.ids.slice(0,6).join(', ')}{current.ids.length>6?` · ${current.ids.length-6} more`:''}. Use Cut type and Die to record an internal choice.</p>}
  {!!current?.candidates?.length&&!loading&&!error&&<details className="ci-die-options"><summary>Review die options · {current.candidates.length}</summary><p>Only a single exact match can be automatic. Other candidates need an internal override; custom outlines always need review.</p><div className="ci-die-option-list">{current.candidates.slice(0,showAll?undefined:6).map(candidate=><article key={candidate.id}><div><strong>{candidate.id}</strong><span className="ci-die-tier">{dieTierLabel(candidate.tier)}</span><small>{candidate.width||'—'} W × {candidate.height||'—'} H in · Gap {candidate.gap||'—'} in</small><small>{[candidate.shape,candidate.material,candidate.finishing].filter(Boolean).join(' · ')||'Additional library details not supplied'}</small></div><button type="button" disabled={disabled} onClick={()=>onChange(value=>manualDieOverride({...value,cut:'Diecut',die:candidate.id},'',new Date().toISOString(),mappings))}>Choose with override</button></article>)}</div>{current.candidates.length>6&&<button type="button" onClick={()=>setShowAll(v=>!v)}>{showAll?'Show fewer':`Show all ${current.candidates.length} dies`}</button>}</details>}
  {decision?.mode==='manual'?<div className="ci-die-override"><small>Manual override · {decision.die||data.cut}{decision.actor?` · ${decision.actor}`:''}</small><label>Override reason<input aria-label="Die override reason" maxLength={1000} value={decision.reason} disabled={disabled} placeholder="Why is this cutting selection needed?" onChange={e=>{const reason=e.target.value;onChange(value=>({...value,dieDecision:JSON.stringify({...readDieDecision(value),reason})}));}}/></label>
   {decision.signature!==signature&&<button type="button" disabled={disabled||!decision.reason.trim()} onClick={()=>onChange(value=>manualDieOverride(value,decision.reason,new Date().toISOString(),mappings))}>Confirm override for these specifications</button>}
  </div>:decision&&<small>Automatic · {decision.basis} · {decision.die||'Laser Cut'}</small>}
  <small>Selections are saved with the item’s change reason. Matching never approves an order.</small>
  {problem&&<p className="ci-die-warning">{problem}</p>}
 </section>;
}
