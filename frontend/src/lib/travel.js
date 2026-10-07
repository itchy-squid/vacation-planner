// Travel on the calendar: a travel item ("travel" kind) with a mode, a
// from and a to, placed like any other block. It takes up the day like an
// activity does. Everything here is pure and tested (travel.test.js); the
// form is components/planner/TravelForm.jsx.
import { DAY_END_MIN, DAY_START_MIN, planDurationMinutes } from "./dayGrid.js";

// The Travel form's choices, in order. `mode` is what's stored
// (backend schemas.py TravelMode); "Other" stores no mode.
export const TRAVEL_MODES = [
  { mode: "flight", label: "Flight" },
  { mode: "car", label: "Drive" },
  { mode: "train", label: "Train" },
  { mode: "bus", label: "Bus" },
  { mode: "walk", label: "Walk" },
  { mode: null, label: "Other" },
];

const VERBS = { flight: "Flight", car: "Drive", train: "Train", bus: "Bus", walk: "Walk" };

// A leg at least this long counts as travel between places even when it
// isn't a flight: a drive from one city to the next, a long train.
export const LONG_LEG_MIN = 120;

/** "Flight IAH → MCO", "Drive to Hotel Alma", "Train", "Travel". */
export function travelTitle(mode, from = "", to = "") {
  const verb = VERBS[mode] ?? "Travel";
  const a = from.trim();
  const b = to.trim();
  if (a && b) return `${verb} ${a} → ${b}`;
  if (b) return `${verb} to ${b}`;
  if (a) return `${verb} from ${a}`;
  return verb;
}

/**
 * Minutes from a departure to a landing, both minutes of the day. A
 * landing earlier than the departure is the next day (an overnight
 * flight); the same time is a whole day.
 */
export function minutesBetween(departMin, landMin) {
  const d = landMin - departMin;
  return d > 0 ? d : d + 1440;
}

