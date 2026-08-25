import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import type { ProofAccessGrant, ProofAccessSession, ProofGrantCapabilityBinding } from "@pathfinder/proof-domain";
import { ltlDemoQaOrderAllowed } from "./ltl-demo-qa-profile.js";
import { getProofRuntimeConfig } from "./runtime-config.js";

type WorkspacePolicyRecord = {
  customer?: { lift_customer_id?: unknown };
  proof_capability_policy?: {
    access_mode?: unknown;
    review_experience?: unknown;
    customer_identity?: {
      proof_customer_id?: unknown;
      verified_order_number?: unknown;
      verified_at?: unknown;
    } | null;
    order_overrides?: Array<{
      order_number?: unknown;
      access_mode?: unknown;
      review_experience?: unknown;
      updated_at?: unknown;
    }>;
    updated_at?: unknown;
  };
};

export type ProofCustomerCapabilityAuthorityReader = (
  pathfinderCustomerId: string
) => Promise<WorkspacePolicyRecord | null>;

function exactTimestamp(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function exactAccessMode(value: unknown) {
  return value === "disabled" || value === "view_only" || value === "review" ? value : null;
}

function exactReviewExperience(value: unknown) {
  return value === "simple" || value === "advanced" ? value : null;
}

export function proofCapabilityBindingMatchesWorkspace(
  binding: ProofGrantCapabilityBinding,
  orderNumber: string,
  scope: ProofAccessGrant["scope"],
  workspace: WorkspacePolicyRecord | null
) {
  const policy = workspace?.proof_capability_policy;
  const identity = policy?.customer_identity;
  if (
    workspace?.customer?.lift_customer_id !== binding.pathfinder_customer_id ||
    identity?.proof_customer_id !== binding.proof_customer_id ||
    exactTimestamp(identity?.verified_at) !== binding.identity_verified_at ||
    !/^A\d{7,8}$/.test(String(identity?.verified_order_number ?? ""))
  ) {
    return false;
  }
  const override = (policy?.order_overrides ?? []).find(
    (candidate) => candidate?.order_number === orderNumber
  );
  const accessMode = exactAccessMode(override?.access_mode ?? policy?.access_mode);
  const reviewExperience = exactReviewExperience(
    override?.review_experience ?? policy?.review_experience
  );
  const source = override ? "order_override" : "customer_default";
  const policyUpdatedAt = exactTimestamp(override?.updated_at ?? policy?.updated_at);
  return Boolean(
    accessMode &&
    reviewExperience &&
    policyUpdatedAt &&
    accessMode !== "disabled" &&
    binding.access_mode === accessMode &&
    binding.review_experience === reviewExperience &&
    binding.source === source &&
    binding.policy_updated_at === policyUpdatedAt &&
    (scope === "view" || accessMode === "review")
  );
}

export function proofLtlDemoQaBindingMatchesWorkspace(
  binding: ProofGrantCapabilityBinding,
  orderNumber: string,
  scope: ProofAccessGrant["scope"],
  workspace: WorkspacePolicyRecord | null
) {
  const profile = getProofRuntimeConfig().ltl_demo_qa;
  const policy = workspace?.proof_capability_policy;
  const identity = policy?.customer_identity;
  const override = (policy?.order_overrides ?? []).find(
    (candidate) => candidate?.order_number === orderNumber
  );
  const policyUpdatedAt = exactTimestamp(override?.updated_at ?? policy?.updated_at);
  return Boolean(
    binding.source === "ltl_demo_qa" &&
    profile.active &&
    profile.persistent &&
    profile.grant_creation_enabled &&
    profile.public_read_enabled &&
    ltlDemoQaOrderAllowed(profile, orderNumber) &&
    workspace?.customer?.lift_customer_id === profile.allowed_customer_id &&
    binding.pathfinder_customer_id === profile.allowed_customer_id &&
    binding.proof_customer_id === profile.allowed_customer_id &&
    identity?.proof_customer_id === binding.proof_customer_id &&
    exactTimestamp(identity?.verified_at) === binding.identity_verified_at &&
    /^A\d{7,8}$/.test(String(identity?.verified_order_number ?? "")) &&
    policyUpdatedAt === binding.policy_updated_at &&
    binding.review_experience === "simple" &&
    (scope === "view" || (
      binding.access_mode === "review" &&
      (profile.customer_approval_enabled || profile.asset_upload_enabled)
    ))
  );
}

async function readDynamoWorkspace(pathfinderCustomerId: string) {
  const tableName = process.env.PATHFINDER_PROOF_CUSTOMER_WORKSPACES_TABLE?.trim();
  if (!tableName || !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName)) return null;
  const response = await new DynamoDBClient({}).send(new GetItemCommand({
    TableName: tableName,
    Key: { customer_id: { S: pathfinderCustomerId } },
    ConsistentRead: true,
    ProjectionExpression: "customer_id, #data",
    ExpressionAttributeNames: { "#data": "data" }
  }));
  const data = response.Item?.data?.S;
  if (!data) return null;
  try {
    return JSON.parse(data) as WorkspacePolicyRecord;
  } catch {
    return null;
  }
}

export async function revalidateProofCustomerCapability(
  subject: Pick<ProofAccessGrant | ProofAccessSession, "order_number" | "scope" | "capability">,
  readWorkspace: ProofCustomerCapabilityAuthorityReader = readDynamoWorkspace
) {
  const binding = subject.capability;
  if (!binding) return subject.scope === "view";
  if (
    !/^\d{1,20}$/.test(binding.proof_customer_id ?? "") ||
    !Number.isFinite(Date.parse(binding.identity_verified_at ?? ""))
  ) {
    return false;
  }
  try {
    const workspace = await readWorkspace(binding.pathfinder_customer_id);
    if (binding.source === "ltl_demo_qa") {
      return proofLtlDemoQaBindingMatchesWorkspace(
        binding,
        subject.order_number,
        subject.scope,
        workspace
      );
    }
    return proofCapabilityBindingMatchesWorkspace(
      binding,
      subject.order_number,
      subject.scope,
      workspace
    );
  } catch {
    return false;
  }
}
