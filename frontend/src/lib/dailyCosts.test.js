// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyCosts, chargedDays, daysCharged, dailyMoney } from "./dailyCosts.js";

const DATES = ["2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15", "2026-03-16", "2026-03-17"];
const TRAVELERS = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

const HOTEL = { id: 7, title: "Casa Malix", kind: "stay", costPer: "day", costCents: 18000, costBasis: "group" };
const CAR = { id: 8, title: "Rental car", kind: "activity", costPer: "day", costCents: 6500, costBasis: "group", costStartDate: "2026-03-12", costEndDate: "2026-03-15" };

function staying(pinId, dates) {
  return Object.fromEntries(dates.map((date) => [date, { stay: "Playa", lodgingPinId: pinId, visits: [] }]));
}

test("n days from first to last is n - 1 days' worth, and never less than one", () => {
  assert.equal(daysCharged("2026-03-12", "2026-03-15"), 3);
  assert.equal(daysCharged("2026-03-31", "2026-04-02"), 2);
  assert.equal(daysCharged("2026-03-12", "2026-03-12"), 1);
  assert.equal(daysCharged(null, "2026-03-12"), 0);
});

test("a stay's days are the nights it's where the group stays", () => {
  const dayPlaces = staying(7, DATES.slice(0, 4));
  const days = chargedDays(HOTEL, { dayPlaces, dates: DATES });
  assert.equal(days.count, 4);
  assert.equal(days.first, "2026-03-12");
  assert.equal(days.last, "2026-03-16"); // checks out the morning after the last night
  assert.equal(chargedDays(HOTEL, { dayPlaces: {}, dates: DATES }).count, 0);
});

test("a stay paid once counts once, however many nights", () => {
  const once = { ...HOTEL, costPer: "once", costCents: 90000 };
  const days = chargedDays(once, { dayPlaces: staying(7, DATES.slice(0, 3)), dates: DATES });
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
  const { rows, waiting } = buildDailyCosts(pins, { dayPlaces: staying(7, DATES.slice(0, 4)), dates: DATES, travelers: TRAVELERS, shownIds: [1, 2] });
  assert.deepEqual(rows.map((r) => [r.title, r.totalCents, r.shownCents]), [
    ["Casa Malix", 72000, 36000],
    ["Rental car", 19500, 9750],
  ]);
  assert.match(rows[0].howLabel, /4 nights × \$180/);
  assert.deepEqual(waiting.map((w) => w.title), ["Bike hire"]);
});

test("a price the viewer can't see is left out", () => {
  const { rows, waiting } = buildDailyCosts({ 8: { ...CAR, costCents: null } }, { dayPlaces: {}, dates: DATES, travelers: TRAVELERS, shownIds: [1] });
  assert.equal(rows.length + waiting.length, 0);
});