/** "07:30" from an <input type="time">, as a minute of the day; null when blank. */
export function minuteFromClock(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A minute of the day as an <input type="time"> value. */
export function clockValue(minute) {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Is a plan item travel (a "travel" kind travel item)? */
export function isTravelItem(item) {
  return item.travelItemId != null && item.kind === "travel";
}

/** Travel between places rather than around one: a flight, or any leg two hours or more. */
export function isLongLeg(item) {
  return isTravelItem(item) && (item.mode === "flight" || item.durationMinutes >= LONG_LEG_MIN);
}

function travelShare(plan) {
  const total = plan.items.reduce((sum, it) => sum + (it.durationMinutes || 0), 0);
  if (!total) return 0;
  const travel = plan.items.filter(isTravelItem).reduce((sum, it) => sum + (it.durationMinutes || 0), 0);
  return travel / total;
}

/**
 * Minutes of travel on one day, from the day's entries (lib/dayGrid.js
 * plansOnDay). A plan that runs past midnight counts only its hours on
 * this day; a block mixing travel with stops counts travel's share of it.
 * Proposals aren't counted: nothing's decided yet.
 */
export function dayTravelMinutes(entries) {
  return Math.round(
    entries
      .filter(({ plan }) => plan.status !== "contested" && plan.status !== "draft")
      .reduce((sum, { plan, startMin, endMin }) => {
        const share = travelShare(plan);
        if (!share) return sum;
        return sum + (Math.min(endMin, DAY_END_MIN) - Math.max(startMin, DAY_START_MIN)) * share;
      }, 0)
  );
}

/** "3h 40m", "45m". */
export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Where a block's first or last stop is, for travel before or after it:
// an idea's place, a custom event's title, or where travel lands (`side`
// "end", the last stop's far end) or leaves from ("start").
function endpoint(item, pins, side) {
  if (!item) return null;
  if (item.pinId != null) {
    const pin = pins[item.pinId];
    const point = pin && pin.lat != null && pin.lng != null ? { lat: pin.lat, lng: pin.lng } : null;
    // Where it is ("Hotel Alma"), not what you do there ("Check in").
    return { label: pin?.place?.trim() || item.title, point, pinId: item.pinId };
  }
  if (isTravelItem(item)) {
    const label = (side === "end" ? item.toLabel : item.fromLabel)?.trim();
    return label ? { label, point: null } : null;
  }
  return { label: item.title, point: null };
}

/** A stay (a "stay" pin, lib/dayPlaces.js lodgingFor) as one end of travel. */
export function stayEnd(pin) {
  if (!pin) return null;
  const point = pin.lat != null && pin.lng != null ? { lat: pin.lat, lng: pin.lng } : null;
  return { label: pin.title?.trim() || pin.place?.trim() || "where you're staying", point, pinId: pin.id };
}

function onlyTravel(plan) {
  return plan.items.length > 0 && plan.items.every(isTravelItem);
}

// Is this end already the stay: the stay's own idea, or travel to or from it by name?
function atStay(end, stay) {
  if (!end) return true;
  if (end.pinId != null) return end.pinId === stay.pinId;
  return end.label.toLowerCase() === stay.label.toLowerCase();
}

/**
 * The places on a day where travel could go. Each says where it starts
 * and ends (minutes of the day) and where from and to, with a point when
 * it's an idea on the map; travel's ends are its typed from and to.
 *
 * - Between two blocks for everyone that follow one another, however
 *   close (back to back is a gap of nothing: the travel pushes what's
 *   after it later, pushesFor), unless both are already travel. So a
 *   flight gets one after it, from the airport it lands at.
 * - With `stays` ({ lastNight, tonight }, each stayEnd()): from last
 *   night's stay to the day's first block (`edge: "start"`, arriving as
 *   it starts: the drive to the airport), and from the last block to
 *   tonight's (`edge: "end"`: the drive from the airport), unless that
 *   block is already there or travel to it.
 */
export function travelGaps(entries, pins, stays = {}) {
  const settled = entries.filter(
    ({ plan }) => plan.status !== "contested" && plan.status !== "draft" && plan.branchId == null && plan.forEveryone !== false
  );
  const first = (plan) => plan.items[0];
  const last = (plan) => plan.items[plan.items.length - 1];
  const gaps = [];

  const opening = settled[0];
  if (stays.lastNight && opening && opening.startMin > DAY_START_MIN) {
    const to = endpoint(first(opening.plan), pins, "start");
    if (!atStay(to, stays.lastNight)) {
      gaps.push({ edge: "start", startMin: opening.startMin, endMin: opening.startMin, from: stays.lastNight, to });
    }
  }

  for (let i = 0; i + 1 < settled.length; i += 1) {
    const before = settled[i];
    const after = settled[i + 1];
    // Something overlapping either one sits between them.
    const latestEnd = Math.max(...settled.slice(0, i + 1).map((e) => e.endMin));
    if (latestEnd !== before.endMin) continue;
    if (after.startMin < before.endMin) continue;
    if (before.endMin < DAY_START_MIN || after.startMin > DAY_END_MIN) continue;
    if (onlyTravel(before.plan) && onlyTravel(after.plan)) continue;
    gaps.push({
      startMin: before.endMin,
      endMin: after.startMin,
      from: endpoint(last(before.plan), pins, "end"),
      to: endpoint(first(after.plan), pins, "start"),
    });
  }

  const closing = settled.length ? settled.reduce((a, b) => (b.endMin >= a.endMin ? b : a)) : null;
  if (stays.tonight && closing && closing.endMin < DAY_END_MIN) {
    const from = endpoint(last(closing.plan), pins, "end");
    if (!atStay(from, stays.tonight)) {
      gaps.push({ edge: "end", startMin: closing.endMin, endMin: DAY_END_MIN, from, to: stays.tonight });
    }
  }
  return gaps;
}

/**
 * The long legs (isLongLeg) on the calendar, by the day they leave:
 * dayIndex -> [{ key, title, mode, startMinuteOfDay, durationMinutes }].
 */
export function longLegsByDay(plans) {
  const byDay = new Map();
  plans
    .filter((p) => p.startDt && p.status !== "contested" && p.status !== "draft")
    .forEach((plan) => {
      plan.items.forEach((item, index) => {
        if (!isLongLeg(item)) return;
        const minute = item.startMinuteOfDay ?? plan.startDt.minuteOfDay;
        const dayIndex = plan.startDt.dayIndex + Math.floor(minute / 1440);
        if (!byDay.has(dayIndex)) byDay.set(dayIndex, []);
        byDay.get(dayIndex).push({
          key: `${plan.id}-${index}`,
          title: item.title,
          mode: item.mode,
          startMinuteOfDay: ((minute % 1440) + 1440) % 1440,
          durationMinutes: item.durationMinutes || planDurationMinutes(plan),
        });
      });
    });
  byDay.forEach((legs) => legs.sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay));
  return byDay;
}

/**
 * What has to move later for travel at [startMin, endMin) to fit, from the
 * day's entries (lib/dayGrid.js plansOnDay): each block in the way is
 * pushed just past the one before it, and the pushing stops at the first
 * block there's already room for, so later gaps soak it up.
 *
 *   { moves: [{ plan, startMin, endMin }] }   in day order; empty when it fits
 *   { blocked: "why" }                        when it can't be made to fit
 *
 * Only a placed or pencilled block moves. A vote or a locked block,
 * something that started before the travel and runs into it, or a push
 * past midnight blocks it.
 */
export function pushesFor(entries, startMin, endMin) {
  const shown = entries.filter(({ plan }) => plan.status !== "draft");
  const before = shown.find((e) => e.startMin < startMin && e.endMin > startMin);
  if (before) return { blocked: `It would overlap ${planName(before.plan)}.` };
  const moves = [];
  let cursor = endMin;
  for (const entry of shown) {
    if (entry.startMin < startMin) continue;
    if (entry.startMin >= cursor) break;
    const { plan } = entry;
    const name = planName(plan);
    // The same blocks a drag can move (lib/planDrag.js dragKind).
    if (plan.status !== "placed" && plan.status !== "pencilled") {
      return { blocked: `${name} is ${plan.status === "locked" ? "locked" : "out for a vote"}, so it can't be pushed later.` };
    }
    if (entry.continuesBefore || entry.continuesAfter) return { blocked: `${name} runs past midnight, so it can't be pushed later.` };
    const shift = cursor - entry.startMin;
    const moved = { plan, startMin: entry.startMin + shift, endMin: entry.endMin + shift };
    if (moved.endMin > DAY_END_MIN) return { blocked: `It would push ${name} past midnight.` };
    moves.push(moved);
    cursor = moved.endMin;
  }
  return { moves };
}

/** "Lunch", "Beach day": what a block is called on the calendar. */
export function planName(plan) {
  return plan.label?.trim() || plan.items?.[0]?.title || "a block";
}

// How far past the trip's own places a place search for travel still
// prefers (lib/places.js searchPlaces bias), in degrees: about 50 km.
const BIAS_PAD_DEG = 0.5;

/**
 * The area to look for a typed "from" or "to" in: the box around the
 * trip's places on the map ({ lat, lng }), padded. Null when none are.
 */
export function biasAround(points) {
  const usable = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!usable.length) return null;
  const lats = usable.map((p) => p.lat);
  const lngs = usable.map((p) => p.lng);
  return {
    south: Math.max(-90, Math.min(...lats) - BIAS_PAD_DEG),
    north: Math.min(90, Math.max(...lats) + BIAS_PAD_DEG),
    west: Math.max(-180, Math.min(...lngs) - BIAS_PAD_DEG),
    east: Math.min(180, Math.max(...lngs) + BIAS_PAD_DEG),
  };
}

// A flight's time from how far it goes: about 780 km/h at cruise, plus
// 40 minutes for taxiing, climbing and landing. A guess to start from,
// not a schedule; Google doesn't time flights.
const CRUISE_KMH = 780;
const FLIGHT_OVERHEAD_MIN = 40;

/** Minutes in the air for a flight of `meters`, rounded up to the next 5. */
export function flightMinutes(meters) {
  const minutes = FLIGHT_OVERHEAD_MIN + (meters / 1000 / CRUISE_KMH) * 60;
  return Math.max(5, Math.ceil(minutes / 5) * 5);
}
