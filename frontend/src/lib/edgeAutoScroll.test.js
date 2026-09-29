// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE_ZONE_PX, MAX_STEP_PX, edgeScrollStep } from "./edgeAutoScroll.js";

// A pane showing client y 100..700.
const TOP = 100;
const BOTTOM = 700;

test("nothing scrolls away from the edges", () => {
  assert.equal(edgeScrollStep(400, TOP, BOTTOM), 0);
  assert.equal(edgeScrollStep(TOP + EDGE_ZONE_PX, TOP, BOTTOM), 0);
  assert.equal(edgeScrollStep(BOTTOM - EDGE_ZONE_PX, TOP, BOTTOM), 0);
});

test("near the bottom scrolls down, near the top scrolls up", () => {
  assert.ok(edgeScrollStep(BOTTOM - 10, TOP, BOTTOM) > 0);
  assert.ok(edgeScrollStep(TOP + 10, TOP, BOTTOM) < 0);
});

test("faster the closer to the edge, capped past it", () => {
  const near = edgeScrollStep(BOTTOM - EDGE_ZONE_PX / 2, TOP, BOTTOM);
  const at = edgeScrollStep(BOTTOM, TOP, BOTTOM);
  assert.ok(near < at);
  assert.equal(at, MAX_STEP_PX);
  assert.equal(edgeScrollStep(BOTTOM + 200, TOP, BOTTOM), MAX_STEP_PX);
  assert.equal(edgeScrollStep(TOP - 200, TOP, BOTTOM), -MAX_STEP_PX);
});

test("a short pane keeps a middle where nothing scrolls", () => {
  assert.equal(edgeScrollStep(150, 100, 200), 0);
  assert.ok(edgeScrollStep(195, 100, 200) > 0);
});
