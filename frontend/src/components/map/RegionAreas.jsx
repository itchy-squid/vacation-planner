import { useCallback, useEffect, useMemo, useState } from "react";
import { importMapsLibrary } from "../../lib/googleMaps";
import { regionRadiusMeters } from "../../lib/regions";
import { useMap } from "./mapContext";
import { markerElement, useMarkers } from "./useMarkers";

// The app's teal (--teal-600). Literal because Google draws circles itself.
const AREA_COLOR = "#3d8a9c";

/**
 * Regions as soft teal areas on the surrounding MapCanvas, each with a
 * marker at its centre for the ideas shown there without an exact spot.
 *
 *   regions  [{ key, name, lat, lng, south, west, north, east, count }]
 *   variant  "badge": a count and the name ("2 Cozumel"), tappable (Map tab)
 *            "question": a dashed "?" (the by-hand form's preview)
 *   selectedKey, onTap(region)  for badges
 */
export default function RegionAreas({ regions, variant = "badge", selectedKey = null, onTap }) {
  const map = useMap();
  const [Circle, setCircle] = useState(null);

  useEffect(() => {
    if (!map) return undefined;
    let cancelled = false;
    importMapsLibrary("maps")
      .then(({ Circle: CircleClass }) => {
        if (!cancelled) setCircle(() => CircleClass);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [map]);

  useEffect(() => {
    if (!map || !Circle) return undefined;
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
  }, [map, Circle, regions]);

  const items = useMemo(
    () => regions.map((r) => ({ ...r, title: r.name, variant, on: r.key === selectedKey, zIndex: 4 })),
    [regions, variant, selectedKey]
  );
  const tap = useCallback((item) => onTap?.(regions.find((r) => r.key === item.key)), [onTap, regions]);
  useMarkers(items, variant === "badge" ? badgeElement : questionElement, variant === "badge" && onTap ? tap : undefined);
  return null;
}

function badgeElement({ name, count, on }) {
  const el = markerElement("", [
    "display:flex",
    "align-items:center",
    "gap:6px",
    "padding:4px 10px 4px 5px",
    "border-radius:999px",
    `border:1.5px ${on ? "solid" : "dashed"} var(--accent)`,
    `background:${on ? "var(--accent-quiet)" : "#fff"}`,
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
    "background:var(--accent)",
    "color:#fff",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font:700 10px var(--font-sans)",
  ]);
  el.append(bubble, document.createTextNode(name));
  return el;
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
