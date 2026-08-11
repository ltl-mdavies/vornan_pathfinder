import assert from "node:assert/strict";
import test from "node:test";
import type { LiftSubmitTransportResult } from "@pathfinder/lift-adapter";
import {
  assertReviewedSubmitIntegrity,
  buildSubmitIdempotencyKey,
  buildSubmitIntegritySnapshot,
  buildWrikeSubmitDocumentExpectations,
  classifySubmitAttemptState,
  preflightWrikeSubmitDocuments,
  submitAttemptId,
  SubmitIntegrityError
} from "../src/submit-integrity.js";
import type { ProcessingJobPreview } from "../src/store.js";

const gridUrl = "https://go.vornan.co/d/wd_1234567890abcdef/order_grid.xlsx";
const proofUrl = "https://go.vornan.co/d/wd_abcdef1234567890/reference_proof.pdf";

function job(): ProcessingJobPreview {
  const value = {
    job_id: "job_submit_integrity_001",
    customer_id: "284619",
    output_route_id: "route-lift",
    submit_profile_id: "profile-demo",
    lift_payload: {
      customer: { customer_name: "LTL Demo", lift_customer_id: "1249" },
      source: {
        platform: "Pathfinder",
        pathfinder_customer_id: "284619",
        source_system: "Wrike",
        source_customer: "Momentara",
        source_record_id: "task-synthetic",
        submitted_at: "2026-08-01T12:00:00.000Z",
        pathfinder_job_id: "job_submit_integrity_001",
        pathfinder_canonical_order_id: "co_submit_integrity_001"
      },
      order: {
        ext_id: "PF-SYNTHETIC-001",
        order_title: "Synthetic order",
        source_order_grid_url: gridUrl,
        source_reference_proof_url: proofUrl
      },
      lines: []
    },
    canonical_order: {
      order: {
        order_attachment: gridUrl,
        reference_proof_url: proofUrl
      }
    },
    submit_request_masked: {
      endpoint_url: "https://lift.invalid/create_order",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Ext_ID: "PF-SYNTHETIC-001",
        User: "PATHFINDER",
        Password: "********",
        Company: "91"
      },
      body: null
    },
    source_evidence: {
      provider: "wrike",
      evidence_id: "evidence-grid-001",
      evidence_sha256: "a".repeat(64),
      import_method_fingerprint: "b".repeat(64),
      connection_id: "connection-001",
      account_id: "account-001",
      task_id: "task-synthetic",
      attachment_id: "attachment-grid",
      version_id: "version-grid",
      captured_at: "2026-08-01T12:00:00.000Z"
    },
    source_document_publications: [
      {
        document_role: "order_grid",
        evidence_id: "evidence-grid-001",
        publication_id: "publication-grid-001",
        sha256: "a".repeat(64),
        object_version_id: "grid.version+001=",
        published_at: "2026-08-01T12:00:00.000Z",
        expires_at: "2026-08-15T12:00:00.000Z"
      },
      {
        document_role: "reference_proof",
        evidence_id: "evidence-proof-001",
        publication_id: "publication-proof-001",
        sha256: "c".repeat(64),
        object_version_id: "proof.version+001=",
        published_at: "2026-08-01T12:00:00.000Z",
        expires_at: "2026-08-15T12:00:00.000Z",
        source_evidence_ids: ["evidence-proof-source-001", "evidence-proof-source-002"]
      }
    ]
  } as unknown as ProcessingJobPreview;
  value.submit_request_masked.body = value.lift_payload;
  return value;
}

test("pins the reviewed payload, masked request, and document set deterministically", () => {
  const firstJob = job();
  const first = buildSubmitIntegritySnapshot({
    payload: firstJob.lift_payload,
    submit_request_masked: firstJob.submit_request_masked,
    source_document_publications: firstJob.source_document_publications,
    reviewed_at: "2026-08-01T12:05:00.000Z"
  });
  const replay = buildSubmitIntegritySnapshot({
    payload: firstJob.lift_payload,
    submit_request_masked: firstJob.submit_request_masked,
    source_document_publications: [...(firstJob.source_document_publications ?? [])].reverse(),
    reviewed_at: "2026-08-01T12:06:00.000Z"
  });
  assert.equal(first.fingerprint, replay.fingerprint);
  const changed = job();
  changed.lift_payload.order.order_title = "Changed after review";
  const changedSnapshot = buildSubmitIntegritySnapshot({
    payload: changed.lift_payload,
    submit_request_masked: changed.submit_request_masked,
    source_document_publications: changed.source_document_publications
  });
  assert.notEqual(first.fingerprint, changedSnapshot.fingerprint);

  const changedProofSet = job();
  changedProofSet.source_document_publications![1]!.source_evidence_ids = [
    "evidence-proof-source-001",
    "evidence-proof-source-003"
  ];
  assert.notEqual(
    first.document_set_sha256,
    buildSubmitIntegritySnapshot({
      payload: changedProofSet.lift_payload,
      submit_request_masked: changedProofSet.submit_request_masked,
      source_document_publications: changedProofSet.source_document_publications
    }).document_set_sha256
  );

  firstJob.submit_integrity = first;
  assert.equal(assertReviewedSubmitIntegrity({
    job: firstJob,
    reviewed_fingerprint: first.fingerprint,
    current_submit_request_masked: firstJob.submit_request_masked
  }).fingerprint, first.fingerprint);
  changed.submit_integrity = first;
  assert.throws(
    () => assertReviewedSubmitIntegrity({
      job: changed,
      reviewed_fingerprint: first.fingerprint,
      current_submit_request_masked: changed.submit_request_masked
    }),
    (error: unknown) => error instanceof SubmitIntegrityError && error.code === "review_mismatch"
  );
});

