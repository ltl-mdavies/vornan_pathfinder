import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { OrderRollupSnapshot } from "@pathfinder/order-rollup";
import { OrderRollup } from "@pathfinder/order-rollup-ui";
import "@pathfinder/order-rollup-ui/styles.css";
import { App as ProofApp } from "../../../apps/proof/src/App";
import "../../../apps/proof/src/styles.css";
import "./styles.css";

const longFilename = "proof-card-with-an-intentionally-long-unbroken-filename-for-contained-responsive-browser-regression-0123456789.jpg";

const statusFixture: OrderRollupSnapshot = {
  order_number: "FIXTURE-ORDER-001",
  source_order_id: "fixture-source-order",
  customer: {
    source_customer_name: "Non-customer browser fixture",
    submit_customer_name: "Non-customer browser fixture"
  },
  header: {
    ext_id: "fixture-ext-id",
    order_title: "Shared proof-card regression",
    po_number: "FIXTURE-PO",
    contract_number: null,
    requested_ship_date: "2026-07-30",
    due_date: "2026-08-01",
    actual_ship_date: null,
    shipping: null,
    field_sources: {
      po_number: "submitted",
      order_title: "submitted",
      requested_ship_date: "submitted",
      due_date: "submitted"
    }
  },
  order_status: "Fixture only",
  proof_summary: {
    source: "proof_cache",
    health: "active",
    pending: 1,
    regenerating: 0,
    waiting: 0,
    reviewed: 0,
    total: 1,
    review_required: true,
    last_synced_at: "2026-07-23T12:00:00.000Z",
    decisions_enabled: false
  },
  shipment_summary: null,
  lines: [{
    line_number: 1,
    order_line_id: 1001,
    product_name: "Deterministic browser fixture",
    quantity: 1,
    proof_count: 1,
    package_count: 0,
    latest_proof_status: "PENDING",
    latest_tracking_message: null,
    packages: [],
    proofs: [{
      proof_filename: longFilename,
      proof_approval_status: "PENDING",
      proof_link_low: "https://assets.fixture.invalid/proof-low.svg",
      proof_link_high: "https://assets.fixture.invalid/proof-high.svg",
      creation_date: "2026-07-23T12:00:00.000Z",
      preview_kind: "image",
      proof_state: "pending"
    }]
  }],
  issues: [],
  refreshed_at: "2026-07-23T12:00:00.000Z"
};

function StatusProofCardFixture() {
  return (
    <main className="browser-fixture-shell">
      <p className="browser-fixture-label">Deterministic non-customer fixture</p>
      <OrderRollup
        snapshot={statusFixture}
        audience="public"
        displayDate={(value) => value ?? "Not available"}
      />
    </main>
  );
}

const fixture = window.location.pathname.startsWith("/order-rollup")
  ? <StatusProofCardFixture />
  : <ProofApp />;

createRoot(document.getElementById("root")!).render(<StrictMode>{fixture}</StrictMode>);
