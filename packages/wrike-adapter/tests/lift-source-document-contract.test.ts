import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareWrikeLiftOrderDocumentPatch,
  sanitizeWrikeLiftDeliveryFileName,
  WrikeLiftDocumentContractError,
  type WrikeLiftDocumentPublication,
  type WrikeLiftSourceEvidenceBinding
} from "../src/lift-source-document-contract.ts";

const digest = "a".repeat(64);

function evidence(role: "order_grid" | "reference_proof"): WrikeLiftSourceEvidenceBinding {
  return {
    evidence_id: role === "order_grid" ? "wrike_workbook_evidence" : "wrike_reference_proof_evidence",
    document_role: role,
    task_id: "IEQUALIFIEDTASK",
    attachment_id: role === "order_grid" ? "IEGRID" : "IEPROOF",
    version_id: role === "order_grid" ? "IEGRIDV1" : "IEPROOFV1",
    file_name: role === "order_grid" ? "C316870: AZ Lottery #1.xlsx" : "C316870 - Campaign Proof.pdf",
    content_type: role === "order_grid"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf",
    byte_size: role === "order_grid" ? 4096 : 2048,
    sha256: digest
  };
}

function publication(source: WrikeLiftSourceEvidenceBinding): WrikeLiftDocumentPublication {
  return {
    publication_id: source.document_role === "order_grid" ? "publication_grid" : "publication_proof",
    evidence_id: source.evidence_id,
    document_role: source.document_role,
    source_sha256: source.sha256,
    object_version_id: "delivery-version-1",
    direct_url: `https://go.vornan.co/d/opaque-document-token/${sanitizeWrikeLiftDeliveryFileName(source.file_name)}`,
    published_byte_size: source.byte_size,
    published_at: "2026-07-31T15:59:00.000Z",
    expires_at: "2026-08-14T15:59:00.000Z",
    preflight: {
      http_status: 200,
      redirect_count: 0,
      content_length: source.byte_size,
      checked_at: "2026-07-31T16:00:00.000Z"
    }
  };
}

test("prepares three distinct canonical URLs only from exact direct-200 publications", () => {
  const grid = evidence("order_grid");
  const proof = evidence("reference_proof");
  const result = prepareWrikeLiftOrderDocumentPatch({
    task_id: "IEQUALIFIEDTASK",
    order_grid: grid,
    order_grid_publication: publication(grid),
    reference_proof: proof,
    reference_proof_publication: publication(proof),
    artwork_folder_url: "https://momentara.sharepoint.com/sites/art/C316870"
  });
  assert.match(result.order_attachment, /^https:\/\/go\.vornan\.co\/d\//);
  assert.match(result.reference_proof_url ?? "", /^https:\/\/go\.vornan\.co\/d\//);
  assert.equal(result.artwork_folder_url, "https://momentara.sharepoint.com/sites/art/C316870");
  assert.equal(result.publications.length, 2);
  assert.equal(JSON.stringify(result).includes("attachment_id"), false);
  assert.match(result.order_attachment, /C316870_AZ_Lottery_1\.xlsx$/);
});

test("replaces illegal delivery filename characters with underscores and preserves the extension", () => {
  assert.equal(
    sanitizeWrikeLiftDeliveryFileName("  Campaign: East / West? #1.xlsx  "),
    "Campaign_East_West_1.xlsx"
  );
  assert.equal(sanitizeWrikeLiftDeliveryFileName(".hidden proof.pdf"), "_hidden_proof.pdf");
});

test("allows no reference proof but never an unpaired proof publication", () => {
  const grid = evidence("order_grid");
  const withoutProof = prepareWrikeLiftOrderDocumentPatch({
    task_id: "IEQUALIFIEDTASK",
    order_grid: grid,
    order_grid_publication: publication(grid),
    artwork_folder_url: null
  });
  assert.equal(withoutProof.reference_proof_url, null);

  assert.throws(
    () => prepareWrikeLiftOrderDocumentPatch({
      task_id: "IEQUALIFIEDTASK",
      order_grid: grid,
      order_grid_publication: publication(grid),
      reference_proof_publication: publication(evidence("reference_proof")),
      artwork_folder_url: null
    }),
    WrikeLiftDocumentContractError
  );
});

test("fails closed on redirects, cross-bound evidence, unsafe hosts, or changed bytes", () => {
  const grid = evidence("order_grid");
  const run = (changed: WrikeLiftDocumentPublication, source = grid) =>
    prepareWrikeLiftOrderDocumentPatch({
      task_id: "IEQUALIFIEDTASK",
      order_grid: source,
      order_grid_publication: changed,
      artwork_folder_url: "https://momentara.sharepoint.com/art"
    });

  assert.throws(() => run({ ...publication(grid), preflight: { ...publication(grid).preflight, redirect_count: 1 as 0 } }));
  assert.throws(() => run({ ...publication(grid), direct_url: "https://example.com/order.xlsx" }));
  assert.throws(() => run({
    ...publication(grid),
    direct_url: "https://go.vornan.co/d/opaque-document-token/wrong-name.xlsx"
  }));
  assert.throws(() => run({ ...publication(grid), source_sha256: "b".repeat(64) }));
  assert.throws(() => run(publication(grid), { ...grid, task_id: "IEOTHER" }));
});
