import type { ProofOrder, ProofVersion } from "./types";

function preserveCommentAssetUrls(previous: ProofVersion, incoming: ProofVersion) {
  return incoming.comments.map((comment, commentIndex) => {
    const previousComment = previous.comments[commentIndex];
    if (
      !previousComment ||
      previousComment.text !== comment.text ||
      previousComment.created_at !== comment.created_at
    ) {
      return comment;
    }
    return {
      ...comment,
      attachments: comment.attachments.map((attachment, attachmentIndex) => {
        const previousAttachment = previousComment.attachments[attachmentIndex];
        if (
          !previousAttachment ||
          previousAttachment.filename !== attachment.filename ||
          previousAttachment.content_type !== attachment.content_type
        ) {
          return attachment;
        }
        return { ...attachment, url: attachment.url ?? previousAttachment.url };
      })
    };
  });
}

function preserveVersionAssetUrls(previous: ProofVersion | undefined, incoming: ProofVersion) {
  if (!previous || previous.version_id !== incoming.version_id) return incoming;
  return {
    ...incoming,
    preview_url: incoming.preview_url ?? previous.preview_url,
    download_url: incoming.download_url ?? previous.download_url,
    comments: preserveCommentAssetUrls(previous, incoming)
  };
}

export function preserveDisplayedProofAssets(previous: ProofOrder | null, incoming: ProofOrder) {
  if (!previous || incoming.health !== "stale" || previous.order_number !== incoming.order_number) {
    return incoming;
  }
  const previousTasks = new Map(previous.tasks.map((task) => [task.task_id, task]));
  return {
    ...incoming,
    tasks: incoming.tasks.map((task) => {
      const previousTask = previousTasks.get(task.task_id);
      if (!previousTask) return task;
      const previousVersions = new Map(previousTask.versions.map((version) => [version.version_id, version]));
      if (previousTask.current_version) {
        previousVersions.set(previousTask.current_version.version_id, previousTask.current_version);
      }
      return {
        ...task,
        current_version: task.current_version
          ? preserveVersionAssetUrls(previousVersions.get(task.current_version.version_id), task.current_version)
          : null,
        versions: task.versions.map((version) => preserveVersionAssetUrls(previousVersions.get(version.version_id), version))
      };
    })
  };
}

export function preserveDisplayedHistoryAssets(previous: ProofVersion[], incoming: ProofVersion[]) {
  const previousVersions = new Map(previous.map((version) => [version.version_id, version]));
  return incoming.map((version) => preserveVersionAssetUrls(previousVersions.get(version.version_id), version));
}

function proofVersionContent(version: ProofVersion | null) {
  if (!version) return null;
  return {
    version_id: version.version_id,
    created_ts: version.created_ts ?? null,
    created_at: version.created_at,
    filename: version.filename,
    content_type: version.content_type,
    preview_kind: version.preview_kind,
    approval_status: version.approval_status,
    proof_approved_ts: version.proof_approved_ts ?? null,
    approved_at: version.approved_at,
    comments: version.comments.map((comment) => ({
      text: comment.text,
      created_at: comment.created_at,
      attachments: comment.attachments.map(({ filename, content_type }) => ({ filename, content_type }))
    })),
    technical_checks: version.technical_checks,
    report_definitions: version.report_definitions ?? [],
    current: version.current
  };
}

export function proofOrderContentIdentity(order: ProofOrder) {
  return JSON.stringify({
    order_number: order.order_number,
    order_title: order.order_title,
    order_status: order.order_status,
    tasks: order.tasks.map((task) => ({
      task_id: task.task_id,
      attachment_id: task.attachment_id ?? null,
      version: task.version ?? null,
      line_number: task.line_number,
      shared_line_numbers: task.shared_line_numbers ?? [],
      product_name: task.product_name,
      quantity: task.quantity,
      state: task.state,
      decision_state: task.decision_state ?? null,
      action_reconciliation_pending: task.action_reconciliation_pending ?? false,
      sibling_index: task.sibling_index,
      sibling_count: task.sibling_count,
      feedback_required: task.feedback_required,
      feedback_acknowledged: task.feedback_acknowledged,
      current_version: proofVersionContent(task.current_version),
      versions: task.versions.map(proofVersionContent)
    }))
  });
}
