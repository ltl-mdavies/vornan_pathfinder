import type { OperationsProofLine, QueueState } from "../../apps/web/src/operations-model";
import type { ProofIntegrationHealth } from "../../apps/web/src/proof-ops-health";

// Synthetic, local-only records; these order numbers must never reach a provider.
const customers = [["284619", "Empirical – Momentara"], ["174094", "Silicon Pasture"], ["1249", "LTL Demo"]];
const states: QueueState[] = ["pending", "waiting", "changes", "approved", "reference", "cancel_requested", "revision_pending", "reviewed", "unavailable"];
export const proofLines: OperationsProofLine[] = Array.from({length: 54}, (_, index) => {
  const orderIndex = Math.floor(index / 3), customer = customers[orderIndex % 3];
  const mixed = index % 7 === 0;
  return {
    id: `sample-proof-line-${index}`, orderNumber: `A${String(9000000 + orderIndex)}`, orderTitle: ["Autumn retail campaign", "Sticker Press production", "LTL Demo proof QA"][orderIndex % 3],
    customerId: customer[0], customer: customer[1], lineNumber: String(index % 3 + 1),
    product: ["Pump topper · Exxon", "Window graphic · 30.375 × 46.375", "Counter card · regional promotion with revised artwork"][index % 3],
    state: mixed || index % 2 === 0 ? "pending" : states[index % states.length], creativeCount: mixed ? 2 : 1,
    stateCounts: mixed ? {pending: 1, changes: 1} : undefined,
    since: index % 11 === 0 ? null : new Date(Date.UTC(2026, 9, 22, 9, index * 3)).toISOString(),
    lastSynced: new Date(Date.UTC(2026, 9, index % 8 === 0 ? 22 : 23, 16, 20)).toISOString(), stale: index % 8 === 0
  };
});
export const proofHealth: ProofIntegrationHealth = {
  phase: "tokenized_customer_read_foundation", storage_driver: "local", core_table_configured: false, audit_table_configured: false,
  lift_reads: {order_host: "local-fixtures.invalid", report_host: "local-fixtures.invalid", timeout_ms: 15000, concurrency: 5, proof_readable_min_step: 7, custom_auth_configured: false},
  sync: {queue_configured: false, stale_after_minutes: 15, automatic_refresh_max_inactive_days: 14},
  access: {edge_secret_configured: false, public_base_host: "local-fixtures.invalid", grant_ttl_days: 30, session_ttl_minutes: 60},
  feature_flags: {grant_creation: false, proof_link_email: false, public_read: false, approve: false, revision: false, undo: false},
  qa_lifecycle: {isolated_endpoint_confirmed: false, dedicated_credentials_confirmed: false, approval_cycle_confirmed: false, revision_cycle_confirmed: false, lift_writes_enabled: false},
  ltl_demo_qa: {active: false, allowed_customer_id: "1249", allowed_order_numbers: [], all_ltl_demo_orders: false, activation_expires_at: null, grant_creation_enabled: false, public_read_enabled: false, customer_approval_enabled: false, asset_upload_enabled: false, automatic_retry: false},
  operator_action_qa: {enabled: false, allowed_customer_id: "1249", allowed_company_id: "91", allowed_order_numbers: [], activation_expires_at: null, jwt_ttl_seconds: 60, advanced_quantity_allocation_enabled: false, target_id: "lift-standard-graphics", environment_id: "env-lift-prod", automatic_retry: false},
  revised_art_upload: {enabled: false, bucket_configured: false, allowed_order_numbers: [], activation_expires_at: null, maximum_bytes: 1000000, allowed_content_types: [], upload_ticket_seconds: 60, scan_enabled: false, publication_enabled: false, lift_resolution_enabled: false}
};
export function cachedProofOrder(number: string) {
  const lines = proofLines.filter(row => row.orderNumber === number);
  if (!lines.length) return null;
  const first = lines[0];
  return {
    order: {order_number: number, customer_id: first.customerId, customer_name: first.customer, order_title: first.orderTitle, order_status: "Pending art approval", health: "local_fixture", last_synced_at: first.lastSynced,
      tasks: lines.map(row => ({task_id: row.id, order_line_id: row.id, line_number: row.lineNumber, attachment_id: `sample-${row.id}`, product_name: row.product, quantity: 100, state: row.state, actionable: false, current_version: {version_id: `version-${row.id}`, filename: `sample-line-${row.lineNumber}.pdf`, attachment_id: `sample-${row.id}`}}))},
    customer_capability: {association_status: "associated", pathfinder_customer_id: first.customerId, customer_name: first.customer, access_mode: "disabled", review_experience: "simple", source: "safe_default", policy_updated_at: null}
  };
}
