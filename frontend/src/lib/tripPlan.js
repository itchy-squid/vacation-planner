// Planning a trip from the Map tab (pages/PlanTrip.jsx): a chain of stops
// with a ride between each pair, turned into either rides straight on the
// calendar or one proposal. Everything here is pure, so the rules that
// decide what gets proposed are tested on their own (tripPlan.test.js).
//
// Each stop is one of three things on the chosen day:
//
//   lodging  where the group is staying (the day's "Staying at" idea,
//            lib/dayPlaces.js lodgingFor). Never proposed: it's where you
//            already are.
//   anchor   already on that day's calendar. It keeps its own time.
//   new      not on the calendar. It's what the proposal is about, with a
//            visit length of its own.
//
// The first and last stops sit outside the block when they're lodging or
// anchors — that's where the trip starts from or ends up. Everything else
// is the block: every ride, every new stop (a new first stop included),
// and any anchor in the middle, which keeps its time inside the block and
// is captured into "on the board" by the server, so losing the vote leaves
// it exactly where it was (backend routers/contests.py).
//
// A trip with no new stop has nothing to decide: its rides go straight on
// the calendar, each filling the gap between the stops either side of it.
//
// A stop can also be somewhere the map doesn't know: a custom event
// ("Lunch") or an idea with no spot. It happens where the group already is
// — at the last stop with a place before it — so no ride goes to or from
// it; the next ride leaves from that last place. Those stops carry
// `located: false`; anything else counts as a place.
import { plansOnDay, overlaps } from "./dayGrid.js";
import { tripMinute } from "./planTime.js";

export const VISIT_STEP_MIN = 15;
export const MIN_VISIT_MIN = 15;

const SETTLED = new Set(["placed", "pencilled", "locked"]);
const OCCUPYING = new Set(["placed", "pencilled", "contested", "locked"]);

const RIDE_VERB = { car: "Drive", bus: "Bus", train: "Train", walk: "Walk" };

/** The key a ride between two stops is remembered by (its mode, its estimate). */
export function legKey(fromId, toId) {
  return `${fromId}>${toId}`;
}

/**
 * What's on day `dayIndex` for one audience — everyone (`branchId` null)
 * or one group of a split — as the trip builder needs it: `busy`, every
 * plan holding time that day ({ id, title, startMin, endMin, locked }),
 * and `stops`, where each settled pin is (pin id -> { startMin, endMin,
 * planId }, its earliest placement). Drafts and other audiences' plans
 * are left out; a proposal is busy but isn't a stop anyone can count on
 * yet.
 */
export function dayCalendar(plans, dayIndex, branchId = null) {
  const mine = (p) => (branchId == null ? p.forEveryone !== false && p.branchId == null : p.branchId === branchId);
  const entries = plansOnDay(
    plans.filter((p) => OCCUPYING.has(p.status) && mine(p)),
    dayIndex
  );
  const busy = entries.map(({ plan, startMin, endMin }) => ({
    id: plan.id,
    title: plan.label || plan.items[0]?.title || "Another plan",
    startMin,
    endMin,
    locked: plan.status === "locked",
  }));
  const stops = new Map();
  entries.forEach(({ plan, startMin }) => {
    if (!SETTLED.has(plan.status)) return;
    const planStart = plan.startDt?.minuteOfDay ?? 0;
    plan.items.forEach((item) => {
      if (!item.pinId || stops.has(item.pinId) || item.startMinuteOfDay == null) return;
      // Items carry their clock time on the plan's own day; the entry
      // carries where the plan sits on this one.
      const at = startMin + ((item.startMinuteOfDay - planStart + 1440) % 1440);
      stops.set(item.pinId, { startMin: at, endMin: at + item.durationMinutes, planId: plan.id });
    });
  });
  return { busy, stops };
}

/**
 * The trip's stops in order: the ones picked, then the night's lodging
 * when the trip should end there (and doesn't already).
 */
export function tripStopIds(pickedIds, { endLodgingId = null, endAtLodging = false } = {}) {
  const ids = [...pickedIds];
  if (endAtLodging && endLodgingId != null && ids.length > 1 && ids[ids.length - 1] !== endLodgingId) ids.push(endLodgingId);
  return ids;
}

const located = (stop) => stop.located !== false;

/**
 * The rides a list of stops needs, in order: one into each stop with a
 * place from the last stop with a place before it. `toIndex` is the stop
 * the ride arrives at, so the ride happens just before it.
 */
