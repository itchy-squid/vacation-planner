// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_PLACES, describeDay, lodgingFor, withLodging, withStay, withVisit } from "./dayPlaces.js";

const DATES = ["2026-10-17", "2026-10-18", "2026-10-19"];

test("the place stayed at survives a change to the day, but not a change of town", () => {
  const day = withLodging(withStay(NO_PLACES, "Playa del Carmen"), 7);
  assert.equal(day.lodgingPinId, 7);
  assert.equal(withVisit(day, "Tulum").lodgingPinId, 7);
  assert.equal(withStay(day, "playa del carmen").lodgingPinId, 7);
  assert.equal(withStay(day, "Tulum").lodgingPinId, null);
  assert.equal(withStay(day, null).lodgingPinId, null);
});

test("there's nowhere to stay at without somewhere to stay", () => {
  assert.equal(withLodging(NO_PLACES, 7).lodgingPinId, null);
});

test("a day's trips start where the group woke up and end where it sleeps", () => {
  const places = {
    [DATES[0]]: { stay: "Playa", lodgingPinId: 1, visits: [] },
    [DATES[1]]: { stay: "Tulum", lodgingPinId: 2, visits: [] },
  };
  assert.deepEqual(lodgingFor(places, DATES, 0), { start: 1, end: 1 });
  assert.deepEqual(lodgingFor(places, DATES, 1), { start: 1, end: 2 });
  assert.deepEqual(lodgingFor(places, DATES, 2), { start: 2, end: null });
  assert.deepEqual(lodgingFor({}, DATES, 1), { start: null, end: null });
});

test("a day says where it's staying at", () => {
  assert.equal(describeDay({ stay: "Playa", visits: [] }, null, "Hotel Xcaret"), "Staying in Playa at Hotel Xcaret");
  assert.equal(describeDay({ stay: "Tulum", visits: [] }, "Playa"), "Moving to Tulum from Playa");
});
