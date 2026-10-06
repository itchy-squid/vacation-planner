// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { plansOnDay } from "./dayGrid.js";
import { dayTime } from "./planTime.js";
import {
  clockValue,
  dayTravelMinutes,
  formatMinutes,
  isLongLeg,
  longLegsByDay,
  minuteFromClock,
  minutesBetween,
  travelGaps,
  travelTitle,
} from "./travel.js";

let nextId = 1;
const stop = (title, durationMinutes, pinId = nextId++) => ({ pinId, travelItemId: null, kind: null, title, mode: null, durationMinutes });
const leg = (title, durationMinutes, mode = "car") => ({ pinId: null, travelItemId: nextId++, kind: "travel", title, mode, durationMinutes });
const errand = (title, durationMinutes) => ({ pinId: null, travelItemId: nextId++, kind: "other", title, mode: null, durationMinutes });

function plan(start, end, items, extra = {}) {
  return { id: nextId++, status: "placed", branchId: null, forEveryone: true, startDt: dayTime(start), endDt: dayTime(end), items, ...extra };
}

test("a travel title says how and between where, with whatever's known", () => {
  assert.equal(travelTitle("flight", "IAH", "MCO"), "Flight IAH → MCO");
  assert.equal(travelTitle("car", "", "Hotel Alma"), "Drive to Hotel Alma");
  assert.equal(travelTitle("train", "Tokyo ", ""), "Train from Tokyo");
  assert.equal(travelTitle("walk"), "Walk");
  assert.equal(travelTitle(null, "A", "B"), "Travel A → B");
});

test("a flight that lands before it leaves lands the next day", () => {
  assert.equal(minutesBetween(minuteFromClock("11:05"), minuteFromClock("13:30")), 145);
  assert.equal(minutesBetween(minuteFromClock("22:00"), minuteFromClock("06:15")), 495);
  assert.equal(minuteFromClock(""), null);
  assert.equal(clockValue(1500), "01:00");
});

test("long legs are flights, or any travel two hours or more", () => {
  assert.ok(isLongLeg(leg("Flight", 50, "flight")));
  assert.ok(isLongLeg(leg("Drive to Tampa", 120)));
  assert.ok(!isLongLeg(leg("Drive to the hotel", 35)));
  assert.ok(!isLongLeg(errand("Rental car pickup", 180)));
  assert.ok(!isLongLeg(stop("Disney Springs", 240)));
});

test("a day's travel counts its own hours of an overnight flight, and travel's share of a mixed block", () => {
  const plans = [
    plan(720, 865, [leg("Flight", 145, "flight")]),
    plan(900, 990, [leg("Drive", 30), stop("Beach", 60)]),
    plan(1320, 1440 + 300, [leg("Red-eye", 420, "flight")]),
    plan(600, 660, [leg("Proposed bus", 60, "bus")], { status: "contested" }),
  ];
  assert.equal(dayTravelMinutes(plansOnDay(plans, 1)), 145 + 30 + 120);
  assert.equal(dayTravelMinutes(plansOnDay(plans, 2)), 300);
  assert.equal(formatMinutes(295), "4h 55m");
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(120), "2h");
});

test("there's room for travel between two blocks that follow one another", () => {
  const pins = { 1: { place: "Hotel Alma", lat: 28.4, lng: -81.3 } };
  const plans = [
    plan(540, 600, [stop("Check in", 60, 1)]),
    plan(630, 700, [stop("Beach", 70, 2)]),
    plan(710, 760, [stop("Lunch", 50)]), // 10 minutes: too short
    plan(800, 830, [leg("Drive", 30)]), // already travel
    plan(900, 960, [stop("Museum", 60)]),
    plan(1000, 1060, [stop("Ours", 60)], { forEveryone: false, branchId: 4 }),
  ];
  const gaps = travelGaps(plansOnDay(plans, 1), pins);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], {
    startMin: 600,
    endMin: 630,
    from: { label: "Hotel Alma", point: { lat: 28.4, lng: -81.3 } },
    to: { label: "Beach", point: null },
  });
});

test("a block overlapping the gap closes it", () => {
  const plans = [plan(540, 600, [stop("A", 60)]), plan(560, 700, [stop("Long", 140)]), plan(650, 720, [stop("B", 70)])];
  assert.deepEqual(travelGaps(plansOnDay(plans, 1), {}), []);
});

test("long legs are listed on the day they leave, in order", () => {
  const plans = [
    plan(1440 + 690, 1440 + 1220, [leg("Flight HNL → HND", 530, "flight")]),
    plan(540, 600, [leg("Bus", 60, "bus")]),
    plan(1440 + 300, 1440 + 600, [leg("Drive to Tampa", 300)]),
  ];
  const byDay = longLegsByDay(plans);
  assert.deepEqual([...byDay.keys()], [2]);
  assert.deepEqual(byDay.get(2).map((l) => [l.title, l.startMinuteOfDay]), [["Drive to Tampa", 300], ["Flight HNL → HND", 690]]);
});
