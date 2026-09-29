import type { CanonicalOrder, CanonicalOrderLine } from './index.js';
import type { JsonSourceArtwork, JsonSourceApproval } from './json-intake.js';

/** Decimal strings preserve source precision; null means unmapped, not zero. */
export type EcommerceMoney = string | null;
export interface EcommerceLine extends CanonicalOrderLine {
  /** Per-item cost and selling price; not extended line totals. */
  pricing?: { item_base_price?: EcommerceMoney; customer_price?: EcommerceMoney };
  roll_finishing?: {
    specification: 'max_roll_diameter' | 'max_labels_per_roll';
    value: number;
    // Optional source evidence; omitted diameter units mean inches under this contract.
    unit?: 'in' | 'labels';
    unwind_direction?: string | null;
    spacing?: number | null;
    spacing_unit?: 'in' | null;
  };
  sample?: boolean | null;
  proof_status?: string | null;
  source_line?: {
    external_line_id?: string; store_product?: string; store_variation_id?: string;
    artwork?: Partial<JsonSourceArtwork>;
    approval?: Partial<JsonSourceApproval> & { provider?: string };
    preview?: { url?: string; format?: string; expires_at?: string; purpose?: string };
    cut?: { type?: string; method?: string; spot_name?: string; layer_name?: string; in_file?: boolean };
    dimensions_unit?: 'in';
    area?: { value: number; unit: 'sq_in'; basis: 'bounding_box_times_quantity' };
  };
  document_delivery?: { preview_url?: string | null };
}
export interface CanonicalEcommerceOrder extends CanonicalOrder {
  source: CanonicalOrder['source'] & { schema?: string; integration_id?: string; store?: string; created_at?: string };
  order: CanonicalOrder['order'] & {
    source_status?: string | null; reference_number?: string | null;
    order_type_name?: string; market?: string; priority?: string;
    account_rep?: string | null; invoice_email?: string | null;
    billing?: {
      first_name?: string | null; last_name?: string | null; company?: string | null;
      address_1?: string | null; address_2?: string | null; city?: string | null; state?: string | null;
      postal_code?: string | null; country?: string | null; email?: string | null; phone?: string | null;
      address_book_reference?: string | null;
    };
    pricing?: {
      currency?: string | null; discount?: EcommerceMoney; subtotal?: EcommerceMoney;
      shipping?: EcommerceMoney; refund?: EcommerceMoney; tax?: EcommerceMoney; total?: EcommerceMoney;
    };
    payment?: { method?: string | null; authorized_amount?: EcommerceMoney; charged_amount?: EcommerceMoney; authorization_code?: string | null };
    coupons?: Array<{ code: string; amount?: EcommerceMoney }>;
    document_delivery?: { prepaid_label_url?: string | null };
    shipping_policy?: {
      mode?: string; blind_ship?: boolean; ship_from_name?: string; prepaid_label_supplied?: boolean;
      label_url?: string | null; label_precedence?: string; missing_ship_date?: string;
    };
  };
  lines: EcommerceLine[];
}
