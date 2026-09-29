// "Where we'll be": the places the group is in on each day of the trip
// (backend routers/day_places.py). A day has at most one place it's
// staying in (where the group sleeps) and any number of day trips, in the
// order they're gone to. Places are region names, matched like pins'
// regions whatever the case (lib/regions.js regionKey).
//
// Everything here is pure: the page (pages/DayPlaces.jsx), the day sheet
// (components/places/DayPlacesSheet.jsx) and the Plan tab
// (pages/DaySchedule.jsx) all read and change days through it.
import { parseISODate } from "./format";
import { regionKey } from "./regions";
import { plansOnDay } from "./dayGrid";

export const NO_PLACES = Object.freeze({ stay: null, visits: Object.freeze([]) });

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

/** The day staying in `name` (null clears it). A day trip there is dropped. */
export function withStay(day, name) {
  return { stay: name || null, visits: name ? day.visits.filter((v) => !samePlace(v, name)) : day.visits };
}

/** Adds a day trip to the end, unless it's already there or it's the stay. */
export function withVisit(day, name) {
  if (samePlace(day.stay, name) || includesPlace(day.visits, name)) return day;
  return { stay: day.stay, visits: [...day.visits, name] };
}

export function withoutVisit(day, name) {
  return { stay: day.stay, visits: day.visits.filter((v) => !samePlace(v, name)) };
}

/**
 * Where the group was staying the night before `date`, when that was the
 * day before (a gap in between says nothing about where they came from).
 */
export function stayBefore(dayPlaces, dates, index) {
  return index > 0 ? placesOn(dayPlaces, dates[index - 1]).stay : null;
}

/**
 * How day `index`'s stay joins its neighbours: whether the same stay runs
 * on from the day before and into the day after, and where the group
 * moved from when it doesn't (a moving day).
 */
export function stayRun(dayPlaces, dates, index) {
  const stay = placesOn(dayPlaces, dates[index]).stay;
  const before = stayBefore(dayPlaces, dates, index);
  const after = index < dates.length - 1 ? placesOn(dayPlaces, dates[index + 1]).stay : null;
  return {
    stay,
    fromBefore: Boolean(stay) && samePlace(stay, before),
    intoAfter: Boolean(stay) && samePlace(stay, after),
    movedFrom: stay && before && !samePlace(stay, before) ? before : null,
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
export function describeDay(day, previousStay = null) {
  const parts = [];
  if (day.stay) {
    parts.push(previousStay && !samePlace(previousStay, day.stay) ? `Moving to ${day.stay} from ${previousStay}` : `Staying in ${day.stay}`);
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
      if (pin?.region) out.push({ title: pin.short || pin.title, region: pin.region });
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
