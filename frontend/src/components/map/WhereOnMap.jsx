import { useEffect, useMemo, useState } from "react";
import Button from "../core/Button";
import MapCanvas from "./MapCanvas";
import RegionAreas from "./RegionAreas";
import PinDots from "./PinDots";
import { useMap } from "./mapContext";
import { areaQueriesForTrip } from "../../lib/mapArea";

const MAP_HEIGHT = 140;
const MAP_HEIGHT_PINNING = 230;
const FIT_PADDING = { top: 16, right: 16, bottom: 16, left: 16 };
// Close enough to see the street an exact spot is on.
const SPOT_ZOOM = 15;

/**
 * "On the map": where an idea will show on the Map tab, in its region's
 * area or at an exact spot, with an optional "Pin an exact spot" that turns
 * the next tap on the map into the spot. Used when adding by hand
 * (components/newpin/ByHandForm.jsx) and on the idea's own screen
 * (pages/EditVisit.jsx). Only rendered when there's a Maps key.
 *
 *   regionName  the region picked on the form
 *   location, lookingUp  from useRegionPreview
 *   newRegion   the region isn't one the trip uses yet (say it was found)
 *   spot        { lat, lng } or null; onSpot(next) changes it
 *   fromGoogle  the spot came from a place search (it's that place);
 *               removing it then reads "Unlink"
 *   onFindOnGoogle  offers "Find it on Google Maps" while there's no spot
 *               (components/newpin/FindOnGoogle.jsx)
 *   startPinning  open ready for a tap (back from "Tap the map instead")
 *   readOnly    shows where it is without offering changes
 *   children    shown under the caption (offers after linking a place)
 */
export default function WhereOnMap({
  trip,
  regionName,
  location,
  lookingUp,
  newRegion = false,
  spot,
  onSpot,
  fromGoogle = false,
  onFindOnGoogle = null,
  startPinning = false,
  readOnly = false,
  children = null,
}) {
  const [pinning, setPinning] = useState(startPinning && !readOnly);
  const canFind = Boolean(onFindOnGoogle) && !readOnly && !spot && !pinning && !lookingUp;
  const pinLabel = canFind ? "Tap the map instead" : null;
  const { locationsLine, name } = trip;
  // Read once, when the map is made: an idea that already has a spot opens
  // on it, anything else on the trip's area until a region is picked.
  const [start] = useState(() =>
    spot
      ? { options: { center: { lat: spot.lat, lng: spot.lng }, zoom: SPOT_ZOOM }, area: null }
      : { options: {}, area: areaQueriesForTrip({ locationsLine, name }) }
  );
  const options = useMemo(() => ({ ...start.options, gestureHandling: "cooperative", zoomControl: false }), [start]);
  const areas = useMemo(() => (location ? [{ ...location, count: 0 }] : []), [location]);
  const dots = useMemo(() => (spot ? [{ id: "spot", title: "Exact spot", lat: spot.lat, lng: spot.lng }] : []), [spot]);

  let caption;
  let actions = null;
  if (pinning) {
    caption = <><b>Tap where it happens</b>, like a tour’s meeting point.</>;
    actions = (
      <>
        {spot ? <LinkButton onClick={() => onSpot(null)}>Remove the spot</LinkButton> : <span />}
        <Button variant="secondary" size="sm" fullWidth={false} onClick={() => setPinning(false)} style={{ padding: "0 16px" }}>
          Done
        </Button>
      </>
    );
  } else if (spot) {
    caption = fromGoogle ? <><b>At its spot on Google Maps.</b> It shows as its own pin.</> : <><b>Exact spot set.</b> It shows as its own pin.</>;
    if (!readOnly) {
      actions = (
        <>
          <LinkButton onClick={() => setPinning(true)}>Move it</LinkButton>
          <LinkButton onClick={() => onSpot(null)}>{fromGoogle ? "Unlink" : "Remove it"}</LinkButton>
        </>
      );
    }
  } else if (!regionName) {
    caption = readOnly ? "Not on the map: it has no region or spot." : "Pick a region and it will show there on the map.";
  } else if (lookingUp) {
    caption = `Finding ${regionName} on the map…`;
  } else if (!location) {
    caption = `Couldn’t find “${regionName}” on the map. It’s still on the board.`;
    if (!readOnly) {
      actions = (
        <>
          <span />
          <LinkButton onClick={() => setPinning(true)}>{pinLabel ?? "Pin an exact spot instead"}</LinkButton>
        </>
      );
    }
  } else {
    caption = (
      <>
        <b>Shown in {regionName}</b>, without an exact spot.{newRegion ? ` New region: found ${location.label ?? location.name}.` : ""}
      </>
    );
    if (!readOnly) {
      actions = (
        <>
          <span className="mono-caption">{canFind ? "Not on Google Maps?" : "Optional"}</span>
          <LinkButton onClick={() => setPinning(true)}>{pinLabel ?? "Pin an exact spot ›"}</LinkButton>
        </>
      );
    }
  }

  return (
    <div>
      <div className="mono-caption">On the map</div>
      <div style={{ marginTop: 6, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface-card)" }}>
        <MapCanvas
          label="Where it will show"
          area={start.area}
          options={options}
          onClick={pinning ? onSpot : undefined}
          style={{ height: pinning ? MAP_HEIGHT_PINNING : MAP_HEIGHT, transition: "height var(--dur-base, .2s) var(--ease-standard, ease)", cursor: pinning ? "crosshair" : undefined }}
        >
          {spot ? <PinDots pins={dots} highlightedId="spot" /> : <RegionAreas regions={areas} variant="question" />}
          <FitTo region={location} spot={spot} />
        </MapCanvas>
        <div role="status" style={{ padding: "9px 11px", display: "grid", gap: 7, font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
          <span>{caption}</span>
          {canFind ? <FindButton regionName={regionName} onClick={onFindOnGoogle} /> : null}
          {actions ? <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>{actions}</div> : null}
          {children}
        </div>
      </div>
    </div>
  );
}

// Brings the chosen region into view. With a spot, the camera stays where
// it is (on the spot, or where the person put it).
function FitTo({ region, spot }) {
  const map = useMap();
  const key = region ? `${region.south},${region.west},${region.north},${region.east}` : null;
  useEffect(() => {
    if (!map || !region || spot) return;
    map.fitBounds({ south: region.south, west: region.west, north: region.north, east: region.east }, FIT_PADDING);
    // Keyed on the area itself, not the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

// For an idea Google knows but that was added without its place.
function FindButton({ regionName, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "9px 10px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-strong)",
        background: "var(--surface-card)",
        textAlign: "left",
      }}
    >
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, background: "var(--geo-quiet)", color: "var(--geo)", display: "flex", alignItems: "center", justifyContent: "center", font: "700 11px var(--font-sans)", flex: "none" }}>
        G
      </span>
      <span>
        <span style={{ display: "block", font: "600 12.5px var(--font-sans)", color: "var(--text-primary)" }}>Find it on Google Maps</span>
        <span style={{ display: "block", font: "400 11px var(--font-sans)", color: "var(--text-secondary)" }}>
          {regionName ? `Look it up in ${regionName}` : "Look it up by its name"}
        </span>
      </span>
    </button>
  );
}

function LinkButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{ font: "500 12px var(--font-sans)", color: "var(--accent)" }}>
      {children}
    </button>
  );
}
