import { useCallback, useEffect, useState } from "react";
import { importMapsLibrary, isMapsConfigured, mapId, onMapsAuthFailure } from "../../lib/googleMaps";

// Before anything better is known (see useFitToArea), the whole world.
const WORLD_VIEW = { center: { lat: 20, lng: 0 }, zoom: 2 };

const MAP_OPTIONS = {
  ...WORLD_VIEW,
  mapId,
  // The screen floats its own header over the top of the map, so Google's
  // map-type, Street View and fullscreen buttons would only crowd it. Zoom
  // stays for anyone on a desktop without pinch.
  disableDefaultUI: true,
  zoomControl: true,
  // One finger pans. The map fills the screen, so there's no page behind
  // it to scroll, and "use two fingers to move the map" would be noise.
  gestureHandling: "greedy",
  // Tapping a shop or landmark icon opens Google's own info window, which
  // isn't something this app does anything with yet.
  clickableIcons: false,
};

/**
 * Puts a Google map into `containerRef` and reports how that went.
 *
 *   status: "unconfigured"  this build has no Maps key
 *           "loading"       fetching the Maps API or drawing the first tiles
 *           "ready"         the map has drawn
 *           "error"         the Maps API couldn't be fetched; retry() tries again
 *           "rejected"      Google refused the key (see lib/googleMaps.js)
 */
export function useGoogleMap(containerRef) {
  const [map, setMap] = useState(null);
  const [status, setStatus] = useState(isMapsConfigured ? "loading" : "unconfigured");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isMapsConfigured) return undefined;
    let cancelled = false;
    let tilesListener = null;
    setStatus("loading");

    const unsubscribe = onMapsAuthFailure(() => {
      if (!cancelled) setStatus("rejected");
    });

    importMapsLibrary("maps")
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return;
        const created = new Map(containerRef.current, MAP_OPTIONS);
        // "Ready" once something is actually on screen, not merely once the
        // object exists: a rejected key still constructs a map, it just
        // never draws tiles.
        tilesListener = created.addListener("tilesloaded", () => {
          tilesListener?.remove();
          tilesListener = null;
          if (!cancelled) setStatus((current) => (current === "loading" ? "ready" : current));
        });
        setMap(created);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      tilesListener?.remove();
      unsubscribe();
    };
  }, [containerRef, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { map, status, retry };
}
