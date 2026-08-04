import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ClipboardCheck, Copy, Database, FileCheck2, History, Link2, LockKeyhole, Mail, Network, Plus, RefreshCw, ShieldCheck, Unlink, UploadCloud, UserRound, X } from "lucide-react";
import { proofReadOnlyPosture, type ProofIntegrationHealth } from "./proof-ops-health";
import {
  assertPrivateProofUploadDestination,
  buildProofUploadForm,
  proofUploadContentType,
  sanitizeProofUploadFilename,
  sha256ProofUpload
} from "./proof-asset-upload";

interface ProofGrant {
  grant_id: string;
  order_number: string;
  scope: "view";
  label: string | null;
  status: "active" | "revoked";
  created_at: string;
  expires_at: string;
  exchanged_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  participant_count: number;
}

interface ProofParticipant {
  participant_id: string;
  display_name: string;
  email: string;
  first_seen_at: string;
  last_seen_at: string;
}

interface ProofOrderSummary {
  order_number: string;
  customer_id?: string | null;
  customer_name?: string | null;
  order_title: string | null;
  order_status: string | null;
  health: string;
  tasks: ProofTaskSummary[];
  last_synced_at: string;
  last_sync_diagnostics?: {
    source: "lift_read";
    completed_at: string;
    line_reads: { attempted: number; succeeded: number; failed: number; proof_rows: number };
    fallback_read: { attempted: boolean; ok: boolean | null; proof_rows: number };
    normalization_warning_count: number;
  } | null;
}

interface ProofTaskSummary {
  task_id: string;
  order_line_id: string | null;
  line_number: string | null;
  attachment_id: string | null;
  product_name: string | null;
  quantity: number | null;
  state: string;
  actionable: boolean;
  decision_context?: {
    state:
      | "rejected_pending_action"
      | "sent_back_to_artist"
      | "revised_art_pending"
      | "cancel_requested";
    action: "REJECT" | "SEND_BACK_TO_ARTIST" | "REVISED_ART_WILL_BE_SENT" | "CANCEL_LINE";
    attachment_id: string;
    recorded_at: string;
    source: "pathfinder_operator_action";
  } | null;
  current_version: {
    version_id: string;
    filename: string | null;
    attachment_id: string | null;
  } | null;
}

interface ResolvedCustomerProofCapability {
  association_status: "associated" | "unassociated" | "ambiguous";
  pathfinder_customer_id: string | null;
  customer_name: string | null;
  access_mode: "disabled" | "view_only" | "review";
  review_experience: "simple" | "advanced";
  source: "customer_default" | "order_override" | "safe_default";
  policy_updated_at: string | null;
}

interface ProofAssetUploadSummary {
  asset_id: string;
  revision_id: string;
  order_number: string;
  task_id: string;
  attachment_id: string;
  original_filename: string;
  content_type: string;
  content_length: number;
  sha256: string;
  state: "initialized" | "uploading" | "uploaded" | "verifying" | "scan_pending" | "ready_for_lift";
  record_version: number;
  initialized_at: string;
  upload_completed_at: string | null;
  verification_status: "pending" | "quarantined" | "cleared";
  publication_status: "not_started" | "published" | "delivery_verified";
}

export type ProofActionDraftKind =
  | "APPROVE"
  | "REJECT"
  | "SEND_BACK_TO_ARTIST"
  | "CANCEL_LINE"
  | "REVISED_ART_WILL_BE_SENT";

export type ProofApprovalMode = "simple" | "quantity_allocation";

export interface ProofApprovalAllocation {
  task_id: string;
  attachment_id: string;
  approve_quantity: number;
}

export interface ProofActionDraft {
  order_number: string;
  task_id: string;
  order_line_id: string | null;
  proofing_id: string;
  proof_filename: string | null;
  action: ProofActionDraftKind;
  approval_mode: ProofApprovalMode | null;
  approve_quantity: number | null;
  allocation_plan: ProofApprovalAllocation[] | null;
  expected_line_quantity: number | null;
  comment: string | null;
  revision_asset_id: string | null;
  execution: "locked";
  automatic_retry: false;
  confirmation: "authoritative_read_after_write_required";
}

function decisionContextLabel(task: ProofTaskSummary | null) {
  switch (task?.decision_context?.state) {
    case "rejected_pending_action":
      return "Rejected — choose what happens next";
    case "sent_back_to_artist":
      return "Sent back to artist — awaiting revised direction";
    case "revised_art_pending":
      return "Revised artwork pending";
    case "cancel_requested":
      return "Line cancellation requested";
    default:
      return null;
  }
}

function availableProofActions(task: ProofTaskSummary | null): ProofActionDraftKind[] {
  switch (task?.decision_context?.state) {
    case "rejected_pending_action":
      return ["SEND_BACK_TO_ARTIST", "CANCEL_LINE", "REVISED_ART_WILL_BE_SENT"];
    case "sent_back_to_artist":
      return ["CANCEL_LINE", "REVISED_ART_WILL_BE_SENT"];
    case "revised_art_pending":
    case "cancel_requested":
      return [];
    default:
      return ["APPROVE", "REJECT"];
  }
}

function proofActionLabel(action: ProofActionDraftKind) {
  switch (action) {
    case "APPROVE": return "Approve";
    case "REJECT": return "Reject";
    case "SEND_BACK_TO_ARTIST": return "Send back to artist";
    case "CANCEL_LINE": return "Cancel line";
    case "REVISED_ART_WILL_BE_SENT": return "Revised artwork will be provided";
  }
}

