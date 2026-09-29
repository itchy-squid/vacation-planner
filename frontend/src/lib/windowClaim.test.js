// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAP_CLAIM_MIN, claimFromTap } from "./windowClaim.js";

const openDay = { min: 0, max: 1440, blocked: [] };

test("a tap claims an hour from the tapped slot", () => {
  assert.deepEqual(claimFromTap(600, openDay), { startMin: 600, endMin: 600 + TAP_CLAIM_MIN });
});

test("a tap claim stops at a pinned plan and at the end of the day", () => {
  const ferry = { min: 0, max: 1440, blocked: [{ start: 630, end: 700 }] };
  assert.deepEqual(claimFromTap(600, ferry), { startMin: 600, endMin: 630 });
  assert.deepEqual(claimFromTap(1410, openDay), { startMin: 1410, endMin: 1440 });
});
