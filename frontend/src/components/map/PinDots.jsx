import { useCallback, useMemo } from "react";
import { markerElement, useMarkers } from "./useMarkers";

/**
 * Ideas with an exact spot, as dots on the surrounding MapCanvas: white
 * like the Compare map's quiet pins, plum for the highlighted one.
 *
 *   pins           [{ id, title, lat, lng }]
 *   highlightedId  drawn larger, in plum (just added, or selected)
 *   onTap(pin)
 */
export default function PinDots({ pins, highlightedId = null, onTap }) {
  const items = useMemo(
    () => pins.map((p) => ({ key: p.id, id: p.id, title: p.title, lat: p.lat, lng: p.lng, on: p.id === highlightedId, zIndex: p.id === highlightedId ? 3 : 2 })),
    [pins, highlightedId]
  );
  const tap = useCallback((item) => onTap?.(pins.find((p) => p.id === item.id)), [onTap, pins]);
  useMarkers(items, dotElement, onTap ? tap : undefined);
  return null;
}

function dotElement({ on }) {
  const size = on ? 20 : 14;
  return markerElement("", [
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:50%",
    "box-sizing:border-box",
    on
      ? "background:var(--accent);border:2.5px solid #fff;box-shadow:var(--shadow-pin)"
      : "background:#fff;border:2px solid rgba(27,26,31,.35);box-shadow:var(--shadow-pin-quiet)",
  ]);
}
