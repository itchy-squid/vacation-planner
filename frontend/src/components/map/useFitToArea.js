import { useEffect } from "react";
import { findTripArea } from "../../lib/mapArea";

/**
 * Moves `map` to cover `area` ({ areas, fallback } from
 * lib/mapArea.js areaQueriesForTrip) once it has been geocoded. If none of
 * the names can be found the map simply stays where it is.
 *
 * `padding` keeps the area clear of anything floating over the map (px,
 * { top, right, bottom, left }).
 */
export function useFitToArea(map, area, padding) {
  useEffect(() => {
    if (!map || !area) return undefined;
    let cancelled = false;

    findTripArea(area)
      .then((bounds) => {
        if (!cancelled && bounds) map.fitBounds(bounds, padding);
      })
      // Centring is a nicety: the map is still usable at the world view.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // `padding` is layout, not data: a new object each render shouldn't
    // move a map someone may already have panned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, area]);
}
