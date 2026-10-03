// The area a place search prefers (lib/places.js searchPlaces), as Places
// API (New) will take it. Kept apart from places.js so it can be tested
// without loading Google's script.

// Places refuses a rectangle wider than 180° of longitude ("Invalid
// rectangle viewport"), which is what a map zoomed out to a continent or
// the world reports as its bounds. Kept just under, centred where it was.
const MAX_LNG_SPAN = 179.9;

/**
 * `bias` (a google.maps.LatLngBounds or { south, west, north, east }) as a
 * { south, west, north, east } Places accepts: at most MAX_LNG_SPAN wide,
 * around the same centre. Null for no bias, or one with no usable numbers.
 */
export function searchBias(bias) {
  if (!bias) return null;
  const box =
    typeof bias.getSouthWest === "function"
      ? { south: bias.getSouthWest().lat(), west: bias.getSouthWest().lng(), north: bias.getNorthEast().lat(), east: bias.getNorthEast().lng() }
      : bias;
  const { south, west, north, east } = box;
  if (![south, west, north, east].every(Number.isFinite) || south > north) return null;
  // Eastward from west to east, so a box across the 180° meridian counts
  // its true width.
  const span = east >= west ? east - west : east + 360 - west;
  if (span <= MAX_LNG_SPAN) return { south, west, north, east };
  const centre = west + span / 2;
  return { south, west: wrap(centre - MAX_LNG_SPAN / 2), north, east: wrap(centre + MAX_LNG_SPAN / 2) };
}

/** A longitude back into -180..180. */
function wrap(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
