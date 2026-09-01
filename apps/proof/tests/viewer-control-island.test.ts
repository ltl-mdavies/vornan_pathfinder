import assert from "node:assert/strict";
import test from "node:test";
import { clampViewerControlIslandPosition } from "../src/viewer-control-island.tsx";

test("keeps a moved viewer control island fully inside its viewer", () => {
  const bounds = { width: 800, height: 500, island_width: 180, island_height: 42 };
  assert.deepEqual(clampViewerControlIslandPosition({ x: -1, y: 4 }, bounds), { x: .1125, y: .958 });
  assert.deepEqual(clampViewerControlIslandPosition({ x: .5, y: .5 }, bounds), { x: .5, y: .5 });
});
