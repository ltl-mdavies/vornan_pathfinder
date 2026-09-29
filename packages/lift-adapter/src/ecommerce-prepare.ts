import type { CanonicalEcommerceOrder } from '@pathfinder/canonical';
import {
  applyLiftOrderOutputMappings, prepareLiftOrderDateFormat, validateLiftPayload,
  type LiftOrderDateFormat, type LiftOrderPayload, type LiftPayloadValidationOptions
} from './index.js';
import { projectLiftEcommercePayload } from './ecommerce.js';

/** Pure export preparation; selecting this helper never registers or activates a route. */
export function prepareLiftEcommercePayload(input: {
  template_id: string;
  base: LiftOrderPayload;
  canonical: CanonicalEcommerceOrder;
  source: CanonicalEcommerceOrder;
  order_mappings: Array<{ sourceColumn: string; targetField: string }>;
  order_date_format?: LiftOrderDateFormat;
  validation_options?: LiftPayloadValidationOptions;
}) {
  if (input.order_date_format !== undefined &&
      !['MM/DD/YYYY', 'YYYY-MM-DD'].includes(input.order_date_format)) {
    throw new Error('Unsupported Lift order date format');
  }
  const mapped = applyLiftOrderOutputMappings(input.base, input.canonical, input.order_mappings);
  const payload = projectLiftEcommercePayload(input.template_id, mapped, input.source);
  // Always validate dates. Without a reviewed target format, preserve valid source spelling.
  const dates = prepareLiftOrderDateFormat(payload, input.order_date_format ?? 'YYYY-MM-DD');
  for (const field of ['requested_ship_date', 'due_date'] as const) {
    if (dates.validation.some(message => message.field === `order.${field}`)) {
      payload.order[field] = null;
    } else if (input.order_date_format && dates.payload.order[field] !== undefined) {
      payload.order[field] = dates.payload.order[field];
    }
  }
  // Copy only dates: the legacy formatter strips nested nulls, which are intentional here.
  return {
    payload,
    validation: [...dates.validation, ...validateLiftPayload(payload, input.validation_options)]
  };
}
