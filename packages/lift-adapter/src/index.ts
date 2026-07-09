import type { CanonicalOrder, ShippingAddress, ValidationMessage } from "@pathfinder/canonical";

export interface LiftTargetConfig {
  destination_adapter: "lift-standard-graphics";
  active_environment: "QA1" | "PROD";
  environments: {
    QA1: { endpoint_url: string };
    PROD: { endpoint_url: string };
  };
  headers: {
    "Content-Type": "application/json";
    Company: string;
    Ext_ID: {
      strategy: "field";
      field: "order.ext_id";
      body_field: "order.ext_id";
      must_match_body: true;
      default_source_field: "canonical.order.external_order_id";
      fallback_fields: string[];
    };
  };
  credentials: {
    User: string;
    Password: string;
  };
}

export interface LiftOrderPayload {
  customer: {
    lift_customer_id?: string;
    customer_name: string;
  };
  source: {
    platform: "Pathfinder";
    pathfinder_customer_id: string;
    source_system: string;
    source_customer: string;
    source_record_id: string;
    source_record_url?: string | null;
    source_template?: string | null;
    submitted_at: string;
    pathfinder_job_id: string;
    pathfinder_canonical_order_id: string;
  };
  order: {
    ext_id: string;
    po_number?: string | null;
    contract_number?: string | null;
    order_title?: string | null;
    order_note?: string | null;
    requested_ship_date?: string | null;
    shipping?: ShippingAddress | null;
  };
  lines: Array<{
    line_number: number;
    unit_number: string;
    customer_sku?: string | null;
    description?: string | null;
    product_name?: string | null;
    quantity: number;
    artwork?: {
      file_name?: string | null;
      file_url?: string | null;
      checksum?: string | null;
    };
    dimensions: {
      final_height: number;
      final_width: number;
      live_height?: number | null;
      live_width?: number | null;
      bleed?: number | null;
    };
    production?: Record<string, string | number | boolean | null>;
    shipping?: ShippingAddress | null;
    line_note?: string | null;
  }>;
}

export interface LiftSubmitRequest {
  endpoint_url: string;
  headers: {
    "Content-Type": "application/json";
    Ext_ID: string;
    User: string;
    Password: string;
    Company: string;
  };
  body: LiftOrderPayload;
}

export const defaultLiftTargetConfig: LiftTargetConfig = {
  destination_adapter: "lift-standard-graphics",
  active_environment: "QA1",
  environments: {
    PROD: {
      endpoint_url: "http://prod-lifterp/lifterp/ords/lifterp/lift/erp/api/create_order"
    },
    QA1: {
      endpoint_url: "http://devcompute/lifterp-qa1/lifterp/liftqa1/erp/api/create_orde"
    }
  },
  headers: {
    "Content-Type": "application/json",
    Company: "91",
    Ext_ID: {
      strategy: "field",
      field: "order.ext_id",
      body_field: "order.ext_id",
      must_match_body: true,
      default_source_field: "canonical.order.external_order_id",
      fallback_fields: ["canonical.order.contract_number", "canonical.order.po_number"]
    }
  },
  credentials: {
    User: "LIFT_IMPORT_USERNAME_TBD",
    Password: "SECRET_REFERENCE_ONLY"
  }
};

function resolveExtId(order: CanonicalOrder): string {
  return (
    order.order.external_order_id ||
    order.order.contract_number ||
    order.order.po_number ||
    order.source.source_record_id
  );
}

