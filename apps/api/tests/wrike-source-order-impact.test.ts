import assert from "node:assert/strict";
import test from "node:test";
import type { LiftOrderPayload } from "@pathfinder/lift-adapter";
import {
  assessWrikeSourceOrderImpact,
  buildWrikeSourceOrderImpact
} from "../src/wrike-source-order-impact.js";

function payload(): LiftOrderPayload {
  return {
    customer: { lift_customer_id: "284619", customer_name: "Momentara" },
    source: {
      platform: "Pathfinder",
      pathfinder_customer_id: "284619",
      source_system: "Wrike",
      source_customer: "Momentara",
      source_record_id: "MAAAAAEOLqIq",
      submitted_at: "2026-08-13T14:28:10Z",
      pathfinder_job_id: "job-1",
      pathfinder_canonical_order_id: "canonical-1"
    },
    order: {
      ext_id: "PFMSRM52HKEE2B",
      contract_number: "C316994",
      order_title: "BHA",
      requested_ship_date: "09/01/2026",
      order_attachment: "https://volatile.example/one",
      reference_proof_url: "https://volatile.example/proof"
    },
    lines: [
      {
        line_number: 1,
        unit_number: "348198",
        product_id: "348198",
        quantity: 1,
        dimensions: { final_height: 24, final_width: 36 }
      }
    ]
  };
}

test("volatile submit identity and document URLs do not change effective impact", () => {
  const first = payload();
  const second = payload();
  second.order.ext_id = "OTHER";
  second.order.order_attachment = "https://volatile.example/two";
  second.source.submitted_at = "2026-08-13T15:00:00Z";
  second.source.pathfinder_job_id = "job-2";
  const baseline = buildWrikeSourceOrderImpact({
    payload: first,
    workbook_sha256: "workbook",
    reference_proof_evidence_ids: ["proof-a"]
  });
  const detected = buildWrikeSourceOrderImpact({
    payload: second,
    workbook_sha256: "workbook",
    reference_proof_evidence_ids: ["proof-a"]
  });
  assert.equal(assessWrikeSourceOrderImpact(baseline, detected).classification, "processing_only");
});

test("Lift-bound line and stable proof-set changes are material", () => {
  const baselinePayload = payload();
  const changedPayload = payload();
  changedPayload.lines[0]!.quantity = 2;
  const assessment = assessWrikeSourceOrderImpact(
    buildWrikeSourceOrderImpact({
      payload: baselinePayload,
      workbook_sha256: "workbook",
      reference_proof_evidence_ids: ["proof-a"]
    }),
    buildWrikeSourceOrderImpact({
      payload: changedPayload,
      workbook_sha256: "workbook",
      reference_proof_evidence_ids: ["proof-a", "proof-b"]
    })
  );
  assert.equal(assessment.classification, "material");
  assert.deepEqual(assessment.reason_codes, ["lift_lines_changed", "reference_proof_set_changed"]);
});

test("workbook content changes are distinguished from proof-set changes", () => {
  const baseline = buildWrikeSourceOrderImpact({
    payload: payload(),
    workbook_sha256: "workbook-a",
    reference_proof_evidence_ids: ["proof-a"]
  });
  const detected = buildWrikeSourceOrderImpact({
    payload: payload(),
    workbook_sha256: "workbook-b",
    reference_proof_evidence_ids: ["proof-a"]
  });
  assert.deepEqual(assessWrikeSourceOrderImpact(baseline, detected).reason_codes, [
    "workbook_content_changed"
  ]);
});

test("missing impact remains fail closed", () => {
  const assessment = assessWrikeSourceOrderImpact(null, null);
  assert.equal(assessment.classification, "impact_unavailable");
  assert.deepEqual(assessment.reason_codes, ["impact_unavailable"]);
});
