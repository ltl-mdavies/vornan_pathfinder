import express from 'express';
import { authenticate, type TestCredential } from './auth.js';
import { IntakeError } from './adapter.js';
import { JsonIntakeService, receiptResponse, statusResponse } from './service.js';

/** Unmounted factory. Enabling this local test router cannot activate Lift or outbound delivery. */
export function createJsonIntakeRouter(options: {enabled?: boolean; credentials: readonly TestCredential[]; service: JsonIntakeService}) {
  const router = express.Router();
  router.use((_req,res,next) => { res.set('Cache-Control','private, no-store'); if (!options.enabled) {res.status(404).json({code:'NOT_FOUND'}); return;} next(); });
  router.use((req,res,next) => {
    try { res.locals.identity = authenticate(req.header('authorization'),options.credentials,req.method === 'POST' ? 'orders:write' : 'orders:read',options.service.now()); next(); }
    catch (e) { next(e); }
  });
  router.post('/orders', express.raw({type: 'application/json', limit:'1mb'}), async (req,res,next) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw new IntakeError(415,'JSON_REQUIRED');
      let payload: unknown;
      try {payload = JSON.parse(req.body.toString('utf8'));} catch {throw new IntakeError(400,'INVALID_JSON');}
      const {receipt,replayed} = await options.service.receive(res.locals.identity,payload,req.body);
      res.status(replayed ? 200 : 202).json(receiptResponse(receipt,replayed));
    } catch (e) {next(e);}
  });
  router.get('/orders/:receiptId', async (req,res,next) => {
    try {res.json(statusResponse(await options.service.lookup(res.locals.identity,req.params.receiptId)));} catch (e) {next(e);}
  });
  router.use((error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction) => {
    if (error instanceof IntakeError) {res.status(error.status).json({code:error.code,...(error.issues.length ? {issues:error.issues} : {})}); return;}
    if ((error as {type?:string})?.type === 'entity.too.large') {res.status(413).json({code:'PAYLOAD_TOO_LARGE'}); return;}
    res.status(503).json({code:'INTAKE_TEMPORARILY_UNAVAILABLE'});
  });
  return router;
}
