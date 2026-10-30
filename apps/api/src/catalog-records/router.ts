import {Router} from 'express';
import {DraftError} from './storage-contract.js';
import type {CatalogRecordService} from './service.js';
import type {CatalogAccess} from './customer-access.js';

/** Customer selection and grants are server-owned and checked before storage access. */
export function createCatalogRecordRouter(args: {
  service?: CatalogRecordService;
  serviceForCustomer?: (customerId: string) => CatalogRecordService | undefined;
  enabled: boolean;
  authorize: (uid: string, customerId: string, access: CatalogAccess) => Promise<boolean>;
}) {
  const router = Router();
  router.use('/customers/:customerId/catalog-records', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!args.enabled) { res.status(423).json({error: 'Catalog storage is disabled.'}); return; }
    const uid = res.locals.authUser?.uid;
    if (typeof uid !== 'string' || !uid) { res.status(401).json({error: 'An authenticated operator is required.'}); return; }
    try {
      const access = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
      if (!await args.authorize(uid, req.params.customerId, access)) {
        res.status(403).json({error: 'Customer access denied.'}); return;
      }
      const service = args.serviceForCustomer?.(req.params.customerId) ?? args.service;
      if (!service || service.customer.id !== req.params.customerId) {
        res.status(403).json({error: 'Customer access denied.'}); return;
      }
      res.locals.catalogActor = uid;
      res.locals.catalogService = service;
      next();
    } catch { res.status(403).json({error: 'Customer access denied.'}); }
  });
  const service = (res: any): CatalogRecordService => res.locals.catalogService;
  const error = (res: any, e: unknown) => res.status(e instanceof DraftError ? e.status : 503).json({
    code: e instanceof DraftError ? e.code : 'storage_unavailable',
    error: e instanceof DraftError ? e.message : 'Catalog storage is unavailable. Retry the same request.'
  });
  router.get('/customers/:customerId/catalog-records', async (req, res) => {
    try { res.json({record: await service(res).current(), customer: service(res).customer, operatorId: res.locals.catalogActor, capabilities: {edit: await args.authorize(res.locals.catalogActor, req.params.customerId, 'write')}, submissionEnabled: false}); } catch (e) { error(res, e); }
  });
  router.get('/customers/:customerId/catalog-records/history', async (_req, res) => {
    try { res.json({history: await service(res).history(), submissionEnabled: false}); } catch (e) { error(res, e); }
  });
  router.get('/customers/:customerId/catalog-records/operations/:key', async (req, res) => {
    try { res.json(await service(res).operationStatus(req.params.key, res.locals.catalogActor)); } catch (e) { error(res, e); }
  });
  router.post('/customers/:customerId/catalog-records', async (req, res) => {
    try { res.json(await service(res).apply(req.body, req.header('idempotency-key') ?? '', res.locals.catalogActor)); }
    catch (e) { error(res, e); }
  });
  router.all('/customers/:customerId/catalog-records/*', (_req, res) => {
    res.status(423).json({error: 'This catalog action is not enabled.'});
  });
  return router;
}
