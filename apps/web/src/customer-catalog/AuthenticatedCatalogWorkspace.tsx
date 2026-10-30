import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {CustomerCatalogWorkspace} from './CustomerCatalogWorkspace';
import {emptyCatalog} from './catalog';
import {DEFAULT_CHANGE_REASONS} from './change-reasons';
import {catalogChange} from './catalog-change';
import {createCatalogApi, type CatalogAccess, type PendingCatalogSave} from './catalog-api';
import './authenticated-catalog.css';

import {createCatalogNavigation,type CatalogNavigationController,type CatalogNavigationState} from './catalog-navigation';
export type {CatalogNavigationState,CatalogNavigationController} from './catalog-navigation';
type Props = {
  apiBaseUrl: string; customerId: string;
  onNavigationState?: (state: CatalogNavigationState) => void;
  onNavigationController?: (customerId:string,controller:CatalogNavigationController) => void | (() => void);
  // Injection is used only by the isolated review harness; the app uses authenticated transport.
  client?: ReturnType<typeof createCatalogApi>;
};
export function AuthenticatedCatalogWorkspace({apiBaseUrl, customerId, onNavigationState, onNavigationController, client}: Props) {
  const api = useMemo(() => client ?? createCatalogApi(apiBaseUrl, customerId, window.localStorage), [apiBaseUrl, customerId, client]);
  const [access, setAccess] = useState<CatalogAccess | null>(null);
  const [pending, setPendingState] = useState<PendingCatalogSave[]>([]);
  const [checked, setChecked] = useState<Record<string, {at:string;retryAllowed:boolean;error?:string}>>({});
  const [loading, setLoading] = useState(true), [busy, setBusyState] = useState(false), [dirty, setDirtyState] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [epoch, setEpoch] = useState(0);
  const [discardKey,setDiscardKey]=useState<string|null>(null);
  const navigation=useMemo(()=>createCatalogNavigation(customerId,()=>{setDirtyState(false);setEpoch(value=>value+1);}),[customerId]);
  const setBusy=useCallback((value:boolean)=>{navigation.update({busy:value});setBusyState(value);},[navigation]);
  const setDirty=useCallback((value:boolean)=>{navigation.update({dirty:value});setDirtyState(value);},[navigation]);
  const setPending=useCallback((value:PendingCatalogSave[])=>{navigation.update({unconfirmed:value.some(request=>!request.rejection)});setPendingState(value);},[navigation]);
  // The parent owns identity-aware cleanup: clear only this registered controller.
  useEffect(()=>onNavigationController?.(customerId,navigation),[customerId,navigation,onNavigationController]);
  const load = useCallback(async () => {
    const value = await api.load();
    const requests = api.pending();
    setAccess(value); setPending(requests);
  }, [api]);
  useEffect(() => {
    let active = true;
    setLoading(true); setAccess(null); setError('');
    void api.load().then(value => {
      const requests = api.pending();
      if (active) {setAccess(value); setPending(requests);}
    }).catch(e => {if (active) setError(e.message);}).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [api, epoch]);
  useEffect(() => {onNavigationState?.(navigation.snapshot());}, [dirty, busy, pending, navigation, onNavigationState]);
  useEffect(() => {
    if (!dirty && !busy && !pending.some(request=>!request.rejection)) return;
    const warn = (e: BeforeUnloadEvent) => {e.preventDefault(); e.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, pending]);
  const recover = async (request: PendingCatalogSave, retry: boolean) => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (retry) {setChecked(previous=>({...previous,[request.key]:{...previous[request.key],retryAllowed:false}}));await api.retry(request); setNotice('The catalog save is recorded.');}
      else {
        const result = await api.check(request);
        setChecked(previous => ({...previous, [request.key]: {at:new Date().toLocaleTimeString(),retryAllowed:result.status==='unconfirmed'}}));
        if(result.status === 'recorded') setNotice(`Save confirmed at revision ${result.revision}.`);
      }
      await load();
    } catch (e) {setChecked(previous=>({...previous,[request.key]:{at:new Date().toLocaleTimeString(),retryAllowed:false,error:(e as Error).message}}));}
    finally {setPending(api.pending()); setBusy(false);}
  };
  function download(request: PendingCatalogSave) {
    const url = URL.createObjectURL(new Blob([JSON.stringify({customerId, purpose: 'Attempted catalog save — not an order', ...request}, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `catalog-${customerId}-recovery.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const reload = () => {
    if (navigation.snapshot().busy || navigation.snapshot().unconfirmed || (dirty && !window.confirm('Reload and discard unsaved item changes and import/PO previews? Recovery records will be kept.'))) return;
    setDirty(false); setEpoch(value => value + 1);
  };
  return <div className="cc-auth-workspace">
    {!access&&<div className="cc-connection-bar"><strong>Customer catalog</strong><button disabled={loading||busy} onClick={reload}>Reload catalog</button></div>}
    {error && !pending.length && <div className="cc-feedback cc-error" role="alert">{error}</div>}
    {notice && <div className="cc-feedback" role="status">{notice}</div>}
    {pending.map(request => <section className="cc-save-recovery" key={request.key} aria-label="Catalog save recovery"><div><strong>{request.rejection?'Save not applied':'Save outcome unconfirmed'}</strong><p>{request.rejection??(checked[request.key]?.error?'Status could not be confirmed. Your changes are retained. Check again or download them for support.':checked[request.key]?.retryAllowed?'Still unconfirmed. Your changes are retained. Check again or retry the same save.':'Your attempted changes are retained. Check status before retrying this save.')}</p><small>{new Date(request.at).toLocaleString()} · {request.rejection?'Attempted changes retained':checked[request.key] ? `Last checked ${checked[request.key].at}` : 'Not checked in this session'}</small></div><div className="cc-recovery-controls">{!request.rejection&&<button disabled={busy} onClick={() => void recover(request, false)}>Check save status</button>}{!request.rejection && checked[request.key]?.retryAllowed && access?.capabilities.edit && <button disabled={busy} onClick={() => void recover(request, true)}>Retry same save</button>}<button onClick={() => download(request)}>Download attempted changes</button>{request.rejection&&(discardKey===request.key?<div role="group" aria-label="Discard recovery copy"><p>Discard these attempted changes? The saved catalog will stay unchanged.</p><button onClick={()=>setDiscardKey(null)}>Keep recovery copy</button><button disabled={busy} onClick={()=>{api.discardRejected(request);setPending(api.pending());setDiscardKey(null);setError('');}}>Discard recovery copy</button></div>:<button disabled={busy} onClick={()=>setDiscardKey(request.key)}>Discard attempted changes</button>)}</div></section>)}
    {loading ? <p role="status" className="cc-auth-loading">Loading customer catalog…</p> : access && <CustomerCatalogWorkspace
      key={`${customerId}:${epoch}`} catalog={access.record?.catalog ?? emptyCatalog(access.customer)}
      changeReasons={access.record?.reasons ?? DEFAULT_CHANGE_REASONS}
      internalUser readOnly={!access.capabilities.edit || busy || pending.some(request=>!request.rejection)}
      saveRecoveryPending={pending.some(request=>!request.rejection)} artworkEditingEnabled={false} storageDescription="This saves to this customer's catalog."
      workspaceSummary={`${access.capabilities.edit?'Internal editing':'Read-only access'} · ${access.record?`Saved revision ${access.record.revision}`:'No catalog imported'}. Order submission and artwork replacement are disabled.`}
      connectionControls={<button disabled={loading||busy} onClick={reload}>Reload catalog</button>}
      onWorkspaceDirtyChange={setDirty}
      onChange={async (next, artworkDraft) => {
        if (artworkDraft) throw new Error('Artwork replacement is not enabled.');
        const operation = catalogChange(access.record?.catalog ?? emptyCatalog(access.customer), next);
        if (!operation) return access.record?.catalog ?? next;
        setBusy(true); setError(''); setNotice('');
        try {
          const record = await api.save(operation, access.record?.revision ?? 0);
          setAccess(previous => previous ? {...previous, record} : previous);
          return record.catalog;
        } catch (e) {setError((e as Error).message); throw e;}
        finally {setPending(api.pending()); setBusy(false);}
      }}
    />}
  </div>;
}