export function buildProofActionDraft(input: {
  order: ProofOrderSummary;
  taskId: string;
  action: ProofActionDraftKind;
  approvalMode: ProofApprovalMode;
  allocationPlan: ProofApprovalAllocation[];
  comment: string;
  revisionAssetId: string;
}): ProofActionDraft {
  if (input.order.customer_id !== "1249") {
    throw new Error("Proof action testing is restricted to the LTL Demo customer (1249).");
  }
  const task = input.order.tasks.find((candidate) => candidate.task_id === input.taskId);
  if (!task || !task.actionable || !task.attachment_id || !task.current_version) {
    throw new Error("Choose a current actionable proof.");
  }
  if (task.current_version.attachment_id && task.current_version.attachment_id !== task.attachment_id) {
    throw new Error("The current proof attachment does not match the selected task.");
  }
  let approveQuantity: number | null = null;
  let allocationPlan: ProofApprovalAllocation[] | null = null;
  let expectedLineQuantity: number | null = null;
  if (input.action === "APPROVE") {
    if (!Number.isSafeInteger(task.quantity) || (task.quantity ?? 0) <= 0) {
      throw new Error("The authoritative Lift line quantity is unavailable.");
    }
    expectedLineQuantity = task.quantity!;
    const currentProofs = input.order.tasks
      .filter((candidate) =>
        candidate.order_line_id === task.order_line_id &&
        candidate.actionable &&
        candidate.attachment_id &&
        candidate.current_version?.attachment_id === candidate.attachment_id
      )
      .sort((left, right) =>
        (left.attachment_id ?? "").localeCompare(right.attachment_id ?? "")
      );
    if (input.approvalMode === "simple" && currentProofs.length !== 1) {
      throw new Error("A line with multiple current proofs requires a complete quantity allocation.");
    }
    if (input.approvalMode === "quantity_allocation") {
      if (!task.order_line_id) {
        throw new Error("Advanced approval requires a current Lift line.");
      }
      allocationPlan = [...input.allocationPlan].sort((left, right) =>
        left.attachment_id.localeCompare(right.attachment_id)
      );
      if (
        currentProofs.length < 2 ||
        currentProofs.length !== allocationPlan.length ||
        currentProofs.some((candidate) => candidate.quantity !== expectedLineQuantity)
      ) {
        throw new Error("Advanced approval requires multiple current proofs on one line.");
      }
      const seen = new Set<string>();
      currentProofs.forEach((proof, index) => {
        const allocation = allocationPlan![index];
        if (
          !allocation ||
          allocation.task_id !== proof.task_id ||
          allocation.attachment_id !== proof.attachment_id ||
          !Number.isSafeInteger(allocation.approve_quantity) ||
          allocation.approve_quantity <= 0 ||
          seen.has(allocation.attachment_id)
        ) {
          throw new Error("Enter a positive whole-number quantity for every current proof.");
        }
        seen.add(allocation.attachment_id);
      });
      const allocated = allocationPlan.reduce(
        (total, allocation) => total + allocation.approve_quantity,
        0
      );
      if (allocated !== expectedLineQuantity) {
        throw new Error(
          `Allocate all ${expectedLineQuantity} items across the current proofs. ${expectedLineQuantity - allocated} remaining.`
        );
      }
      approveQuantity = allocationPlan.find(
        (allocation) => allocation.task_id === task.task_id
      )?.approve_quantity ?? null;
      if (approveQuantity === null) {
        throw new Error("The selected proof is missing from the allocation.");
      }
    }
  }
  const revisionAssetId = input.action === "REVISED_ART_WILL_BE_SENT"
    ? input.revisionAssetId.trim()
    : null;
  if (
    input.action === "REVISED_ART_WILL_BE_SENT" &&
    !/^passet_[a-f0-9]{64}$/.test(revisionAssetId ?? "")
  ) {
    throw new Error(
      "Revised art requires a verified Pathfinder Proof upload that has completed scanning, publication, and delivery settling."
    );
  }
  const comment = input.comment.trim();
  if (comment.length > 2_000) throw new Error("The production-team message is too long.");
  return {
    order_number: input.order.order_number,
    task_id: task.task_id,
    order_line_id: task.order_line_id,
    proofing_id: task.attachment_id,
    proof_filename: task.current_version.filename,
    action: input.action,
    approval_mode: input.action === "APPROVE" ? input.approvalMode : null,
    approve_quantity: approveQuantity,
    allocation_plan: allocationPlan,
    expected_line_quantity: expectedLineQuantity,
    comment: comment || null,
    revision_asset_id: revisionAssetId,
    execution: "locked",
    automatic_retry: false,
    confirmation: "authoritative_read_after_write_required"
  };
}

interface ProofAuditEvent {
  event_id: string;
  occurred_at: string;
  action: string;
  outcome: "succeeded" | "failed";
  actor_type: "operator" | "customer_session" | "system";
  correlation_id: string;
  metadata: { source: string };
}

async function responseJson<T>(response: Response) {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Vornan Proof request failed.");
  return body;
}

