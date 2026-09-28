// Where a trip's map should open. Pins don't have coordinates yet (see
// Pin.lat/lng in backend/app/models.py), so the only clues are the names
// people typed: the regions on the trip's pins, the trip's own location
// line, and the trip's name. Those are geocoded into one area to fit.

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

// Per page load, so moving between tabs doesn't geocode the same names
// again. Values are promises, so two maps asking at once share one call.
const viewportCache = new Map();

function geocodeViewport(geocoder, query) {
  const key = query.toLowerCase();
  if (!viewportCache.has(key)) {
    const lookup = geocoder
      .geocode({ address: query })
      .then(({ results }) => results[0]?.geometry?.viewport?.toJSON() ?? null)
      // Not found, or the key isn't allowed to geocode: either way this
      // name just doesn't contribute to the area.
      .catch(() => null);
    viewportCache.set(key, lookup);
  }
  return viewportCache.get(key);
}

async function unionOf(geocoder, LatLngBounds, queries) {
  const viewports = (await Promise.all(queries.map((q) => geocodeViewport(geocoder, q)))).filter(Boolean);
  if (viewports.length === 0) return null;
  const bounds = new LatLngBounds();
  viewports.forEach((viewport) => bounds.union(viewport));
  return bounds;
}

/**
 * The bounds covering a trip's areas, or null if nothing could be found.
 * `geocoder` is a google.maps.Geocoder and `LatLngBounds` the class from
 * the "maps" library; they're passed in so this file never loads Google.
 */
export async function findTripArea({ geocoder, LatLngBounds }, { areas, fallback }) {
  const fromAreas = areas.length ? await unionOf(geocoder, LatLngBounds, areas) : null;
  if (fromAreas || !fallback) return fromAreas;
  return unionOf(geocoder, LatLngBounds, [fallback]);
}
