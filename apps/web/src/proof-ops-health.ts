export interface ProofIntegrationHealth {
  phase: "tokenized_customer_read_foundation" | "single_proof_customer_approval_foundation";
  storage_driver: "disabled" | "local" | "dynamodb";
  core_table_configured: boolean;
  audit_table_configured: boolean;
  lift_reads: {
    order_host: string;
    report_host: string;
    timeout_ms: number;
    concurrency: number;
    proof_readable_min_step: number | null;
    custom_auth_configured: false;
  };
  sync: {
    queue_configured: boolean;
    stale_after_minutes: number;
    automatic_refresh_max_inactive_days: number;
  };
  access: {
    edge_secret_configured: boolean;
    public_base_host: string;
    grant_ttl_days: number;
    session_ttl_minutes: number;
  };
  feature_flags: {
    grant_creation: boolean;
    proof_link_email: boolean;
    public_read: boolean;
    approve: boolean;
    revision: false;
    undo: false;
  };
  qa_lifecycle: {
    isolated_endpoint_confirmed: boolean;
    dedicated_credentials_confirmed: boolean;
    approval_cycle_confirmed: boolean;
    revision_cycle_confirmed: boolean;
    lift_writes_enabled: false;
  };
  operator_action_qa: {
    enabled: boolean;
    allowed_customer_id: "1249";
    allowed_company_id: "91";
    allowed_order_numbers: string[];
    activation_expires_at: string | null;
    jwt_ttl_seconds: number;
    advanced_quantity_allocation_enabled: boolean;
    target_id: "lift-standard-graphics";
    environment_id: "env-lift-prod";
    automatic_retry: false;
  };
  revised_art_upload: {
    enabled: boolean;
    bucket_configured: boolean;
    allowed_order_numbers: string[];
    activation_expires_at: string | null;
    maximum_bytes: number;
    allowed_content_types: string[];
    upload_ticket_seconds: number;
    scan_enabled: false;
    publication_enabled: boolean;
    lift_resolution_enabled: false;
  };
}

export interface ProofReadOnlyPosture {
  level: "deployed_customer_approval" | "deployed_read_only" | "dark_deploy_ready" | "local_qa" | "configuration_required";
  label: string;
  detail: string;
  blockers: string[];
}

export function proofReadOnlyPosture(health: ProofIntegrationHealth): ProofReadOnlyPosture {
  const unsupportedDecisionsLocked = !health.feature_flags.revision
    && !health.feature_flags.undo
    && !health.qa_lifecycle.lift_writes_enabled;
  const deployedPersistence = health.storage_driver === "dynamodb"
    && health.core_table_configured
    && health.audit_table_configured;
  const deployedBoundary = health.sync.queue_configured && health.access.edge_secret_configured;
  const blockers = [
    ...(!unsupportedDecisionsLocked ? ["Unsupported Lift decision capability must remain disabled."] : []),
    ...(!deployedPersistence ? ["Dedicated DynamoDB core and audit persistence are not fully configured."] : []),
    ...(!health.sync.queue_configured ? ["The isolated synchronization queue is not configured."] : []),
    ...(!health.access.edge_secret_configured ? ["The CloudFront-to-API edge secret is not configured."] : [])
  ];

  if (
    health.feature_flags.public_read &&
    health.feature_flags.approve &&
    deployedPersistence &&
    deployedBoundary &&
    unsupportedDecisionsLocked
  ) {
    return {
      level: "deployed_customer_approval",
      label: "Single-proof customer approval active",
      detail: "Review-scoped links can approve one current, unshared proof; revisions, undo, and advanced decisions remain locked.",
      blockers: []
    };
  }

  if (health.feature_flags.public_read && deployedPersistence && deployedBoundary && !health.feature_flags.approve && unsupportedDecisionsLocked) {
    return {
      level: "deployed_read_only",
      label: "Read-only public boundary active",
      detail: "The isolated customer read boundary is enabled; all decision and Lift-write capabilities remain locked.",
      blockers: []
    };
  }
  if (deployedPersistence && deployedBoundary && !health.feature_flags.approve && unsupportedDecisionsLocked) {
    return {
      level: "dark_deploy_ready",
      label: "Dark read-only boundary ready",
      detail: "Dedicated persistence, queue, and edge controls are configured while customer public read remains off.",
      blockers: []
    };
  }
  if (health.storage_driver === "local" && unsupportedDecisionsLocked) {
    return {
      level: "local_qa",
      label: "Local read-only QA",
      detail: "The operator surface is using isolated local persistence; deployment controls are intentionally unavailable.",
      blockers
    };
  }
  return {
    level: "configuration_required",
    label: "Deployment configuration required",
    detail: "Complete the isolated read-only infrastructure controls before a dark deployment.",
    blockers
  };
}
