import {Router} from 'express';
import {CatalogRecordService} from './service.js';
import {createCatalogRecordRouter} from './router.js';
import {catalogCustomerAccess} from './customer-access.js';
import {CloudCatalogDraftRepository} from './cloud-store.js';
import type {DraftRepository} from './storage-contract.js';
/** Catalog misconfiguration must never prevent unrelated API routes from starting. */
export function configuredCatalogRecordRouter(env:NodeJS.ProcessEnv,dependencies:{repository?:(customerId:string)=>DraftRepository}={}){
 const router=Router();
 router.all('/customers/:customerId/catalog-drafts*',(_req,res)=>res.status(423).json({error:'Order review is not enabled.'}));
 if(env.PATHFINDER_ENABLE_CATALOG_DRAFTS!=='true'||env.PATHFINDER_ENABLE_CATALOG_RECORDS!=='true'){
  router.all('/customers/:customerId/catalog-records*',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.status(423).json({error:'Catalog storage is disabled.'});});return router;
 }
 let access:ReturnType<typeof catalogCustomerAccess>;
 const storage={table:env.PATHFINDER_CATALOG_DRAFT_TABLE??'',bucket:env.PATHFINDER_CATALOG_DRAFT_BUCKET??'',prefix:env.PATHFINDER_CATALOG_DRAFT_PREFIX??''};
 try{
  access=catalogCustomerAccess(env);
  if(!/^[A-Za-z0-9_.-]{3,255}$/.test(storage.table)||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(storage.bucket)||!/^catalog-drafts\/[A-Za-z0-9/-]+\/$/.test(storage.prefix))throw new Error('Invalid catalog storage configuration.');
 }catch{
  // No configuration values, identities or credentials appear in the response.
  router.all('/customers/:customerId/catalog-records*',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.status(503).json({code:'catalog_configuration_unavailable',error:'Catalog configuration is unavailable. Contact an administrator.'});});return router;
 }
 const services=new Map<string,CatalogRecordService>();
 const serviceForCustomer=(id:string)=>{const customer=access.customer(id);if(!customer)return undefined;let service=services.get(id);if(!service){const repo=dependencies.repository?.(id)??new CloudCatalogDraftRepository({...storage,customerId:id,kind:'catalog'});service=new CatalogRecordService(repo,{customer});services.set(id,service);}return service;};
 router.use(createCatalogRecordRouter({serviceForCustomer,enabled:true,authorize:access.authorize}));return router;
}
