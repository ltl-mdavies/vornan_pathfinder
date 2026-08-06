import assert from "node:assert/strict";
import test from "node:test";

process.env.PATHFINDER_RUNTIME = "lambda";
process.env.PATHFINDER_REQUIRE_AUTH = "false";

const { normalizeProofReportPayload } = await import("../src/server.ts");

test("normalizes nested original-art metadata without changing one-proof-per-row cardinality", () => {
  const proofs = normalizeProofReportPayload({
    rowset: [{
      ORDER_NUMBER: "A0226753",
      ORDER_LINE_ID: 9748545,
      LINE_NUMBER: 1,
      ATTACHMENT_ID: 27085012,
      PROOF_FILENAME: "proof.jpg",
      PROOF_LINK_LOW: "https://proof.example.invalid/proof.jpg",
      ORIGINAL_ARTS: [{
        ORIGINAL_ART_ID: 27083920,
        ORIGINAL_ART_FILENAME: "1_Sheet_46x30_v2.pdf",
        ORIGINAL_ART_LINK: "https://art.example.invalid/original.pdf?X-Amz-Expires=604800"
      }, {
        ORIGINAL_ART_ID: 27083921,
        ORIGINAL_ART_FILENAME: "1_Sheet_46x30_v3.pdf",
        ORIGINAL_ART_LINK: "https://art.example.invalid/original-2.pdf?X-Amz-Expires=604800"
      }]
    }]
  });

  assert.equal(proofs.length, 1);
  assert.deepEqual(proofs[0]?.original_arts?.map((art) => ({
    id: art.original_art_id,
    filename: art.original_art_filename
  })), [{
    id: "27083920",
    filename: "1_Sheet_46x30_v2.pdf"
  }, {
    id: "27083921",
    filename: "1_Sheet_46x30_v3.pdf"
  }]);
});

test("keeps absent originals null and drops unsafe original-art locators", () => {
  const proofs = normalizeProofReportPayload({
    rowset: [{
      ORDER_NUMBER: "A0226753",
      ORDER_LINE_ID: 9748547,
      LINE_NUMBER: 3,
      ATTACHMENT_ID: 26834452,
      PROOF_FILENAME: "proof.jpg",
      ORIGINAL_ARTS: null
    }, {
      ORDER_NUMBER: "A0226753",
      ORDER_LINE_ID: 9748548,
      LINE_NUMBER: 4,
      ATTACHMENT_ID: 26834453,
      PROOF_FILENAME: "proof-2.jpg",
      ORIGINAL_ARTS: [{
        ORIGINAL_ART_ID: 123,
        ORIGINAL_ART_FILENAME: "unsafe.pdf",
        ORIGINAL_ART_LINK: "http://art.example.invalid/unsafe.pdf"
      }]
    }]
  });

  assert.equal(proofs[0]?.original_arts, null);
  assert.deepEqual(proofs[1]?.original_arts, []);
});
