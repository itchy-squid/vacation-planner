// Where a trip's regions are on the map. A pin without an exact spot is
// shown in its region (pages/TripMap.jsx), so each region name is looked up
// on Google once and then stored for the trip (backend routers/regions.py).
import { importMapsLibrary } from "./googleMaps";

// Kept in its own module so pure helpers (lib/tripPlaces.js) can use it
// without loading Google Maps.
import { regionKey } from "./regionKey";

export { regionKey };

// Per page load, so the same name isn't looked up twice (each lookup is
// billed). Values are promises, so two callers asking at once share one.
const lookups = new Map();

/**
 * Finds a place name on Google: { name, label, lat, lng, south, west,
 * north, east } (label is Google's full name for it, e.g. "Cozumel,
 * Quintana Roo, Mexico"), or null when there's no match or no Maps key.
 */
export function geocodeRegion(name) {
  const key = regionKey(name);
  if (!key) return Promise.resolve(null);
  if (!lookups.has(key)) {
    const lookup = importMapsLibrary("geocoding")
      .then(({ Geocoder }) => new Geocoder().geocode({ address: name.trim() }))
      .then(({ results }) => {
        const best = results[0];
        if (!best?.geometry) return null;
        const center = best.geometry.location;
        const viewport = best.geometry.viewport?.toJSON();
        return {
          name: name.trim(),
          label: best.formatted_address ?? name.trim(),
          lat: center.lat(),
          lng: center.lng(),
          south: viewport?.south ?? center.lat(),
          west: viewport?.west ?? center.lng(),
          north: viewport?.north ?? center.lat(),
          east: viewport?.east ?? center.lng(),
        };
      })
      // No match, or the key can't geocode: the region just isn't on the map.
      .catch(() => null);
    lookups.set(key, lookup);
  }
  return lookups.get(key);
}

// Areas are drawn as a circle around the centre, big enough to take in
// most of the region without swallowing its neighbours.
const MIN_RADIUS_M = 800;
const MAX_RADIUS_M = 40_000;

/** Radius, in metres, of the circle a region is drawn as. */
export function regionRadiusMeters({ south, west, north, east }) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const midLat = rad((south + north) / 2);
  const spanLng = east >= west ? east - west : east + 360 - west;
  const height = (north - south) * 111_320;
  const width = spanLng * 111_320 * Math.cos(midLat);
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.min(height, width) / 2));
}
