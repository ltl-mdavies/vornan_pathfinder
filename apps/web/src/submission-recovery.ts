// Frontend safety complements (and never replaces) backend certification/idempotency.
type Job = { customer_id: string; job_id: string; state: string; target_order_number?: string | null; submit_integrity?: { fingerprint: string } | null; submit_certification?: { can_submit: boolean; external_submit_enabled: boolean } | null };
type Attempt = { job_id: string; request_fingerprint?: string | null; state: string };
export const submissionKey = (job: Pick<Job, "customer_id" | "job_id">) => `${job.customer_id}:${job.job_id}`;

export function submissionDisposition(job: Job, attempts: Attempt[] = [], unknown = false) {
  if (job.target_order_number || job.state === "Order Confirmed") return "confirmed";
  if (unknown || job.state === "Submitted" || attempts.some(attempt => attempt.job_id === job.job_id &&
    (attempt.state === "Submission Uncertain" || (attempt.request_fingerprint === job.submit_integrity?.fingerprint && !["Blocked", "Gate Locked"].includes(attempt.state))))) return "pending";
  if (!["Ready", "Submit Failed"].includes(job.state) || !job.submit_integrity?.fingerprint ||
    !job.submit_certification?.can_submit || !job.submit_certification.external_submit_enabled) return "blocked";
  return "ready";
}

export function createSubmissionGuard() {
  const pending = new Set<string>();
  const unknown = new Set<string>();
  return {
    isUnknown: (job: Job) => unknown.has(submissionKey(job)),
    isPending: (job: Job) => pending.has(submissionKey(job)),
    begin(job: Job, attempts: Attempt[] = []) {
      const key = submissionKey(job);
      if (pending.has(key) || submissionDisposition(job, attempts, unknown.has(key)) !== "ready") return false;
      pending.add(key);
      return true;
    },
    finish(job: Job, responseUnknown: boolean) {
      const key = submissionKey(job);
      pending.delete(key);
      if (responseUnknown) unknown.add(key);
    },
    // Only a job+attempt read can resolve an unknown browser response. Empty/stale
    // Ready snapshots, certification responses and failed reads cannot unlock it.
    reconcile(job: Job, attempts: Attempt[]) {
      if (job.target_order_number || job.state === "Order Confirmed" || job.state === "Submitted" ||
        attempts.some(attempt => attempt.job_id === job.job_id && attempt.request_fingerprint === job.submit_integrity?.fingerprint && !["Blocked", "Gate Locked"].includes(attempt.state))) unknown.delete(submissionKey(job));
    }
  };
}
