// Laying out the Map tab's markers (components/map/IdeaMarkers.jsx) so they
// stay readable when zoomed out: exact spots that would sit on top of each
// other become one bubble with a count, and a region badge that would cover
// a dot or bubble shrinks to its count. Pure functions, no Google calls, so
// they can be tested in Node (clusters.test.js).
//
// Positions are Google "world coordinates": the map at zoom 0 is a 256x256
// square, and at zoom z every distance is 2^z times larger in screen
// pixels. That's what map.getProjection().fromLatLngToPoint() returns.

export const WORLD_SIZE = 256;

// Closer than this on screen and two markers merge into a bubble. A little
// more than a bubble's own width, so bubbles never touch each other.
export const CLUSTER_RADIUS_PX = 48;

// The most Google will zoom in (satellite goes further, but the app only
// uses the road map). A bubble still whole at this zoom never splits.
export const MAX_ZOOM = 21;

/**
 * Screen distance in pixels between two world points at `zoom`, taking the
 * short way round across the antimeridian (a trip to Fiji or Samoa can
 * have ideas on both sides of it).
 */
export function screenDistance(a, b, zoom) {
  const rawDx = Math.abs(a.x - b.x);
  const dx = Math.min(rawDx, WORLD_SIZE - rawDx);
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) * 2 ** zoom;
}

/**
 * Groups `points` ([{ x, y, ... }] in world coordinates) so no two groups'
 * seeds are closer than `radius` pixels at `zoom`. Greedy and in input
 * order, so the same points at the same zoom always group the same way:
 * each point not yet taken starts a group and takes every later free point
 * within `radius` of it. Tens of ideas per trip make the O(n²) pass free.
 *
 * Returns an array of groups, each an array of the original points. A
 * group of one is a point that stays a plain marker.
 */
export function clusterPoints(points, zoom, radius = CLUSTER_RADIUS_PX) {
  const taken = new Array(points.length).fill(false);
  const groups = [];
  points.forEach((seed, i) => {
    if (taken[i]) return;
    taken[i] = true;
    const group = [seed];
    for (let j = i + 1; j < points.length; j += 1) {
      if (!taken[j] && screenDistance(seed, points[j], zoom) < radius) {
        taken[j] = true;
        group.push(points[j]);
      }
    }
    groups.push(group);
  });
  return groups;
}

/**
 * The lat/lng of a world point: the inverse of Google's projection
 * (Web Mercator), for placing the camera without a live map.
 */
export function fromWorld({ x, y }) {
  const n = Math.PI - (2 * Math.PI * y) / WORLD_SIZE;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / WORLD_SIZE) * 360 - 180 };
}

/**
 * Whether a box `width` x `height` pixels centred on `center` would overlap
 * any of `markers` ([{ x, y, size }], `size` being the marker's diameter in
 * pixels) at `zoom`. All positions in world coordinates.
 */
export function coversAny(center, { width, height }, markers, zoom) {
  const scale = 2 ** zoom;
  return markers.some((m) => {
    const rawDx = Math.abs(center.x - m.x);
    const dx = Math.min(rawDx, WORLD_SIZE - rawDx) * scale;
    const dy = Math.abs(center.y - m.y) * scale;
    return dx < width / 2 + m.size / 2 && dy < height / 2 + m.size / 2;
  });
}

/**
 * The centre and bounds ({ south, west, north, east }) of `places`
 * ([{ lat, lng }]). Places either side of the antimeridian get bounds that
 * cross it (west > east), which is how Google reads such bounds.
 */
export function extentOf(places) {
  const lats = places.map((p) => p.lat);
  const rawLngs = places.map((p) => p.lng);
  const crosses = Math.max(...rawLngs) - Math.min(...rawLngs) > 180;
  const lngs = crosses ? rawLngs.map((lng) => (lng < 0 ? lng + 360 : lng)) : rawLngs;
  const wrap = (lng) => (lng > 180 ? lng - 360 : lng);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: wrap((west + east) / 2),
    bounds: { south: Math.min(...lats), north: Math.max(...lats), west: wrap(west), east: wrap(east) },
  };
}
