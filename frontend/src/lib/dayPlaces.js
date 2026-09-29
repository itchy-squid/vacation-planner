// "Where we'll be": the places the group is in on each day of the trip
// (backend routers/day_places.py). A day has at most one place it's
// staying in (where the group sleeps) and any number of day trips, in the
// order they're gone to. Places are region names, matched like pins'
// regions whatever the case (lib/regions.js regionKey). A stay can also
// name the idea the group sleeps at (`lodgingPinId`, the hotel), which is
// where trips planned on the map start and end (lib/tripPlan.js).
//
// Everything here is pure: the page (pages/DayPlaces.jsx), the day sheet
// (components/places/DayPlacesSheet.jsx) and the Plan tab
// (pages/DaySchedule.jsx) all read and change days through it.
import { parseISODate } from "./format.js";
import { regionKey } from "./regionKey.js";
import { plansOnDay } from "./dayGrid.js";

export const NO_PLACES = Object.freeze({ stay: null, lodgingPinId: null, visits: Object.freeze([]) });

/**
 * The ISO date ("YYYY-MM-DD") of each day of the trip, in order. A trip
 * without a start date has no days to say anything about, so [].
 */
export function tripDates(startDate, endDate) {
  const start = parseISODate(startDate);
  if (!start) return [];
  const end = parseISODate(endDate) ?? start;
  const first = Date.UTC(start.year, start.month - 1, start.day);
  const last = Date.UTC(end.year, end.month - 1, end.day);
  const dates = [];
  for (let t = first; t <= last; t += 86400000) dates.push(new Date(t).toISOString().slice(0, 10));
  return dates;
}

/** The places set on `date`, or NO_PLACES. `dayPlaces` is date -> day. */
export function placesOn(dayPlaces, date) {
  return (date && dayPlaces[date]) || NO_PLACES;
}

/** Every place on a day: the stay first, then the day trips in order. */
export function placeNames(day) {
  return day.stay ? [day.stay, ...day.visits] : [...day.visits];
}

export function isSet(day) {
  return Boolean(day.stay) || day.visits.length > 0;
}

export function samePlace(a, b) {
  return a != null && b != null && regionKey(a) === regionKey(b);
}

export function includesPlace(names, name) {
  return names.some((n) => samePlace(n, name));
}

/**
 * The day staying in `name` (null clears it). A day trip there is dropped.
 * The place it's staying at goes with a change of town, and stays when
 * the town is the same.
 */
export function withStay(day, name) {
  return {
    stay: name || null,
    lodgingPinId: name && samePlace(day.stay, name) ? day.lodgingPinId ?? null : null,
    visits: name ? day.visits.filter((v) => !samePlace(v, name)) : day.visits,
  };
}

/** The day staying at idea `pinId` (null clears it). Needs a stay. */
export function withLodging(day, pinId) {
  return { ...day, lodgingPinId: day.stay ? pinId ?? null : null };
}

/** Adds a day trip to the end, unless it's already there or it's the stay. */
export function withVisit(day, name) {
  if (samePlace(day.stay, name) || includesPlace(day.visits, name)) return day;
  return { ...day, visits: [...day.visits, name] };
}

export function withoutVisit(day, name) {
  return { ...day, visits: day.visits.filter((v) => !samePlace(v, name)) };
}

/**
 * Where a trip on day `index` starts and ends: the lodging of the night
 * before (that's where the group wakes up), else that day's, and that
 * day's own lodging (where they sleep). Either is null when not set, and
 * then the trip builder simply doesn't offer a hotel at that end.
 */
export function lodgingFor(dayPlaces, dates, index) {
  const tonight = placesOn(dayPlaces, dates[index]).lodgingPinId ?? null;
  const lastNight = index > 0 ? placesOn(dayPlaces, dates[index - 1]).lodgingPinId ?? null : null;
  return { start: lastNight ?? tonight, end: tonight };
}

/**
 * Where the group was staying the night before `date`, when that was the
 * day before (a gap in between says nothing about where they came from).
 */
export function stayBefore(dayPlaces, dates, index) {
  return index > 0 ? placesOn(dayPlaces, dates[index - 1]).stay : null;
}

