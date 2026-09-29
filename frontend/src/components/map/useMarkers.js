import { useEffect, useRef, useState } from "react";
import { importMapsLibrary } from "../../lib/googleMaps";
import { useMap } from "./mapContext";

/**
 * Draws `items` as markers on the surrounding MapCanvas. Each item needs
 * `key`, `lat` and `lng`; `render(item)` returns the marker's element and
 * `onTap(item)`, if given, makes it tappable. Optional per item: `title`
 * (its accessible name), `zIndex`, and `hidesLabels`, which hides Google's
 * own labels (town and road names) under the marker so it stays readable.
 *
 * Markers are kept by `key` and only touched when their item changes (see
 * syncMarker). Rebuilding them all would be simpler, but every marker that
 * hides labels would then leave the map for a frame: the labels under it
 * flash back in and out each time the Map tab re-lays itself out after a
 * zoom. Pass a memoised array so unchanged items aren't even compared.
 */
export function useMarkers(items, render, onTap) {
  const map = useMap();
  const [library, setLibrary] = useState(null);
  const renderRef = useRef(render);
  const onTapRef = useRef(onTap);
  const markersRef = useRef(new Map()); // key -> { marker, item, signature }

  useEffect(() => {
    renderRef.current = render;
    onTapRef.current = onTap;
  }, [render, onTap]);

  useEffect(() => {
    if (!map) return undefined;
    let cancelled = false;
    importMapsLibrary("marker")
      .then((lib) => {
        if (!cancelled) setLibrary(lib);
      })
      // Without markers the rest of the screen still works.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [map]);

  const tappable = Boolean(onTap);
  useEffect(() => {
    if (!map || !library) return;
    const markers = markersRef.current;
    const keep = new Set();
    items.forEach((item) => {
      keep.add(item.key);
      const current = markers.get(item.key);
      if (current) {
        syncMarker(current, item, { library, render: renderRef.current, tappable });
        return;
      }
      const entry = { marker: new library.AdvancedMarkerElement({ map }), item: null, signature: null };
      // Reads the entry's latest item, so the listener never needs replacing.
      entry.marker.addEventListener("gmp-click", () => onTapRef.current?.(entry.item));
      syncMarker(entry, item, { library, render: renderRef.current, tappable });
      markers.set(item.key, entry);
    });
    markers.forEach((entry, key) => {
      if (keep.has(key)) return;
      entry.marker.map = null;
      markers.delete(key);
    });
  }, [map, library, items, tappable]);

  // Off the map when the screen goes, or the map is replaced.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((entry) => {
        entry.marker.map = null;
      });
      markers.clear();
    };
  }, [map]);
}

/**
 * Brings one marker up to date with `item`, changing only what differs. Its
 * element is redrawn only when the item's own fields change (`signature`),
 * not merely because the items array was rebuilt around it.
 */
function syncMarker(entry, item, { library, render, tappable }) {
  const { marker } = entry;
  entry.item = item;
  const signature = JSON.stringify(item);
  if (signature === entry.signature && marker.gmpClickable === tappable) return;
  entry.signature = signature;
  marker.position = { lat: item.lat, lng: item.lng };
  marker.title = item.title ?? "";
  marker.zIndex = item.zIndex ?? 1;
  marker.gmpClickable = tappable;
  marker.collisionBehavior = item.hidesLabels
    ? library.CollisionBehavior?.REQUIRED_AND_HIDES_OPTIONAL ?? "REQUIRED_AND_HIDES_OPTIONAL"
    : library.CollisionBehavior?.REQUIRED ?? "REQUIRED";
  marker.content = render(item);
}

/** A marker element styled with inline CSS (the app's tokens work here). */
export function markerElement(text, css) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = css.join(";");
  return el;
}
