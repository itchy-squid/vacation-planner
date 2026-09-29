// Extensions on the imports so Node can run this for the tests (Vite doesn't need them).
import { MAX_ZOOM, clusterPoints, coversAny, extentOf, fromWorld } from "../../lib/clusters.js";
import { DOT_SIZE, HIGHLIGHTED_DOT_SIZE, PHOTO_MARKER_SIZE, badgeSize, bubbleSize } from "./markerSizes.js";

const NO_KEYS = new Set();

/**
 * Where the Map tab's markers go at the current zoom (IdeaMarkers.jsx).
 *
 *   pins           ideas with an exact spot: [{ id, lat, lng, photoUrl? }]
 *   regions        region badges: [{ key, name, lat, lng, count }]
 *   highlightedId  the selected idea. Never put in a bubble, so it can be
 *                  found at any zoom.
 *   view           { zoom, toWorld } from useMapZoom, or null before the
 *                  map has drawn (then nothing is grouped)
 *
 * Returns
 *   dots         pins drawn on their own
 *   clusters     bubbles: [{ key, lat, lng, bounds, pins, count }]. Only
 *                exact spots go in a bubble. A region's ideas always keep
 *                their own badge, even beside a bubble: zooming splits a
 *                bubble, but never pulls ideas with no spot apart.
 *   compactKeys  Set of region keys whose full badge would cover a dot or
 *                bubble, so it shows just its count
 */
export function layoutIdeas({ pins, regions, highlightedId = null, view }) {
  if (!view) return { dots: pins, clusters: [], compactKeys: NO_KEYS };
  const { zoom, toWorld } = view;
  const at = (place) => {
    const point = toWorld({ lat: place.lat, lng: place.lng });
    return { x: point.x, y: point.y };
  };

  const highlighted = pins.find((p) => p.id === highlightedId) ?? null;
  const points = pins.filter((p) => p !== highlighted).map((pin) => ({ ...at(pin), pin }));
  const groups = clusterPoints(points, zoom);

  const dots = groups.filter((g) => g.length === 1).map((g) => g[0].pin);
  if (highlighted) dots.push(highlighted);
  const clusters = groups
    .filter((g) => g.length > 1)
    .map((g) => {
      const members = g.map((p) => p.pin);
      return { key: members.map((p) => p.id).join(","), ...extentOf(members), pins: members, count: members.length };
    });

  const markers = [
    ...dots.map((pin) => ({ ...at(pin), size: dotSize(pin, pin === highlighted) })),
    ...clusters.map((c) => ({ ...at(c), size: bubbleSize(c.count) })),
  ];
  const compactKeys = new Set(regions.filter((r) => coversAny(at(r), badgeSize(r.name), markers, zoom)).map((r) => r.key));

  return { dots, clusters, compactKeys };
}

/**
 * How far to zoom in when `cluster` is tapped: the first whole zoom level
 * above the current one at which it no longer holds together, so it just
 * breaks into smaller bubbles or dots (tap again to go further).
 * Fitting the camera to its ideas instead would zoom until they sat at
 * opposite edges of the screen. `input` is what the cluster was laid out
 * from (see layoutIdeas). Null when it holds together even at MAX_ZOOM,
 * like ideas pinned to one hotel: zooming can't help, so list them.
 */
export function expansionZoom(cluster, input, maxZoom = MAX_ZOOM) {
  const pinIds = cluster.pins.map((p) => p.id);
  const holdsAll = (c) => pinIds.every((id) => c.pins.some((p) => p.id === id));
  for (let zoom = Math.floor(input.view.zoom) + 1; zoom <= maxZoom; zoom += 1) {
    const { clusters } = layoutIdeas({ ...input, view: { ...input.view, zoom } });
    if (!clusters.some(holdsAll)) return zoom;
  }
  return null;
}

/**
 * Where to point the camera to show `cluster` at `zoom`: its centre, in the
 * middle of the part of the map not covered by `padding` ({ top, right,
 * bottom, left } in pixels, like the floating header's clearance).
 */
export function cameraFor(cluster, zoom, padding, toWorld) {
  const scale = 2 ** zoom;
  const point = toWorld({ lat: cluster.lat, lng: cluster.lng });
  const dx = ((padding.right ?? 0) - (padding.left ?? 0)) / 2 / scale;
  const dy = ((padding.bottom ?? 0) - (padding.top ?? 0)) / 2 / scale;
  return { center: fromWorld({ x: point.x + dx, y: point.y + dy }), zoom };
}

function dotSize(pin, highlighted) {
  if (!highlighted) return DOT_SIZE;
  return pin.photoUrl ? PHOTO_MARKER_SIZE : HIGHLIGHTED_DOT_SIZE;
}
