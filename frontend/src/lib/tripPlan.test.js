// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayTime, tripMinute } from "./planTime.js";
import {
  blockingProblem,
  buildTrip,
  dayCalendar,
  openSlots,
  proposalBody,
  rideLegsOf,
  splitStretch,
  tripMoney,
  rideItem,
  ridePlacements,
  stopLetter,
  tripName,
  tripStopIds,
} from "./tripPlan.js";

const DAY = 3;

const HOTEL = { id: 1, title: "Our hotel", dur: 60 };
const COBA = { id: 2, title: "Cobá Ruins", dur: 150 };
const CENOTE = { id: 3, title: "Cenote Dos Ojos", dur: 120 };
const TULUM = { id: 4, title: "Tulum Ruins", dur: 180 };

let nextPlanId = 100;
function plan(pin, startMin, endMin, { status = "placed", day = DAY, title } = {}) {
  const startsAt = tripMinute(day, startMin);
  const endsAt = tripMinute(day, endMin);
  return {
    id: nextPlanId++,
    status,
    forEveryone: true,
    label: title ?? "",
    startsAt,
    endsAt,
    startDt: dayTime(startsAt),
    endDt: dayTime(endsAt),
    items: [{ pinId: pin.id, title: pin.title, startMinuteOfDay: startMin, durationMinutes: endMin - startMin }],
  };
}

