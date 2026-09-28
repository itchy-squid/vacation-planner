import { useMemo } from "react";
import MapCanvas from "../components/map/MapCanvas";
import TripHeader from "../components/core/TripHeader";
import { usePlannerState } from "../state/PlannerContext";
import { areaQueriesForTrip } from "../lib/mapArea";

// Clearance for the floating header (16px inset + its 44px row + a margin),
// so an area fitted to the screen doesn't start underneath it.
const FIT_PADDING = { top: 76, right: 24, bottom: 24, left: 24 };

// The Map tab: the trip's area on a real map. Pins aren't drawn yet — none
// has coordinates until place search and backfill land (see the project's
// trip-map-and-place-search mockups) — so for now the screen's job is to
// open on the right part of the world, worked out from the names on the
// trip (lib/mapArea.js).
//
// The map runs full-bleed under a floating header, like the Compare map,
// but stops at the tab bar rather than running beneath it: Google's logo
// and attribution sit in the map's bottom corners and must stay visible.
export default function TripMap() {
  const { trip } = usePlannerState();
  const { locationsLine, name } = trip;
  const area = useMemo(() => areaQueriesForTrip({ locationsLine, name }), [locationsLine, name]);

  return (
    <div className="screen" style={{ position: "relative" }}>
      <MapCanvas
        label="Trip map"
        area={area}
        fitPadding={FIT_PADDING}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: "var(--bottom-nav-height)" }}
      />
      <div style={{ position: "absolute", top: 16, left: 16, right: 16, zIndex: 5 }}>
        <TripHeader floating />
      </div>
    </div>
  );
}
