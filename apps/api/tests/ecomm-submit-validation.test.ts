import assert from 'node:assert/strict';
import test from 'node:test';
import {buildLiftSubmitRequest,generateLiftPayload,LIFT_ECOMMERCE_TEMPLATE_ID} from '@pathfinder/lift-adapter';
import {sampleCanonicalOrder} from '@pathfinder/canonical';
import {validateEcommSubmitIdentity} from '../src/json-intake/ecomm-submit-validation.js';
test('Ecomm submission gate rejects unsafe historical IDs without rewriting them; High End unchanged',()=>{
 for(const ext of ['json_'+'a'.repeat(64),'order 123','order/123','']){
  const payload=generateLiftPayload(sampleCanonicalOrder);payload.order.ext_id=ext;
  const request=buildLiftSubmitRequest(payload),before=JSON.stringify(request);
  assert.equal(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,request)[0]?.severity,'FAIL');
  assert.deepEqual(validateEcommSubmitIdentity('template-lift-high-end-work',request),[]);
  assert.equal(JSON.stringify(request),before);
 }
});
test('Ecomm gate accepts nested/header safe IDs and rejects root duplicates/header mismatches',()=>{
 const payload=generateLiftPayload(sampleCanonicalOrder);payload.order.ext_id='json-'+'a'.repeat(64);
 const request=buildLiftSubmitRequest(payload);assert.deepEqual(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,request),[]);
 assert.equal(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,{...request,headers:{...request.headers,Ext_ID:'OTHER'}}).length,1);
 assert.equal(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,{...request,body:{...request.body,ext_id:payload.order.ext_id} as any}).length,1);
});
test('Ecomm checks exact typed identity, including missing values, whitespace and stale root keys',()=>{
 const payload=generateLiftPayload(sampleCanonicalOrder);payload.order.ext_id='Mixed-Case-123';
 const valid=buildLiftSubmitRequest(payload);assert.deepEqual(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,valid),[]);
 for(const ext of [undefined,null,123,' bad','bad ','bad\tvalue']) {
  const request=structuredClone(valid);(request.body.order as any).ext_id=ext;
  assert.equal(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,request).length,1);
 }
 for(const root of [null,'',undefined]) {
  const request=structuredClone(valid);(request.body as any).ext_id=root;
  assert.equal(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,request).length,1);
  assert.equal(validateEcommSubmitIdentity(LIFT_ECOMMERCE_TEMPLATE_ID,valid,request.body).length,1);
 }
});
test('actual server readiness drives blocking certification before transport, scoped to Ecomm',async()=>{
 process.env.PATHFINDER_RUNTIME='lambda';
 const {validateSubmitReadiness,buildSubmitCertification}=await import('../src/server.js');
 const payload=generateLiftPayload(sampleCanonicalOrder);payload.order.ext_id='legacy_id';
 const request=buildLiftSubmitRequest(payload);
 const profile:any={mode:'sandbox_customer',enabled:true};
 const route:any={output_template_id:LIFT_ECOMMERCE_TEMPLATE_ID,status:'Active'};
 const messages=validateSubmitReadiness(request,payload,profile,route);
 assert.ok(messages.some(m=>m.code==='SUBMIT-ECOMM-EXT-ID'&&m.severity==='FAIL'));
 const certification=buildSubmitCertification({state:'Ready',canonicalValidation:[],liftValidation:[],submitValidation:messages,unresolvedProducts:[],request,payload,profile,route,environment:{status:'Active',name:'test'} as any});
 assert.equal(certification.can_submit,false);assert.ok(certification.items.some(i=>i.item_id==='submit-readiness'&&i.blocking));
 const legacy=validateSubmitReadiness(request,payload,profile,{...route,output_template_id:'template-lift-high-end-work'});
 assert.ok(!legacy.some(m=>m.code==='SUBMIT-ECOMM-EXT-ID'));
});
