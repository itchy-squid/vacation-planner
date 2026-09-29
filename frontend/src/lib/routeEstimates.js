// How long a ride takes, from Google's Routes service through the Maps JS
// "routes" library — the same browser key as the map, so the key needs the
// Routes API enabled (README "Google Maps"). What to ask and how to read
// the answer are lib/routes.js; this is only the asking, and remembering.
import { importMapsLibrary } from "./googleMaps.js";
import { WALK_LIMIT_METERS, formatDistance, readRoute, routeRequest, straightLineMeters } from "./routes.js";

const cache = new Map();

/**
 * readRoute's answer for one ride, asked of Google once per page for each
 * pair of places, mode and departure. A failed request isn't remembered,
 * so trying again asks again. Rejects when Google can't be reached or
 * refuses.
 */
export function estimateLeg(from, to, mode, { departure } = {}) {
  const crowFlies = straightLineMeters(from, to);
  if (mode === "walk" && crowFlies > WALK_LIMIT_METERS) {
    return Promise.resolve({ available: false, reason: `Too far to walk (${formatDistance(crowFlies)})` });
  }
  const when = departure && mode !== "car" && mode !== "walk" ? departure.toISOString() : "";
  const key = [from.lat, from.lng, to.lat, to.lng, mode, when].join("|");
  if (!cache.has(key)) {
    const pending = importMapsLibrary("routes")
      .then(({ Route }) => Route.computeRoutes(routeRequest(from, to, mode, departure)))
      .then(({ routes }) => readRoute(routes?.[0], mode));
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return cache.get(key);
}