export function rideLegsOf(stops) {
  const rides = [];
  let from = null;
  stops.forEach((stop, i) => {
    if (!located(stop)) return;
    if (from) rides.push({ key: legKey(from.id, stop.id), from, to: stop, toIndex: i });
    from = stop;
  });
  return rides;
}

/**
 * The whole trip, timed.
 *
 *   stops         [{ id, title, dur, located? }] in order — pins, or custom
 *                 events and ideas with no spot (located: false)
 *   lodgingIds    pin ids that are lodging on this day (where it starts and ends)
 *   calendar      dayCalendar(...)
 *   legMinutes    [minutes | null] per ride, in order; null while unknown
 *   leaveMinute   when the trip leaves, if nothing on the calendar pins it
 *   visitMinutes  pin id -> a visit length chosen here
 *
 * Returns { stops, legs, seq, windowStart, windowEnd, hasNew, direct,
 * clashes, lockedClash, late, captured, ready, fitsDay }.
 */
export function buildTrip({ stops, lodgingIds = [], calendar, legMinutes, leaveMinute, visitMinutes = {} }) {
  const last = stops.length - 1;
  const lodging = new Set(lodgingIds);
  const shaped = stops.map((pin, i) => {
    const anchorAt = calendar.stops.get(pin.id) ?? null;
    const role = located(pin) && lodging.has(pin.id) ? "lodging" : anchorAt ? "anchor" : "new";
    // A pin can only be in a plan once (backend routers/plans.py
    // ensure_unique_stops), so passing somewhere a second time is just a
    // waypoint: no time there, and no stop in the block.
    const repeat = stops.slice(0, i).some((s) => s.id === pin.id);
    const atEnd = i === 0 || i === last;
    const inBlock = !repeat && (role === "new" || (role === "anchor" && !atEnd));
    let minutes = 0;
    if (inBlock && role === "new") minutes = visitMinutes[pin.id] ?? pin.dur ?? 60;
    if (inBlock && role === "anchor") minutes = anchorAt.endMin - anchorAt.startMin;
    return { index: i, pin, role, anchor: anchorAt, repeat, inBlock, minutes };
  });

  const seq = [];
  const rides = rideLegsOf(stops);
  shaped.forEach((stop, i) => {
    const r = rides.findIndex((ride) => ride.toIndex === i);
    if (r >= 0) {
      const minutes = legMinutes[r];
      seq.push({ kind: "leg", index: r, from: rides[r].from, to: rides[r].to, minutes: minutes ?? 0, known: minutes != null, inBlock: true });
    }
    seq.push({ kind: "stop", stop, minutes: stop.minutes, inBlock: stop.inBlock });
  });

  // Pin the chain to its first anchor, else to the chosen leave time.
  const anchorAt = seq.findIndex((it) => it.kind === "stop" && it.stop.role === "anchor" && !it.stop.repeat);
  let cursor = leaveMinute;
  if (anchorAt >= 0) {
    const { stop } = seq[anchorAt];
    const point = stop.index === 0 ? stop.anchor.endMin : stop.anchor.startMin;
    cursor = point - seq.slice(0, anchorAt).reduce((sum, it) => sum + it.minutes, 0);
  }
  const late = [];
  seq.forEach((it) => {
    const { stop } = it;
    const timed = it.kind === "stop" && stop.role === "anchor" && !stop.repeat && stop.index !== 0;
    if (timed && cursor > stop.anchor.startMin) late.push({ pin: stop.pin, byMinutes: cursor - stop.anchor.startMin, atMinute: stop.anchor.startMin });
    if (timed && stop.inBlock) {
      it.start = Math.max(cursor, stop.anchor.startMin);
      it.end = it.start + it.minutes;
    } else {
      it.start = cursor;
      it.end = cursor + it.minutes;
    }
    cursor = it.end;
  });

  const block = seq.filter((it) => it.inBlock);
  const windowStart = block.length ? Math.min(...block.map((it) => it.start)) : 0;
  const windowEnd = block.length ? Math.max(...block.map((it) => it.end)) : 0;
  const hasNew = shaped.some((s) => s.role === "new" && !s.repeat);
  const legs = seq.filter((it) => it.kind === "leg");

  const tripPlanIds = new Set(shaped.filter((s) => s.anchor).map((s) => s.anchor.planId));
  const spans = hasNew ? [{ start: windowStart, end: windowEnd }] : legs;
  const clashes = calendar.busy.filter(
    (b) => !tripPlanIds.has(b.id) && spans.some((s) => s.end > s.start && overlaps(s.start, s.end, b.startMin, b.endMin))
  );
  const captured = [...new Set(shaped.filter((s) => s.role === "anchor" && s.inBlock).map((s) => s.anchor.planId))];

  return {
    stops: shaped,
    legs,
    seq,
    windowStart,
    windowEnd,
    hasNew,
    direct: !hasNew,
    clashes,
    lockedClash: clashes.some((c) => c.locked),
    late,
    captured,
    // Something to do, and every ride timed. One stop and no ride is a
    // proposal too ("dinner at the night market").
    ready: (legs.length > 0 || hasNew) && seq.some((it) => it.inBlock) && legs.every((l) => l.known),
    fitsDay: windowStart >= 0 && windowEnd <= 1440,
  };
}

