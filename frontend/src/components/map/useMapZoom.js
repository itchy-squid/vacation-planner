import { useEffect, useState } from "react";
import { useMap } from "./mapContext";

/**
 * The surrounding MapCanvas's zoom, and `toWorld({ lat, lng })` for its
 * world coordinates (see lib/clusters.js), once the map has settled after
 * a pan or zoom. Null until the map has drawn.
 *
 * Updated on "idle" rather than on every zoom step, so markers laid out
 * from it are rebuilt once per gesture, not dozens of times during one.
 */
export function useMapZoom() {
  const map = useMap();
  const [view, setView] = useState(null);

  useEffect(() => {
    if (!map) return undefined;
    const update = () => {
      const projection = map.getProjection();
      const zoom = map.getZoom();
      if (!projection || zoom == null) return;
      setView((current) =>
        current?.zoom === zoom && current.projection === projection
          ? current
          : { zoom, projection, toWorld: (place) => projection.fromLatLngToPoint(place) }
      );
    };
    update();
    const listener = map.addListener("idle", update);
    return () => listener.remove();
  }, [map]);

  return view;
}
