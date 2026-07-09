export interface LiftCustomer {
  lift_customer_id: string;
  customer_name: string;
  customer_number?: string | null;
  customer_type?: string | null;
  customer_status?: string | null;
  sales_rep?: string | null;
  default_invoice_email_address?: string | null;
  created_date?: string | null;
}

export interface LiftCustomerDirectory {
  customers: LiftCustomer[];
  source: "lift-endpoint" | "local-seed";
  endpoint_url: string;
  loaded_at: string;
  warning?: string;
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
        sales_rep: get(row, "SALES_REP"),
        default_invoice_email_address: get(row, "DEFAULT_INVOICE_EMAIL_ADDRESS"),
        created_date: get(row, "CREATED_DATE")
      };
    })
    .filter((customer): customer is LiftCustomer => Boolean(customer))
    .sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}

export function findCustomerByName(customers: LiftCustomer[], name: string) {
  const normalizedName = name.trim().toLowerCase();
  return customers.find((customer) => customer.customer_name.trim().toLowerCase() === normalizedName);
}