export function generateLiftPayload(
  canonicalOrder: CanonicalOrder,
  ids: { jobId: string; canonicalOrderId: string } = {
    jobId: "job_preview",
    canonicalOrderId: "co_preview"
  }
): LiftOrderPayload {
  const extId = resolveExtId(canonicalOrder);

  return {
    customer: {
      lift_customer_id: canonicalOrder.customer.destination_customer_id,
      customer_name: canonicalOrder.customer.customer_name
    },
    source: {
      platform: "Pathfinder",
      pathfinder_customer_id: canonicalOrder.customer.customer_id,
      source_system: canonicalOrder.source.source_system,
      source_customer: canonicalOrder.source.source_customer,
      source_record_id: canonicalOrder.source.source_record_id,
      source_record_url: canonicalOrder.source.source_record_url ?? null,
      source_template: canonicalOrder.source.source_template ?? null,
      submitted_at: canonicalOrder.source.submitted_at,
      pathfinder_job_id: ids.jobId,
      pathfinder_canonical_order_id: ids.canonicalOrderId
    },
    order: {
      ext_id: extId,
      po_number: canonicalOrder.order.po_number ?? null,
      contract_number: canonicalOrder.order.contract_number ?? null,
      order_title: canonicalOrder.order.order_title ?? null,
      order_note: canonicalOrder.order.order_note ?? null,
      requested_ship_date: canonicalOrder.order.ship_date ?? null,
      shipping: canonicalOrder.order.shipping ?? null
    },
    lines: canonicalOrder.lines.map((line) => ({
      line_number: line.line_number,
      unit_number: line.unit_number,
      customer_sku: line.customer_sku ?? null,
      description: line.description ?? null,
      product_name: line.product_name ?? line.description ?? null,
      quantity: line.quantity,
      artwork: line.artwork,
      dimensions: {
        final_height: line.dimensions.final_height,
        final_width: line.dimensions.final_width,
        live_height: line.dimensions.live_height ?? null,
        live_width: line.dimensions.live_width ?? null,
        bleed: line.dimensions.bleed ?? null
      },
      production: line.production,
      shipping: line.shipping ?? null,
      line_note: line.line_note ?? null
    }))
  };
}

export function validateLiftPayload(payload: LiftOrderPayload): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  if (!payload.order.ext_id?.trim()) {
    messages.push({
      severity: "FAIL",
      code: "LIFT-EXT-ID",
      object: "lift.order",
      field: "order.ext_id",
      message: "Lift payload order.ext_id is required.",
      suggested_action: "Map or derive ext_id from the canonical external order ID, contract number, or PO number."
    });
  }

  if (!payload.lines.length) {
    messages.push({
      severity: "FAIL",
      code: "LIFT-LINES",
      object: "lift.lines",
      field: "lines",
      message: "Lift payload requires at least one line.",
      suggested_action: "Import line rows before generating the payload."
    });
  }

  payload.lines.forEach((line, index) => {
    if (!line.unit_number.trim()) {
      messages.push({
        severity: "FAIL",
        code: "LIFT-UNIT",
        object: "lift.line",
        field: `lines[${index}].unit_number`,
        message: "Lift line unit_number is required.",
        suggested_action: "Resolve product mapping before generating the Lift payload."
      });
    }
  });

  return messages.length
    ? messages
    : [
        {
          severity: "PASS",
          code: "LIFT-OK",
          object: "lift.payload",
          field: "*",
          message: "Lift payload passes preview validation."
        }
      ];
}

export function buildLiftSubmitRequest(
  payload: LiftOrderPayload,
  config: LiftTargetConfig = defaultLiftTargetConfig
): LiftSubmitRequest {
  const extIdHeader = payload.order.ext_id;
  if (extIdHeader !== payload.order.ext_id) {
    throw new Error("Lift Ext_ID header must match payload order.ext_id.");
  }

  return {
    endpoint_url: config.environments[config.active_environment].endpoint_url,
    headers: {
      "Content-Type": "application/json",
      Ext_ID: extIdHeader,
      User: config.credentials.User,
      Password: config.credentials.Password,
      Company: config.headers.Company
    },
    body: payload
  };
}

export function maskLiftSubmitRequest(request: LiftSubmitRequest) {
  return {
    ...request,
    headers: {
      ...request.headers,
      Password: "********"
    }
  };
}
