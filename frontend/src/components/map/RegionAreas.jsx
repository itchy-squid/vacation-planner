import { useCallback, useEffect, useMemo, useState } from "react";
import { importMapsLibrary } from "../../lib/googleMaps";
import { regionRadiusMeters } from "../../lib/regions";
import { useMap } from "./mapContext";
import { markerElement, useMarkers } from "./useMarkers";

// The app's teal (--teal-600). Literal because Google draws circles itself.
const AREA_COLOR = "#3d8a9c";

/**
 * Regions on the surrounding MapCanvas: a marker at each one's centre for
 * the ideas shown there without an exact spot, over a soft teal area.
 *
 *   regions      [{ key, name, lat, lng, south, west, north, east, count }]
 *   variant      "badge": a teal count and the name ("2 Cozumel"), tappable
 *                (Map tab). Teal and dashed, unlike the plum bubbles of
 *                exact spots, because these ideas never split apart.
 *                "question": a dashed "?" (the by-hand form's preview)
 *   showArea     draw the teal area. The Map tab leaves it off: at most
 *                zooms it collided with dots and bubbles, and the badge
 *                already names the region.
 *   compactKeys  Set of regions whose badge would cover a dot or bubble,
 *                shown as just the count (IdeaMarkers.jsx decides)
 *   selectedKey, onTap(region)  for badges
 */
export default function RegionAreas({ regions, variant = "badge", showArea = true, compactKeys = NO_KEYS, selectedKey = null, onTap }) {
  const map = useMap();
  const [Circle, setCircle] = useState(null);

  useEffect(() => {
    if (!map || !showArea) return undefined;
    let cancelled = false;
    importMapsLibrary("maps")
      .then(({ Circle: CircleClass }) => {
        if (!cancelled) setCircle(() => CircleClass);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [map, showArea]);

  useEffect(() => {
    if (!map || !Circle || !showArea) return undefined;
    const circles = regions.map(
      (r) =>
        new Circle({
          map,
          center: { lat: r.lat, lng: r.lng },
          radius: regionRadiusMeters(r),
          strokeColor: AREA_COLOR,
          strokeOpacity: 0.55,
          strokeWeight: 1.5,
          fillColor: AREA_COLOR,
          fillOpacity: 0.1,
          clickable: false,
        })
    );
    return () => circles.forEach((c) => c.setMap(null));
  }, [map, Circle, regions, showArea]);

  const items = useMemo(
    () =>
      regions.map((r) => ({
        ...r,
        title: r.name,
        variant,
        on: r.key === selectedKey,
        compact: compactKeys.has(r.key),
        hidesLabels: variant === "badge",
        // Above bubbles, so a compact badge next to one stays tappable.
        zIndex: 4,
      })),
    [regions, variant, selectedKey, compactKeys]
  );
  const tap = useCallback((item) => onTap?.(regions.find((r) => r.key === item.key)), [onTap, regions]);
  useMarkers(items, variant === "badge" ? badgeElement : questionElement, variant === "badge" && onTap ? tap : undefined);
  return null;
}

const NO_KEYS = new Set();

function badgeElement({ name, count, on, compact }) {
  if (compact) return compactElement({ count, on });
  const el = markerElement("", [
    "display:flex",
    "align-items:center",
    "gap:6px",
    "padding:4px 10px 4px 5px",
    "border-radius:999px",
    `border:1.5px ${on ? "solid" : "dashed"} var(--geo)`,
    `background:${on ? "var(--geo-quiet)" : "#fff"}`,
    "box-shadow:var(--shadow-pin-quiet)",
    "font:600 11px var(--font-sans)",
    "color:var(--text-primary)",
    "white-space:nowrap",
  ]);
  const bubble = markerElement(String(count), [
    "min-width:18px",
    "height:18px",
    "padding:0 4px",
    "box-sizing:border-box",
    "border-radius:999px",
    "background:var(--geo)",
    "color:#fff",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:700 10px var(--font-sans)",
  ]);
  el.append(bubble, document.createTextNode(name));
  return el;
}

// Just the count, in a small dashed teal square: the same look as the
// full badge, without the name that would cover its neighbours.
function compactElement({ count, on }) {
  return markerElement(String(count), [
    "min-width:22px",
    "height:22px",
    "padding:0 5px",
    "box-sizing:border-box",
    "border-radius:6px",
    `border:1.5px ${on ? "solid" : "dashed"} var(--geo)`,
    `background:${on ? "var(--geo-quiet)" : "#fff"}`,
    "box-shadow:var(--shadow-pin-quiet)",
    "color:var(--geo)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:700 11px var(--font-sans)",
  ]);
}

function questionElement() {
  return markerElement("?", [
    "width:26px",
    "height:26px",
    "border-radius:50%",
    "box-sizing:border-box",
    "border:2px dashed var(--accent)",
    "background:rgba(255,255,255,.95)",
    "color:var(--accent)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:700 12px var(--font-sans)",
  ]);
}
