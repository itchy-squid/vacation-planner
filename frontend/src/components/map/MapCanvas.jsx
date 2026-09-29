import { useEffect, useRef } from "react";
import Button from "../core/Button";
import { useGoogleMap } from "./useGoogleMap";
import { useFitToArea } from "./useFitToArea";
import { MapContext } from "./mapContext";

// A real Google map (see components/map/useGoogleMap.js), opened on `area`
// when one is given. It replaces components/planner/MapPlaceholder.jsx
// screen by screen: so far the Map tab (pages/TripMap.jsx) and place
// search on the new-pin screen (components/newpin/PlaceSearchStep.jsx).
//
// `options` are starting map options (read once). `onClick` gets { lat, lng }
// where the map was tapped. `children` are drawn on the map (markers,
// region areas) and find it through MapContext.
//
// The striped map pattern sits behind the map, so the space reads as "a
// map goes here" while it loads and behind the notices below when it
// can't. `data-map-state` mirrors the hook's status for tests.
export default function MapCanvas({ area, fitPadding, options, onClick, label = "Map", style, children }) {
  const containerRef = useRef(null);
  const { map, status, retry } = useGoogleMap(containerRef, options);
  useFitToArea(map, area, fitPadding);

  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);
  const listensForClicks = Boolean(onClick);
  useEffect(() => {
    if (!map || !listensForClicks) return undefined;
    const listener = map.addListener("click", (event) => {
      // A tap on a marker is the marker's, not the map's (it would otherwise
      // clear the selection it just made, or pin a spot under a badge).
      if (event.domEvent?.target?.closest?.("gmp-advanced-marker")) return;
      if (event.latLng) onClickRef.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
    return () => listener.remove();
  }, [map, listensForClicks]);

  return (
    <div
      role="region"
      aria-label={label}
      aria-busy={status === "loading"}
      data-map-state={status}
      style={{ position: "relative", overflow: "hidden", background: "var(--pattern-map)", ...style }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {status === "loading" ? (
        <span className="mono-data-sm" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", color: "var(--text-muted)" }}>
          Loading map…
        </span>
      ) : null}
      <MapNotice status={status} onRetry={retry} />
      <MapContext.Provider value={map}>{children}</MapContext.Provider>
    </div>
  );
}

const NOTICES = {
  unconfigured: {
    title: "The map isn't switched on yet",
    body: "This copy of the app doesn't have a Google Maps key. Everything else works as usual.",
  },
  error: {
    title: "Couldn't load the map",
    body: "Check your connection, then try again.",
    retry: true,
  },
  rejected: {
    title: "Google turned the map down",
    body: "This site's Maps key was refused, so there's no map to show. Whoever runs the app needs to check the key's settings.",
  },
};

function MapNotice({ status, onRetry }) {
  const notice = NOTICES[status];
  if (!notice) return null;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 var(--gutter-screen)", zIndex: 1 }}>
      <div
        role="status"
        style={{
          maxWidth: 300,
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-card)",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div className="serif-place" style={{ fontSize: 19, lineHeight: 1.2, color: "var(--text-primary)" }}>
          {notice.title}
        </div>
        <div style={{ font: "400 13px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{notice.body}</div>
        {notice.retry ? (
          <Button variant="secondary" onClick={onRetry} style={{ marginTop: 6 }}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
