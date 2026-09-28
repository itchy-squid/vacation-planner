import { useEffect, useRef, useState } from "react";
import { importMapsLibrary } from "../../lib/googleMaps";
import { useMap } from "./mapContext";

// Close enough to see the street a single result is on.
const SINGLE_RESULT_ZOOM = 15;

/**
 * Search results as lettered markers on the surrounding MapCanvas,
 * matching the letters in the results list. A place that's already an
 * idea shows a teal check. Tapping a marker selects it.
 *
 *   results   [{ placeId, name, lat, lng, letter, existing }]
 *   selectedId  the highlighted one
 *   fitPadding  room to keep clear when the map fits the results
 */
export default function ResultMarkers({ results, selectedId, onSelect, fitPadding }) {
  const map = useMap();
  const [library, setLibrary] = useState(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!map) return undefined;
    let cancelled = false;
    importMapsLibrary("marker")
      .then((lib) => {
        if (!cancelled) setLibrary(lib);
      })
      // Without markers the list still works on its own.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [map]);

  // Redrawn whenever the results or the selection change: five markers at
  // most, so rebuilding is simpler than patching each one.
  useEffect(() => {
    if (!map || !library) return undefined;
    const markers = results.map((result) => {
      const selected = result.placeId === selectedId;
      const marker = new library.AdvancedMarkerElement({
        map,
        position: { lat: result.lat, lng: result.lng },
        title: result.name,
        content: markerElement(result, selected),
        zIndex: selected ? 2 : 1,
        gmpClickable: true,
      });
      marker.addEventListener("gmp-click", () => onSelectRef.current(result.placeId));
      return marker;
    });
    return () => markers.forEach((marker) => {
      marker.map = null;
    });
  }, [map, library, results, selectedId]);

  // New results: show them all.
  useEffect(() => {
    if (!map || results.length === 0) return;
    if (results.length === 1) {
      map.setCenter({ lat: results[0].lat, lng: results[0].lng });
      map.setZoom(SINGLE_RESULT_ZOOM);
      return;
    }
    const lats = results.map((r) => r.lat);
    const lngs = results.map((r) => r.lng);
    map.fitBounds({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) }, fitPadding);
    // fitPadding is layout, not data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, results]);

  // A selection from the list: bring it into view.
  useEffect(() => {
    const selected = results.find((r) => r.placeId === selectedId);
    if (map && selected) map.panTo({ lat: selected.lat, lng: selected.lng });
  }, [map, results, selectedId]);

  return null;
}

// Drawn as a plain element so it can use the app's tokens: plum for a new
// place, teal (the geography colour) for one that's already an idea.
function markerElement({ letter, existing }, selected) {
  const color = existing ? "var(--geo)" : "var(--accent)";
  const size = selected ? 30 : 22;
  const el = document.createElement("div");
  el.textContent = existing ? "✓" : letter;
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:50%",
    "box-sizing:border-box",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `font:700 ${selected ? 12 : 10}px var(--font-sans)`,
    selected
      ? `background:${color};color:#fff;border:2.5px solid #fff;box-shadow:var(--shadow-pin)`
      : `background:#fff;color:${color};border:2px solid ${color};box-shadow:var(--shadow-pin-quiet)`,
  ].join(";");
  return el;
}
