// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseApiDateTime, isoForDayMinute } from "./planTime.js";
import {
  blockingProblem,
  buildTrip,
  dayCalendar,
  proposalBody,
  rideItem,
  ridePlacements,
  stopLetter,
  tripName,
  tripStopIds,
} from "./tripPlan.js";

const START = "2026-10-17";
const DAY = 3;

const HOTEL = { id: 1, title: "Our hotel", dur: 60 };
const COBA = { id: 2, title: "Cobá Ruins", dur: 150 };
const CENOTE = { id: 3, title: "Cenote Dos Ojos", dur: 120 };
const TULUM = { id: 4, title: "Tulum Ruins", dur: 180 };

let nextPlanId = 100;
function plan(pin, startMin, endMin, { status = "placed", day = DAY, title } = {}) {
  const startsAt = isoForDayMinute(START, day, startMin);
  const endsAt = isoForDayMinute(START, day, endMin);
  return {
    id: nextPlanId++,
    status,
    forEveryone: true,
    label: title ?? "",
    startDt: parseApiDateTime(startsAt),
    endDt: parseApiDateTime(endsAt),
    items: [{ pinId: pin.id, title: pin.title, startMinuteOfDay: startMin, durationMinutes: endMin - startMin }],
  };
}

function trip({ stops, plans = [], lodging = [HOTEL.id], legs, leave = 540, visits = {} }) {
  return buildTrip({
    stops,
    lodgingIds: lodging,
    calendar: dayCalendar(plans, START, DAY),
    legMinutes: legs ?? stops.slice(1).map(() => 30),
    leaveMinute: leave,
    visitMinutes: visits,
  });
}

const roles = (t) => t.stops.map((s) => [s.pin.title, s.role, s.inBlock]);
const times = (t) => t.seq.map((it) => [it.kind === "leg" ? `→ ${it.to.title}` : it.stop.pin.title, it.start, it.end]);

test("the night's lodging closes the loop only when asked, and only once", () => {
  assert.deepEqual(tripStopIds([1, 2, 3], { endLodgingId: 1, endAtLodging: true }), [1, 2, 3, 1]);
  assert.deepEqual(tripStopIds([1, 2, 3], { endLodgingId: 1, endAtLodging: false }), [1, 2, 3]);
  assert.deepEqual(tripStopIds([2, 1], { endLodgingId: 1, endAtLodging: true }), [2, 1]);
  assert.deepEqual(tripStopIds([1, 2], { endLodgingId: null, endAtLodging: true }), [1, 2]);
});

test("hotel → A → B → hotel proposes both stops and every ride, not the hotel", () => {
  const t = trip({ stops: [HOTEL, COBA, CENOTE, HOTEL], legs: [110, 55, 60] });
  assert.deepEqual(roles(t), [
    ["Our hotel", "lodging", false],
    ["Cobá Ruins", "new", true],
    ["Cenote Dos Ojos", "new", true],
    ["Our hotel", "lodging", false],
  ]);
  assert.equal(t.direct, false);
  assert.equal(t.windowStart, 540);
  assert.equal(t.windowEnd, 540 + 110 + 150 + 55 + 120 + 60);
  assert.equal(tripName(t), "Cobá Ruins & Cenote Dos Ojos");
});

test("a first stop that isn't lodging or on the calendar is proposed too", () => {
  const t = trip({ stops: [COBA, CENOTE], lodging: [], legs: [55] });
  assert.deepEqual(roles(t), [
    ["Cobá Ruins", "new", true],
    ["Cenote Dos Ojos", "new", true],
  ]);
  assert.deepEqual(times(t), [
    ["Cobá Ruins", 540, 690],
    ["→ Cenote Dos Ojos", 690, 745],
    ["Cenote Dos Ojos", 745, 865],
  ]);
});

test("a stop already on the calendar pins the whole trip to its time", () => {
  const tulum = plan(TULUM, 660, 840);
  const t = trip({ stops: [HOTEL, CENOTE, TULUM, HOTEL], plans: [tulum], legs: [45, 20, 50] });
  assert.deepEqual(times(t), [
    ["Our hotel", 475, 475],
    ["→ Cenote Dos Ojos", 475, 520],
    ["Cenote Dos Ojos", 520, 640],
    ["→ Tulum Ruins", 640, 660],
    ["Tulum Ruins", 660, 840],
    ["→ Our hotel", 840, 890],
    ["Our hotel", 890, 890],
  ]);
  assert.deepEqual(t.captured, [tulum.id]);
  assert.deepEqual(t.clashes, []);
});

test("only rides between stops already on the calendar go straight on it", () => {
  const breakfast = plan(HOTEL, 480, 525, { title: "Breakfast" });
  const tulum = plan(TULUM, 660, 840);
  const t = trip({ stops: [HOTEL, TULUM, HOTEL], plans: [breakfast, tulum], legs: [60, 60] });
  assert.equal(t.direct, true);
  assert.deepEqual(t.legs.map((l) => [l.start, l.end]), [[600, 660], [840, 900]]);
  assert.equal(blockingProblem(t), null);
  assert.equal(tripName(t), "Getting to Tulum Ruins");
});

test("a ride that doesn't fit its gap can't be added straight away", () => {
  const swim = plan(CENOTE, 480, 600, { title: "Cenote swim" });
  const tulum = plan(TULUM, 660, 840);
  // Leaves when the swim ends, so a 90-minute ride is half an hour late.
  const late = trip({ stops: [CENOTE, TULUM], plans: [swim, tulum], lodging: [], legs: [90] });
  assert.equal(late.direct, true);
  assert.equal(late.legs[0].start, 600);
  assert.match(blockingProblem(late), /reach Tulum Ruins 30 min after it starts/);
  // Arriving on time instead would run over coffee in between.
  const coffee = plan(COBA, 600, 650, { title: "Coffee" });
  assert.match(blockingProblem(trip({ stops: [HOTEL, TULUM], plans: [coffee, tulum], legs: [90] })), /overlaps Coffee/);
});