/**
 * Why the trip can't go on the calendar as it stands, or null. A proposal
 * may overlap plans (they join the vote as what's on the board) but never
 * a pinned one; rides added straight to the calendar may overlap nothing.
 */
export function blockingProblem(trip) {
  if (!trip.legs.length && !trip.hasNew) return "Add another stop to plan a trip.";
  if (!trip.fitsDay) return "This trip runs past midnight. Leave earlier, or split it over two days.";
  const pinned = trip.clashes.find((c) => c.locked);
  if (pinned) return `It overlaps ${pinned.title}, which is pinned. Try another day or time.`;
  if (trip.direct && trip.clashes.length) {
    return `A ride overlaps ${trip.clashes[0].title}, so it doesn’t fit the gap. Try a faster way, or add a stop to propose a change.`;
  }
  if (trip.direct && trip.late.length) return lateMessage(trip.late[0]);
  return null;
}

export function lateMessage(late) {
  return `You’d reach ${late.pin.title} ${late.byMinutes} min after it starts.`;
}

/**
 * A stop's letter on the map and in the lists: A, B, C… in order, and a
 * place passed a second time (back at the hotel) keeps its first letter,
 * since it's one marker on the map.
 */
export function stopLetter(trip, stop) {
  if (!located(stop.pin)) return "•";
  const first = trip.stops.find((s) => s.pin.id === stop.pin.id) ?? stop;
  const places = trip.stops.filter((s, i) => i < first.index && located(s.pin) && !s.repeat).length;
  return String.fromCharCode(65 + places);
}

/** "Drive to Tulum Ruins". */
export function rideTitle(mode, to) {
  return `${RIDE_VERB[mode] ?? "Travel"} to ${to.title}`;
}

/** "Cobá Ruins & Cenote Dos Ojos": what the proposal is about. */
export function tripName(trip) {
  const fresh = trip.stops.filter((s) => s.role === "new" && !s.repeat);
  const news = fresh.map((s) => s.pin.title);
  if (!news.length) {
    const anchor = trip.stops.find((s) => s.role === "anchor");
    return anchor ? `Getting to ${anchor.pin.title}` : "Rides";
  }
  // "Trip to Lunch" reads oddly: an event with no place is just its name.
  if (news.length === 1) return fresh[0].pin.located === false ? news[0] : `Trip to ${news[0]}`;
  if (news.length === 2) return `${news[0]} & ${news[1]}`;
  return `${news[0]} + ${news.length - 1} more`;
}

/**
 * The travel item behind one ride (POST /api/trips/{id}/travel-items).
 * A transit fare is what one person pays; a car's cost isn't known.
 */
export function rideItem(leg, estimate, mode) {
  return {
    title: rideTitle(mode, leg.to),
    kind: "travel",
    mode,
    duration_minutes: leg.minutes,
    distance_meters: estimate?.distanceMeters ?? null,
    cost_cents: estimate?.fareCents ?? 0,
    cost_basis: "per_head",
    notes: estimate?.summary ?? "",
  };
}

/**
 * The proposal (POST /api/trips/{id}/contests): the block's hours, and its
 * stops and rides in order, each at its own time. `rideIds[i]` is the
 * travel item made for ride i. `window` ({ start, end }) fixes the hours
 * instead — a set joining a running vote has to span the vote's hours
 * exactly — and the trip sits inside them at its own times.
 */
