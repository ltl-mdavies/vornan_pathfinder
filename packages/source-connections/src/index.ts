export type SourceConnectorProvider =
  | "wrike"
  | "odoo"
  | "asana"
  | "sharepoint"
  | "salesforce"
  | "generic_rest";

export type SourceConnectorAvailability = "Available" | "Planned";
export type SourceConnectionStatus = "Draft" | "Active" | "Inactive";
export type SourceConnectionEnvironment = "Production" | "Sandbox";
export type SourceConnectionAuthStrategy = "oauth2" | "api_key" | "basic" | "bearer" | "configurable";

export interface SourceConnectorDefinition {
  provider: SourceConnectorProvider;
  name: string;
  description: string;
  category: "Work management" | "ERP" | "Content platform" | "CRM" | "Generic";
  availability: SourceConnectorAvailability;
  auth_strategy: SourceConnectionAuthStrategy;
  capabilities: {
    records: boolean;
    attachments: boolean;
    webhooks: boolean;
    polling: boolean;
    writes: boolean;
  };
}

export interface CustomerSourceConnection {
  connection_id: string;
  name: string;
  provider: SourceConnectorProvider;
  status: SourceConnectionStatus;
  environment: SourceConnectionEnvironment;
  auth_strategy: SourceConnectionAuthStrategy;
  created_at: string;
  updated_at: string;
}

export const SOURCE_CONNECTOR_DEFINITIONS: SourceConnectorDefinition[] = [
  {
    provider: "wrike",
    name: "Wrike",
    description: "Read approved tasks and order workbooks from a customer-owned Wrike workspace.",
    category: "Work management",
    availability: "Available",
    auth_strategy: "oauth2",
    capabilities: { records: true, attachments: true, webhooks: true, polling: true, writes: false }
  },
  {
    provider: "odoo",
    name: "Odoo",
    description: "Connect customer sales, order, and document workflows from Odoo.",
    category: "ERP",
    availability: "Planned",
    auth_strategy: "configurable",
    capabilities: { records: true, attachments: true, webhooks: true, polling: true, writes: false }
  },
  {
    provider: "asana",
    name: "Asana",
    description: "Read approved projects, tasks, and attached order files from Asana.",
    category: "Work management",
    availability: "Planned",
    auth_strategy: "oauth2",
    capabilities: { records: true, attachments: true, webhooks: true, polling: true, writes: false }
  },
  {
    provider: "sharepoint",
    name: "Microsoft SharePoint",
    description: "Read approved files and list records from a customer SharePoint tenant.",
    category: "Content platform",
    availability: "Planned",
    auth_strategy: "oauth2",
    capabilities: { records: true, attachments: true, webhooks: true, polling: true, writes: false }
  },
  {
    provider: "salesforce",
    name: "Salesforce",
    description: "Read approved order records and related files from Salesforce.",
    category: "CRM",
    availability: "Planned",
    auth_strategy: "oauth2",
    capabilities: { records: true, attachments: true, webhooks: true, polling: true, writes: false }
  },
  {
    provider: "generic_rest",
    name: "Generic REST API",
    description: "Define a constrained read-only integration for a supported customer API.",
    category: "Generic",
    availability: "Planned",
    auth_strategy: "configurable",
    capabilities: { records: true, attachments: false, webhooks: false, polling: true, writes: false }
  }
];

export function getSourceConnectorDefinition(provider: SourceConnectorProvider) {
  return SOURCE_CONNECTOR_DEFINITIONS.find((definition) => definition.provider === provider) ?? null;
}

export function normalizeCustomerSourceConnection(value: CustomerSourceConnection): CustomerSourceConnection {
  const definition = getSourceConnectorDefinition(value.provider);
  const timestamp = value.updated_at || value.created_at || new Date(0).toISOString();
  return {
    connection_id: value.connection_id.trim(),
    name: value.name.trim() || definition?.name || "Source connection",
    provider: definition?.provider ?? "generic_rest",
    status: ["Draft", "Active", "Inactive"].includes(value.status) ? value.status : "Draft",
    environment: value.environment === "Sandbox" ? "Sandbox" : "Production",
    auth_strategy: definition?.auth_strategy ?? "configurable",
    created_at: value.created_at || timestamp,
    updated_at: timestamp
  };
}