/**
 * How day `index`'s stay joins its neighbours: whether a stay starts here
 * (a new place, or the first day with one) and whether it ends here (the
 * next day is somewhere else, unset, or past the trip), and where the
 * group moved from on a moving day.
 */
export function stayRun(dayPlaces, dates, index) {
  const stay = placesOn(dayPlaces, dates[index]).stay;
  const before = stayBefore(dayPlaces, dates, index);
  const after = index < dates.length - 1 ? placesOn(dayPlaces, dates[index + 1]).stay : null;
  return {
    stay,
    startsHere: Boolean(stay) && !samePlace(stay, before),
    endsHere: Boolean(stay) && !samePlace(stay, after),
    movedFrom: stay && before && !samePlace(stay, before) ? before : null,
  };
}

/**
 * Day `index` on the trip's timeline: one line through every day, solid
 * between two days that both have a stay and dashed where either hasn't.
 * A dot marks where a stay starts and where a solid stretch ends (the
 * last day with a stay before an unset day or the end of the trip), so
 * the solid line never stops without one. `top` and `bottom` are the
 * halves of the line above and below the day ("solid" | "dashed" | null
 * at the ends).
 */
export function timelineAt(dayPlaces, dates, index) {
  const hasStay = (i) => i >= 0 && i < dates.length && Boolean(placesOn(dayPlaces, dates[i]).stay);
  const segment = (a, b) => (hasStay(a) && hasStay(b) ? "solid" : "dashed");
  const solidEndsHere = hasStay(index) && !hasStay(index + 1);
  return {
    top: index > 0 ? segment(index - 1, index) : null,
    bottom: index < dates.length - 1 ? segment(index, index + 1) : null,
    dot: stayRun(dayPlaces, dates, index).startsHere || solidEndsHere,
  };
}

/** "Taipei", "Taipei and Jiufen", "Taipei, Jiufen and Keelung". */
export function joinNames(names) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One line for a day that has places: "Staying in Taipei · Day trip to
 * North Coast", or "Moving to Hualien from Taipei" on a moving day. Empty
 * for a day that isn't set.
 */
export function describeDay(day, previousStay = null, lodgingTitle = null) {
  const parts = [];
  if (day.stay) {
    const at = lodgingTitle ? ` at ${lodgingTitle}` : "";
    parts.push(previousStay && !samePlace(previousStay, day.stay) ? `Moving to ${day.stay}${at} from ${previousStay}` : `Staying in ${day.stay}${at}`);
  }
  if (day.visits.length) parts.push(`Day trip to ${joinNames(day.visits)}`);
  return parts.join(" · ");
}

/** "Day 3", or "Days 1–4, 7" for day numbers in any order. */
export function dayRangeLabel(dayNumbers) {
  const sorted = [...dayNumbers].sort((a, b) => a - b);
  const runs = [];
  sorted.forEach((n) => {
    const run = runs[runs.length - 1];
    if (run && n === run[1] + 1) run[1] = n;
    else runs.push([n, n]);
  });
  const text = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
  return `${sorted.length === 1 ? "Day" : "Days"} ${text}`;
}

/**
 * What's on the calendar on day `dayIndex` (1-based) and where: one
 * { title, region } per pin in a non-draft plan touching that day, in
 * calendar order. Travel items have no region, so they're left out.
 */
export function calendarPlacesOnDay(plans, pins, startDate, dayIndex) {
  const entries = plansOnDay(plans.filter((p) => p.status !== "draft"), startDate, dayIndex);
  const out = [];
  entries.forEach(({ plan }) =>
    plan.items.forEach((item) => {
      const pin = item.pinId ? pins[item.pinId] : null;
      if (pin?.region) out.push({ title: pin.title, region: pin.region });
    })
  );
  return out;
}

/** The distinct regions in calendarPlacesOnDay's list, first spelling kept. */
export function distinctRegions(items) {
  const byKey = new Map();
  items.forEach(({ region }) => {
    if (!byKey.has(regionKey(region))) byKey.set(regionKey(region), region);
  });
  return [...byKey.values()];
}
