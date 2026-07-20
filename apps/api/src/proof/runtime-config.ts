import {
  DEFAULT_LIFT_PROOF_ORDER_READ_URL,
  DEFAULT_LIFT_PROOF_REPORT_READ_URL,
  type LiftProofReadConfig
} from "@pathfinder/lift-proof-adapter";

export type ProofStorageDriver = "disabled" | "local" | "dynamodb";

export interface ProofRuntimeConfig {
  phase: "tokenized_customer_read_foundation";
  storage_driver: ProofStorageDriver;
  core_table_name: string | null;
  audit_table_name: string | null;
  read: LiftProofReadConfig;
  feature_flags: {
    grant_creation: boolean;
    proof_link_email: boolean;
    public_read: boolean;
    approve: false;
    revision: false;
    undo: false;
  };
  access: {
    public_base_url: string;
    grant_ttl_days: number;
    session_ttl_minutes: number;
    edge_shared_secret: string | null;
  };
  sync: {
    queue_url: string | null;
    stale_after_minutes: number;
    automatic_refresh_max_inactive_days: number;
  };
  qa_lifecycle: {
    isolated_endpoint_confirmed: boolean;
    dedicated_credentials_confirmed: boolean;
    approval_cycle_confirmed: boolean;
    revision_cycle_confirmed: boolean;
    lift_writes_enabled: false;
  };
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getProofRuntimeConfig(): ProofRuntimeConfig {
  const requestedStorageDriver = process.env.PATHFINDER_PROOF_STORAGE_DRIVER;
  const storageDriver: ProofStorageDriver =
    requestedStorageDriver === "dynamodb" || requestedStorageDriver === "local"
      ? requestedStorageDriver
      : process.env.PATHFINDER_RUNTIME === "lambda"
        ? "disabled"
        : "local";

  return {
    phase: "tokenized_customer_read_foundation",
    storage_driver: storageDriver,
    core_table_name: process.env.PATHFINDER_PROOF_CORE_TABLE?.trim() || null,
    audit_table_name: process.env.PATHFINDER_PROOF_AUDIT_TABLE?.trim() || null,
    read: {
      order_read_url: process.env.PATHFINDER_PROOF_LIFT_ORDER_READ_URL ?? DEFAULT_LIFT_PROOF_ORDER_READ_URL,
      proof_report_read_url:
        process.env.PATHFINDER_PROOF_LIFT_REPORT_READ_URL ?? DEFAULT_LIFT_PROOF_REPORT_READ_URL,
      timeout_ms: positiveNumber(process.env.PATHFINDER_PROOF_LIFT_READ_TIMEOUT_MS, 15_000),
      concurrency: Math.min(5, positiveNumber(process.env.PATHFINDER_PROOF_LIFT_READ_CONCURRENCY, 5)),
      proof_readable_min_step: optionalNumber(process.env.PATHFINDER_PROOF_READABLE_MIN_STEP)
    },
    feature_flags: {
      grant_creation: process.env.PATHFINDER_PROOF_ENABLE_GRANT_CREATION === "true",
      proof_link_email: process.env.PATHFINDER_PROOF_ENABLE_LINK_EMAIL === "true",
      public_read: process.env.PATHFINDER_PROOF_ENABLE_PUBLIC_READ === "true",
      approve: false,
      revision: false,
      undo: false
    },
    access: {
      public_base_url: (process.env.PATHFINDER_PROOF_PUBLIC_BASE_URL ?? "https://proof.vornan.co").replace(/\/$/, ""),
      grant_ttl_days: positiveNumber(process.env.PATHFINDER_PROOF_GRANT_TTL_DAYS, 14),
      session_ttl_minutes: Math.min(24 * 60, positiveNumber(process.env.PATHFINDER_PROOF_SESSION_TTL_MINUTES, 30)),
      edge_shared_secret: process.env.PATHFINDER_PROOF_EDGE_SHARED_SECRET?.trim() || null
    },
    sync: {
      queue_url: process.env.PATHFINDER_PROOF_SYNC_QUEUE_URL?.trim() || null,
      stale_after_minutes: positiveNumber(process.env.PATHFINDER_PROOF_STALE_AFTER_MINUTES, 15),
      automatic_refresh_max_inactive_days: Math.min(
        365,
        positiveInteger(process.env.PATHFINDER_PROOF_AUTO_REFRESH_MAX_INACTIVE_DAYS, 14)
      )
    },
    qa_lifecycle: {
      isolated_endpoint_confirmed: process.env.PATHFINDER_PROOF_QA_ISOLATED_ENDPOINT_CONFIRMED === "true",
      dedicated_credentials_confirmed: process.env.PATHFINDER_PROOF_QA_DEDICATED_CREDENTIALS_CONFIRMED === "true",
      approval_cycle_confirmed: process.env.PATHFINDER_PROOF_QA_APPROVAL_CYCLE_CONFIRMED === "true",
      revision_cycle_confirmed: process.env.PATHFINDER_PROOF_QA_REVISION_CYCLE_CONFIRMED === "true",
      lift_writes_enabled: false
    }
  };
}

export function assertLiftProofWritesDisabled() {
  const config = getProofRuntimeConfig();
  if (config.feature_flags.approve || config.feature_flags.revision || config.feature_flags.undo || config.qa_lifecycle.lift_writes_enabled) {
    throw new Error("Vornan Proof Lift writes must remain disabled until the isolated QA lifecycle is confirmed.");
  }
}
