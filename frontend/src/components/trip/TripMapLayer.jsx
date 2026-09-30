import { useEffect, useMemo, useRef, useState } from "react";
import { importMapsLibrary } from "../../lib/googleMaps";
import { markerElement, useMarkers } from "../map/useMarkers";
import { useMap } from "../map/mapContext";

// Colours by what a stop is (lib/tripPlan.js): proposed, already on the
// calendar, where you're staying. Same meanings as the rest of the app —
// plum is the thing being decided, teal is settled geography, ink is home.
const ROLE_COLOURS = { new: "var(--accent)", anchor: "var(--geo)", lodging: "var(--surface-inverse)" };
const RIDE_COLOUR = "#8f4478"; // --accent; Google's polylines can't read CSS variables
const FIT_PADDING = { top: 80, right: 40, bottom: 40, left: 40 };

/**
 * The trip on the map: every idea with a spot (tap one to add it, or to
 * start there), the trip's stops lettered in order, and each ride drawn
 * along Google's route in its mode's line — solid for driving, dashed for a
 * bus, a railway for the train, dots on foot.
 *
 *   pins      every idea with a spot
 *   stops     buildTrip(...).stops, each with its `letter` (lib/tripPlan.js stopLetter)
 *   rides     [{ key, mode, path, open }] — path from lib/routes.js readRoute
 *   onTapPin  (pin)
 */
export default function TripMapLayer({ pins, stops, rides, onTapPin }) {
  const items = useMemo(() => {
    const byPin = new Map();
    // A place passed twice is one marker, under its first letter (lib/tripPlan.js stopLetter).
    stops.forEach((s) => {
      if (s.pin.located !== false && !byPin.has(s.pin.id)) byPin.set(s.pin.id, { role: s.role, letter: s.letter });
    });
    return pins.map((p) => {
      const stop = byPin.get(p.id);
      return {
        key: p.id,
        lat: p.lat,
        lng: p.lng,
        title: stop ? `${p.title}, stop ${stop.letter}` : `Add ${p.title}`,
        letter: stop?.letter ?? "",
        role: stop?.role ?? null,
        zIndex: stop ? 3 : 1,
        hidesLabels: Boolean(stop),
      };
    });
  }, [pins, stops]);
  const tap = useMemo(() => (item) => onTapPin(pins.find((p) => p.id === item.key)), [onTapPin, pins]);
  useMarkers(items, stopElement, tap);
  useRideLines(rides);
  useFitStops(stops);
  return null;
}

function stopElement({ letter, role }) {
  if (!role) {
    return markerElement("", ["width:13px", "height:13px", "border-radius:50%", "box-sizing:border-box", "background:#fff", "border:2px solid rgba(27,26,31,.35)"]);
  }
  return markerElement(letter, [
    "width:26px",
    "height:26px",
    "border-radius:50%",
    "box-sizing:border-box",
    `background:${ROLE_COLOURS[role]}`,
    "border:2px solid #fff",
    "box-shadow:var(--shadow-pin)",
    "color:#fff",
    "font:700 12px var(--font-sans)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
  ]);
}

// Each ride as one or two polylines. Rebuilt whenever the rides change;
// there are only ever a handful.
function useRideLines(rides) {
  const map = useMap();
  const [maps, setMaps] = useState(null);
  useEffect(() => {
    if (!map) return undefined;
    let cancelled = false;
    importMapsLibrary("maps")
      .then((lib) => !cancelled && setMaps(lib))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [map]);

  const signature = JSON.stringify(rides.map((r) => [r.key, r.mode, r.open, r.path?.length ?? 0]));
  useEffect(() => {
    if (!map || !maps) return undefined;
    const lines = rides.filter((r) => r.path?.length > 1).flatMap((r) => rideLines(maps, r));
    lines.forEach((line) => line.setMap(map));
    return () => lines.forEach((line) => line.setMap(null));
    // `signature` stands in for `rides`, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, maps, signature]);
}

function rideLines(maps, { mode, path, open }) {
  const opacity = open === false ? 0.45 : 1;
  const base = { path, geodesic: false, clickable: false, zIndex: open ? 2 : 1 };
  const repeat = (icon, every) => ({ ...base, strokeOpacity: 0, icons: [{ icon, offset: "0", repeat: every }] });
  const dash = { path: "M 0,-1 0,1", strokeColor: RIDE_COLOUR, strokeOpacity: opacity, scale: 3.5 };
  switch (mode) {
    case "bus":
      return [new maps.Polyline(repeat(dash, "16px"))];
    case "walk":
      return [
        new maps.Polyline(
          repeat({ path: maps.SymbolPath?.CIRCLE ?? 0, fillColor: RIDE_COLOUR, fillOpacity: opacity, strokeOpacity: 0, scale: 3 }, "11px")
        ),
      ];
    case "train":
      return [
        new maps.Polyline({ ...base, strokeColor: RIDE_COLOUR, strokeOpacity: opacity, strokeWeight: 6 }),
        new maps.Polyline(repeat({ path: "M 0,-1 0,1", strokeColor: "#fff", strokeOpacity: opacity, scale: 1.5 }, "12px")),
      ];
    default:
      return [new maps.Polyline({ ...base, strokeColor: RIDE_COLOUR, strokeOpacity: opacity, strokeWeight: 5 })];
  }
}

// Frames the stops whenever a stop is added, removed or swapped — not on
// every re-render, so panning around afterwards is left alone.
function useFitStops(stops) {
  const map = useMap();
  const last = useRef("");
  useEffect(() => {
    const spots = stops.map((s) => s.pin).filter((p) => p.lat != null);
    const signature = spots.map((p) => p.id).join(",");
    if (!map || !spots.length || signature === last.current) return;
    last.current = signature;
    if (spots.length === 1) {
      map.panTo({ lat: spots[0].lat, lng: spots[0].lng });
      return;
    }
    const lats = spots.map((p) => p.lat);
    const lngs = spots.map((p) => p.lng);
    map.fitBounds({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) }, FIT_PADDING);
  }, [map, stops]);
}
