// Searching Google for places to add as pins (pages/NewPin.jsx). Runs in
// the browser through the Maps JS "places" library, on the same key as the
// map, so the key needs Places API (New) enabled (README "Google Maps").
import { importMapsLibrary } from "./googleMaps";

export const MAX_RESULTS = 5;

// Text Search returns each place's location with it, which is what puts
// the results on the map. Only fields in its cheaper tiers are requested:
// no rating, hours or photos.
const FIELDS = ["id", "displayName", "formattedAddress", "location", "addressComponents"];

/**
 * Up to MAX_RESULTS places for `query`, preferring ones inside `bias` (a
 * google.maps.LatLngBounds, normally the visible map).
 *
 * Each result: { placeId, name, address, lat, lng, components } where
 * components are { long, short, types } (Google's address parts).
 */
export async function searchPlaces(query, { bias } = {}) {
  const { Place } = await importMapsLibrary("places");
  const request = { textQuery: query, fields: FIELDS, maxResultCount: MAX_RESULTS };
  if (bias) request.locationBias = bias;
  const { places } = await Place.searchByText(request);
  return places.filter((place) => place.location).map(toResult);
}

function toResult(place) {
  return {
    placeId: place.id,
    name: place.displayName ?? "",
    address: place.formattedAddress ?? "",
    lat: place.location.lat(),
    lng: place.location.lng(),
    components: (place.addressComponents ?? []).map((c) => ({ long: c.longText ?? "", short: c.shortText ?? "", types: c.types ?? [] })),
  };
}

// ---- Pure helpers (no Google calls) ----

const TOWN_TYPES = ["locality", "postal_town", "sublocality", "administrative_area_level_3"];
const AREA_TYPES = ["administrative_area_level_2", "administrative_area_level_1"];

function firstOfType(components, types) {
  for (const type of types) {
    const found = components.find((c) => c.types.includes(type));
    if (found) return found;
  }
  return null;
}

/** "Liuqiu Township, Pingtung County": the town and the wider area. */
export function areaLine(result) {
  const town = firstOfType(result.components, TOWN_TYPES)?.long;
  const area = firstOfType(result.components, AREA_TYPES)?.long;
  const parts = [...new Set([town, area].filter(Boolean))];
  return parts.length ? parts.join(", ") : result.address;
}

// "Liuqiu Township" -> "Liuqiu": the name people use, without the
// administrative word Google adds.
const ADMIN_WORDS = /\s+(township|district|city|county|village|town|municipality|prefecture|province)$/i;
const MIN_NAME_LENGTH = 4;

function townName(result) {
  return (firstOfType(result.components, TOWN_TYPES)?.long ?? "").replace(ADMIN_WORDS, "").trim();
}

/**
 * The trip region a place belongs to: one the trip already uses when the
 * address names it, or when it and the place's town are spellings of the
 * same name ("Xiaoliuqiu" and Liuqiu Township), otherwise the town as a new
 * region. Case-insensitive. { name, existing }; name is "" when there's
 * nothing to go on.
 */
export function regionFor(result, knownRegions) {
  const haystack = [result.address, ...result.components.flatMap((c) => [c.long, c.short])].join(" | ").toLowerCase();
  const town = townName(result);
  const townLower = town.toLowerCase();
  const known = knownRegions.find((region) => {
    const r = region?.toLowerCase() ?? "";
    if (r.length < MIN_NAME_LENGTH) return false;
    return haystack.includes(r) || (townLower.length >= MIN_NAME_LENGTH && (r.includes(townLower) || townLower.includes(r)));
  });
  if (known) return { name: known, existing: true };
  return { name: town, existing: false };
}

/** Straight-line distance in km between two { lat, lng }. */
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "350 m", "1.2 km", "14 km" */
export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Google Maps' own page for the place (a documented Maps URL). */
export function googleMapsPlaceUrl({ name, placeId }) {
  const params = new window.URLSearchParams({ api: "1", query: name, query_place_id: placeId });
  return `https://www.google.com/maps/search/?${params}`;
}
