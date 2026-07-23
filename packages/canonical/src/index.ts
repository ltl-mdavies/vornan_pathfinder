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
  | "Order Confirmed"
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
    artwork_folder_url?: string | null;
    shipping?: ShippingAddress | null;
  };
  lines: CanonicalOrderLine[];
}

export type CanonicalFieldSection = "customer" | "contacts" | "source" | "target" | "order" | "shipping" | "lines";
export type CanonicalFieldDataType = "string" | "number" | "integer" | "boolean" | "datetime" | "url" | "object";
export type CanonicalFieldStatus = "Active" | "Draft" | "Deprecated";

export interface CanonicalFieldDefinition {
  field_id: string;
  path: string;
  section: CanonicalFieldSection;
  label: string;
  data_type: CanonicalFieldDataType;
  required: boolean;
  repeatable: boolean;
  status: CanonicalFieldStatus;
  aliases: string[];
  description?: string;
}

function canonicalField(
  path: string,
  section: CanonicalFieldSection,
  label: string,
  data_type: CanonicalFieldDataType,
  options: Partial<Pick<CanonicalFieldDefinition, "required" | "repeatable" | "status" | "aliases" | "description">> = {}
): CanonicalFieldDefinition {
  return {
    field_id: `canonical.${path.replace(/\[\]/g, ".items").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
    path,
    section,
    label,
    data_type,
    required: options.required ?? false,
    repeatable: options.repeatable ?? path.includes("[]"),
    status: options.status ?? "Active",
    aliases: options.aliases ?? [],
    description: options.description
  };
}

export const canonicalFieldRegistry = [
  canonicalField("customer.customer_id", "customer", "Customer ID", "string", {
    required: true,
    aliases: ["Pathfinder customer ID", "Source customer ID"]
  }),
  canonicalField("customer.customer_name", "customer", "Customer Name", "string", {
    required: true,
    aliases: ["Customer name", "Source customer"]
  }),
  canonicalField("customer.destination_customer_id", "customer", "Destination Customer ID", "string", {
    aliases: ["Lift customer ID", "Submit customer ID"]
  }),
  canonicalField("customer.crm_id", "customer", "CRM ID", "string", {
    aliases: ["CRM customer ID", "Salesforce ID"]
  }),
  canonicalField("contacts[].first_name", "contacts", "Contact First Name", "string", { aliases: ["First name"] }),
  canonicalField("contacts[].last_name", "contacts", "Contact Last Name", "string", { aliases: ["Last name"] }),
  canonicalField("contacts[].title", "contacts", "Contact Title", "string"),
  canonicalField("contacts[].email", "contacts", "Contact Email", "string"),
  canonicalField("contacts[].mobile_phone", "contacts", "Contact Mobile Phone", "string", { aliases: ["Cell phone"] }),
  canonicalField("contacts[].office_phone", "contacts", "Contact Office Phone", "string", { aliases: ["Work phone"] }),
  canonicalField("contacts[].home_phone", "contacts", "Contact Home Phone", "string"),
  canonicalField("contacts[].slack", "contacts", "Contact Slack", "string"),
  canonicalField("contacts[].fax", "contacts", "Contact Fax", "string"),
  canonicalField("source.source_system", "source", "Source System", "string", { required: true }),
  canonicalField("source.source_customer", "source", "Source Customer", "string"),
  canonicalField("source.source_record_id", "source", "Source Record ID", "string", {
    required: true,
    aliases: ["External record ID", "Order number"]
  }),
  canonicalField("source.source_record_url", "source", "Source Record URL", "url"),
  canonicalField("source.source_template", "source", "Source Template", "string"),
  canonicalField("source.submitted_at", "source", "Submitted At", "datetime"),
  canonicalField("target.target_system", "target", "Target System", "string", { required: true }),
  canonicalField("order.external_order_id", "order", "External Order ID", "string", {
    required: true,
    aliases: ["Ext ID", "Order number"]
  }),
  canonicalField("order.po_number", "order", "PO Number", "string", { aliases: ["Purchase order"] }),
  canonicalField("order.contract_number", "order", "Contract Number", "string"),
  canonicalField("order.order_title", "order", "Order Title", "string", { aliases: ["Campaign"] }),
  canonicalField("order.order_note", "order", "Order Note", "string"),
  canonicalField("order.ship_date", "order", "Requested Ship Date", "string", { aliases: ["Ship date"] }),
  canonicalField("order.due_date", "order", "Due Date", "string"),
  canonicalField("order.order_attachment", "order", "Order Attachment", "url", { aliases: ["Imported file"] }),
  canonicalField("order.artwork_folder_url", "order", "Artwork Folder URL", "url", {
    aliases: ["Art Location", "LTL Artwork Folder URL"]
  }),
  canonicalField("order.shipping.method", "shipping", "Shipping Method", "string"),
  canonicalField("order.shipping.account_number", "shipping", "Shipping Account Number", "string"),
  canonicalField("order.shipping.acct_billing_zip", "shipping", "Account Billing ZIP", "string"),
  canonicalField("order.shipping.acct_billing_country", "shipping", "Account Billing Country", "string"),
  canonicalField("order.shipping.attention_to", "shipping", "Attention To", "string"),
  canonicalField("order.shipping.company", "shipping", "Ship-To Company", "string"),
  canonicalField("order.shipping.address_1", "shipping", "Address 1", "string"),
  canonicalField("order.shipping.address_2", "shipping", "Address 2", "string"),
  canonicalField("order.shipping.city", "shipping", "City", "string"),
  canonicalField("order.shipping.state", "shipping", "State", "string"),
  canonicalField("order.shipping.postal_code", "shipping", "Postal Code", "string", { aliases: ["ZIP"] }),
  canonicalField("order.shipping.country", "shipping", "Country", "string"),
  canonicalField("order.shipping.phone", "shipping", "Phone", "string"),
  canonicalField("order.shipping.email", "shipping", "Email", "string"),
  canonicalField("order.shipping.instructions", "shipping", "Shipping Instructions", "string"),
  canonicalField("lines[].line_number", "lines", "Line Number", "integer", { repeatable: true }),
  canonicalField("lines[].unit_number", "lines", "Lift Unit Number", "string", { repeatable: true }),
  canonicalField("lines[].product_id", "lines", "Lift Product ID", "string", { repeatable: true }),
  canonicalField("lines[].customer_sku", "lines", "Customer SKU", "string", { repeatable: true }),
  canonicalField("lines[].description", "lines", "Line Description", "string", { repeatable: true }),
  canonicalField("lines[].product_name", "lines", "Product Name", "string", { repeatable: true }),
  canonicalField("lines[].quantity", "lines", "Quantity", "integer", { required: true, repeatable: true }),
  canonicalField("lines[].artwork.file_name", "lines", "Artwork File Name", "string", { repeatable: true }),
  canonicalField("lines[].artwork.file_url", "lines", "Artwork File URL", "url", { repeatable: true }),
  canonicalField("lines[].artwork.checksum", "lines", "Artwork Checksum", "string", { repeatable: true }),
  canonicalField("lines[].dimensions.final_height", "lines", "Final Height", "number", { required: true, repeatable: true }),
  canonicalField("lines[].dimensions.final_width", "lines", "Final Width", "number", { required: true, repeatable: true }),
  canonicalField("lines[].dimensions.live_height", "lines", "Live Height", "number", { repeatable: true }),
  canonicalField("lines[].dimensions.live_width", "lines", "Live Width", "number", { repeatable: true }),
  canonicalField("lines[].dimensions.bleed", "lines", "Bleed", "number", { repeatable: true }),
  canonicalField("lines[].production.material", "lines", "Production Material", "string", { repeatable: true }),
  canonicalField("lines[].production.laminate", "lines", "Production Laminate", "string", { repeatable: true }),
  canonicalField("lines[].production.coating", "lines", "Production Coating", "string", { repeatable: true }),
  canonicalField("lines[].production.premask", "lines", "Production Premask", "string", { repeatable: true }),
  canonicalField("lines[].production.ink", "lines", "Production Ink", "string", { repeatable: true }),
  canonicalField("lines[].production.cut_type", "lines", "Production Cut Type", "string", { repeatable: true }),
  canonicalField("lines[].production.hem", "lines", "Hem", "boolean", { repeatable: true }),
  canonicalField("lines[].production.grommets", "lines", "Grommets", "boolean", { repeatable: true }),
  canonicalField("lines[].shipping.method", "lines", "Line Shipping Method", "string", { repeatable: true }),
  canonicalField("lines[].shipping.account_number", "lines", "Line Shipping Account Number", "string", { repeatable: true }),
  canonicalField("lines[].shipping.acct_billing_zip", "lines", "Line Account Billing ZIP", "string", { repeatable: true }),
  canonicalField("lines[].shipping.acct_billing_country", "lines", "Line Account Billing Country", "string", {
    repeatable: true
  }),
  canonicalField("lines[].shipping.attention_to", "lines", "Line Attention To", "string", { repeatable: true }),
  canonicalField("lines[].shipping.company", "lines", "Line Ship-To Company", "string", { repeatable: true }),
  canonicalField("lines[].shipping.address_1", "lines", "Line Address 1", "string", { repeatable: true }),
  canonicalField("lines[].shipping.address_2", "lines", "Line Address 2", "string", { repeatable: true }),
  canonicalField("lines[].shipping.city", "lines", "Line City", "string", { repeatable: true }),
  canonicalField("lines[].shipping.state", "lines", "Line State", "string", { repeatable: true }),
  canonicalField("lines[].shipping.postal_code", "lines", "Line Postal Code", "string", { repeatable: true }),
  canonicalField("lines[].shipping.country", "lines", "Line Country", "string", { repeatable: true }),
  canonicalField("lines[].shipping.phone", "lines", "Line Phone", "string", { repeatable: true }),
  canonicalField("lines[].shipping.email", "lines", "Line Email", "string", { repeatable: true }),
  canonicalField("lines[].shipping.instructions", "lines", "Line Shipping Instructions", "string", { repeatable: true }),
  canonicalField("lines[].line_note", "lines", "Line Note", "string", { repeatable: true })
] as const satisfies CanonicalFieldDefinition[];

export type CanonicalFieldPath = (typeof canonicalFieldRegistry)[number]["path"];

export const canonicalFieldPaths = canonicalFieldRegistry.map((field) => field.path) as CanonicalFieldPath[];

export const canonicalRegistryMetadata = {
  registry_id: "canonical-order-v1",
  version: "1.0.0",
  status: "Active",
  updated_at: "2026-07-14T00:00:00.000Z"
} as const;

export interface ProcessingJob {
  job_id: string;
  customer_id: string;
  state: ProcessingState;
  source_file_name?: string;
  created_at: string;
  updated_at: string;
  validation_messages: ValidationMessage[];
}

export type CanonicalProductIdentifierType = "lift_unit_number" | "lift_product_id" | string;

export interface CanonicalValidationOptions {
  product_identifier_type?: CanonicalProductIdentifierType;
}

export function validateCanonicalOrder(order: CanonicalOrder, options: CanonicalValidationOptions = {}): ValidationMessage[] {
  const messages: ValidationMessage[] = [];
  const productIdentifierType = options.product_identifier_type ?? "lift_unit_number";

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

  if (order.order.artwork_folder_url) {
    try {
      const artworkFolderUrl = new URL(order.order.artwork_folder_url);
      if (artworkFolderUrl.protocol !== "https:" || artworkFolderUrl.username || artworkFolderUrl.password) {
        throw new Error("Unsafe artwork folder URL.");
      }
    } catch {
      messages.push({
        severity: "FAIL",
        code: "VAL-ART-URL",
        object: "order",
        field: "order.artwork_folder_url",
        message: "Artwork Folder URL must be a valid HTTPS URL without embedded credentials.",
        suggested_action: "Provide a secure SharePoint, Dropbox, or other approved HTTPS folder link."
      });
    }
  }

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
    if (productIdentifierType === "lift_product_id") {
      requireString(line.product_id, `${prefix}.product_id`, "line");
    } else {
      requireString(line.unit_number, `${prefix}.unit_number`, "line");
    }

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
    artwork_folder_url: "https://example.com/artwork/momentara-order",
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
