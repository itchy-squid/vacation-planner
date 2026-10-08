// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyCosts, chargedDays, daysCharged, dailyMoney, rowsByDay } from "./dailyCosts.js";

const DAYS = [1, 2, 3, 4, 5, 6];
const TRIP = { startDate: "2026-03-12", dayCount: 6 };
const TRAVELERS = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

const HOTEL = { id: 7, title: "Casa Malix", kind: "stay", costPer: "day", costCents: 18000, costBasis: "group" };
const CAR = { id: 8, title: "Rental car", kind: "activity", costPer: "day", costCents: 6500, costBasis: "group", costStartDay: 1, costEndDay: 4 };

function staying(pinId, days) {
  return Object.fromEntries(days.map((day) => [day, { stay: "Playa", lodgingPinId: pinId, visits: [] }]));
}

test("n days from first to last is n - 1 days' worth, and never less than one", () => {
  assert.equal(daysCharged(1, 4), 3);
  assert.equal(daysCharged(1, 1), 1);
  assert.equal(daysCharged(null, 1), 0);
});

test("a stay's days are the nights it's where the group stays", () => {
  const dayPlaces = staying(7, DAYS.slice(0, 4));
  const days = chargedDays(HOTEL, { dayPlaces, days: DAYS, trip: TRIP });
  assert.equal(days.count, 4);
  assert.equal(days.first, 1);
  assert.equal(days.last, 5); // checks out the morning after the last night
  assert.equal(days.label, "Mar 12 – 16");
  assert.equal(chargedDays(HOTEL, { dayPlaces, days: DAYS }).label, "Days 1–5");
  assert.equal(chargedDays(HOTEL, { dayPlaces: {}, days: DAYS, trip: TRIP }).count, 0);
});

test("a stay paid once counts once, however many nights", () => {
  const once = { ...HOTEL, costPer: "once", costCents: 90000 };
  const days = chargedDays(once, { dayPlaces: staying(7, DAYS.slice(0, 3)), days: DAYS, trip: TRIP });
  assert.equal(days.count, 1);
  assert.deepEqual(dailyMoney(once, days.count, 4), { eachCents: 22500, totalCents: 90000 });
});

test("a group price is divided; a per-person price is multiplied", () => {
  assert.deepEqual(dailyMoney(CAR, 3, 4), { eachCents: 4875, totalCents: 19500 });
  assert.deepEqual(dailyMoney({ ...CAR, costBasis: "per_head" }, 3, 4), { eachCents: 19500, totalCents: 78000 });
});

test("rows come out priced, and ideas with a price but no days wait", () => {
  const pins = {
    7: HOTEL,
    8: CAR,
    9: { id: 9, title: "Bike hire", kind: "activity", costPer: "day", costCents: 1500, costBasis: "per_head" },
    10: { id: 10, title: "Cenote", kind: "activity", costPer: "once", costCents: 3000, costBasis: "per_head" },
  };
  const { rows, waiting } = buildDailyCosts(pins, { dayPlaces: staying(7, DAYS.slice(0, 4)), days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1, 2] });
  assert.deepEqual(rows.map((r) => [r.title, r.totalCents, r.shownCents]), [
    ["Casa Malix", 72000, 36000],
    ["Rental car", 19500, 9750],
  ]);
  assert.match(rows[0].howLabel, /4 nights × \$180/);
  assert.deepEqual(waiting.map((w) => w.title), ["Bike hire"]);
});

test("a price the viewer can't see is left out", () => {
  const { rows, waiting } = buildDailyCosts({ 8: { ...CAR, costCents: null } }, { dayPlaces: {}, days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1] });
  assert.equal(rows.length + waiting.length, 0);
});

