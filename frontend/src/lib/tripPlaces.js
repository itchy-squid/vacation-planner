// The places a trip has, for place pickers: every region an idea is in,
// then every place set on a day in "Where we'll be" (lib/dayPlaces.js).
// These are the only things that make a place part of the trip, so a place
// nothing refers to any more drops out on its own — no clean-up needed.
//
// Deliberately not the regions stored for the map (backend TripRegion):
// those are a lookup cache that outlives the pins that made them, and not
// the trip's hand-typed region_line, which the app no longer asks for.
import { regionKey } from "./regionKey.js";

/**
 * pins      { id: { region } }
 * dayPlaces { date: { stay, visits } }
 * -> the distinct names, trimmed, first spelling kept, in that order.
 */
export function tripPlaceNames(pins, dayPlaces) {
  const names = [
    ...Object.values(pins ?? {}).map((pin) => pin.region),
    ...Object.values(dayPlaces ?? {}).flatMap((day) => [day.stay, ...(day.visits ?? [])]),
  ];
  const byKey = new Map();
  names.forEach((name) => {
    const key = regionKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name.trim());
  });
  return [...byKey.values()];
}
