import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { OrderRollupLine, OrderRollupSnapshot } from "@pathfinder/order-rollup";
import { isPendingProofLine, pendingProofControlsEnabled } from "../../../packages/order-rollup-ui/src/pending-proof-lines.js";

const line = (step: string, cancelled = false) => ({step:{step_number:step},cancelled,proof_count:3}) as OrderRollupLine;
test("pending line predicate uses current steps and counts lines, never creatives", () => {
  for (const step of ["7.01","7.02","7.010"]) assert.equal(isPendingProofLine(line(step)),true);
  for (const step of ["", "7", "7.05", "14", "18", "invalid"]) assert.equal(isPendingProofLine(line(step)),false);
  assert.equal(isPendingProofLine(line("7.02",true)),false);
  assert.equal([line("7.01"),line("7.02"),line("14")].filter(isPendingProofLine).length,2);
});
test("presentation gate fails closed, independent of reviewer identity", () => {
  const snapshot = {proofing_enabled:true,proof_visibility:"status_only"} as OrderRollupSnapshot;
  assert.equal(pendingProofControlsEnabled(snapshot),true);
  for (const flag of [undefined,false]) assert.equal(pendingProofControlsEnabled({...snapshot,proofing_enabled:flag}),false);
  assert.equal(pendingProofControlsEnabled({...snapshot,proof_visibility:"off"}),false);
  assert.equal(pendingProofControlsEnabled({...snapshot,lifecycle:{state:"cancelled"}}),false);
  assert.equal(pendingProofControlsEnabled({...snapshot,order_status:{step:{step_number:"18"}} as OrderRollupSnapshot["order_status"]}),false);
});
test("filter preserves mounted thumbnails and uses visible lines for expansion", () => {
  const source=readFileSync(new URL('../../../packages/order-rollup-ui/src/index.tsx',import.meta.url),'utf8');
  assert.match(source,/hidden=\{pendingOnly && !isPendingProofLine\(line\)\}/);
  assert.match(source,/for \(const line of visibleLines\)/);
  assert.match(source,/SharedRowThumbnail/);
  assert.match(source,/Show all lines/);
});
