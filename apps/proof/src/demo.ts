import type { ProofOrder } from "./types";
import type { ProofActivity } from "./types";
import { proofTaskCounts } from "./lifecycle-state";

export const demoOrder: ProofOrder = {
  order_number: "A0221132",
  order_title: "Summer retail rollout",
  order_status: "Pending Art Approval",
  health: "active",
  counts: { pending: 4, regenerating: 0, waiting: 0, reviewed: 1, total: 5 },
  last_synced_at: "2026-07-20T16:42:00.000Z",
  access: { scope: "view", decisions_enabled: false },
  tasks: [
    {
      task_id: "ptask_a",
      line_number: "1",
      product_name: "North wall graphic",
      quantity: 20,
      state: "pending",
      sibling_index: 1,
      sibling_count: 4,
      feedback_required: true,
      feedback_acknowledged: false,
      current_version: {
        version_id: "v2",
        created_at: "2026-07-19T18:20:00.000Z",
        filename: "north-wall-v2.jpg",
        content_type: "image/jpeg",
        preview_kind: "image",
        preview_url: "/brand/proof-placeholder.svg",
        download_url: "/brand/proof-placeholder.svg",
        approval_status: "PENDING",
        approved_at: null,
        comments: [{
          text: "Updated with the latest seasonal artwork.",
          created_at: "2026-07-19T18:20:00.000Z",
          attachments: [{ filename: "seasonal-lockup-reference.svg", url: "/brand/proof-placeholder.svg", content_type: "image/svg+xml" }]
        }],
        technical_checks: [{ name: "Artwork dimensions", status: "PASS" }, { name: "Image resolution", status: "PASS" }],
        current: true
      },
      versions: [
        {
          version_id: "v2",
          created_at: "2026-07-19T18:20:00.000Z",
          filename: "north-wall-v2.jpg",
          content_type: "image/jpeg",
          preview_kind: "image",
          preview_url: "/brand/proof-placeholder.svg",
          download_url: "/brand/proof-placeholder.svg",
          approval_status: "PENDING",
          approved_at: null,
          comments: [{
            text: "Updated with the latest seasonal artwork.",
            created_at: "2026-07-19T18:20:00.000Z",
            attachments: [{ filename: "seasonal-lockup-reference.svg", url: "/brand/proof-placeholder.svg", content_type: "image/svg+xml" }]
          }],
          technical_checks: [{ name: "Artwork dimensions", status: "PASS" }, { name: "Image resolution", status: "PASS" }],
          current: true
        },
        {
          version_id: "v1",
          created_at: "2026-07-17T14:10:00.000Z",
          filename: "north-wall-v1.jpg",
          content_type: "image/jpeg",
          preview_kind: "unavailable",
          preview_url: null,
          download_url: null,
          approval_status: "REVISION",
          approved_at: null,
          comments: [{ text: "Please use the updated seasonal lockup.", created_at: "2026-07-18T09:30:00.000Z", attachments: [] }],
          technical_checks: [{ name: "Artwork dimensions", status: "PASS" }, { name: "Image resolution", status: "WARNING" }],
          current: false
        }
      ]
    },
    ...[2, 3, 4].map((sibling) => ({
      task_id: `ptask_${sibling}`,
      line_number: "1",
      product_name: `North wall graphic · panel ${sibling}`,
      quantity: 20,
      state: "pending" as const,
      sibling_index: sibling,
      sibling_count: 4,
      feedback_required: false,
      feedback_acknowledged: false,
      current_version: {
        version_id: `v${sibling}`,
        created_at: "2026-07-19T18:20:00.000Z",
        filename: `north-wall-panel-${sibling}.jpg`,
        content_type: "image/jpeg",
        preview_kind: "image" as const,
        preview_url: "/brand/proof-placeholder.svg",
        download_url: null,
        approval_status: "PENDING",
        approved_at: null,
        comments: [],
        technical_checks: [],
        current: true
      },
      versions: []
    })),
    {
      task_id: "ptask_b",
      line_number: "2",
      product_name: "Register counter decal",
      quantity: 2,
      state: "approved",
      sibling_index: 1,
      sibling_count: 1,
      feedback_required: false,
      feedback_acknowledged: false,
      current_version: {
        version_id: "v1b",
        created_at: "2026-07-18T15:00:00.000Z",
        filename: "counter-decal.pdf",
        content_type: "application/pdf",
        preview_kind: "unavailable",
        preview_url: null,
        download_url: null,
        approval_status: "APPROVED",
        approved_at: "2026-07-19T12:00:00.000Z",
        comments: [],
        technical_checks: [{ name: "Preflight", status: "PASS" }],
        current: true
      },
      versions: []
    }
  ]
};

