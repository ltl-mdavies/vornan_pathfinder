import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPrivateProofUploadDestination,
  buildProofUploadForm,
  proofUploadContentType,
  sanitizeProofUploadFilename,
  sha256ProofUpload
} from "../src/proof-asset-upload.ts";

test("sanitizes revised-art filenames without changing safe names", () => {
  assert.equal(sanitizeProofUploadFilename("Final Art (v2).pdf"), "Final Art (v2).pdf");
  assert.equal(sanitizeProofUploadFilename("client/final?.psd"), "client_final_.psd");
  assert.throws(() => sanitizeProofUploadFilename("..."), /usable filename/);
});

test("infers reviewed content types only when the browser omits one", () => {
  assert.equal(proofUploadContentType({ name: "art.PSD", type: "" }), "image/vnd.adobe.photoshop");
  assert.equal(proofUploadContentType({ name: "art.bin", type: "application/pdf" }), "application/pdf");
  assert.equal(proofUploadContentType({ name: "art.zip", type: "" }), "");
});

test("allows only direct private S3 POST destinations", () => {
  assert.equal(
    assertPrivateProofUploadDestination("https://vornan-proof.s3.us-east-1.amazonaws.com/"),
    "https://vornan-proof.s3.us-east-1.amazonaws.com/"
  );
  for (const value of [
    "http://vornan-proof.s3.amazonaws.com/",
    "https://example.com/upload",
    "https://vornan-proof.s3.amazonaws.com/?credential=secret",
    "https://user@example.s3.amazonaws.com/"
  ]) {
    assert.throws(() => assertPrivateProofUploadDestination(value), /upload destination/);
  }
});

test("streams a pinned SHA-256 digest and reports completed bytes", async () => {
  const progress: number[] = [];
  const value = new Blob(["synthetic revised art"]);
  assert.equal(
    await sha256ProofUpload(value, (completed) => progress.push(completed)),
    "1a03c582be285d0fd53549484be7f00a71d7b221b350ed83d8968856436e5283"
  );
  assert.equal(progress.at(-1), value.size);
});

test("places exact signed fields before the sanitized file in the S3 form", () => {
  const form = buildProofUploadForm(
    { key: "orders/synthetic", policy: "synthetic-policy" },
    new Blob(["art"], { type: "application/pdf" }),
    "revised?.pdf"
  );
  assert.deepEqual([...form.keys()], ["key", "policy", "file"]);
  assert.equal(form.get("key"), "orders/synthetic");
  const file = form.get("file") as File;
  assert.equal(file.name, "revised_.pdf");
  assert.equal(file.type, "application/pdf");
});
