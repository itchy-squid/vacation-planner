// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyCosts, chargedDays, daysCharged, dailyMoney } from "./dailyCosts.js";

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
