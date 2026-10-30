import {useMaterialMappings} from './MaterialMappingContext';
import React, {useEffect, useId, useRef, useState} from 'react';
import {ArrowUpRight, CheckCircle2, FileText, Image as ImageIcon, Upload, X} from 'lucide-react';
import {money, safeUrl, validateItem, type Item, type ItemData} from './catalog';
import './catalog-item-modal.css';
import type {ArtworkDraft} from './artwork-draft';
import {DEFAULT_CHANGE_REASONS,recordChangeReason,type ChangeReasonOption} from './change-reasons';
import {resolvedCutComplexity,cutComplexityOptions,updateCutGeometry,cutKind,productionData,parseDieList,type DieChoice} from './production-fields';
import {approveArtwork,revokeArtworkApproval,readArtworkConfirmation,readArtworkVersion,artworkApprovalProblem,verifyProductionArtwork,attachArtworkVersion,artworkEvidenceLabel} from './artwork-approval';
import {DieMatchControl} from './DieMatchControl';
import {manualDieOverride,dieDecisionLabel} from './die-matching';

type Props = {
  artworkEditingEnabled?: boolean;
  saveRecoveryPending?: boolean;
  item: Item;
  customerName: string;
  readOnly: boolean;
  internalUser?: boolean;
  dieListUrl?: string;
  dieMatchUrl?: string;
  artworkVerifyUrl?:string;
  changeReasons?:readonly ChangeReasonOption[];
  initialDraft?: ArtworkDraft;
  onSaveDraft?: (draft:ArtworkDraft|null) => Promise<void>;
  onClose: () => void;
  onSave: (data: ItemData, expectedRevision: number, reasonId: string, reasonDetails: string, draft?:ArtworkDraft) => Promise<Item>;
};
type Mode = 'details' | 'history' | 'upload' | 'pending';
const fields: [keyof ItemData, string][] = [
  ['product','Product'], ['width','Width (in)'], ['height','Height (in)'],
  ['shape','Shape'], ['cornerRadius','Corner Radius (in)'], ['spacing','Spacing (in)'],
  ['material','Material'], ['laminate','Laminate'], ['varnish','Varnish'],
  ['cut','Cut type'], ['corners','Cut complexity'], ['die','Die'], ['unwind','Unwind direction'],
  ['rollMode','Roll requirement'], ['rollValue','Roll limit'],
];
const labels = Object.fromEntries([...fields, ['sku','Customer SKU'], ['name','Item name'], ['price','Unit price (USD)'], ['whiteInk','White Ink'], ['die','Die'], ['approval','Print approval']]);
function Preview({url,name}: {url:string;name:string}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[url]);
  return url&&!failed?<img src={url} alt={name} referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<div className="ci-art-placeholder"><ImageIcon size={36}/><span>Preview unavailable</span></div>;
}
export function CatalogItemModal({saveRecoveryPending=false,artworkEditingEnabled=true,item,customerName,readOnly,internalUser=false,dieListUrl,dieMatchUrl,artworkVerifyUrl,changeReasons=DEFAULT_CHANGE_REASONS,initialDraft,onSaveDraft,onClose,onSave}:Props) {
 const mappings=useMaterialMappings();
  const [saved,setSaved]=useState({...item,data:productionData(item)});
  const [data,setData]=useState(productionData(item));
  const [dies,setDies]=useState<DieChoice[]>([]);
  const [dieStatus,setDieStatus]=useState('');
  const [dieAttempt,setDieAttempt]=useState(0);
  const [dieLoading,setDieLoading]=useState(false);
  const [reasonId,setReasonId]=useState('');
  const [reasonDetails,setReasonDetails]=useState('');
  const [reasonOpen,setReasonOpen]=useState(false);
  const reasonDialog=useRef<HTMLDialogElement>(null);
  const reasonTitleId=useId();
  const [mode,setMode]=useState<Mode>(initialDraft?(initialDraft.previewing?'pending':'upload'):'details');
  const [revisionOpen,setRevisionOpen]=useState(!!initialDraft);
  const [storedDraft,setStoredDraft]=useState(initialDraft);
  const closeAfterSave=useRef(false);
  const attemptedData=useRef<string|null>(null);
  const focusTab=useRef(false);
  const [saving,setSaving]=useState(false);
  const [verifyingArt,setVerifyingArt]=useState(false),[artCheckError,setArtCheckError]=useState('');
  const artController=useRef<AbortController|null>(null);
  useEffect(()=>()=>artController.current?.abort(),[]);
  const [saveError,setError]=useState('');
  const [validationError,setValidationError]=useState('');
  const error=saveError||validationError;
  useEffect(()=>setValidationError(''),[data]);
  const [file,setFile]=useState<File|null>(initialDraft?.file??null);
  const [fileUrl,setFileUrl]=useState('');
  const [fileError,setFileError]=useState('');
  const [revisionNote,setRevisionNote]=useState(initialDraft?.note??'');
  const [pending,setPending]=useState(initialDraft?.previewing??false);
  const [revisionApproval,setRevisionApproval]=useState<ItemData['approval']>(internalUser?(initialDraft?.approval??'pending'):'pending');
  const [discard,setDiscard]=useState<false|'item'|'revision'>(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const confirmation=useRef<HTMLDialogElement>(null);
  const picker=useRef<HTMLInputElement>(null);
  const details=useRef<HTMLElement>(null);
  const savingLock=useRef(false);
  const titleId=useId(),confirmId=useId(),tabId=useId();
  const changed=JSON.stringify(data)!==JSON.stringify(saved.data);
  const dirty=changed||revisionOpen;
  const artworkChanged=revisionOpen&&(!storedDraft||file!==storedDraft.file||revisionNote!==storedDraft.note||revisionApproval!==storedDraft.approval||pending!==storedDraft.previewing);
  const revisionDraft=():ArtworkDraft=>({file,note:revisionNote,approval:internalUser?revisionApproval:'pending',previewing:pending,baseRevision:saved.revision,savedAt:new Date().toISOString()});
  const source=safeUrl(saved.data.artwork);
  const preview=safeUrl(saved.data.preview);
  const approved=saved.data.approval==='approved';
  const cut=cutKind(data.cut);
  const confirmedArt=readArtworkConfirmation(data,item.key);
  const verifiedArt=readArtworkVersion(data),approvalProblem=artworkApprovalProblem(data,item.key);
  const verifyArt=async()=>{
    if(readOnly||!internalUser||verifyingArt||saving)return;
    const controller=new AbortController();artController.current=controller;setVerifyingArt(true);setArtCheckError('');
    const timer=setTimeout(()=>controller.abort(),30000);
    try{const version=await verifyProductionArtwork(data.artwork,controller.signal,artworkVerifyUrl);if(!controller.signal.aborted)setData(current=>attachArtworkVersion(current,version));}
    catch(e){if(artController.current===controller)setArtCheckError(e instanceof Error&&e.name==='AbortError'?'File verification timed out. Try again.':'Could not verify this file. Check source access; no approval was recorded.');}
    finally{clearTimeout(timer);if(artController.current===controller){artController.current=null;setVerifyingArt(false);}}
  };
  const approveCurrent=()=>{try{setData(current=>approveArtwork(current,item.key,new Date().toISOString(),internalUser));setError('');}catch(e){setError((e as Error).message);}};

  const currentArtwork=mode==='details'||mode==='history';
  const activeTab=currentArtwork?mode:'revision';
  const savedAt=revisionOpen&&!changed?storedDraft?.savedAt??saved.history.at(-1)?.at:saved.history.at(-1)?.at;
  const savedDate=savedAt?new Date(savedAt):null;
  const lastSaved=savedDate&&Number.isFinite(savedDate.getTime())?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(savedDate):null;
  const saveStatus=saving?'Saving…':error?(error.includes('unconfirmed')?'Save unconfirmed':'Save failed'):changed?'Unsaved changes':artworkChanged?'Artwork draft not saved':revisionOpen?'Artwork draft saved locally':'Saved';
  const close=()=>{if(savingLock.current||verifyingArt)return;if(saveRecoveryPending&&!revisionOpen&&attemptedData.current===JSON.stringify(data)){onClose();return;}if(dirty)setDiscard('item');else onClose();};
  const startRevision=()=>{setRevisionOpen(true);setMode(pending?'pending':'upload');focusTab.current=true;};
  const clearRevision=()=>{setStoredDraft(undefined);setFile(null);setFileUrl('');setFileError('');setRevisionNote('');setRevisionApproval('pending');setPending(false);setRevisionOpen(false);setDiscard(false);setMode('details');focusTab.current=true;};
  const finishRevision=async()=>{
    if(savingLock.current)return;
    savingLock.current=true;setSaving(true);setError('');
    try{if(storedDraft){if(!onSaveDraft)throw new Error('Draft storage is unavailable.');await onSaveDraft(null);}clearRevision();}
    catch(err){setError(err instanceof Error?err.message:'Could not discard this draft. Try again.');}
    finally{savingLock.current=false;setSaving(false);}
  };
  const cancelRevision=()=>{if(file||revisionNote.trim()||storedDraft)setDiscard('revision');else clearRevision();};
  const discardAndClose=async()=>{
    if(savingLock.current)return;
    savingLock.current=true;setSaving(true);setError('');
    try{if(storedDraft){if(!onSaveDraft)throw new Error('Draft storage is unavailable.');await onSaveDraft(null);}onClose();}
    catch(err){setError(err instanceof Error?err.message:'Could not discard this draft. Try again.');}
    finally{savingLock.current=false;setSaving(false);}
  };
  const saveAndClose=async()=>{
    if(readOnly||savingLock.current||verifyingArt)return;
    setError('');
    if(changed){
      const invalid=validateItem(data,mappings).find(issue=>issue.severity==='error');
      if(invalid){setDiscard(false);setMode('details');setValidationError(invalid.message);return;}
      closeAfterSave.current=true;setDiscard(false);setReasonOpen(true);return;
    }
    savingLock.current=true;setSaving(true);
    try{if(revisionOpen){if(!onSaveDraft)throw new Error('Artwork draft saving is not connected in this view. Keep editing or discard the draft.');await onSaveDraft(revisionDraft());}onClose();}
    catch(err){setError(err instanceof Error?err.message:'Could not save the artwork draft. Try again.');}
    finally{savingLock.current=false;setSaving(false);}
  };
  const cancelSave=()=>{if(!savingLock.current){closeAfterSave.current=false;setReasonOpen(false);}};
  useEffect(()=>{if(focusTab.current){document.getElementById(`${tabId}-${activeTab}`)?.focus();focusTab.current=false;}},[activeTab,revisionOpen]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const modal=dialog.current;
    modal?.showModal();
    return()=>{modal?.close();previous?.focus();};
  },[]);
  useEffect(()=>{if(discard)confirmation.current?.showModal();else confirmation.current?.close();},[discard]);
  useEffect(()=>{details.current?.scrollTo(0,0);},[mode]);
  useEffect(()=>{
    if(!reasonOpen)return;
    const previous=document.activeElement as HTMLElement|null;
    reasonDialog.current?.showModal();
    return()=>{reasonDialog.current?.close();previous?.focus();};
  },[reasonOpen]);
  useEffect(()=>{
    if(!file||!file.type.startsWith('image/')){setFileUrl('');return;}
    const url=URL.createObjectURL(file);setFileUrl(url);
    return()=>URL.revokeObjectURL(url);
  },[file]);
  const selectFile=(next?:File)=>{
    if(readOnly||!next||pending)return;
    if(!/\.(pdf|png|jpe?g)$/i.test(next.name)||!['application/pdf','image/png','image/jpeg'].includes(next.type)){
      setFileError('Choose a PDF, PNG, or JPEG file.');return;
    }
    if(!next.size||next.size>50*1024*1024){setFileError('Choose a non-empty file up to 50 MB.');return;}
    setFile(next);setRevisionApproval('pending');setFileError('');
  };
  useEffect(()=>{
    if(!internalUser||cut!=='die'||!dieListUrl)return;
    const controller=new AbortController();let active=true;
    const timer=setTimeout(()=>controller.abort(),15000);
    setDieLoading(true);setDieStatus('');
    fetch(dieListUrl,{signal:controller.signal,credentials:'omit'}).then(async response=>{
      if(!response.ok)throw new Error('Could not load the die library.');
      return parseDieList(await response.json());
    }).then(result=>{if(active){setDies(result.choices);setDieStatus(result.excluded?'Some library entries are unavailable. Compatibility is not yet checked.':'');}})
      .catch(()=>{if(active){setDies([]);setDieStatus('Die library unavailable. Your saved selection is preserved.');}})
      .finally(()=>{clearTimeout(timer);if(active)setDieLoading(false);});
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[internalUser,cut,dieListUrl,dieAttempt]);
  const select=(key:keyof ItemData,label:string,options:{value:string;label:string}[])=>{
    const value=key==='corners'?resolvedCutComplexity(data):data[key]??'';
    return <label key={key}>{label}<select aria-label={label} value={value} disabled={readOnly||saving} onChange={e=>setData(key==='cut'?manualDieOverride({...data,[key]:e.target.value},'',new Date().toISOString(),mappings):internalUser&&['shape','cornerRadius','corners'].includes(key)?updateCutGeometry(data,key as 'shape'|'cornerRadius'|'corners',e.target.value):{...data,[key]:e.target.value})}>
      <option value="">Not specified</option>{value&&!options.some(o=>o.value===value)&&<option value={value}>{value} · current value</option>}
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select></label>;
  };
  const field=(key:keyof ItemData,label:string)=> <label key={key}>{label}<input
    value={data[key]??''} placeholder={key==='spacing'?'0.125 default':undefined} disabled={readOnly||saving} inputMode={['width','height','price','spacing'].includes(key)?'decimal':undefined}
    onChange={e=>{setData({...data,[key]:e.target.value});}}/></label>;
  const requestSave=(e:React.FormEvent)=>{
    e.preventDefault();if(readOnly||savingLock.current||verifyingArt||!changed)return;
    const invalid=validateItem(data,mappings).find(issue=>issue.severity==='error');
    if(invalid){setValidationError(invalid.message);return;}
    closeAfterSave.current=false;setError('');setReasonOpen(true);
  };
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();if(readOnly||savingLock.current||verifyingArt||!changed||!reasonOpen)return;
    try{recordChangeReason(changeReasons,reasonId,reasonDetails);}catch(err){setError((err as Error).message);return;}
    savingLock.current=true;setSaving(true);setError('');
    try {
      const draft=closeAfterSave.current&&revisionOpen?revisionDraft():undefined;
      if(draft&&!onSaveDraft)throw new Error('Artwork draft saving is not connected in this view.');
      attemptedData.current=JSON.stringify(data);
      const next=await onSave({...data},saved.revision,reasonId,reasonDetails,draft);
      setSaved(next);setData({...next.data});setReasonId('');setReasonDetails('');setReasonOpen(false);
      if(closeAfterSave.current){closeAfterSave.current=false;onClose();}
    }catch(err){setError(err instanceof Error?err.message:'Could not save this item. Try again.');}
    finally{savingLock.current=false;setSaving(false);}
  };
  return <div className="ci-page"><dialog ref={dialog} className="ci-dialog" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close();}}>
    <header className="ci-header"><div><div className="ci-identity"><span>{customerName}</span><span>{saved.data.sku}</span><span className="ci-header-price"><b>{money(saved.data.price)}</b> / label</span><span className={`ci-pill ${approved?'':'ci-amber'}`}>{approved?'Approved for print':'Pending approval'}</span><span>Item revision {saved.revision}</span></div><h2 id={titleId}>{saved.data.name}</h2></div><button className="ci-icon" aria-label="Close item details" disabled={saving||verifyingArt} onClick={close}><X size={20}/></button></header>
    <form className="ci-form" onSubmit={requestSave}>
      <div className="ci-body"><section className="ci-artwork" aria-label="Artwork">
        <div className="ci-section-title"><h3>{currentArtwork?'Current artwork':mode==='upload'?'Revised artwork':'Revision review preview'}</h3>{currentArtwork?(source?<a className="ci-source" href={source} target="_blank" rel="noreferrer">Open source artwork<ArrowUpRight size={14}/></a>:<span className="ci-missing-file">No production file</span>):<span className="ci-pill ci-amber">{pending?(revisionApproval==='approved'?'Approved · preview':'Pending · preview'):'Draft · preview'}</span>}</div>
        <div className="ci-artboard">{currentArtwork?<Preview url={preview} name={`${saved.data.name} current artwork`}/>:fileUrl?<Preview url={fileUrl} name={`${file?.name} revised artwork preview`}/>:<div className="ci-art-placeholder"><FileText size={36}/><strong>{file?'PDF selected':'Add revised artwork'}</strong><span>{file?'Proof preview will be prepared during review.':'Current artwork stays unchanged.'}</span></div>}</div>
        <div className="ci-art-actions">{currentArtwork?
          <>{internalUser&&<div className="ci-approval-control"><div><span>Approved for print</span><small>{data.approval==='approved'?(approvalProblem?(verifiedArt?'Confirm approval for this file':'File approval needs verification'):confirmedArt?'Artwork confirmed':'Approval bound to file'):'Pending approval'}{data.approval!==saved.data.approval?' · unsaved':''}</small></div><button type="button" role="switch" aria-label="Approved for print" aria-checked={data.approval==='approved'} className="ci-approval-switch" disabled={!artworkEditingEnabled||readOnly||saving||verifyingArt||!source||(data.approval!=='approved'&&!verifiedArt)} title={!source?'A production file is needed to change approval':undefined} onClick={()=>data.approval==='approved'?setData(revokeArtworkApproval(data)):approveCurrent()}><span/></button></div>}{artworkEditingEnabled&&internalUser&&source&&!confirmedArt&&<div className="ci-art-verification"><div><button type="button" disabled={readOnly||saving||verifyingArt} onClick={()=>void verifyArt()}>{verifyingArt?'Verifying file…':verifiedArt?'Recheck production file':'Verify production file'}</button>{verifiedArt&&data.approval==='approved'&&approvalProblem&&<button type="button" disabled={readOnly||saving||verifyingArt} onClick={approveCurrent}>Confirm approval for this file</button>}</div><small role="status" title={verifiedArt?`SHA-256: ${verifiedArt.sha256}`:undefined}>{artCheckError|| (verifiedArt?'Production file verified':'File verification is needed to bind approval.')}</small></div>}{artworkEditingEnabled&&!readOnly&&<button type="button" className="ci-primary ci-wide" disabled={saving} onClick={startRevision}><Upload size={16}/>{pending?'View revision preview':file?'Continue artwork revision':'Upload revised artwork'}</button>}</>
        :<><div className="ci-revision-file" title={file?.name}><strong>{file?.name??'No file selected'}</strong><span>{file?`${(file.size/1024/1024).toFixed(2)} MB`:'PDF, PNG, or JPEG'}</span></div><div className="ci-approved-reference"><Preview url={preview} name={`${saved.data.name} current artwork thumbnail`}/><div><strong>{approved?'Current artwork remains approved':'Current artwork remains pending approval'}</strong></div></div></>}</div>
      </section>
      <div className="ci-right"><div className="ci-modal-tabs" role="tablist" aria-label="Item workspace" onKeyDown={e=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
        e.preventDefault();const tabs=revisionOpen?['details','history','revision']:['details','history'];const index=tabs.indexOf(activeTab);
        const next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length];
        setMode(next==='revision'?(pending?'pending':'upload'):next as Mode);document.getElementById(`${tabId}-${next}`)?.focus();
      }}>
        <button type="button" role="tab" id={`${tabId}-details`} aria-selected={activeTab==='details'} aria-controls={`${tabId}-panel`} tabIndex={activeTab==='details'?0:-1} onClick={()=>setMode('details')}>Item details</button>
        <button type="button" role="tab" id={`${tabId}-history`} aria-selected={activeTab==='history'} aria-controls={`${tabId}-panel`} tabIndex={activeTab==='history'?0:-1} onClick={()=>setMode('history')}>Change history <span>{saved.history.length}</span></button>
        {revisionOpen&&<button type="button" className="ci-revision-tab" role="tab" id={`${tabId}-revision`} aria-selected={activeTab==='revision'} aria-controls={`${tabId}-panel`} tabIndex={activeTab==='revision'?0:-1} onClick={()=>setMode(pending?'pending':'upload')}>Revised artwork</button>}
      </div><section ref={details} className="ci-details" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${activeTab}`} tabIndex={0}>
        {mode==='details'?<><div className="ci-fields">{field('name','Item name')}{field('sku','Customer SKU')}</div>
          <h3 className="ci-group-title">Print specifications</h3><div className="ci-fields ci-thirds">{fields.filter(([key])=>internalUser||!['cut','corners','die'].includes(key)).map(([key,label])=>key==='shape'?select('shape','Shape',[{value:'Square/Rectangle',label:'Square/Rectangle'},{value:'Circle/Oval',label:'Circle/Oval'},{value:'Custom',label:'Contour Cut to Shape'}]):key==='cornerRadius'?(data.shape==='Square/Rectangle'?select('cornerRadius','Corner Radius (in)',[{value:'Square',label:'Square'},{value:'1/16',label:'1/16'},{value:'1/8',label:'1/8'}]):null):key==='cut'?select('cut','Cut type', [{value:'Diecut',label:'Die Cut'},{value:'Laser',label:'Laser Cut'},{value:'Zund',label:'Zund Cut'}]):key==='corners'?select('corners','Cut complexity',cutComplexityOptions(data.shape??'')):key==='die'?(cut==='die'?<label key="die">Die<select aria-label="Die" value={data.die??''} disabled={readOnly||saving||dieLoading||!dieListUrl||!dies.length} onChange={e=>setData(manualDieOverride({...data,die:e.target.value},'',new Date().toISOString(),mappings))}><option value="">{dieLoading?'Loading dies…':'Select a die'}</option>{data.die&&!dies.some(d=>d.id===data.die)&&<option value={data.die}>{data.die} · current reference</option>}{dies.map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>:null):field(key,label))}{internalUser&&select('whiteInk','White Ink',[{value:'Yes',label:'Yes'},{value:'No',label:'No'}])}</div>
          {internalUser&&<DieMatchControl data={data} onChange={setData} url={dieMatchUrl} disabled={readOnly||saving}/>}
          {cut==='die'&&dieStatus.startsWith('Die library unavailable')&&<div className="ci-error" role="alert">Could not load dies. <button type="button" className="ci-back" onClick={()=>setDieAttempt(n=>n+1)}>Retry</button></div>}
        </>:mode==='history'?<div className="ci-history">{!saved.history.length?<p className="ci-empty-history">No item changes recorded yet.</p>:saved.history.slice().reverse().map((h,i)=><article key={i}><strong>{h.changeReason?.label??h.reason}</strong>{h.changeReason?.details&&<p className="ci-history-context">{h.changeReason.details}</p>}<small>{new Date(h.at).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'})} · {h.actor}</small><dl>{(Object.keys(h.after) as (keyof ItemData)[]).filter(k=>h.after[k]!==h.before[k]&&(internalUser||!['whiteInk','die','cut','corners','dieDecision','artworkVersion','artworkApproval','artworkConfirmation'].includes(k))).map(k=><div key={k}><dt>{k==='dieDecision'?'Cutting decision':k==='artworkVersion'?'Production file':k==='artworkApproval'?'File approval':k==='artworkConfirmation'?'Artwork confirmation':labels[k]??k}</dt><dd>{k==='dieDecision'?dieDecisionLabel(h.before[k]):['artworkVersion','artworkApproval','artworkConfirmation'].includes(k)?artworkEvidenceLabel(h.before[k]):h.before[k]||'Blank'} → {k==='dieDecision'?dieDecisionLabel(h.after[k]):['artworkVersion','artworkApproval','artworkConfirmation'].includes(k)?artworkEvidenceLabel(h.after[k]):h.after[k]||'Blank'}</dd></div>)}</dl></article>)}</div>:mode==='upload'?<><h3 className="ci-flow-title">Upload revised artwork</h3><p className="ci-description">Prepare a new revision while keeping the current artwork and specifications intact.</p>
          <div className="ci-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();selectFile(e.dataTransfer.files[0]);}}><Upload size={25}/><strong>{file?'Artwork selected':'Drop artwork here'}</strong><span>PDF, PNG, or JPEG · up to 50 MB</span><button type="button" onClick={()=>picker.current?.click()}>{file?'Choose a different file':'Choose file'}</button><input ref={picker} type="file" accept=".pdf,.png,.jpg,.jpeg" aria-label="Choose revised artwork" hidden onChange={e=>{selectFile(e.target.files?.[0]);e.target.value='';}}/></div>
          {fileError&&<p className="ci-error" role="alert">{fileError}</p>}
          {internalUser&&<div className="ci-approval-control ci-revision-approval"><div><span>Approved for print</span><small>{revisionApproval==='approved'?'Approved for print':'Pending approval'} · revised file</small></div><button type="button" role="switch" aria-label="Revised artwork approved for print" aria-checked={revisionApproval==='approved'} className="ci-approval-switch" disabled={readOnly||!file} onClick={()=>setRevisionApproval(revisionApproval==='approved'?'pending':'approved')}><span/></button></div>}
          <label className="ci-notes">What changed? (required)<textarea value={revisionNote} onChange={e=>setRevisionNote(e.target.value)} rows={3} placeholder="Describe the artwork changes for the reviewer."/></label>
          <div className="ci-info"><CheckCircle2 size={17}/><div><strong>Preview the review flow</strong><p>Save a draft when closing to resume here later in this browser. Nothing is submitted, approved, or substituted for production.</p></div></div>
        </>:<><h3 className="ci-flow-title">{revisionApproval==='approved'?'Approved for print · preview':'Pending review · preview'}</h3><p className="ci-description">This is how the revision will appear after submission. No file has been sent for review. Finish preview discards this draft and returns to item details.</p><div className="ci-review-summary"><span className={`ci-pill ${revisionApproval==='approved'?'':'ci-amber'}`}>{revisionApproval==='approved'?'Approved for print · preview':'Pending artwork review · preview'}</span><h4>Proposed artwork revision</h4><p>{file?.name}</p><div><span>Revision note</span><strong>{revisionNote}</strong></div></div>{revisionApproval==='pending'&&<ol className="ci-steps"><li><span className="ci-step-dot"/><div><strong>Prepress review</strong><span>Check artwork and prepare a proof</span></div></li><li><span className="ci-step-dot"/><div><strong>Proof approval</strong><span>Approve the new revision for production</span></div></li></ol>}<div className="ci-info"><CheckCircle2 size={17}/><div><strong>Current artwork is preserved</strong><p>Catalog approval and existing order artwork have not changed.</p></div></div><button type="button" className="ci-secondary" onClick={()=>{setPending(false);setMode('upload');}}>Edit revision draft</button></>}
      </section></div></div>
      <footer className="ci-footer"><div className="ci-save-message" role="status" aria-live="polite"><div><span className={`ci-save-status ${error?'ci-error':''}`}><span className={`ci-status-dot ${saving||changed||artworkChanged?'ci-status-pending':''}`}/>{saveStatus}</span>{lastSaved?<time dateTime={savedAt}>Last saved {lastSaved}</time>:<span className="ci-save-time">Last save not recorded</span>}</div>{error&&<span role="alert" className="ci-error">{error}</span>}</div><div className="ci-footer-actions">
        {currentArtwork&&<div className="ci-footer-price">{field('price','Unit price (USD)')}</div>}
        <button type="button" disabled={saving} onClick={currentArtwork?close:cancelRevision}>{currentArtwork?(readOnly?'Close':'Cancel'):'Cancel revision'}</button>
        {currentArtwork?!readOnly&&<button className="ci-primary" type="submit" disabled={saving||!changed}>{saving?'Saving…':'Save changes'}</button>:<>{mode==='pending'&&<button type="button" className="ci-primary" disabled={saving} onClick={cancelRevision}>Finish preview</button>}{mode==='upload'&&<button type="button" className="ci-primary" disabled={!file||!revisionNote.trim()} onClick={()=>{setPending(true);setMode('pending');}}>Preview submission</button>}</>}
      </div></footer>
    </form>
    <dialog ref={reasonDialog} className="ci-reason-dialog" aria-labelledby={reasonTitleId} onCancel={e=>{e.preventDefault();e.stopPropagation();cancelSave();}}>
      <form onSubmit={save}><header><h3 id={reasonTitleId}>Reason for update</h3><button type="button" className="ci-icon" aria-label="Close save prompt" disabled={saving} onClick={cancelSave}><X size={19}/></button></header>
        <label>Reason (required)<select aria-label="Reason (required)" autoFocus required value={reasonId} disabled={saving} onChange={e=>setReasonId(e.target.value)}><option value="">Select a reason</option>{changeReasons.filter(option=>option.active).map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Additional details (optional)<textarea value={reasonDetails} maxLength={2000} rows={3} disabled={saving} onChange={e=>setReasonDetails(e.target.value)} placeholder="Add context for this update"/></label>
        {!changeReasons.some(option=>option.active)&&<p role="alert" className="ci-error">No change reasons are available. Ask an administrator to add one.</p>}
        {error&&<p role="alert" className="ci-error">{error}</p>}
        <footer><button type="button" disabled={saving} onClick={cancelSave}>Back to item</button><button className="ci-primary" type="submit" disabled={readOnly||saving||!changeReasons.some(option=>option.id===reasonId&&option.active)}>{saving?'Saving…':'Confirm save'}</button></footer>
      </form>
    </dialog>
    <dialog ref={confirmation} className="ci-discard" aria-labelledby={confirmId} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!savingLock.current)setDiscard(false);}}>
      <h3 id={confirmId}>{discard==='revision'?'Cancel artwork revision?':'Save before closing?'}</h3>
      <p>{discard==='revision'?'The revision draft, file and notes will be discarded. Your item detail edits will be kept.':changed&&revisionOpen?'Save your item changes and artwork draft, or discard both.':revisionOpen?'Save this artwork draft to resume later, or discard it.':'Save your item changes, or discard them.'}</p>
      {discard==='item'&&revisionOpen&&<p className="ci-close-note">Artwork drafts stay in this browser. Saving a draft does not replace or approve the production file.</p>}
      {error&&<p role="alert" className="ci-error">{error}</p>}
      <div className="ci-close-actions"><button autoFocus disabled={saving} onClick={()=>setDiscard(false)}>{discard==='revision'?'Keep revision':'Keep editing'}</button>
      <button disabled={saving} onClick={()=>{if(discard==='revision')void finishRevision();else void discardAndClose();}}>{discard==='revision'?'Discard revision':'Discard'}</button>
      {discard==='item'&&<button className="ci-primary" disabled={saving||readOnly} onClick={()=>void saveAndClose()}>{saving?'Saving…':changed?'Save changes':'Save draft'}</button>}</div>
    </dialog>
  </dialog></div>;
}
