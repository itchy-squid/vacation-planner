// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstName, matchesQuery, sharedTripsLine, suggestedRole, tripGroups } from "./people.js";

const taiwan = { id: 1, name: "Taiwan", start_date: "2026-06-01", role: "planner" };
const peru = { id: 2, name: "Peru", start_date: "2025-03-01", role: "companion" };
const priya = { email: "priya@example.com", display_name: "Priya Shah", last_role: "planner", trips: [taiwan, peru] };
const sam = { email: "sam@example.com", display_name: "Sam", last_role: "owner", trips: [peru] };

test("trip groups list everyone from each shared trip, newest first", () => {
  assert.deepEqual(tripGroups([priya, sam]), [
    { id: 1, name: "Taiwan", startDate: "2026-06-01", emails: ["priya@example.com"] },
    { id: 2, name: "Peru", startDate: "2025-03-01", emails: ["priya@example.com", "sam@example.com"] },
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
