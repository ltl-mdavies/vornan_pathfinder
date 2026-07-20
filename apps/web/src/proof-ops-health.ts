export interface ProofIntegrationHealth {
  phase: "tokenized_customer_read_foundation";
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
    approve: false;
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
}

export interface ProofReadOnlyPosture {
  level: "deployed_read_only" | "dark_deploy_ready" | "local_qa" | "configuration_required";
  label: string;
  detail: string;
  blockers: string[];
}

export function proofReadOnlyPosture(health: ProofIntegrationHealth): ProofReadOnlyPosture {
  const decisionsLocked = !health.feature_flags.approve
    && !health.feature_flags.revision
    && !health.feature_flags.undo
    && !health.qa_lifecycle.lift_writes_enabled;
  const deployedPersistence = health.storage_driver === "dynamodb"
    && health.core_table_configured
    && health.audit_table_configured;
  const deployedBoundary = health.sync.queue_configured && health.access.edge_secret_configured;
  const blockers = [
    ...(!decisionsLocked ? ["Lift decision capability must remain disabled."] : []),
    ...(!deployedPersistence ? ["Dedicated DynamoDB core and audit persistence are not fully configured."] : []),
    ...(!health.sync.queue_configured ? ["The isolated synchronization queue is not configured."] : []),
    ...(!health.access.edge_secret_configured ? ["The CloudFront-to-API edge secret is not configured."] : [])
  ];

  if (health.feature_flags.public_read && deployedPersistence && deployedBoundary && decisionsLocked) {
    return {
      level: "deployed_read_only",
      label: "Read-only public boundary active",
      detail: "The isolated customer read boundary is enabled; all decision and Lift-write capabilities remain locked.",
      blockers: []
    };
  }
  if (deployedPersistence && deployedBoundary && decisionsLocked) {
    return {
      level: "dark_deploy_ready",
      label: "Dark read-only boundary ready",
      detail: "Dedicated persistence, queue, and edge controls are configured while customer public read remains off.",
      blockers: []
    };
  }
  if (health.storage_driver === "local" && decisionsLocked) {
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
