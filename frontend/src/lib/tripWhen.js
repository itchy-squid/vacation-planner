// When a trip is, and what happens to its plan when that changes.
//
// A trip has dates, or — planned before they're known — a length ("about
// 5 days") and maybe a rough month. Everything on its calendar is kept by
// day of the trip (backend app/tripdays.py), so:
//
//   - setting dates on a trip planned by length needs no question: day 1
//     lands on the start date and the rest follow;
//   - moving the start date from one date to another does: "shift" keeps
//     day 1 as day 1, so the plan moves with the trip, and "keep_dates"
//     leaves everything on the date it was on;
//   - moving only the end date, or changing the length, needs none either,
//     since day 1 doesn't move.
//
// Whatever ends up outside the trip's days is kept, not deleted: it's
// "set aside" until the dates move back or it's cleared.
import { parseISODate } from "./format.js";
import { MINUTES_PER_DAY } from "./planTime.js";

const DAY_MS = 86400000;

// Lengths offered as one tap on a new trip; anything else is the stepper.
export const LENGTH_PRESETS = [
  { days: 3, label: "Long weekend" },
  { days: 7, label: "A week" },
  { days: 10, label: "10 days" },
  { days: 14, label: "Two weeks" },
];

export const MAX_LENGTH_DAYS = 366;

function utcOf(iso) {
  const d = parseISODate(iso);
  return d ? Date.UTC(d.year, d.month - 1, d.day) : null;
}

function isoOf(utc) {
  return new Date(utc).toISOString().slice(0, 10);
}

/** Days from `a` to `b` (ISO dates): positive when `b` is later. */
export function daysBetween(a, b) {
  const from = utcOf(a);
  const to = utcOf(b);
  if (from == null || to == null) return 0;
  return Math.round((to - from) / DAY_MS);
}

/** The ISO date `days` after `iso`. */
export function addDays(iso, days) {
  return isoOf(utcOf(iso) + days * DAY_MS);
}

/** How many days a trip from `start` to `end` has (an end before the start counts as one). */
export function lengthOf(start, end) {
  if (!start) return null;
  return Math.max(1, daysBetween(start, end || start) + 1);
}

/** "Fri, Mar 12" for an ISO date. */
export function shortDate(iso) {
  const utc = utcOf(iso);
  if (utc == null) return "";
  return new Date(utc).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The fields PATCH/POST /api/trips take for what the form says, from
 * { mode: "dates" | "rough", startDate, endDate, lengthDays, roughMonth }.
 * Dates drop any length; a length drops the dates.
 */
export function whenFields(when) {
  if (when.mode === "rough") {
    return { start_date: null, end_date: null, length_days: when.lengthDays, rough_month: when.roughMonth ?? null };
  }
  return { start_date: when.startDate || null, end_date: when.endDate || null, length_days: null, rough_month: null };
}

/** The form's starting state for a trip (state.trip's shape), or a new one (no dates yet, 5 days if "Not sure yet"). */
export function whenOf(trip) {
  if (!trip?.startDate && trip?.lengthDays) {
    return { mode: "rough", startDate: "", endDate: "", lengthDays: trip.lengthDays, roughMonth: trip.roughMonth ?? null };
  }
  return {
    mode: "dates",
    startDate: trip?.startDate ?? "",
    endDate: trip?.endDate ?? "",
    lengthDays: trip?.dayCount ?? 5,
    roughMonth: null,
  };
}

/** Days the trip's first day moves when its dates change from `before` to `after` (ISO starts); 0 unless both are dates. */
export function startMovedBy(before, after) {
  if (!before || !after) return 0;
  return daysBetween(before, after);
}

/** "a week later", "2 days earlier". */
export function movedWords(days) {
  const n = Math.abs(days);
  const way = days > 0 ? "later" : "earlier";
  if (n % 7 === 0) return `${n === 7 ? "a week" : `${n / 7} weeks`} ${way}`;
  return `${n} ${n === 1 ? "day" : "days"} ${way}`;
}

/**
 * What's on each day of the trip as it is now: day -> { plans, stay },
 * the number of plans starting that day (drafts too — they move with
 * everything else) and where the group is staying.
 */
export function dayContents(plans, dayPlaces) {
  const days = new Map();
  const at = (day) => {
    if (!days.has(day)) days.set(day, { plans: 0, stay: null });
    return days.get(day);
  };
  plans.forEach((plan) => {
    if (plan.startDt) at(plan.startDt.dayIndex).plans += 1;
  });
  Object.entries(dayPlaces ?? {}).forEach(([day, places]) => {
    if (places.stay || places.visits?.length) at(Number(day)).stay = places.stay ?? places.visits[0] ?? null;
  });
  return days;
}

/** "3 plans · Hotel Kaze" for one day's contents. */
export function describeContents(c) {
  const parts = [];
  if (c?.plans) parts.push(`${c.plans} ${c.plans === 1 ? "plan" : "plans"}`);
  if (c?.stay) parts.push(c.stay);
  return parts.join(" · ");
}

/**
 * What the trip will look like after its dates change, for the move
 * prompt: one row per day of the new dates ({ day, date, contents,
 * fromDate }), and the days that end up outside them ({ date, contents }).
 * `how` is "shift" or "keep_dates"; `contents` comes from dayContents.
 */
export function movePreview({ contents, oldStart, newStart, newLength, how }) {
  const moved = startMovedBy(oldStart, newStart);
  const offset = how === "keep_dates" ? moved : 0;
  const rows = [];
  for (let day = 1; day <= newLength; day += 1) {
    const from = day + offset;
    rows.push({
      day,
      date: addDays(newStart, day - 1),
      contents: contents.get(from) ?? null,
      fromDate: how === "shift" && moved !== 0 && contents.has(from) ? addDays(oldStart, from - 1) : null,
    });
  }
  const setAside = [...contents.keys()]
    .filter((day) => day - offset < 1 || day - offset > newLength)
    .sort((a, b) => a - b)
    .map((day) => ({ date: addDays(oldStart, day - 1), contents: contents.get(day) }));
  return { rows, setAside };
}

/** The option the move prompt starts on: the plan moves with the trip unless its length changed. */
export function defaultMove(oldLength, newLength) {
  return oldLength === newLength ? "shift" : "keep_dates";
}

/**
 * What's outside the trip's days, kept but not shown: plans that don't
 * touch any day from 1 to `dayCount`, and days with places past either
 * end. Nothing is outside a trip with no days to plan.
 */
export function outsideTrip({ plans, dayPlaces }, dayCount) {
  if (!dayCount) return { plans: [], days: [] };
  const end = dayCount * MINUTES_PER_DAY;
  return {
    plans: plans.filter((p) => p.startsAt != null && (p.startsAt >= end || p.endsAt <= 0)),
    days: Object.keys(dayPlaces ?? {})
      .map(Number)
      .filter((day) => day < 1 || day > dayCount),
  };
}