export function proposalBody(trip, rideIds, { dayIndex, label = "", rationale = "", window = null }) {
  const start = window ? window.start : trip.windowStart;
  const end = window ? window.end : trip.windowEnd;
  return {
    start_min: tripMinute(dayIndex, start),
    end_min: tripMinute(dayIndex, end),
    label,
    rationale,
    items: blockItems(trip, rideIds, start),
  };
}

/** The block's stops and rides as plan items, timed from `base`. */
export function blockItems(trip, rideIds, base = trip.windowStart) {
  return trip.seq
    .filter((it) => it.inBlock)
    .map((it) => {
      if (it.kind === "leg") return { travel_item_id: rideIds[it.index], offset_minutes: it.start - base };
      const { pin } = it.stop;
      const item = pin.travelItemId != null ? { travel_item_id: pin.travelItemId } : { pin_id: pin.id };
      item.offset_minutes = it.start - base;
      // Only a visit that differs from the idea's own length is a trim.
      if (it.minutes !== pin.dur) item.duration_minutes = it.minutes;
      return item;
    });
}

/**
 * What the block costs the people it's for (`memberIds`): each new stop's
 * price, per person or split across the group (the same rule as
 * data/expenses.js stopMoney and the server), plus each ride's fare per
 * person. Stops already on the
 * calendar are paid for where they are. { perHeadCents, totalCents,
 * headcount, unknownFares } — unknownFares counts rides with no fare
 * (a car, or no estimate yet).
 */
export function tripMoney(trip, fares, memberIds) {
  const headcount = Math.max(1, memberIds.length);
  let totalCents = 0;
  trip.stops.forEach((s) => {
    if (s.role !== "new" || s.repeat || !s.inBlock) return;
    // Paid by the day: counted over its days, not per stop (lib/dailyCosts.js).
    const price = s.pin.costPer === "day" ? 0 : s.pin.costCents ?? 0;
    totalCents += (s.pin.costBasis ?? "per_head") === "group" ? price : price * headcount;
  });
  let unknownFares = 0;
  trip.legs.forEach((leg) => {
    const fare = fares[leg.index];
    if (fare) totalCents += fare * headcount;
    else unknownFares += 1;
  });
  return { perHeadCents: Math.round(totalCents / headcount), totalCents, headcount, unknownFares };
}

/**
 * Where a trip of `lengthMin` fits on a day: the open stretches between
 * `busy` spans ({ startMin, endMin }) inside [from, to], each as
 * { start, end, after } — `after` the title of what it follows, if
 * anything. Starts are rounded up to `step` minutes.
 */
export function openSlots(busy, lengthMin, { from = 0, to = 1440, step = 15 } = {}) {
  const spans = [...busy].filter((b) => b.endMin > from && b.startMin < to).sort((a, b) => a.startMin - b.startMin);
  const slots = [];
  let cursor = from;
  let after = null;
  const push = (end) => {
    const start = Math.ceil(cursor / step) * step;
    if (end - start >= lengthMin) slots.push({ start, end, after });
  };
  spans.forEach((b) => {
    if (b.startMin > cursor) push(b.startMin);
    if (b.endMin > cursor) {
      cursor = b.endMin;
      after = b.title ?? null;
    }
  });
  if (to > cursor) push(to);
  return slots;
}

/**
 * How far a block for one group reaches past its split's hours, or null
 * when it fits. A group's plans running long doesn't stop them: the group
 * stays apart longer. { daySplit, startMin, endMin } are the split's hours
 * as they'd have to become, and `earlier` / `later` say which edge moves.
 * `daySplits` from lib/splits.js splitsOnDay.
 */
export function splitStretch({ daySplits, branchId, start, end }) {
  if (branchId == null || end <= start) return null;
  const daySplit = daySplits.find((s) => s.split.branches.some((b) => b.id === branchId));
  if (!daySplit || (start >= daySplit.startMin && end <= daySplit.endMin)) return null;
  return {
    daySplit,
    startMin: Math.min(start, daySplit.startMin),
    endMin: Math.max(end, daySplit.endMin),
    earlier: start < daySplit.startMin,
    later: end > daySplit.endMin,
  };
}

/** One placed plan per ride (POST /api/trips/{id}/plans), for a trip with nothing to decide. */
export function ridePlacements(trip, rideIds, { dayIndex }) {
  return trip.legs.map((leg) => ({
    start_min: tripMinute(dayIndex, leg.start),
    end_min: tripMinute(dayIndex, leg.end),
    status: "placed",
    items: [{ travel_item_id: rideIds[leg.index] }],
  }));
}
