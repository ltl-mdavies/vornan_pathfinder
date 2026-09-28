import type { CanonicalOrder, CanonicalOrderLine } from './index.js';

/** Additive source evidence. This does not confer a target mapping or a Proof approval. */
export interface JsonSourceArtwork {
  filename: string;
  format: 'pdf';
  pages: 1;
  page_in: { w: number; h: number };
  trim_in: { w: number; h: number };
  download_url: string;
  artwork_expires_at: string;
  artwork_sha256: string;
  bytes: number;
}
export interface JsonSourceApproval {
  approved_by: 'auto' | 'operator' | 'customer';
  approved_at: string;
  artwork_sha256: string;
}
export interface CanonicalJsonLine extends CanonicalOrderLine {
  source_line: {
    external_line_id: string;
    store_product: string;
    store_variation_id: string;
    artwork: JsonSourceArtwork;
    approval: JsonSourceApproval & { provider: string };
    preview?: { url: string; format: 'png' | 'jpg' | 'jpeg'; expires_at: string; purpose: string };
    cut: { type: string; method: string; spot_name: string; layer_name: string; in_file: boolean };
    dimensions_unit: 'in';
    area: { value: number; unit: 'sq_in'; basis: 'bounding_box_times_quantity' };
  };
}
export interface CanonicalJsonOrder extends CanonicalOrder {
  source: CanonicalOrder['source'] & {
    schema: string; integration_id: string; store: string; created_at: string;
  };
  order: CanonicalOrder['order'] & {
    order_type_name: string; market: string; priority: string;
    shipping_policy: {
      mode: 'supplier_ships'; blind_ship: boolean; ship_from_name: string;
      label_url: string | null; label_precedence: 'prepaid_required_when_supplied';
      missing_ship_date: 'configured_turnaround';
    };
  };
  lines: CanonicalJsonLine[];
}