test("binds one workbook and one proof to custom Lift output fields", () => {
  const expectations = buildWrikeSubmitDocumentExpectations(job());
  assert.deepEqual(expectations.map((item) => item.document_role), ["order_grid", "reference_proof"]);
  assert.deepEqual(expectations.map((item) => item.object_key), [
    "d/wd_1234567890abcdef/order_grid.xlsx",
    "d/wd_abcdef1234567890/reference_proof.pdf"
  ]);

  const duplicate = job();
  duplicate.lift_payload.order.another_grid_field = gridUrl;
  assert.throws(
    () => buildWrikeSubmitDocumentExpectations(duplicate),
    (error: unknown) => error instanceof SubmitIntegrityError && error.code === "document_binding_invalid"
  );
});

test("rechecks immutable S3 versions and direct HTTP 200 delivery immediately before submit", async () => {
  const commands: any[] = [];
  const checked = await preflightWrikeSubmitDocuments({
    job: job(),
    publication_enabled: true,
    delivery_bucket_name: "synthetic-delivery-bucket",
    now: () => new Date("2026-08-01T12:10:00.000Z"),
    s3_sender: {
      async send(command: any) {
        commands.push(command.input);
        const isGrid = command.input.Key.includes("order_grid");
        return {
          VersionId: isGrid ? "grid.version+001=" : "proof.version+001=",
          ContentLength: isGrid ? 1234 : 5678,
          Metadata: {
            evidence_id: isGrid ? "evidence-grid-001" : "evidence-proof-001",
            publication_id: isGrid ? "publication-grid-001" : "publication-proof-001",
            source_sha256: isGrid ? "a".repeat(64) : "c".repeat(64),
            document_role: isGrid ? "order_grid" : "reference_proof"
          }
        };
      }
    },
    fetch_impl: (async (url: string | URL) => {
      const directUrl = String(url);
      const length = directUrl.endsWith(".xlsx") ? "1234" : "5678";
      return {
        status: 200,
        redirected: false,
        url: directUrl,
        headers: new Headers({ "content-length": length }),
        body: { cancel: async () => undefined }
      } as unknown as Response;
    }) as typeof fetch
  });
  assert.equal(checked.required, true);
  assert.equal(checked.documents.length, 2);
  assert.equal(commands.every((input) => input.VersionId === undefined), true);
  assert.equal(JSON.stringify(checked).includes("https://"), false);
});

test("fails closed when document delivery is dark or a file redirects", async () => {
  await assert.rejects(
    preflightWrikeSubmitDocuments({
      job: job(),
      publication_enabled: false,
      delivery_bucket_name: "synthetic-delivery-bucket"
    }),
    (error: unknown) => error instanceof SubmitIntegrityError && error.code === "document_delivery_disabled"
  );
});

test("classifies uncertain observations as non-terminal and derives one deterministic attempt", () => {
  const observation = (args: Partial<LiftSubmitTransportResult>): LiftSubmitTransportResult => ({
    status: "error",
    http_status: null,
    lift_order_id: null,
    message: "synthetic",
    raw_body: null,
    error_translation: null,
    received_at: "2026-08-01T12:00:00.000Z",
    ...args
  });
  assert.equal(classifySubmitAttemptState(observation({ status: "accepted", lift_order_id: "A0000001", http_status: 200 })), "Submitted");
  assert.equal(classifySubmitAttemptState(observation({ status: "accepted", http_status: 202 })), "Submission Uncertain");
  assert.equal(classifySubmitAttemptState(observation({ status: "rejected", http_status: 503 })), "Submission Uncertain");
  assert.equal(classifySubmitAttemptState(observation({ status: "rejected", http_status: 422 })), "Failed");
  assert.equal(classifySubmitAttemptState(observation({ status: "not_sent" })), "Dry Run");

  const firstJob = job();
  const fingerprint = "d".repeat(64);
  const key = buildSubmitIdempotencyKey(firstJob, fingerprint);
  assert.equal(submitAttemptId(firstJob.customer_id, key), submitAttemptId(firstJob.customer_id, key));
  assert.notEqual(submitAttemptId(firstJob.customer_id, key), submitAttemptId(firstJob.customer_id, `${key}:changed`));
});
