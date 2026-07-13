export type ProcessingState =
  | "Discovered"
  | "Received"
  | "Raw Archived"
  | "Canonical Created"
  | "Validated"
  | "Resolved"
  | "Needs Mapping"
  | "Ready"
  | "Submitted"
  | "Submit Failed"
  | "Completed"
  | "Archived"
  | "Failed"
  | "Waiting"
  | "Retry"
  | "Cancelled";

export type ValidationSeverity = "PASS" | "WARNING" | "FAIL";

export interface ValidationMessage {
  severity: ValidationSeverity;
  code: string;
  object: string;
  field: string;
  message: string;
  suggested_action?: string;
}

export interface ShippingAddress {
  method?: string | null;
  account_number?: string | null;
  acct_billing_zip?: string | null;
  acct_billing_country?: string | null;
  attention_to?: string | null;
  company?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  instructions?: string | null;
}

export interface Contact {
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  email?: string | null;
  mobile_phone?: string | null;
  office_phone?: string | null;
  home_phone?: string | null;
  slack?: string | null;
  fax?: string | null;
}

export interface CanonicalOrderLine {
  line_number: number;
  unit_number: string;
  customer_sku?: string | null;
  description?: string | null;
  product_id?: string | null;
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
}

export interface CanonicalOrder {
  customer: {
    customer_id: string;
    customer_name: string;
    destination_customer_id?: string;
    crm_id?: string | null;
  };
  contacts?: Contact[];
  source: {
    source_system: string;
    source_customer: string;
    source_record_id: string;
    source_record_url?: string | null;
    source_template?: string | null;
    submitted_at: string;
  };
  target: {
    target_system: string;
  };
  order: {
    external_order_id: string;
    po_number?: string | null;
    contract_number?: string | null;
    order_title?: string | null;
    order_note?: string | null;
    ship_date?: string | null;
    due_date?: string | null;
    order_attachment?: string | null;
    shipping?: ShippingAddress | null;
  };
  lines: CanonicalOrderLine[];
}

export interface ProcessingJob {
  job_id: string;
  customer_id: string;
  state: ProcessingState;
  source_file_name?: string;
  created_at: string;
  updated_at: string;
  validation_messages: ValidationMessage[];
}

export function validateCanonicalOrder(order: CanonicalOrder): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  const requireString = (value: unknown, field: string, object = "order") => {
    if (typeof value !== "string" || !value.trim()) {
      messages.push({
        severity: "FAIL",
        code: "VAL-REQ",
        object,
        field,
        message: `${field} is required.`,
        suggested_action: "Map or provide the required value before generating a Lift payload."
      });
    }
  };

  requireString(order.customer.customer_id, "customer.customer_id", "customer");
  requireString(order.customer.customer_name, "customer.customer_name", "customer");
  requireString(order.source.source_system, "source.source_system", "source");
  requireString(order.source.source_record_id, "source.source_record_id", "source");
  requireString(order.target.target_system, "target.target_system", "target");
  requireString(order.order.external_order_id, "order.external_order_id");

  if (!Array.isArray(order.lines) || order.lines.length === 0) {
    messages.push({
      severity: "FAIL",
      code: "VAL-LINES",
      object: "lines",
      field: "lines",
      message: "At least one order line is required.",
      suggested_action: "Import line rows or adjust the template row range."
    });
  }

  order.lines.forEach((line, index) => {
    const prefix = `lines[${index}]`;
    requireString(line.unit_number, `${prefix}.unit_number`, "line");

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      messages.push({
        severity: "FAIL",
        code: "VAL-QTY",
        object: "line",
        field: `${prefix}.quantity`,
        message: "Line quantity must be a positive integer.",
        suggested_action: "Map a numeric quantity column or correct the source value."
      });
    }

    if (!Number.isFinite(line.dimensions?.final_width) || line.dimensions.final_width <= 0) {
      messages.push({
        severity: "FAIL",
        code: "VAL-DIM-W",
        object: "line",
        field: `${prefix}.dimensions.final_width`,
        message: "Final width is required and must be greater than zero.",
        suggested_action: "Map width from the source file or add a template default."
      });
    }

    if (!Number.isFinite(line.dimensions?.final_height) || line.dimensions.final_height <= 0) {
      messages.push({
        severity: "FAIL",
        code: "VAL-DIM-H",
        object: "line",
        field: `${prefix}.dimensions.final_height`,
        message: "Final height is required and must be greater than zero.",
        suggested_action: "Map height from the source file or add a template default."
      });
    }
  });

  if (messages.length === 0) {
    messages.push({
      severity: "PASS",
      code: "VAL-OK",
      object: "order",
      field: "*",
      message: "Canonical Order passes required-field validation."
    });
  }

  return messages;
}

export const sampleCanonicalOrder: CanonicalOrder = {
  customer: {
    customer_id: "customer_momentara",
    customer_name: "Momentara",
    destination_customer_id: "LIFT_CUSTOMER_ID_TBD",
    crm_id: "CRM-EXAMPLE-001"
  },
  contacts: [
    {
      first_name: "Jane",
      last_name: "Smith",
      title: "Marketing Manager",
      email: "jane.smith@example.com",
      mobile_phone: "555-555-0101",
      office_phone: "555-555-0100",
      home_phone: null,
      slack: "@jane.smith",
      fax: null
    }
  ],
  source: {
    source_system: "Manual Upload",
    source_customer: "Momentara",
    source_record_id: "AS360-30904511",
    source_record_url: null,
    source_template: "Momentara OOH Order Form",
    submitted_at: "2026-06-18T14:32:00-04:00"
  },
  target: {
    target_system: "Lift Standard Graphics"
  },
  order: {
    external_order_id: "AS360-30904511",
    po_number: "1122334455",
    contract_number: "1122334455",
    order_title: "Campaign",
    order_note: "Optional order-level production note.",
    ship_date: "2026-06-23",
    due_date: "2026-06-24",
    order_attachment: "https://example.com/imports/momentara-order.xlsx",
    shipping: {
      method: "UPS Ground",
      account_number: null,
      acct_billing_zip: "45202",
      acct_billing_country: "US",
      attention_to: "Jane Smith",
      company: "Example Company",
      address_1: "123 Main St",
      address_2: "Suite 200",
      city: "Cincinnati",
      state: "OH",
      postal_code: "45202",
      country: "US",
      phone: "555-555-0100",
      email: "jane.smith@example.com",
      instructions: "Deliver to receiving dock."
    }
  },
  lines: [
    {
      line_number: 1,
      unit_number: "2SHEET_46x60_48PT",
      customer_sku: "OOH-2SHEET-46X60",
      description: "2 Sheet Poster",
      product_id: "PROD-2SHEET-POSTER",
      product_name: "2 Sheet Poster",
      quantity: 1,
      artwork: {
        file_name: "momentara_campaign_art.pdf",
        file_url: "https://example.com/artwork/momentara_campaign_art.pdf",
        checksum: null
      },
      dimensions: {
        final_height: 46.2,
        final_width: 60.2,
        live_height: 43,
        live_width: 57,
        bleed: 0.125
      },
      production: {
        material: "15pt Styrene",
        laminate: "8520",
        coating: "N",
        premask: "N",
        ink: "4CP/0",
        cut_type: "Square Cut"
      },
      shipping: null,
      line_note: "Optional line-level production note."
    }
  ]
};
