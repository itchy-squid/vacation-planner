// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "./format.js";

test("a length of time reads in hours and minutes", () => {
  assert.equal(formatDuration(45), "45m");
  assert.equal(formatDuration(120), "2h");
  assert.equal(formatDuration(65), "1h 5m");
  assert.equal(formatDuration(null), "0m");
});
