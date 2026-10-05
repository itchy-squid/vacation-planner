// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstName,
  lastPayer,
  matchesQuery,
  openSpots,
  resolvePayer,
  sameNameSpot,
  sharedTripsLine,
  suggestedRole,
  tripGroups,
} from "./people.js";

const taiwan = { id: 1, name: "Taiwan", start_date: "2026-06-01", role: "planner" };
const peru = { id: 2, name: "Peru", start_date: "2025-03-01", role: "companion" };
const priya = { email: "priya@example.com", display_name: "Priya Shah", last_role: "planner", trips: [taiwan, peru] };
const sam = { email: "sam@example.com", display_name: "Sam", last_role: "owner", trips: [peru] };

test("trip groups list everyone from each shared trip, newest first", () => {
  assert.deepEqual(tripGroups([priya, sam]), [
    { id: 1, name: "Taiwan", startDate: "2026-06-01", emails: ["priya@example.com"], travelerKeys: [] },
    { id: 2, name: "Peru", startDate: "2025-03-01", emails: ["priya@example.com", "sam@example.com"], travelerKeys: [] },
  ]);
});

test("an undated trip sorts after dated ones", () => {
  const someday = { id: 3, name: "Someday", start_date: null, role: "reader" };
  const groups = tripGroups([{ ...sam, trips: [someday, peru] }]);
  assert.deepEqual(groups.map((g) => g.name), ["Peru", "Someday"]);
});

test("the shared-trips line caps a long history", () => {
  assert.equal(sharedTripsLine(priya), "Taiwan, Peru");
  const many = { ...priya, trips: [taiwan, peru, taiwan, peru, taiwan] };
  assert.equal(sharedTripsLine(many), "Taiwan, Peru, Taiwan +2");
});

test("search matches a name or email, ignoring case", () => {
  assert.ok(matchesQuery(priya, "  pri "));
  assert.ok(matchesQuery(priya, "SHAH"));
  assert.ok(matchesQuery(sam, "sam@"));
  assert.ok(!matchesQuery(sam, "priya"));
  assert.ok(matchesQuery(sam, ""));
});

test("an invite suggests the role from last time, and an owner becomes a planner", () => {
  assert.equal(suggestedRole(priya), "planner");
  assert.equal(suggestedRole({ ...priya, last_role: "reader" }), "reader");
  assert.equal(suggestedRole(sam), "planner");
});

test("first name is the first word of the display name", () => {
  assert.equal(firstName(priya), "Priya");
  assert.equal(firstName(sam), "Sam");
});

test("trip groups count past travelers without an account too", () => {
  const kai = { key: "kai|priya@example.com", name: "Kai", trips: [peru] };
  const groups = tripGroups([sam], [kai]);
  assert.deepEqual(groups[0].emails, ["sam@example.com"]);
  assert.deepEqual(groups[0].travelerKeys, ["kai|priya@example.com"]);
});

test("a listed traveler's payer falls back to you when they aren't coming", () => {
  const chosen = { "mei@example.com": { traveling: true }, "ana@example.com": { traveling: false } };
  assert.equal(resolvePayer("mei@example.com", chosen), "mei@example.com");
  assert.equal(resolvePayer("ana@example.com", chosen), "me");
  assert.equal(resolvePayer("zoe@example.com", chosen), "me");
  assert.equal(resolvePayer("me", chosen), "me");
  assert.equal(resolvePayer(null, chosen), null);
});

test("the last payer is you, someone else, or nobody", () => {
  assert.equal(lastPayer({ paid_by_you: true, paid_by_email: "me@example.com" }), "me");
  assert.equal(lastPayer({ paid_by_you: false, paid_by_email: "mei@example.com" }), "mei@example.com");
  assert.equal(lastPayer({ paid_by_you: false, paid_by_email: null }), null);
});

test("someone swaps in for the one open spot with their first name", () => {
  const roster = [
    { id: 1, name: "Mei", contributorId: 10 },
    { id: 2, name: "Jonah", contributorId: null },
    { id: 3, name: "Traveler 5", contributorId: null },
  ];
  const jonah = { display_name: "Jonah Reyes" };
  assert.equal(sameNameSpot(jonah, openSpots(roster))?.id, 2);
  assert.equal(sameNameSpot(jonah, openSpots(roster, new Set([2]))), null);
  assert.equal(sameNameSpot({ display_name: "Mei Lin" }, openSpots(roster)), null);
  const twoJonahs = [...roster, { id: 4, name: "jonah b", contributorId: null }];
  assert.equal(sameNameSpot(jonah, openSpots(twoJonahs)), null);
});
