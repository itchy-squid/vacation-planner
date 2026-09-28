// Where a trip's map should open when it has nothing to show yet (the Map
// tab fits its pins and regions instead once there are some, see
// pages/TripMap.jsx): the regions on the trip's pins, the trip's own
// location line, and the trip's name, geocoded into one area to fit.
import { geocodeRegion } from "./regions";

// Enough to cover a multi-stop trip without one map visit turning into a
// long run of geocoding calls (each one is billed).
export const MAX_AREA_QUERIES = 5;

function locationNames(line) {
  return (line ?? "")
    .split("·")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * The place names to look up for a trip, most specific first.
 *
 *   areas:    the trip's locations (trip.locationsLine: its pin regions,
 *             or its hand-typed location line while it has no pins)
 *   fallback: the trip's name, tried only if none of the areas are found
 *             ("Taiwan, Oct 2026" still finds Taiwan)
 */
export function areaQueriesForTrip(trip) {
  const areas = [...new Set(locationNames(trip?.locationsLine))].slice(0, MAX_AREA_QUERIES);
  const name = trip?.name?.trim() ?? "";
  return { areas, fallback: name && !areas.includes(name) ? name : null };
}

/**
 * The bounds ({ south, west, north, east }) covering a trip's areas, or
 * null if none of the names can be found. Lookups go through
 * lib/regions.js, which caches them for the page load.
 */
export async function findTripArea({ areas, fallback }) {
  const fromAreas = areas.length ? await unionOf(areas) : null;
  if (fromAreas || !fallback) return fromAreas;
  return unionOf([fallback]);
}

async function unionOf(names) {
  const found = (await Promise.all(names.map((name) => geocodeRegion(name)))).filter(Boolean);
  if (found.length === 0) return null;
  return {
    south: Math.min(...found.map((r) => r.south)),
    west: Math.min(...found.map((r) => r.west)),
    north: Math.max(...found.map((r) => r.north)),
    east: Math.max(...found.map((r) => r.east)),
  };
}
