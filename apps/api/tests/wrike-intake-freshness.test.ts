import assert from "node:assert/strict";
import test from "node:test";
import { assessWrikeFeedbackFreshness } from "../src/wrike-intake-freshness.js";
import type { ProcessingJobPreview } from "../src/store.js";
const job = { source_evidence: { attachment_id: "attachment", version_id: "version", evidence_id: "evidence", evidence_sha256: "a".repeat(64), import_method_fingerprint: "fingerprint", captured_at: "2026-09-10T10:00:00Z" } } as ProcessingJobPreview;
const workbook = { attachment_id: "attachment", version_id: "version", updated_at: "2026-09-10T09:00:00Z" };
test("freshness rejects legacy identity, multiple workbooks, changed versions and newer source metadata", () => {
  assert.equal(assessWrikeFeedbackFreshness(job, [workbook], workbook.updated_at), "current");
  assert.equal(assessWrikeFeedbackFreshness({} as ProcessingJobPreview, [workbook], workbook.updated_at), "legacy_backfill_required");
  assert.equal(assessWrikeFeedbackFreshness(job, [workbook, { ...workbook, attachment_id: "second" }], workbook.updated_at), "workbook_identity_review");
  assert.equal(assessWrikeFeedbackFreshness(job, [], workbook.updated_at), "workbook_identity_review");
  assert.equal(assessWrikeFeedbackFreshness(job, [workbook], null), "task_freshness_unknown");
  assert.equal(assessWrikeFeedbackFreshness(job, [{ ...workbook, version_id: "new" }], workbook.updated_at), "source_version_changed");
  assert.equal(assessWrikeFeedbackFreshness(job, [workbook], "2026-09-10T11:00:00Z"), "source_newer_than_job");
  assert.equal(assessWrikeFeedbackFreshness(job, [{ ...workbook, updated_at: "2026-09-10T11:00:00Z" }], workbook.updated_at), "source_newer_than_job");
});
