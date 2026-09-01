import assert from "node:assert/strict";
import test from "node:test";
import { highResolutionFormatDiffers } from "../src/proof-file-format.ts";

test("explains only a meaningful high-resolution proof format mismatch", () => {
  assert.equal(highResolutionFormatDiffers("artwork.jpg", "pdf"), true);
  assert.equal(highResolutionFormatDiffers("artwork.pdf", "image"), true);
  assert.equal(highResolutionFormatDiffers("artwork.jpg", "image"), false);
  assert.equal(highResolutionFormatDiffers("artwork.ai", "pdf"), false);
});
