export interface LiftCustomer {
  lift_customer_id: string;
  customer_name: string;
  customer_number?: string | null;
  customer_type?: string | null;
  customer_status?: string | null;
  crm_id?: string | null;
  terms?: string | null;
  terms_status?: string | null;
  credit_limit?: number | null;
  credit_hold?: string | null;
  unpaid_total?: number | null;
  available_credit?: number | null;
  sales_rep?: string | null;
  default_invoice_email_address?: string | null;
  created_date?: string | null;
}

export interface LiftCustomerDirectory {
  customers: LiftCustomer[];
  source: "lift-endpoint" | "local-seed";
  endpoint_url: string;
  status_endpoint_url?: string;
  loaded_at: string;
  warning?: string;
}

export interface LiftCustomerStatus {
  lift_customer_id: string;
  customer_name?: string | null;
  customer_number?: string | null;
  customer_status?: string | null;
  crm_id?: string | null;
  terms?: string | null;
  terms_status?: string | null;
  credit_limit?: number | null;
  credit_hold?: string | null;
  unpaid_total?: number | null;
  available_credit?: number | null;
}

function parseCsvRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let insideQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const nextChar = csv[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string) {
  return value.trim().replace(/^\uFEFF/, "").toUpperCase();
}

function valueOrNull(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

function stringFromUnknown(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function parseLiftCustomerCsv(csv: string): LiftCustomer[] {
  const [headers = [], ...rows] = parseCsvRows(csv);
  const headerMap = new Map(headers.map((header, index) => [normalizeHeader(header), index]));

  const get = (row: string[], header: string) => valueOrNull(row[headerMap.get(header) ?? -1]);

  return rows
    .map<LiftCustomer | null>((row) => {
      const liftCustomerId = get(row, "CUSTOMER_ID");
      const customerName = get(row, "CUSTOMER_NAME");

      if (!liftCustomerId || !customerName) {
        return null;
      }

      return {
        lift_customer_id: liftCustomerId,
        customer_name: customerName,
        customer_number: get(row, "CUSTOMER_NUMBER"),
        customer_type: get(row, "CUSTOMER_TYPE"),
        customer_status: get(row, "CUSTOMER_STATUS"),
        crm_id: get(row, "CRM_ID"),
        sales_rep: get(row, "SALES_REP"),
        default_invoice_email_address: get(row, "DEFAULT_INVOICE_EMAIL_ADDRESS"),
        created_date: get(row, "CREATED_DATE")
      };
    })
    .filter((customer): customer is LiftCustomer => Boolean(customer))
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}

function statusRowsFromJson(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["items", "rows", "data", "customers", "CUSTOMERS"]) {
      if (Array.isArray(record[key])) {
        return record[key];
      }
    }
  }

  return [];
}

export function parseLiftCustomerStatusJson(payload: unknown): LiftCustomerStatus[] {
  return statusRowsFromJson(payload)
    .map<LiftCustomerStatus | null>((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const record = row as Record<string, unknown>;
      const liftCustomerId = stringFromUnknown(record.CUSTOMER_ID ?? record.customer_id);

      if (!liftCustomerId) {
        return null;
      }

      return {
        lift_customer_id: liftCustomerId,
        customer_name: stringFromUnknown(record.CUSTOMER_NAME ?? record.customer_name),
        customer_number: stringFromUnknown(record.CUSTOMER_NUMBER ?? record.customer_number),
        customer_status: stringFromUnknown(record.CUSTOMER_STATUS ?? record.customer_status),
        crm_id: stringFromUnknown(record.CRM_ID ?? record.crm_id),
        terms: stringFromUnknown(record.TERMS ?? record.terms),
        terms_status: stringFromUnknown(record.TERMS_STATUS ?? record.terms_status),
        credit_limit: numberFromUnknown(record.CREDIT_LIMIT ?? record.credit_limit),
        credit_hold: stringFromUnknown(record.CREDIT_HOLD ?? record.credit_hold),
        unpaid_total: numberFromUnknown(record.UNPAID_TOTAL ?? record.unpaid_total),
        available_credit: numberFromUnknown(
          record.AVAILABLE_CREDIT ??
            record.available_credit ??
            record.AVILABLE_CREDIT ??
            record.avilable_credit
        )
      };
    })
    .filter((status): status is LiftCustomerStatus => Boolean(status));
}

export function enrichLiftCustomers(customers: LiftCustomer[], statuses: LiftCustomerStatus[]) {
  const byId = new Map(statuses.map((status) => [status.lift_customer_id, status]));
  const byNumber = new Map(
    statuses
      .filter((status) => status.customer_number)
      .map((status) => [status.customer_number as string, status])
  );

  return customers.map((customer) => {
    const status = byId.get(customer.lift_customer_id) ?? (customer.customer_number ? byNumber.get(customer.customer_number) : undefined);

    if (!status) {
      return customer;
    }

    return {
      ...customer,
      customer_name: status.customer_name ?? customer.customer_name,
      customer_number: status.customer_number ?? customer.customer_number,
      customer_status: status.customer_status ?? customer.customer_status,
      crm_id: status.crm_id ?? customer.crm_id ?? null,
      terms: status.terms ?? customer.terms ?? null,
      terms_status: status.terms_status ?? customer.terms_status ?? null,
      credit_limit: status.credit_limit ?? customer.credit_limit ?? null,
      credit_hold: status.credit_hold ?? customer.credit_hold ?? null,
      unpaid_total: status.unpaid_total ?? customer.unpaid_total ?? null,
      available_credit: status.available_credit ?? customer.available_credit ?? null
    };
  });
}

export function findCustomerByName(customers: LiftCustomer[], name: string) {
  const normalizedName = name.trim().toLowerCase();
  return customers.find((customer) => customer.customer_name.trim().toLowerCase() === normalizedName);
}