test("a proposal can overlap plans, but never a pinned one", () => {
  const coffee = plan(TULUM, 600, 630, { title: "Coffee" });
  const t = trip({ stops: [HOTEL, COBA, HOTEL], plans: [coffee], legs: [110, 110] });
  assert.deepEqual(t.clashes.map((c) => c.title), ["Coffee"]);
  assert.equal(blockingProblem(t), null);
  const ferry = plan(TULUM, 700, 760, { status: "locked", title: "Ferry" });
  const blocked = trip({ stops: [HOTEL, COBA, HOTEL], plans: [ferry], legs: [110, 110] });
  assert.equal(blocked.lockedClash, true);
  assert.match(blockingProblem(blocked), /Ferry, which is pinned/);
});

test("a visit can be lengthened, and the proposal trims the stop to match", () => {
  const t = trip({ stops: [HOTEL, COBA, HOTEL], legs: [110, 110], visits: { [COBA.id]: 180 } });
  const body = proposalBody(t, { 0: 901, 1: 902 }, { startDate: START, dayIndex: DAY, label: "Cobá" });
  assert.equal(body.starts_at, "2026-10-19T09:00:00+00:00");
  assert.equal(body.ends_at, "2026-10-19T15:40:00+00:00");
  assert.deepEqual(body.items, [
    { travel_item_id: 901, offset_minutes: 0 },
    { pin_id: COBA.id, offset_minutes: 110, duration_minutes: 180 },
    { travel_item_id: 902, offset_minutes: 290 },
  ]);
});

test("an anchor inside the proposal keeps its own clock time", () => {
  const tulum = plan(TULUM, 660, 840);
  const t = trip({ stops: [HOTEL, CENOTE, TULUM, HOTEL], plans: [tulum], legs: [45, 20, 50] });
  const body = proposalBody(t, [1, 2, 3], { startDate: START, dayIndex: DAY });
  assert.deepEqual(
    body.items.map((i) => [i.pin_id ?? `ride ${i.travel_item_id}`, i.offset_minutes]),
    [["ride 1", 0], [CENOTE.id, 45], ["ride 2", 165], [TULUM.id, 185], ["ride 3", 365]]
  );
});

test("a later stop reached after it starts is flagged", () => {
  const dinner = plan(CENOTE, 900, 960, { title: "Dinner" });
  const t = trip({ stops: [HOTEL, COBA, CENOTE], plans: [dinner], legs: [110, 120], leave: 600 });
  // Pinned to dinner: 900 - 120 - 150 - 110 = 520.
  assert.equal(t.windowStart, 520);
  assert.equal(t.late.length, 0);
  const lunch = plan(COBA, 700, 760, { title: "Lunch" });
  const late = trip({ stops: [HOTEL, COBA, CENOTE], plans: [lunch, dinner], legs: [110, 200] });
  assert.equal(late.late[0].pin.title, "Cenote Dos Ojos");
  assert.equal(late.late[0].byMinutes, 60);
});

test("passing the same place twice is just a waypoint, under its first letter", () => {
  const t = trip({ stops: [HOTEL, COBA, HOTEL, CENOTE, HOTEL], legs: [110, 110, 50, 50] });
  assert.deepEqual(roles(t).map((r) => r[2]), [false, true, false, true, false]);
  assert.deepEqual(t.stops.map((s) => stopLetter(t, s)), ["A", "B", "A", "D", "A"]);
});

test("a trip still waiting on a ride's time isn't ready", () => {
  assert.equal(trip({ stops: [HOTEL, COBA], legs: [null] }).ready, false);
  assert.equal(trip({ stops: [HOTEL, COBA], legs: [110] }).ready, true);
  assert.equal(trip({ stops: [HOTEL], legs: [] }).ready, false);
});

test("a trip past midnight can't go on the calendar", () => {
  const t = trip({ stops: [HOTEL, COBA, HOTEL], legs: [110, 110], leave: 1200 });
  assert.match(blockingProblem(t), /past midnight/);
});

test("each ride becomes a travel item and, when nothing's new, a placed plan", () => {
  const tulum = plan(TULUM, 660, 840);
  const t = trip({ stops: [HOTEL, TULUM], plans: [tulum], legs: [60] });
  const item = rideItem(t.legs[0], { distanceMeters: 58000, fareCents: 350, summary: "Walk 5m · Bus 50m" }, "bus");
  assert.deepEqual(item, {
    title: "Bus to Tulum Ruins",
    kind: "travel",
    mode: "bus",
    duration_minutes: 60,
    distance_meters: 58000,
    cost_cents: 350,
    cost_basis: "per_head",
    notes: "Walk 5m · Bus 50m",
  });
  assert.deepEqual(ridePlacements(t, [77], { startDate: START, dayIndex: DAY }), [
    { starts_at: "2026-10-19T10:00:00+00:00", ends_at: "2026-10-19T11:00:00+00:00", status: "placed", items: [{ travel_item_id: 77 }] },
  ]);
});

test("drafts and split-group plans aren't on the day; proposals are busy but not stops", () => {
  const draft = plan(TULUM, 660, 840, { status: "draft" });
  const proposed = plan(COBA, 600, 700, { status: "contested" });
  const cal = dayCalendar([draft, proposed, { ...plan(CENOTE, 700, 760), forEveryone: false }], START, DAY);
  assert.deepEqual(cal.busy.map((b) => b.id), [proposed.id]);
  assert.equal(cal.stops.size, 0);
});
