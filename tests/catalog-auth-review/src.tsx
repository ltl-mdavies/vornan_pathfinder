import React,{useCallback,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Users,Gauge,Archive,ShieldCheck,Settings} from 'lucide-react';
import {AuthenticatedCatalogWorkspace,type CatalogNavigationController} from '../../apps/web/src/customer-catalog/AuthenticatedCatalogWorkspace';
import {createCatalogApi} from '../../apps/web/src/customer-catalog/catalog-api';
import {PathfinderShell} from '../../apps/web/src/PathfinderShell';
import {CustomerRecordHeader,CustomerRecordTabs} from '../../apps/web/src/OperationsCustomers';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/operations-workspace.css';
const scenario=new URLSearchParams(location.search).get('state')??'ready';
const id=scenario==='empty'?'review-empty':'review-demo';
const customer={lift_customer_id:id,customer_name:id==='review-demo'?'Harvest Pantry · design sample':'New customer · design sample',customer_status:'Active'} as any;
function Review(){
 const navigation=useRef<CatalogNavigationController|null>(null);
 const register=useCallback((_id:string,controller:CatalogNavigationController)=>{navigation.current=controller;return()=>{if(navigation.current===controller)navigation.current=null;};},[]);
 const [tab,setTab]=useState('Catalog');
 const client=useMemo(()=>{
  let interrupted=false;
  const send:typeof fetch=async(input,init={})=>{
   if(scenario==='loading')return new Promise(()=>{});
   if(scenario==='error')return new Response(JSON.stringify({error:'Catalog storage is temporarily unavailable. Try reloading; your saved records are retained.'}),{status:503});
   if(scenario==='conflict'&&init.method==='POST')return new Response(JSON.stringify({error:'The catalog changed elsewhere. Reload before saving.'}),{status:409});
   const headers=new Headers(init.headers);headers.set('x-isolated-review','1');headers.set('x-review-role',scenario==='readonly'?'reader':'editor');
   if(init.method==='POST'&&!interrupted&&['unknown','lost-response'].includes(scenario)){
    interrupted=true;
    if(scenario==='lost-response')await fetch(input,{...init,headers});
    throw new Error('Synthetic connection loss');
   }
   return fetch(input,{...init,headers});
  };
  return createCatalogApi('',id,localStorage,send);
 },[]);
 function navigate(next:string){const state=navigation.current?.snapshot();if(state?.busy||state?.dirty)return;setTab(next);}
 return <PathfinderShell enabled active="Customers" items={[{label:'Overview',icon:Gauge},{label:'Customers',icon:Users},{label:'Jobs',icon:Archive},{label:'Proof',icon:ShieldCheck},{label:'Settings',icon:Settings}]} onNavigate={navigate}>
 <section className="workspace" id="pathfinder-content" data-admin-view="Customers" data-customer-view={tab}>
 <CustomerRecordHeader customers={[customer]} customer={customer} onSelect={()=>{}} onDirectory={()=>navigate('Directory')}/>
 <CustomerRecordTabs tabs={['Overview','Jobs','Proof','Catalog','Import Methods','Output Product Map','Manual Import','Settings']} selected={tab} onSelect={navigate} onGlobalProof={()=>navigate('Proof')}/>
 {tab==='Catalog'?<AuthenticatedCatalogWorkspace apiBaseUrl="" customerId={id} client={client} onNavigationController={register}/>:<p>Isolated review harness · <button onClick={()=>setTab('Catalog')}>Return to catalog</button></p>}
 <p style={{fontSize:11,color:'#727b74',marginTop:20}}>Isolated UX review · synthetic records · no production access</p>
 </section></PathfinderShell>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