function trip({ stops, plans = [], lodging = [HOTEL.id], legs, leave = 540, visits = {} }) {
  return buildTrip({
    stops,
    lodgingIds: lodging,
    calendar: dayCalendar(plans, DAY),
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
  const body = proposalBody(t, { 0: 901, 1: 902 }, { dayIndex: DAY, label: "Cobá" });
  assert.equal(body.start_min, tripMinute(DAY, 540));
  assert.equal(body.end_min, tripMinute(DAY, 940));
  assert.deepEqual(body.items, [
    { travel_item_id: 901, offset_minutes: 0 },
    { pin_id: COBA.id, offset_minutes: 110, duration_minutes: 180 },
    { travel_item_id: 902, offset_minutes: 290 },
  ]);
});

test("an anchor inside the proposal keeps its own clock time", () => {
  const tulum = plan(TULUM, 660, 840);
  const t = trip({ stops: [HOTEL, CENOTE, TULUM, HOTEL], plans: [tulum], legs: [45, 20, 50] });
  const body = proposalBody(t, [1, 2, 3], { dayIndex: DAY });
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
  assert.deepEqual(t.stops.map((s) => stopLetter(t, s)), ["A", "B", "A", "C", "A"]);
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
  assert.deepEqual(ridePlacements(t, [77], { dayIndex: DAY }), [
    { start_min: tripMinute(DAY, 600), end_min: tripMinute(DAY, 660), status: "placed", items: [{ travel_item_id: 77 }] },
  ]);
});

test("drafts and split-group plans aren't on the day; proposals are busy but not stops", () => {
  const draft = plan(TULUM, 660, 840, { status: "draft" });
  const proposed = plan(COBA, 600, 700, { status: "contested" });
  const cal = dayCalendar([draft, proposed, { ...plan(CENOTE, 700, 760), forEveryone: false }], DAY);
  assert.deepEqual(cal.busy.map((b) => b.id), [proposed.id]);
  assert.equal(cal.stops.size, 0);
});

const LUNCH = { id: "t9", travelItemId: 9, title: "Lunch", dur: 45, located: false, costCents: 1200, costBasis: "per_head" };

test("a stop with no place happens where the group is, with no ride to it", () => {
  const stops = [HOTEL, COBA, LUNCH, CENOTE];
  assert.deepEqual(rideLegsOf(stops).map((r) => [r.from.title, r.to.title, r.toIndex]), [
    ["Our hotel", "Cobá Ruins", 1],
    ["Cobá Ruins", "Cenote Dos Ojos", 3],
  ]);
  const t = trip({ stops, legs: [110, 55] });
  assert.deepEqual(times(t), [
    ["Our hotel", 540, 540],
    ["→ Cobá Ruins", 540, 650],
    ["Cobá Ruins", 650, 800],
    ["Lunch", 800, 845],
    ["→ Cenote Dos Ojos", 845, 900],
    ["Cenote Dos Ojos", 900, 1020],
  ]);
  assert.deepEqual(t.stops.map((s) => stopLetter(t, s)), ["A", "B", "•", "C"]);
  const body = proposalBody(t, [71, 72], { dayIndex: DAY });
  assert.deepEqual(body.items[2], { travel_item_id: 9, offset_minutes: 260 });
});

test("one stop with no ride is a proposal of its own", () => {
  const t = trip({ stops: [LUNCH], lodging: [], legs: [] });
  assert.equal(t.ready, true);
  assert.equal(blockingProblem(t), null);
  assert.equal(t.windowEnd - t.windowStart, 45);
});

test("a set joining a vote spans the vote's hours, with the trip inside them", () => {
  const t = trip({ stops: [HOTEL, COBA], legs: [30], leave: 780 });
  const body = proposalBody(t, [71], { dayIndex: DAY, window: { start: 720, end: 1020 } });
  assert.equal(body.start_min, tripMinute(DAY, 720));
  assert.equal(body.end_min, tripMinute(DAY, 1020));
  assert.deepEqual(body.items.map((it) => it.offset_minutes), [60, 90]);
});

test("the block's cost counts new stops and fares, not what's already booked", () => {
  const coba = { ...COBA, costCents: 2000, costBasis: "per_head" };
  const van = { ...CENOTE, costCents: 9000, costBasis: "group" };
  const t = trip({ stops: [HOTEL, coba, van], legs: [30, 30] });
  const money = tripMoney(t, [150, null], [1, 2, 3]);
  assert.equal(money.totalCents, 2000 * 3 + 9000 + 150 * 3);
  assert.equal(money.perHeadCents, Math.round(money.totalCents / 3));
  assert.equal(money.unknownFares, 1);
});

test("open slots skip what's booked and round starts to the quarter hour", () => {
  const busy = [
    { startMin: 600, endMin: 720, title: "Museum" },
    { startMin: 1110, endMin: 1260, title: "Night market" },
  ];
  assert.deepEqual(openSlots(busy, 200, { from: 480, to: 1440 }), [
    { start: 720, end: 1110, after: "Museum" },
  ]);
  assert.deepEqual(openSlots(busy, 60, { from: 480, to: 1440 }).map((s) => s.start), [480, 720, 1260]);
});

test("a group's block that runs long stretches its split instead of stopping", () => {
  const daySplits = [{ startMin: 540, endMin: 720, split: { branches: [{ id: 7 }, { id: 8 }] } }];
  const ask = (branchId, start, end) => splitStretch({ daySplits, branchId, start, end });
  assert.equal(ask(7, 600, 700), null);
  assert.equal(ask(null, 480, 600), null);
  assert.deepEqual(
    (({ startMin, endMin, earlier, later }) => ({ startMin, endMin, earlier, later }))(ask(7, 660, 750)),
    { startMin: 540, endMin: 750, earlier: false, later: true }
  );
  assert.deepEqual(
    (({ startMin, endMin, earlier, later }) => ({ startMin, endMin, earlier, later }))(ask(8, 510, 600)),
    { startMin: 510, endMin: 720, earlier: true, later: false }
  );
});

test("a plan's length runs across days, so an overnight one isn't cut to its stops", async () => {
  const { planDurationMinutes } = await import("./dayGrid.js");
  const overnight = { startDt: dayTime(tripMinute(2, 1320)), endDt: dayTime(tripMinute(3, 120)), totalDurationMinutes: 75 };
  assert.equal(planDurationMinutes(overnight), 240);
  const contest = { startDt: dayTime(tripMinute(1, 780)), endDt: dayTime(tripMinute(1, 900)), totalDurationMinutes: 90 };
  assert.equal(planDurationMinutes(contest), 120);
});