export function demoActivityForHash(hash: string): ProofActivity {
  return hash === "#/proof/activity-qa"
    ? {
        identified_reviewers: 2,
        last_activity_at: "2026-07-20T17:15:00.000Z",
        reviewer_names_visible: false
      }
    : { identified_reviewers: 0, last_activity_at: null, reviewer_names_visible: false };
}

export function demoOrderForHash(hash: string) {
  if (hash === "#/proof/complete-qa" || hash === "#/proof/all-reviewed-qa") {
    const completePacket = hash === "#/proof/complete-qa";
    const tasks = demoOrder.tasks.map((task, index) => {
      const currentVersion = task.current_version
        ? {
            ...task.current_version,
            approval_status: "APPROVED",
            approved_at: task.current_version.approved_at ?? "2026-07-20T16:35:00.000Z"
          }
        : null;
      return {
        ...task,
        state: completePacket && index === demoOrder.tasks.length - 1 ? "reference" as const : "approved" as const,
        feedback_required: false,
        feedback_acknowledged: false,
        current_version: currentVersion,
        versions: task.versions.map((version) => version.version_id === currentVersion?.version_id ? currentVersion : version)
      };
    });
    return {
      ...demoOrder,
      health: completePacket ? "complete" as const : "active" as const,
      order_status: completePacket ? "Proof Review Complete" : "All Proofs Reviewed",
      tasks,
      counts: proofTaskCounts(tasks)
    };
  }
  if (hash === "#/proof/assets-qa") {
    return {
      ...demoOrder,
      tasks: demoOrder.tasks.map((task, index) => {
        if (index === 0 && task.current_version) {
          const pdfVersion = {
            ...task.current_version,
            filename: "north-wall-final-proof-with-an-intentionally-long-filename-for-responsive-review.pdf",
            content_type: "application/pdf",
            preview_kind: "pdf" as const,
            preview_url: "/brand/proof-placeholder.pdf",
            download_url: "/brand/proof-placeholder.pdf"
          };
          return { ...task, current_version: pdfVersion, versions: [pdfVersion, ...task.versions.slice(1)] };
        }
        if (index === 1 && task.current_version) {
          return {
            ...task,
            current_version: {
              ...task.current_version,
              filename: "north-wall-layered-production-artwork-with-linked-assets.psd",
              content_type: "image/vnd.adobe.photoshop",
              preview_kind: "download" as const,
              preview_url: null,
              download_url: "/brand/proof-placeholder.svg"
            }
          };
        }
        if (index === 2 && task.current_version) {
          return {
            ...task,
            current_version: {
              ...task.current_version,
              filename: "north-wall-preview-processing-pending.tiff",
              content_type: "image/tiff",
              preview_kind: "unavailable" as const,
              preview_url: null,
              download_url: null
            }
          };
        }
        return task;
      })
    };
  }
  if (hash === "#/proof/display-fallback-qa") {
    return {
      ...demoOrder,
      order_title: null,
      order_status: null,
      tasks: demoOrder.tasks.map((task, index) => index === 0 ? { ...task, product_name: null } : task)
    };
  }
  if (hash !== "#/proof/lifecycle-qa") return demoOrder;
  const tasks = demoOrder.tasks.map((task, index) => {
    if (index === 0) return { ...task, state: "revised" as const };
    if (index === 1) return { ...task, state: "waiting" as const, current_version: null, versions: [] };
    if (index === 3) return { ...task, state: "error" as const, current_version: null, versions: [] };
    if (task.state === "approved") return { ...task, state: "reference" as const };
    return task;
  });
  return {
    ...demoOrder,
    health: "stale" as const,
    tasks,
    counts: proofTaskCounts(tasks)
  };
}
