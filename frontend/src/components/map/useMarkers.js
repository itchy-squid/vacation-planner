import { useEffect, useRef, useState } from "react";
import { importMapsLibrary } from "../../lib/googleMaps";
import { useMap } from "./mapContext";

/**
 * Draws `items` as markers on the surrounding MapCanvas. Each item needs
 * `key`, `lat` and `lng`; `render(item)` returns the marker's element and
 * `onTap(item)`, if given, makes it tappable.
 *
 * Markers are rebuilt whenever `items` changes: the app draws tens of
 * them at most, so rebuilding is simpler than patching each one. Pass a
 * memoised array so they aren't rebuilt on every render.
 */
export function useMarkers(items, render, onTap) {
  const map = useMap();
  const [library, setLibrary] = useState(null);
  const renderRef = useRef(render);
  const onTapRef = useRef(onTap);

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
    if (!map || !library) return undefined;
    const markers = items.map((item) => {
      const marker = new library.AdvancedMarkerElement({
        map,
        position: { lat: item.lat, lng: item.lng },
        title: item.title ?? "",
        content: renderRef.current(item),
        zIndex: item.zIndex ?? 1,
        gmpClickable: tappable,
      });
      if (tappable) marker.addEventListener("gmp-click", () => onTapRef.current?.(item));
      return marker;
    });
    return () => markers.forEach((marker) => {
      marker.map = null;
    });
  }, [map, library, items, tappable]);
}

/** A marker element styled with inline CSS (the app's tokens work here). */
export function markerElement(text, css) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = css.join(";");
  return el;
}