function dateLabel(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

const QA_ORDER_STORAGE_KEY = "pathfinder.proof.qa-orders";

function initialQaOrders() {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(QA_ORDER_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((candidate): candidate is string => typeof candidate === "string" && /^A\d{7,8}$/.test(candidate))
      .slice(-12);
  } catch {
    return [];
  }
}

export function ProofOpsPanel({ apiBaseUrl, authToken }: { apiBaseUrl: string; authToken: string | null }) {
  const [orderNumber, setOrderNumber] = useState("");
  const [label, setLabel] = useState("");
  const [order, setOrder] = useState<ProofOrderSummary | null>(null);
  const [customerCapability, setCustomerCapability] =
    useState<ResolvedCustomerProofCapability | null>(null);
  const [grants, setGrants] = useState<ProofGrant[]>([]);
  const [auditEvents, setAuditEvents] = useState<ProofAuditEvent[]>([]);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [health, setHealth] = useState<ProofIntegrationHealth | null>(null);
  const [oneTimeAccess, setOneTimeAccess] = useState<{ grantId: string; url: string } | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ grant: ProofGrant; action: "revoke" | "regenerate" } | null>(null);
  const [reviewerGrantId, setReviewerGrantId] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<Record<string, ProofParticipant[]>>({});
  const [qaOrders, setQaOrders] = useState<string[]>(initialQaOrders);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [proofAction, setProofAction] = useState<ProofActionDraftKind>("APPROVE");
  const [allocationQuantities, setAllocationQuantities] = useState<Record<string, number>>({});
  const [proofComment, setProofComment] = useState("");
  const [revisionAssetId, setRevisionAssetId] = useState("");
  const [revisionUploadFile, setRevisionUploadFile] = useState<File | null>(null);
  const [revisionUploadProgress, setRevisionUploadProgress] = useState(0);
  const [revisionUploadState, setRevisionUploadState] = useState<
    "idle" | "hashing" | "uploading" | "finalizing" | "pending_verification" | "error"
  >("idle");
  const [revisionUploadAsset, setRevisionUploadAsset] = useState<ProofAssetUploadSummary | null>(null);
  const [preparedAction, setPreparedAction] = useState<{
    request: Record<string, unknown>;
    confirmation_phrase: string;
    action_id: string;
  } | null>(null);
  const [actionConfirmation, setActionConfirmation] = useState("");
  const [actionResult, setActionResult] = useState<{
    outcome: string;
    classification: string | null;
    task_state: string | null;
  } | null>(null);
  const [actionRequiresFreshSync, setActionRequiresFreshSync] = useState(false);
  const operatorActionInFlight = useRef(false);
  const revisionUploadKeys = useRef(new Map<string, string>());

  const request = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
    return fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  };

  useEffect(() => {
    void request("/api/proof/health/lift")
      .then((response) => responseJson<ProofIntegrationHealth>(response))
      .then(setHealth)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Proof health is unavailable."));
  }, [apiBaseUrl, authToken]);

  const normalizedOrderNumber = orderNumber.trim().toUpperCase();
  const advancedCustomerEnabled =
    customerCapability?.association_status === "associated" &&
    customerCapability.access_mode === "review" &&
    customerCapability.review_experience === "advanced";

  useEffect(() => {
    if (!order) return;
    const firstActionable = order.tasks.find((task) => task.actionable && task.attachment_id && task.current_version);
    setSelectedTaskId(firstActionable?.task_id ?? "");
    setAllocationQuantities({});
    setProofAction("APPROVE");
    setProofComment("");
    setRevisionAssetId("");
    setRevisionUploadFile(null);
    setRevisionUploadProgress(0);
    setRevisionUploadState("idle");
    setRevisionUploadAsset(null);
  }, [order]);

  useEffect(() => {
    if (!order || !selectedTaskId) {
      setAllocationQuantities({});
      return;
    }
    const selected = order.tasks.find((task) => task.task_id === selectedTaskId);
    const siblings = selected?.order_line_id
      ? order.tasks.filter((task) =>
          task.order_line_id === selected.order_line_id &&
          task.actionable &&
          task.attachment_id &&
          task.current_version?.attachment_id === task.attachment_id
        )
      : [];
    setAllocationQuantities(Object.fromEntries(
      siblings.map((task) => [task.task_id, 0])
    ));
    setProofAction(availableProofActions(selected ?? null)[0] ?? "REJECT");
  }, [order, selectedTaskId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(QA_ORDER_STORAGE_KEY, JSON.stringify(qaOrders));
    } catch {
      // Browser storage is optional; the supervised QA boundary never depends on it.
    }
  }, [qaOrders]);

  const addQaOrder = (value = normalizedOrderNumber) => {
    if (!/^A\d{7,8}$/.test(value)) {
      setMessage("Enter a Lift order number in A######## format.");
      return;
    }
    setQaOrders((current) => current.includes(value) ? current : [...current, value].slice(-12));
  };

  async function loadGrants(targetOrder = normalizedOrderNumber) {
    const payload = await responseJson<{ grants: ProofGrant[] }>(await request(`/api/proof/orders/${targetOrder}/grants`));
    setGrants(payload.grants);
  }

  async function loadAudit(targetOrder = normalizedOrderNumber, cursor: string | null = null) {
    setAuditLoading(true);
    try {
      const query = new URLSearchParams({ limit: "10" });
      if (cursor) query.set("cursor", cursor);
      const payload = await responseJson<{ events: ProofAuditEvent[]; next_cursor: string | null }>(
        await request(`/api/proof/orders/${targetOrder}/audit?${query}`)
      );
      setAuditEvents((current) => cursor ? [...current, ...payload.events] : payload.events);
      setAuditCursor(payload.next_cursor);
    } finally {
      setAuditLoading(false);
    }
  }

  async function syncOrder() {
    if (!/^A\d{7,8}$/.test(normalizedOrderNumber)) {
      setMessage("Enter a Lift order number in A######## format.");
      return;
    }
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{
        order: ProofOrderSummary;
        customer_capability: ResolvedCustomerProofCapability;
      }>(
        await request(`/api/proof/orders/${normalizedOrderNumber}/sync`, { method: "POST", body: "{}" })
      );
      setOrder(payload.order);
      setCustomerCapability(payload.customer_capability);
      setActionRequiresFreshSync(false);
      addQaOrder(payload.order.order_number);
      await loadGrants(payload.order.order_number);
      await loadAudit(payload.order.order_number).catch(() => undefined);
      setMessage(`Proof order ${payload.order.order_number} synchronized.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof order synchronization failed.");
    } finally {
      setState("idle");
    }
  }

  async function inspectCachedOrder() {
    if (!/^A\d{7,8}$/.test(normalizedOrderNumber)) {
      setMessage("Enter a Lift order number in A######## format.");
      return;
    }
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{
        order: ProofOrderSummary;
        customer_capability: ResolvedCustomerProofCapability;
      }>(
        await request(`/api/proof/orders/${normalizedOrderNumber}`)
      );
      setOrder(payload.order);
      setCustomerCapability(payload.customer_capability);
      await loadGrants(payload.order.order_number);
      await loadAudit(payload.order.order_number).catch(() => undefined);
      setMessage(`Opened cached Proof order ${payload.order.order_number} without contacting Lift.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cached Proof order could not be opened.");
    } finally {
      setState("idle");
    }
  }

  async function createGrant() {
    if (!order) return;
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{ grant: ProofGrant; access_url: string }>(
        await request(`/api/proof/orders/${order.order_number}/grants`, {
          method: "POST",
          body: JSON.stringify({ scope: "view", label: label.trim() || null })
        })
      );
      setOneTimeAccess({ grantId: payload.grant.grant_id, url: payload.access_url });
      setLabel("");
      await loadGrants(order.order_number);
      await loadAudit(order.order_number).catch(() => undefined);
      setMessage("View-only link created. Copy it now; the raw token will not be shown again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof link creation failed.");
    } finally {
      setState("idle");
    }
  }

  async function confirmGrantAction() {
    if (!pendingAction || !order) return;
    setState("loading");
    setMessage(null);
    setOneTimeAccess(null);
    try {
      const payload = await responseJson<{ grant: ProofGrant; access_url: string | null }>(
        await request(`/api/proof/grants/${pendingAction.grant.grant_id}`, {
          method: "PATCH",
          body: JSON.stringify({ action: pendingAction.action })
        })
      );
      setOneTimeAccess(payload.access_url ? { grantId: payload.grant.grant_id, url: payload.access_url } : null);
      await loadGrants(order.order_number);
      await loadAudit(order.order_number).catch(() => undefined);
      setMessage(
        pendingAction.action === "regenerate"
          ? "The old link was revoked. Copy the replacement now; it will not be shown again."
          : "The proof link was revoked and its active sessions are no longer valid."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof access update failed.");
    } finally {
      setPendingAction(null);
      setState("idle");
    }
  }

  async function sendAccessEmail() {
    if (!oneTimeAccess) return;
    setState("loading");
    setMessage(null);
    try {
      const payload = await responseJson<{
        delivery: { mode: "log" | "ses"; status: "logged" | "sent"; recipient_masked: string };
      }>(await request(`/api/proof/grants/${oneTimeAccess.grantId}/email`, {
        method: "POST",
        body: JSON.stringify({ recipient_email: recipientEmail, access_url: oneTimeAccess.url })
      }));
      if (order) await loadAudit(order.order_number).catch(() => undefined);
      if (payload.delivery.status === "sent") {
        setOneTimeAccess(null);
        setRecipientEmail("");
        setMessage(`Proof link sent to ${payload.delivery.recipient_masked}. The raw link has been removed from this screen.`);
      } else {
        setMessage(`Proof link delivery logged for ${payload.delivery.recipient_masked}. Copy remains available because no email was sent.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof link email could not be sent.");
    } finally {
      setState("idle");
    }
  }

  async function toggleReviewers(grant: ProofGrant) {
    if (reviewerGrantId === grant.grant_id) {
      setReviewerGrantId(null);
      return;
    }
    setReviewerGrantId(grant.grant_id);
    if (reviewers[grant.grant_id]) return;
    try {
      const payload = await responseJson<{ participants: ProofParticipant[] }>(
        await request(`/api/proof/grants/${grant.grant_id}/participants`)
      );
      setReviewers((current) => ({ ...current, [grant.grant_id]: payload.participants }));
    } catch (error) {
      setReviewerGrantId(null);
      setMessage(error instanceof Error ? error.message : "Proof reviewers could not be loaded.");
    }
  }

  async function prepareProofAction() {
    if (!order || !actionDraft || operatorActionInFlight.current) return;
    operatorActionInFlight.current = true;
    setState("loading");
    setMessage(null);
    setPreparedAction(null);
    setActionResult(null);
    try {
      const actionRequest = {
        order_number: actionDraft.order_number,
        task_id: actionDraft.task_id,
        attachment_id: actionDraft.proofing_id,
        action: actionDraft.action,
        idempotency_key: `proof-action-${crypto.randomUUID()}`,
        target_id: health?.operator_action_qa.target_id,
        environment_id: health?.operator_action_qa.environment_id,
        comment: actionDraft.comment,
        revision_asset_id: actionDraft.revision_asset_id,
        approval_mode: actionDraft.approval_mode,
        approve_quantity: actionDraft.approve_quantity,
        allocation_plan: actionDraft.allocation_plan
      };
      const payload = await responseJson<{
        confirmation_phrase: string;
        operator_action: { action_id: string };
      }>(
        await request("/api/proof/operator-actions/prepare", {
          method: "POST",
          body: JSON.stringify(actionRequest)
        })
      );
      setPreparedAction({
        request: actionRequest,
        confirmation_phrase: payload.confirmation_phrase,
        action_id: payload.operator_action.action_id
      });
      setActionConfirmation("");
      setMessage("Proof action intent and audit were reserved. Confirm the exact single action to continue.");
      await loadAudit(order.order_number).catch(() => undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proof action could not be prepared.");
    } finally {
      operatorActionInFlight.current = false;
      setState("idle");
    }
  }

  async function executePreparedProofAction() {
    if (!preparedAction || !order || operatorActionInFlight.current) return;
    operatorActionInFlight.current = true;
    setState("loading");
    setMessage(null);
    try {
      const payload = await responseJson<{
        operator_action: { outcome: string; response_classification: string | null };
        authoritative_reconciliation: {
          completed: boolean;
          failure_class: string | null;
          task_state: string | null;
          requires_manual_review: boolean;
        };
      }>(
        await request("/api/proof/operator-actions/execute", {
          method: "POST",
          body: JSON.stringify({
            ...preparedAction.request,
            confirmation_phrase: actionConfirmation
          })
        })
      );
      setActionResult({
        outcome: payload.operator_action.outcome,
        classification: payload.operator_action.response_classification,
        task_state: payload.authoritative_reconciliation.task_state
      });
      setPreparedAction(null);
      setActionConfirmation("");
      if (payload.authoritative_reconciliation.completed) {
        try {
          const refreshed = await responseJson<{
            order: ProofOrderSummary;
            customer_capability: ResolvedCustomerProofCapability;
          }>(
            await request(`/api/proof/orders/${order.order_number}`)
          );
          setOrder(refreshed.order);
          setCustomerCapability(refreshed.customer_capability);
          setActionRequiresFreshSync(false);
          setMessage(
            "One Proof action was attempted with zero retry. The workbench was rebound to the authoritative post-action Lift snapshot."
          );
        } catch {
          setActionRequiresFreshSync(true);
          setMessage(
            "The Proof action was attempted, but the refreshed snapshot is unavailable. Do not retry. Sync Lift and review the durable action state."
          );
        }
      } else {
        setActionRequiresFreshSync(true);
        setMessage(
          "The Proof action was attempted, but authoritative Lift reconciliation is incomplete. Do not retry. Sync Lift and review the durable action state."
        );
      }
    } catch {
      setPreparedAction(null);
      setActionConfirmation("");
      setActionRequiresFreshSync(true);
      setMessage(
        "The Proof execution response is unavailable. Do not retry. Sync Lift and review the durable action state before taking another action."
      );
    } finally {
      operatorActionInFlight.current = false;
      setState("idle");
    }
  }

  async function uploadRevisedArt() {
    if (!order || !selectedTask || !revisionUploadFile || operatorActionInFlight.current) return;
    const uploadConfig = health?.revised_art_upload;
    if (
      !uploadConfig?.enabled ||
      !uploadConfig.bucket_configured ||
      !uploadConfig.allowed_order_numbers.includes(order.order_number)
    ) {
      setMessage("Revised-art upload is outside the current bounded operator window.");
      return;
    }
    if (!selectedTask.attachment_id || !selectedTask.current_version) {
      setMessage("Choose a current actionable proof before uploading revised art.");
      return;
    }
    const contentType = proofUploadContentType(revisionUploadFile);
    if (!uploadConfig.allowed_content_types.includes(contentType)) {
      setMessage("This revised-art file type is not allowed by the reviewed upload policy.");
      return;
    }
    if (revisionUploadFile.size < 1 || revisionUploadFile.size > uploadConfig.maximum_bytes) {
      setMessage(`Revised art must be smaller than ${Math.round(uploadConfig.maximum_bytes / 1024 / 1024)} MB.`);
      return;
    }
    operatorActionInFlight.current = true;
    setMessage(null);
    setRevisionUploadAsset(null);
    setRevisionAssetId("");
    setRevisionUploadProgress(0);
    try {
      const safeFilename = sanitizeProofUploadFilename(revisionUploadFile.name);
      setRevisionUploadState("hashing");
      const digest = await sha256ProofUpload(revisionUploadFile, (completed) => {
        setRevisionUploadProgress(Math.round((completed / revisionUploadFile.size) * 100));
      });
      const fileIdentity = [
        order.order_number,
        selectedTask.task_id,
        selectedTask.attachment_id,
        safeFilename,
        revisionUploadFile.size,
        revisionUploadFile.lastModified,
        digest
      ].join("\0");
      let idempotencyKey = revisionUploadKeys.current.get(fileIdentity);
      if (!idempotencyKey) {
        idempotencyKey = `proof-upload-${crypto.randomUUID()}`;
        revisionUploadKeys.current.set(fileIdentity, idempotencyKey);
      }
      const prepared = await responseJson<{
        asset: ProofAssetUploadSummary;
        upload: {
          method: "POST";
          url: string;
          fields: Record<string, string>;
          expires_at: string;
        };
      }>(
        await request("/api/proof/operator-assets/uploads/prepare", {
          method: "POST",
          body: JSON.stringify({
            order_number: order.order_number,
            task_id: selectedTask.task_id,
            attachment_id: selectedTask.attachment_id,
            idempotency_key: idempotencyKey,
            original_filename: safeFilename,
            content_type: contentType,
            content_length: revisionUploadFile.size,
            sha256: digest
          })
        })
      );
      if (Date.parse(prepared.upload.expires_at) <= Date.now()) {
        throw new Error("The revised-art upload ticket expired before use. Try again.");
      }
      setRevisionUploadState("uploading");
      const uploaded = await fetch(assertPrivateProofUploadDestination(prepared.upload.url), {
        method: "POST",
        body: buildProofUploadForm(prepared.upload.fields, revisionUploadFile, safeFilename),
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      if (uploaded.status !== 201) {
        throw new Error("Private revised-art storage did not accept the exact upload ticket.");
      }
      setRevisionUploadState("finalizing");
      const finalized = await responseJson<{ asset: ProofAssetUploadSummary }>(
        await request("/api/proof/operator-assets/uploads/finalize", {
          method: "POST",
          body: JSON.stringify({
            order_number: order.order_number,
            asset_id: prepared.asset.asset_id
          })
        })
      );
      setRevisionUploadAsset(finalized.asset);
      setRevisionUploadState("pending_verification");
      setMessage("Revised art is fully uploaded and finalized. It remains unavailable to Lift until scanning, publication, direct-delivery verification, and settling are complete.");
      await loadAudit(order.order_number).catch(() => undefined);
    } catch (error) {
      setRevisionUploadState("error");
      setMessage(error instanceof Error ? error.message : "Revised art could not be uploaded.");
    } finally {
      operatorActionInFlight.current = false;
    }
  }

  async function inspectRevisedArtReadiness() {
    if (!order || !revisionUploadAsset || operatorActionInFlight.current) return;
    operatorActionInFlight.current = true;
    setMessage(null);
    try {
      const payload = await responseJson<{ asset: ProofAssetUploadSummary }>(
        await request(
          `/api/proof/operator-assets/uploads/${encodeURIComponent(order.order_number)}/${encodeURIComponent(revisionUploadAsset.asset_id)}`
        )
      );
      setRevisionUploadAsset(payload.asset);
      if (
        payload.asset.state === "ready_for_lift" &&
        payload.asset.verification_status === "cleared" &&
        payload.asset.publication_status === "delivery_verified"
      ) {
        setRevisionAssetId(payload.asset.asset_id);
        setRevisionUploadState("pending_verification");
        setMessage("Revised art is verified, directly deliverable, and ready to bind to one supervised action.");
      } else {
        setRevisionAssetId("");
        setRevisionUploadState("pending_verification");
        setMessage(`Revised art remains ${payload.asset.state.replaceAll("_", " ")}. No Lift action is available yet.`);
      }
    } catch (error) {
      setRevisionAssetId("");
      setMessage(error instanceof Error ? error.message : "Revised-art readiness could not be checked.");
    } finally {
      operatorActionInFlight.current = false;
    }
  }

  const pendingCount = order?.tasks.filter((task) => task.state === "pending").length ?? 0;
  const readOnlyPosture = health ? proofReadOnlyPosture(health) : null;
  const selectedTask = order?.tasks.find((task) => task.task_id === selectedTaskId) ?? null;
  const selectedLineProofs = selectedTask?.order_line_id
    ? (order?.tasks ?? []).filter((task) =>
        task.order_line_id === selectedTask.order_line_id &&
        task.actionable &&
        task.attachment_id &&
        task.current_version?.attachment_id === task.attachment_id
      )
    : [];
  const approvalMode: ProofApprovalMode =
    selectedLineProofs.length > 1 ? "quantity_allocation" : "simple";
  const selectedTaskActions = availableProofActions(selectedTask);
  const selectedDecisionLabel = decisionContextLabel(selectedTask);
  const allocationAvailable =
    health?.operator_action_qa.advanced_quantity_allocation_enabled &&
    advancedCustomerEnabled;
  const allocationPlan = selectedLineProofs.map((task) => ({
    task_id: task.task_id,
    attachment_id: task.attachment_id!,
    approve_quantity: allocationQuantities[task.task_id] ?? 0
  }));
  const allocatedQuantity = allocationPlan.reduce(
    (total, allocation) => total + allocation.approve_quantity,
    0
  );
  const allocationRemainder = (selectedTask?.quantity ?? 0) - allocatedQuantity;
  let actionDraft: ProofActionDraft | null = null;
  let actionDraftError: string | null = null;
  if (order && selectedTaskId) {
    try {
      if (!selectedTaskActions.length) {
        throw new Error("This proof is waiting for Lift to return a new current proof before another action can be prepared.");
      }
      if (
        proofAction === "APPROVE" &&
        selectedLineProofs.length > 1 &&
        !allocationAvailable
      ) {
        throw new Error("Multiple current proofs require Advanced review and a bounded allocation window.");
      }
      actionDraft = buildProofActionDraft({
        order,
        taskId: selectedTaskId,
        action: proofAction,
        approvalMode,
        allocationPlan,
        comment: proofComment,
        revisionAssetId
      });
    } catch (error) {
      actionDraftError = error instanceof Error ? error.message : "Proof action draft is invalid.";
    }
  }

  return (
    <section className="proof-ops-panel" aria-labelledby="proof-ops-title">
      <div className="proof-ops-heading">
        <div>
          <p className="eyebrow">Vornan Proof</p>
          <h3 id="proof-ops-title">Sync an order and manage customer access.</h3>
          <span>Direct Lift orders are supported; a Pathfinder job is not required.</span>
        </div>
        <div className="proof-write-lock"><ShieldCheck size={16} /> Lift decisions locked</div>
      </div>

      <div className="proof-ops-form">
        <label>
          Lift order number
          <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="A0221132" />
        </label>
        <button className="primary-button" type="button" disabled={state === "loading"} onClick={() => void syncOrder()}>
          <RefreshCw size={16} /> {state === "loading" ? "Working" : "Sync Proofs"}
        </button>
        <button className="secondary-button" type="button" disabled={state === "loading"} onClick={() => void inspectCachedOrder()}>
          Open cached
        </button>
        <button className="secondary-button" type="button" disabled={!/^A\d{7,8}$/.test(normalizedOrderNumber)} onClick={() => addQaOrder()}>
          <Plus size={16} /> Add to test set
        </button>
      </div>

      {qaOrders.length ? (
        <div className="proof-qa-order-set" aria-label="Proof action test order set">
          <span>Test order set</span>
          <div>
            {qaOrders.map((qaOrder) => (
              <span className={order?.order_number === qaOrder ? "active" : ""} key={qaOrder}>
                <button
                  type="button"
                  onClick={() => {
                    setOrderNumber(qaOrder);
                    setOrder(null);
                    setCustomerCapability(null);
                    setMessage(`Selected ${qaOrder}. Sync it to load the current Lift proofs.`);
                  }}
                >
                  {qaOrder}
                </button>
                <button type="button" aria-label={`Remove ${qaOrder} from test set`} onClick={() => setQaOrders((current) => current.filter((candidate) => candidate !== qaOrder))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <small>Saved only in this browser. Each order must be synchronized and verified as LTL Demo before any future action test.</small>
        </div>
      ) : null}

      {message ? <div className="proof-ops-message" role="status">{message}</div> : null}

      {health && readOnlyPosture ? (
        <section className={`proof-integration-health ${readOnlyPosture.level}`} aria-labelledby="proof-integration-health-title">
          <div className="proof-integration-health-heading">
            <div className="proof-health-icon">
              {readOnlyPosture.level === "configuration_required" ? <CircleAlert size={18} /> : <ShieldCheck size={18} />}
            </div>
            <div>
              <span className="eyebrow">Integration health</span>
              <h4 id="proof-integration-health-title">{readOnlyPosture.label}</h4>
              <p>{readOnlyPosture.detail}</p>
            </div>
          </div>
          <div className="proof-integration-health-grid">
            <div>
              <Database size={16} />
              <span>Persistence</span>
              <strong>{health.storage_driver === "dynamodb" ? "Dedicated DynamoDB" : health.storage_driver === "local" ? "Local QA store" : "Disabled"}</strong>
              <small>Core {health.core_table_configured ? "configured" : "not configured"} · Audit {health.audit_table_configured ? "configured" : "not configured"}</small>
            </div>
            <div>
              <Network size={16} />
              <span>Lift reads</span>
              <strong>{health.lift_reads.order_host === health.lift_reads.report_host ? health.lift_reads.order_host : "Separate reviewed hosts"}</strong>
              <small>{health.lift_reads.concurrency} concurrent · {Math.round(health.lift_reads.timeout_ms / 1000)}s timeout</small>
            </div>
            <div>
              <RefreshCw size={16} />
              <span>Refresh boundary</span>
              <strong>{health.sync.queue_configured ? "Isolated queue configured" : "Queue not configured"}</strong>
              <small>{health.sync.stale_after_minutes}m stale · {health.sync.automatic_refresh_max_inactive_days}d activity window</small>
            </div>
            <div>
              <ShieldCheck size={16} />
              <span>Customer capability</span>
              <strong>{health.feature_flags.public_read ? "View-only public read" : "Public read off"}</strong>
              <small>Approve off · Revision off · Undo off · Lift writes off</small>
            </div>
          </div>
          {readOnlyPosture.blockers.length ? (
            <details>
              <summary>{readOnlyPosture.blockers.length} deployment {readOnlyPosture.blockers.length === 1 ? "requirement" : "requirements"} remain</summary>
              <ul>{readOnlyPosture.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {order ? (
        <>
          <div className="proof-ops-summary">
            <div><span>Order</span><strong>{order.order_number}</strong></div>
            <div><span>Health</span><strong>{order.health}</strong></div>
            <div><span>Pending proofs</span><strong>{pendingCount}</strong></div>
            <div><span>Last synchronized</span><strong>{dateLabel(order.last_synced_at)}</strong></div>
          </div>

          {order.last_sync_diagnostics ? (
            <section className="proof-sync-diagnostics" aria-label="Last read-only Lift synchronization diagnostics">
              <div>
                <span>Line reads</span>
                <strong>{order.last_sync_diagnostics.line_reads.succeeded}/{order.last_sync_diagnostics.line_reads.attempted} succeeded</strong>
              </div>
              <div>
                <span>Proof rows</span>
                <strong>{order.last_sync_diagnostics.line_reads.proof_rows + order.last_sync_diagnostics.fallback_read.proof_rows}</strong>
              </div>
              <div>
                <span>Fallback</span>
                <strong>{order.last_sync_diagnostics.fallback_read.attempted ? (order.last_sync_diagnostics.fallback_read.ok ? "Succeeded" : "Failed") : "Not needed"}</strong>
              </div>
              <div>
                <span>Normalization warnings</span>
                <strong>{order.last_sync_diagnostics.normalization_warning_count}</strong>
              </div>
              <small>Sanitized counts only. Lift URLs, errors, credentials, and customer files are excluded.</small>
            </section>
          ) : null}

          <section className="proof-action-workbench" aria-labelledby="proof-action-workbench-title">
            <div className="proof-action-workbench-heading">
              <div>
                <span className="eyebrow"><ClipboardCheck size={14} /> Operator QA preparation</span>
                <h4 id="proof-action-workbench-title">Prepare one supervised proof action.</h4>
                <p>Choose a current proof and review the exact action. Execution remains locked and no Lift request is sent from this screen.</p>
              </div>
              <span className="proof-action-locked">
                <LockKeyhole size={14} /> {health?.operator_action_qa.enabled ? "Bounded operator QA" : "Execution locked"}
              </span>
            </div>

            <div className="proof-action-fields">
              <label>
                Proof
                <select value={selectedTaskId} onChange={(event) => {
                  setSelectedTaskId(event.target.value);
                }}>
                  <option value="">Choose current proof</option>
                  {order.tasks.filter((task) => task.actionable && task.attachment_id && task.current_version).map((task) => (
                    <option key={task.task_id} value={task.task_id}>
                      Line {task.line_number ?? "—"} · {task.product_name ?? "Unnamed product"} · {task.current_version?.filename ?? task.attachment_id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Action
                <select
                  value={selectedTaskActions.includes(proofAction) ? proofAction : ""}
                  disabled={!selectedTaskActions.length}
                  onChange={(event) => setProofAction(event.target.value as ProofActionDraftKind)}
                >
                  {!selectedTaskActions.length ? <option value="">Awaiting a new current proof</option> : null}
                  {selectedTask?.decision_context?.state === "rejected_pending_action" ? (
                    <>
                      <optgroup label="Artwork will not be used">
                        <option value="SEND_BACK_TO_ARTIST">Send back to artist</option>
                        <option value="CANCEL_LINE">Cancel line</option>
                      </optgroup>
                      <optgroup label="Revised artwork">
                        <option value="REVISED_ART_WILL_BE_SENT">Revised artwork will be provided</option>
                      </optgroup>
                    </>
                  ) : selectedTaskActions.map((action) => (
                    <option key={action} value={action}>{proofActionLabel(action)}</option>
                  ))}
                </select>
              </label>
              {selectedDecisionLabel ? (
                <div className="proof-action-decision-state" role="status">
                  <CircleAlert size={16} />
                  <span>
                    <strong>{selectedDecisionLabel}</strong>
                    <small>
                      Pathfinder recorded the last supervised action for this exact proof. This state clears when Lift returns a replacement proof or a non-pending result.
                    </small>
                  </span>
                </div>
              ) : null}
              {proofAction === "APPROVE" ? (
                <div className="proof-approval-mode" role="group" aria-labelledby="proof-approval-mode-title">
                  <div className="proof-approval-mode-heading">
                    <div>
                      <strong id="proof-approval-mode-title">
                        {approvalMode === "simple" ? "Simple approval" : "Creative quantity allocation"}
                      </strong>
                      <small>
                        {approvalMode === "simple"
                          ? "One current proof is approved without sending a quantity override."
                          : "Multiple current proofs require the full line quantity to be allocated before approval."}
                      </small>
                    </div>
                  </div>
                  {approvalMode === "simple" ? (
                    <div className="proof-simple-approval-note">
                      <CheckCircle2 size={16} />
                      <span><strong>Approve</strong> sends no quantity override and keeps the customer experience intentionally simple.</span>
                    </div>
                  ) : (
                    <div className="proof-allocation-editor">
                      {!allocationAvailable ? (
                        <div className="proof-action-allocation-blocked" role="alert">
                          This line has multiple current proofs. Enable Advanced review for this customer and open a bounded allocation QA window before approval.
                        </div>
                      ) : null}
                      <div className="proof-allocation-summary">
                        <span>Line quantity <strong>{selectedTask?.quantity ?? "—"}</strong></span>
                        <span>Allocated <strong>{allocatedQuantity}</strong></span>
                        <span className={allocationRemainder === 0 ? "is-complete" : ""}>
                          Remaining <strong>{allocationRemainder}</strong>
                        </span>
                      </div>
                      <div className="proof-allocation-list">
                        {selectedLineProofs.map((proof) => (
                          <label key={proof.task_id} className={proof.task_id === selectedTaskId ? "is-selected" : ""}>
                            <span>
                              <strong>{proof.current_version?.filename ?? `Proof ${proof.attachment_id}`}</strong>
                              <small>{proof.task_id === selectedTaskId ? "Selected for the next single action" : "Current creative"}</small>
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={selectedTask?.quantity ?? undefined}
                              step={1}
                              inputMode="numeric"
                              aria-label={`Quantity for ${proof.current_version?.filename ?? proof.attachment_id}`}
                              value={allocationQuantities[proof.task_id] || ""}
                              onChange={(event) => {
                                const value = Number.parseInt(event.target.value, 10);
                                setAllocationQuantities((current) => ({
                                  ...current,
                                  [proof.task_id]: Number.isFinite(value) ? value : 0
                                }));
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <small>
                        Every current proof must receive a positive whole-number quantity and the remainder must be zero. Pathfinder sends one action, then requires a fresh Lift sync before the next.
                      </small>
                    </div>
                  )}
                  {selectedLineProofs.length >= 2 && !allocationAvailable ? (
                    <small className="proof-advanced-locked-note">
                      {!health?.operator_action_qa.advanced_quantity_allocation_enabled
                        ? "Advanced allocation remains behind the default-disabled platform gate."
                        : customerCapability?.association_status !== "associated"
                          ? "Link this Lift order to one Pathfinder customer before enabling Advanced review."
                          : "Advanced review is not enabled for this customer or order."}
                    </small>
                  ) : null}
                </div>
              ) : null}
              <label className="proof-action-comment">
                Message to production team
                <textarea value={proofComment} maxLength={2000} onChange={(event) => setProofComment(event.target.value)} placeholder="Optional line-specific message" />
                <small>This appears in the Lift order history and references the order line. It is separate from Prepress team feedback attached to the proof.</small>
              </label>
              {proofAction === "REVISED_ART_WILL_BE_SENT" ? (
                <div className="proof-action-art-url proof-revised-art-upload" role="group" aria-labelledby="proof-revised-art-upload-title">
                  <div>
                    <strong id="proof-revised-art-upload-title">Upload revised artwork</strong>
                    <small>
                      Pathfinder hashes the file locally, uploads it directly to private Proof storage,
                      and verifies the immutable object before marking the upload complete.
                    </small>
                  </div>
                  <label className="proof-revised-art-file">
                    Revised-art file
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.psd,.ai,.eps"
                      disabled={revisionUploadState === "hashing" || revisionUploadState === "uploading" || revisionUploadState === "finalizing"}
                      onChange={(event) => {
                        setRevisionUploadFile(event.target.files?.[0] ?? null);
                        setRevisionUploadProgress(0);
                        setRevisionUploadState("idle");
                        setRevisionUploadAsset(null);
                        setRevisionAssetId("");
                      }}
                    />
                  </label>
                  <div className="proof-revised-art-upload-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={
                        !revisionUploadFile ||
                        !selectedTask ||
                        !health?.revised_art_upload.enabled ||
                        !health.revised_art_upload.allowed_order_numbers.includes(order.order_number) ||
                        ["hashing", "uploading", "finalizing"].includes(revisionUploadState)
                      }
                      onClick={() => void uploadRevisedArt()}
                    >
                      <UploadCloud size={15} />
                      {revisionUploadState === "hashing"
                        ? `Checking file ${revisionUploadProgress}%`
                        : revisionUploadState === "uploading"
                          ? "Uploading securely"
                          : revisionUploadState === "finalizing"
                            ? "Verifying upload"
                            : "Upload revised art"}
                    </button>
                    <small>
                      {health?.revised_art_upload.enabled
                        ? `Bounded upload window expires ${dateLabel(health.revised_art_upload.activation_expires_at)}.`
                        : "Uploads are default-disabled and require a separate bounded operator window."}
                    </small>
                  </div>
                  {revisionUploadAsset ? (
                    <div className="proof-revised-art-status" role="status">
                      <FileCheck2 size={17} />
                      <div>
                        <strong>{revisionUploadAsset.original_filename}</strong>
                        <span>
                          {revisionAssetId
                            ? "Delivery verified · revised-art action may be prepared"
                            : `${revisionUploadAsset.state.replaceAll("_", " ")} · Lift action locked`}
                        </span>
                        <small>Asset {revisionUploadAsset.asset_id.slice(0, 20)}…</small>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => void inspectRevisedArtReadiness()}>
                        <RefreshCw size={14} /> Check readiness
                      </button>
                    </div>
                  ) : null}
                  <small className="proof-revised-art-boundary">
                    Arbitrary URLs are never accepted. The revised-art action remains unavailable until
                    Pathfinder records a cleared scan, immutable publication, direct HTTP 200 verification,
                    and the required settling delay.
                  </small>
                </div>
              ) : null}
            </div>

            <div className="proof-action-preview">
              <div>
                <span>Selected target</span>
                <strong>{selectedTask ? `${order.order_number} · line ${selectedTask.line_number ?? "—"} · proof ${selectedTask.attachment_id ?? "—"}` : "Choose a current actionable proof"}</strong>
              </div>
              <div>
                <span>QA customer boundary</span>
                <strong>{order.customer_id === "1249" ? "LTL Demo / 1249 verified" : "Not verified"}</strong>
                <small>{order.customer_id === "1249" ? order.customer_name ?? "LTL Demo" : "Execution remains locked outside customer 1249."}</small>
              </div>
              <div>
                <span>Prepared action</span>
                <strong>{actionDraft?.action.replaceAll("_", " ") ?? actionDraftError ?? "Not ready"}</strong>
              </div>
              <div>
                <span>Safety behavior</span>
                <strong>No automatic retry · authoritative Lift read required</strong>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={
                  state === "loading" ||
                  !actionDraft ||
                  actionRequiresFreshSync ||
                  !health?.operator_action_qa.enabled ||
                  !health.operator_action_qa.allowed_order_numbers.includes(order.order_number)
                }
                onClick={() => void prepareProofAction()}
              >
                <LockKeyhole size={15} /> Prepare supervised action
              </button>
            </div>
            {actionRequiresFreshSync ? (
              <p className="proof-action-boundary">
                A fresh authoritative Lift sync is required before another Proof action can be prepared.
              </p>
            ) : null}
            <p className="proof-action-boundary">
              {health?.operator_action_qa.enabled
                ? `Bounded operator gate expires ${dateLabel(health.operator_action_qa.activation_expires_at)}. Only allowlisted LTL Demo orders can proceed.`
                : "Operator execution is default-disabled. Enabling it requires a separate bounded deployment and QA approval."}
            </p>
            {actionResult ? (
              <div className="proof-ops-message" role="status">
                Durable state: {actionResult.outcome} · Lift observation: {actionResult.classification ?? "unclassified"} · authoritative task: {actionResult.task_state ?? "not resolved"}. Manual review required.
              </div>
            ) : null}
          </section>

          <div className="proof-grant-create">
            <label>
              Link label
              <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Customer review" />
            </label>
            <button className="secondary-button" type="button" disabled={!health?.feature_flags.grant_creation || state === "loading"} onClick={() => void createGrant()}>
              <Link2 size={16} /> Create view-only link
            </button>
            {!health?.feature_flags.grant_creation ? <small>Grant creation is disabled in this environment.</small> : null}
          </div>

          {oneTimeAccess ? (
            <div className="proof-one-time-link">
              <CheckCircle2 size={18} />
              <div className="proof-one-time-content">
                <span>One-time access link</span>
                <code>{oneTimeAccess.url}</code>
                <div className="proof-one-time-actions">
                  <input
                    aria-label="Proof link recipient email"
                    type="email"
                    autoComplete="email"
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    placeholder="customer@example.com"
                  />
                  <button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(oneTimeAccess.url).then(() => setMessage("Proof link copied."))}>
                    <Copy size={15} /> Copy
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!health?.feature_flags.proof_link_email || state === "loading" || !recipientEmail.trim()}
                    onClick={() => void sendAccessEmail()}
                  >
                    <Mail size={15} /> Send link
                  </button>
                </div>
                {!health?.feature_flags.proof_link_email ? <small>Email delivery is disabled in this environment. Copy the link through an approved private channel.</small> : null}
              </div>
            </div>
          ) : null}

          <div className="proof-grant-list">
            {grants.map((grant) => (
              <article key={grant.grant_id} className={grant.status === "revoked" ? "revoked" : ""}>
                <div>
                  <strong>{grant.label ?? "View-only access"}</strong>
                  <span>{grant.status} · expires {dateLabel(grant.expires_at)} · last used {dateLabel(grant.last_used_at)}</span>
                </div>
                <div className="proof-grant-actions">
                  {grant.participant_count > 0 ? (
                    <button className="secondary-button" type="button" aria-expanded={reviewerGrantId === grant.grant_id} onClick={() => void toggleReviewers(grant)}>
                      <UserRound size={14} /> {grant.participant_count} {grant.participant_count === 1 ? "reviewer" : "reviewers"}
                    </button>
                  ) : null}
                  {grant.status === "active" ? (
                    <>
                    <button className="secondary-button" type="button" onClick={() => setPendingAction({ grant, action: "regenerate" })}>Regenerate</button>
                    <button className="secondary-button danger" type="button" onClick={() => setPendingAction({ grant, action: "revoke" })}><Unlink size={14} /> Revoke</button>
                    </>
                  ) : null}
                </div>
                {reviewerGrantId === grant.grant_id ? (
                  <div className="proof-reviewer-list" aria-label="Identified reviewers">
                    {(reviewers[grant.grant_id] ?? []).map((reviewer) => (
                      <div key={reviewer.participant_id}>
                        <span><strong>{reviewer.display_name}</strong><small>{reviewer.email}</small></span>
                        <small>Last seen {dateLabel(reviewer.last_seen_at)}</small>
                      </div>
                    ))}
                    {!reviewers[grant.grant_id] ? <small>Loading restricted reviewer details…</small> : null}
                  </div>
                ) : null}
              </article>
            ))}
            {!grants.length ? <p>No customer access grants for this order.</p> : null}
          </div>

          <section className="proof-audit" aria-labelledby="proof-audit-title">
            <div className="proof-audit-heading">
              <div>
                <span className="eyebrow"><History size={14} /> Restricted audit</span>
                <h4 id="proof-audit-title">Lifecycle activity</h4>
              </div>
              <small>Identifiers only; customer files, comments, and access secrets are excluded.</small>
            </div>
            <ol>
              {auditEvents.map((event) => (
                <li key={event.event_id}>
                  <span className={`proof-audit-status ${event.outcome}`}>{event.outcome}</span>
                  <div>
                    <strong>{event.action.replace(/^proof\./, "").replaceAll("_", " ")}</strong>
                    <span>{event.actor_type.replaceAll("_", " ")} · {event.metadata.source.replaceAll("_", " ")} · {dateLabel(event.occurred_at)}</span>
                  </div>
                  <code title={event.correlation_id}>{event.correlation_id.slice(0, 12)}</code>
                </li>
              ))}
            </ol>
            {!auditEvents.length ? <p>No lifecycle activity has been recorded for this order.</p> : null}
            {auditCursor ? (
              <button className="secondary-button" type="button" disabled={auditLoading} onClick={() => void loadAudit(order.order_number, auditCursor).catch((error) => setMessage(error instanceof Error ? error.message : "Proof audit could not be loaded."))}>
                {auditLoading ? "Loading" : "Load older activity"}
              </button>
            ) : null}
          </section>
        </>
      ) : null}

      {pendingAction ? (
        <div className="proof-action-confirm" role="alertdialog" aria-modal="true" aria-labelledby="proof-confirm-title">
          <div>
            <strong id="proof-confirm-title">{pendingAction.action === "revoke" ? "Revoke this link?" : "Regenerate this link?"}</strong>
            <span>{pendingAction.action === "revoke" ? "Existing sessions will stop working." : "The current link and sessions will be revoked before a replacement is issued."}</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setPendingAction(null)}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => void confirmGrantAction()}>Confirm</button>
        </div>
      ) : null}

      {preparedAction ? (
        <div className="proof-action-confirm" role="alertdialog" aria-modal="true" aria-labelledby="proof-operator-confirm-title">
          <div>
            <h4 id="proof-operator-confirm-title">Confirm one supervised Lift action</h4>
            <p>The intent and audit are durable. Execution will send exactly one PUT with no automatic retry, then immediately read Lift again.</p>
            <code>{preparedAction.confirmation_phrase}</code>
            <label>
              Type the exact confirmation phrase
              <input
                autoComplete="off"
                value={actionConfirmation}
                onChange={(event) => setActionConfirmation(event.target.value)}
              />
            </label>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={state === "loading"}
                onClick={() => {
                  setPreparedAction(null);
                  setActionConfirmation("");
                }}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={
                  state === "loading" ||
                  actionConfirmation !== preparedAction.confirmation_phrase
                }
                onClick={() => void executePreparedProofAction()}
              >
                Execute exactly one action
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