test("by day, a stay paid by the night is a night's worth under each night, adding up exactly", () => {
  const pricey = { ...HOTEL, costCents: 10000 }; // $100 a night for the group, $25 each
  const { rows } = buildDailyCosts({ 7: pricey }, { dayPlaces: staying(7, [1, 2, 4]), days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1, 2, 3] });
  const parts = rowsByDay(rows[0]);
  assert.deepEqual(parts.map((p) => p.day), [1, 2, 4]); // the nights themselves, not a range
  assert.deepEqual(parts.map((p) => p.howLabel), ["night 1 of 3 · $100/night", "night 2 of 3 · $100/night", "night 3 of 3 · $100/night"]);
  const sum = (key) => parts.reduce((s, p) => s + p[key], 0);
  assert.equal(sum("totalCents"), rows[0].totalCents);
  assert.equal(sum("eachCents"), rows[0].eachCents);
  assert.equal(sum("shownCents"), rows[0].shownCents);
});

test("by day, what doesn't divide evenly goes on the last day", () => {
  const { rows } = buildDailyCosts({ 8: { ...CAR, costCents: 1000 } }, { dayPlaces: {}, days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1] });
  // 3 days at $10 for 4 people: $7.50 each over the 3 days.
  const parts = rowsByDay(rows[0]);
  assert.deepEqual(parts.map((p) => [p.day, p.totalCents, p.eachCents]), [
    [1, 1000, 250],
    [2, 1000, 250],
    [3, 1000, 250],
  ]);
  const odd = rowsByDay({ ...rows[0], eachCents: 751, totalCents: 3004, shownCents: 751 });
  assert.deepEqual(odd.map((p) => p.eachCents), [250, 250, 251]);
});

test("by day, a stay paid once is one row on its first night", () => {
  const once = { ...HOTEL, costPer: "once", costCents: 90000 };
  const { rows } = buildDailyCosts({ 7: once }, { dayPlaces: staying(7, [2, 3, 4]), days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1] });
  const parts = rowsByDay(rows[0]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].day, 2);
  assert.equal(parts[0].totalCents, 90000);
  assert.equal(parts[0].howLabel, "3 nights · paid once");
});

const TICKET = {
  id: 9, title: "Universal 5-day ticket", kind: "expense", expenseType: "pass", costPer: "once", costCents: 45000,
  costBasis: "per_head", costStartDay: 2, costEndDay: 6, travelerIds: [1, 2, 3], coversPinIds: [],
};

test("an expense paid once counts once, on its first day, without being on the calendar", () => {
  const { rows } = buildDailyCosts({ 9: TICKET }, { dayPlaces: {}, days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1, 2, 3, 4] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalCents, 135000);
  assert.equal(rows[0].eachCents, 45000);
  assert.equal(rows[0].howLabel, "Mar 13 – 17 · paid once");
  assert.deepEqual(rowsByDay(rows[0]).map((r) => r.day), [2]);
});

test("an expense is shared by its own travelers, and only those still on the trip", () => {
  const travelers = TRAVELERS.map((t, i) => ({ ...t, initial: "ABCD"[i] }));
  const ticket = { ...TICKET, travelerIds: [1, 3, 99] };
  const { rows } = buildDailyCosts({ 9: ticket }, { dayPlaces: {}, days: DAYS, trip: TRIP, travelers, shownIds: [2, 3] });
  assert.deepEqual(rows[0].sharers, [1, 3]);
  assert.equal(rows[0].sharersLabel, "A, C");
  assert.equal(rows[0].shownCents, 45000); // only traveler 3 of the shown two holds one
});

test("an expense for everyone is everyone's, said without initials", () => {
  const car = { ...CAR, kind: "expense", expenseType: "rental", travelerIds: null };
  const { rows } = buildDailyCosts({ 8: car }, { dayPlaces: {}, days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1] });
  assert.equal(rows[0].totalCents, 19500);
  assert.equal(rows[0].sharersLabel, "");
});

test("an idea picked as where you're staying is lodging even when it isn't marked as a stay", () => {
  const hotel = { ...CAR, id: 5, title: "Hotel Xcaret" };
  const { rows } = buildDailyCosts({ 5: hotel, 7: HOTEL }, { dayPlaces: staying(5, [1, 2]), days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1] });
  assert.equal(rows.find((r) => r.pinId === 5).lodging, true);
  const unpicked = buildDailyCosts({ 5: hotel }, { dayPlaces: {}, days: DAYS, trip: TRIP, travelers: TRAVELERS, shownIds: [1] });
  assert.equal(unpicked.rows[0].lodging, false);
});
