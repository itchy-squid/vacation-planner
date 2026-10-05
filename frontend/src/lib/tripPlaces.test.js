// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tripPlaceNames } from "./tripPlaces.js";

test("lists pins' regions, then places set on days, once each", () => {
  const pins = { 1: { region: "Taipei" }, 2: { region: " taipei " }, 3: { region: "Jiufen" } };
  const dayPlaces = {
    1: { stay: "Taipei", visits: ["North Coast", "jiufen"] },
    2: { stay: "Kenting", visits: [] },
  };
  assert.deepEqual(tripPlaceNames(pins, dayPlaces), ["Taipei", "Jiufen", "North Coast", "Kenting"]);
});

test("a place nothing refers to any more is gone", () => {
  const before = tripPlaceNames({ 1: { region: "Hualien" } }, { 1: { stay: "Hualien", visits: [] } });
  assert.deepEqual(before, ["Hualien"]);
  // The idea moved to another region and the day was cleared.
  assert.deepEqual(tripPlaceNames({ 1: { region: "Tainan" } }, {}), ["Tainan"]);
});

test("skips blank names and copes with nothing loaded yet", () => {
  assert.deepEqual(tripPlaceNames({ 1: { region: "  " }, 2: { region: null } }, { d: { stay: null, visits: [""] } }), []);
  assert.deepEqual(tripPlaceNames(undefined, undefined), []);
});
