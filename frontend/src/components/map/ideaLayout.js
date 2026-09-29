// Extensions on the imports so Node can run this for the tests (Vite doesn't need them).
import { canSplit, clusterPoints, coversAny, extentOf, screenDistance } from "../../lib/clusters.js";
import { DOT_SIZE, HIGHLIGHTED_DOT_SIZE, PHOTO_MARKER_SIZE, badgeSize, bubbleSize } from "./markerSizes.js";

const NO_KEYS = new Set();

/**
 * Where the Map tab's markers go at the current zoom (IdeaMarkers.jsx).
 *
 *   pins               ideas with an exact spot: [{ id, lat, lng, photoUrl? }]
 *   regions            region badges: [{ key, name, lat, lng, count }]
 *   highlightedId      the selected idea
 *   selectedRegionKey  the selected region
 *   view               { zoom, toWorld } from useMapZoom, or null before
 *                      the map has drawn (then nothing is grouped)
 *
 * Exact spots too close to tell apart become a bubble. A region badge that
 * would cover a bubble is rolled into it: the bubble counts the region's
 * ideas too, and the badge comes back once zooming in pulls them apart.
 * A badge that would only cover a dot shows just its count instead. The
 * selected idea or region is never put in a bubble, so it can be found at
 * any zoom.
 *
 * Returns
 *   dots         pins drawn on their own
 *   clusters     bubbles: [{ key, lat, lng, bounds, pins, regions, count,
 *                splittable }]. `regions` are the badges rolled in, and
 *                `count` is their ideas plus `pins`.
 *   badges       regions still drawn as their own badge
 *   compactKeys  Set of badge keys that would cover a dot, so show just
 *                their count
 */
export function layoutIdeas({ pins, regions, highlightedId = null, selectedRegionKey = null, view }) {
  if (!view) return { dots: pins, clusters: [], badges: regions, compactKeys: NO_KEYS };
  const { zoom, toWorld } = view;
  const at = (place) => {
    const point = toWorld({ lat: place.lat, lng: place.lng });
    return { x: point.x, y: point.y };
  };

  // Exact spots first.
  const highlighted = pins.find((p) => p.id === highlightedId) ?? null;
  const points = pins.filter((p) => p !== highlighted).map((pin) => ({ ...at(pin), pin }));
  const groups = clusterPoints(points, zoom);
  const dots = groups.filter((g) => g.length === 1).map((g) => g[0].pin);
  if (highlighted) dots.push(highlighted);
  const bubbles = groups
    .filter((g) => g.length > 1)
    .map((g) => {
      const members = g.map((p) => p.pin);
      const center = extentOf(members);
      return { members, points: g, regions: [], ...at(center) };
    });

  // Then each badge: rolled into the nearest bubble it would cover, shrunk
  // to its count if it would cover a dot, or left as it is.
  const badges = [];
  const compactKeys = new Set();
  const dotMarkers = dots.map((pin) => ({ ...at(pin), size: dotSize(pin, pin === highlighted) }));
  regions.forEach((region) => {
    const spot = at(region);
    const size = badgeSize(region.name);
    const covered = region.key === selectedRegionKey ? [] : bubbles.filter((b) => coversAny(spot, size, [{ ...b, size: bubbleSize(b.members.length) }], zoom));
    if (covered.length > 0) {
      const nearest = covered.reduce((best, b) => (screenDistance(spot, b, zoom) < screenDistance(spot, best, zoom) ? b : best));
      nearest.regions.push(region);
      nearest.points.push({ ...spot, region });
      return;
    }
    badges.push(region);
    if (coversAny(spot, size, dotMarkers, zoom)) compactKeys.add(region.key);
  });

  const clusters = bubbles.map((b) => ({
    key: [...b.members.map((p) => p.id), ...b.regions.map((r) => r.key)].join(","),
    ...extentOf([...b.members, ...b.regions]),
    pins: b.members,
    regions: b.regions,
    count: b.members.length + b.regions.reduce((n, r) => n + r.count, 0),
    splittable: canSplit(b.points),
  }));

  return { dots, clusters, badges, compactKeys };
}

function dotSize(pin, highlighted) {
  if (!highlighted) return DOT_SIZE;
  return pin.photoUrl ? PHOTO_MARKER_SIZE : HIGHLIGHTED_DOT_SIZE;
}
