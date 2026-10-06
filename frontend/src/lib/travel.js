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

// Leave at least this much room for a "+ travel" chip between two blocks:
// the grid is a pixel a minute, and a shorter gap can't hold one.
export const MIN_GAP_MIN = 20;

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

// Where a block's first or last stop is, for the gap between two blocks:
// an idea's place, or a custom event's title.
function endpoint(item, pins) {
  if (!item) return null;
  if (item.pinId != null) {
    const pin = pins[item.pinId];
    const point = pin && pin.lat != null && pin.lng != null ? { lat: pin.lat, lng: pin.lng } : null;
    // Where it is ("Hotel Alma"), not what you do there ("Check in").
    return { label: pin?.place?.trim() || item.title, point };
  }
  if (isTravelItem(item)) return null;
  return { label: item.title, point: null };
}

function onlyTravel(plan) {
  return plan.items.length > 0 && plan.items.every(isTravelItem);
}

/**
 * The gaps on a day where travel could go: between two blocks for
 * everyone that follow one another, at least MIN_GAP_MIN apart, where
 * neither side is already travel. Each says where it starts and ends
 * (minutes of the day) and where from and to — the last stop before and
 * the first after, with a point when it's an idea on the map.
 */
export function travelGaps(entries, pins) {
  const settled = entries.filter(
    ({ plan }) => plan.status !== "contested" && plan.status !== "draft" && plan.branchId == null && plan.forEveryone !== false
  );
  const gaps = [];
  for (let i = 0; i + 1 < settled.length; i += 1) {
    const before = settled[i];
    const after = settled[i + 1];
    // Something overlapping either one sits between them.
    const latestEnd = Math.max(...settled.slice(0, i + 1).map((e) => e.endMin));
    if (latestEnd !== before.endMin) continue;
    if (after.startMin - before.endMin < MIN_GAP_MIN) continue;
    if (before.endMin < DAY_START_MIN || after.startMin > DAY_END_MIN) continue;
    if (onlyTravel(before.plan) || onlyTravel(after.plan)) continue;
    gaps.push({
      startMin: before.endMin,
      endMin: after.startMin,
      from: endpoint(before.plan.items[before.plan.items.length - 1], pins),
      to: endpoint(after.plan.items[0], pins),
    });
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
