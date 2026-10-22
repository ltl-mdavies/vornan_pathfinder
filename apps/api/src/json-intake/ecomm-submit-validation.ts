import type {ValidationMessage} from '@pathfinder/canonical';
import type {LiftSubmitRequest,LiftOrderPayload} from '@pathfinder/lift-adapter';
import {LIFT_ECOMMERCE_TEMPLATE_ID} from '@pathfinder/lift-adapter';

/** Certification and submission gate only. Never rewrite a persisted/reviewed job identity. */
export function validateEcommSubmitIdentity(templateId:string, request:LiftSubmitRequest, payload:LiftOrderPayload=request.body):ValidationMessage[] {
  if(templateId!==LIFT_ECOMMERCE_TEMPLATE_ID)return [];
  const ext=request.body.order.ext_id;
  if(typeof ext==='string' && /^[A-Za-z0-9-]+$/.test(ext) && request.headers.Ext_ID===ext && payload.order.ext_id===ext && !Object.hasOwn(request.body,'ext_id') && !Object.hasOwn(payload,'ext_id'))return [];
  return [{severity:'FAIL',code:'SUBMIT-ECOMM-EXT-ID',object:'submit.request',field:'order.ext_id',
    message:'Ecomm order.ext_id must contain only letters, digits and hyphens, match the Ext_ID header, and have no root duplicate.',
    suggested_action:'Prepare and review a corrected Ecomm job before submitting. Preserve existing confirmed or uncertain order identities.'}];
}
