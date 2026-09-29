import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { useLocation, useNavigate } from "react-router-dom";
import MapCanvas from "../components/map/MapCanvas";
import IdeaMarkers from "../components/map/IdeaMarkers";
import { useMap } from "../components/map/mapContext";
import { useRegionLocations } from "../components/map/useRegionLocations";
import { useKnownRegions } from "../components/map/useKnownRegions";
import FindOnGoogle from "../components/newpin/FindOnGoogle";
import TripHeader from "../components/core/TripHeader";
import Button from "../components/core/Button";
import { usePlannerState, usePlannerDispatch, useIdeaAccess, useCan } from "../state/PlannerContext";
import { areaQueriesForTrip } from "../lib/mapArea";
import { regionKey } from "../lib/regions";
import { otherTripRegion } from "../lib/places";

// Clearance for the floating header (16px inset + its 44px row + a margin),
// so an area fitted to the screen doesn't start underneath it.
const FIT_PADDING = { top: 76, right: 28, bottom: 28, left: 28 };

// The Map tab: every idea that can be placed. An idea with an exact spot
// (found by search, or pinned) is a dot, and dots too close together to
// tell apart at this zoom become a numbered bubble that zooms in when
// tapped (components/map/IdeaMarkers.jsx). One without is counted in a
// teal badge at its region's centre ("2 Cozumel"), because scattering those
// around the region would suggest a precision nobody has. The badge stays
// separate from any bubble beside it. Tapping a dot
// shows the idea with its photo; ✕, a tap on empty map or Esc clears it.
// Tapping a badge lists the region's ideas,
// each with "Find on Google" (for an idea Google knows, added without its
// place: components/newpin/FindOnGoogle.jsx, saved straight away) and
// "Pin a spot", which turns the next tap on the map into that
// idea's exact spot.
//
// Regions the trip hasn't stored a location for are looked up here and
// stored (useRegionLocations), so ideas added before place search existed
// show up in their regions without anyone doing anything.
//
// The map runs full-bleed under a floating header, and stops at the sheet
// below it rather than running underneath: Google's logo and attribution
// sit in the map's bottom corners and must stay visible.
export default function TripMap() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const ideaAccess = useIdeaAccess();
  const can = useCan();
  // Trips between places end up on the calendar or in a vote.
  const canPlanTrips = can("plans:propose");
  const { trip, pins, regions } = usePlannerState();
  const pinList = useMemo(() => Object.values(pins), [pins]);

  const regionNames = useMemo(() => pinList.filter((p) => p.lat == null).map((p) => p.region), [pinList]);
  const locations = useRegionLocations(regionNames, { save: true });

  const exact = useMemo(() => pinList.filter((p) => p.lat != null), [pinList]);
  const byRegion = useMemo(() => {
    const groups = {};
    pinList.forEach((p) => {
      if (p.lat != null) return;
      const location = locations[regionKey(p.region)];
      if (!location) return;
      (groups[location.key] ??= { ...location, pins: [] }).pins.push(p);
    });
    return groups;
  }, [pinList, locations]);
  const areas = useMemo(() => Object.values(byRegion).map((g) => ({ ...g, count: g.pins.length })), [byRegion]);
  const unplaced = pinList.length - exact.length - areas.reduce((n, a) => n + a.count, 0);

  // What the sheet shows: a summary, one region's ideas, the ideas sharing
  // one spot (a bubble zooming can't split), or one idea.
  const [selected, setSelected] = useState(null); // { kind: "region", key } | { kind: "pin", id } | { kind: "stack", ids }
  const [placing, setPlacing] = useState(null); // the pin whose spot the next tap sets
  // A line for the sheet. Can arrive from the "On Google Maps?" review
  // (pages/LinkReview.jsx) in navigation state, which is then cleared so a
  // reload doesn't repeat it.
  const location = useLocation();
  const [notice, setNotice] = useState(() => location.state?.notice ?? "");
  useEffect(() => {
    if (location.state?.notice) navigate(location.pathname, { replace: true, state: null });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [finding, setFinding] = useState(null); // the pin being looked up on Google Maps
  const [moveOffer, setMoveOffer] = useState(null); // { pinId, region }: a linked place is in another region
  const knownRegions = useKnownRegions();
  // Ideas the review can look up: no spot, a placed region, and editable.
  const reviewable = pinList.filter((p) => p.lat == null && regions[regionKey(p.region)] && ideaAccess.canEditIdea(p)).length;

  // A trip with nothing placeable yet opens on its area, found by name.
  const { locationsLine, name } = trip;
  const hasContent = pinList.some((p) => p.lat != null || p.region);
  const area = useMemo(() => (hasContent ? null : areaQueriesForTrip({ locationsLine, name })), [hasContent, locationsLine, name]);

  async function placeSpot(latLng) {
    const pin = placing;
    setPlacing(null);
    const result = await dispatch({ type: "PATCH_PIN", id: pin.id, fields: { location: { ...latLng, placeId: null } } });
    setNotice(result?.ok ? `${pin.title} is pinned.` : `Couldn’t pin ${pin.title}. Try again.`);
    if (result?.ok) setSelected({ kind: "pin", id: pin.id });
  }

  async function linkPlace(place) {
    const pin = finding;
    setFinding(null);
    const result = await dispatch({ type: "PATCH_PIN", id: pin.id, fields: { location: { lat: place.lat, lng: place.lng, placeId: place.placeId } } });
    if (!result?.ok) {
      setNotice(`Couldn’t link ${pin.title}. Try again.`);
      return;
    }
    setNotice(`Linked to ${place.name} on Google Maps.`);
    setSelected({ kind: "pin", id: pin.id });
    const elsewhere = otherTripRegion(place, pin.region, knownRegions);
    setMoveOffer(elsewhere ? { pinId: pin.id, region: elsewhere } : null);
  }

  async function moveRegion() {
    const { pinId, region } = moveOffer;
    setMoveOffer(null);
    const result = await dispatch({ type: "PATCH_PIN", id: pinId, fields: { region } });
    setNotice(result?.ok ? `Moved to ${region}.` : `Couldn’t move it to ${region}. Try again.`);
  }

  const clearSelection = useCallback(() => {
    setNotice("");
    setMoveOffer(null);
    setSelected(null);
  }, []);
  const hasSelection = selected != null;
  useEffect(() => {
    if (!hasSelection || placing) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") clearSelection();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasSelection, placing, clearSelection]);

  const tapRegion = useCallback((region) => {
    setNotice("");
    setSelected((current) => (current?.kind === "region" && current.key === region.key ? null : { kind: "region", key: region.key }));
  }, []);
  const tapPin = useCallback((pin) => {
    setNotice("");
    setSelected({ kind: "pin", id: pin.id });
  }, []);
  const tapStack = useCallback((cluster) => {
    setNotice("");
    setSelected({ kind: "stack", ids: cluster.pins.map((p) => p.id) });
  }, []);

  const openIdea = (pin) => navigate(`/trips/${trip.id}/edit/${pin.id}?from=board`);
  const selectedRegion = selected?.kind === "region" ? byRegion[selected.key] : null;
  const selectedPin = selected?.kind === "pin" ? pins[selected.id] : null;
  // A bubble's ideas that share one spot, which zooming can't pull apart.
  const stackedPins = selected?.kind === "stack" ? selected.ids.map((id) => pins[id]).filter(Boolean) : null;

  if (finding) {
    return (
      <FindOnGoogle
        pin={finding}
        onLink={linkPlace}
        onTapInstead={() => {
          setPlacing(finding);
          setFinding(null);
        }}
        onBack={() => setFinding(null)}
      />
    );
  }

  return (
    <div className="screen">
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <MapCanvas
        label="Trip map"
        area={area}
        fitPadding={FIT_PADDING}
        onClick={placing ? placeSpot : hasSelection ? clearSelection : undefined}
        style={{ position: "absolute", inset: 0, cursor: placing ? "crosshair" : undefined }}
      >
        <IdeaMarkers
          pins={exact}
          regions={areas}
          highlightedId={selectedPin?.lat != null ? selectedPin.id : null}
          selectedRegionKey={selectedRegion?.key ?? null}
          onTapPin={tapPin}
          onTapRegion={tapRegion}
          onTapStack={tapStack}
          fitPadding={FIT_PADDING}
        />
        <FitToContent exact={exact} areas={areas} />
      </MapCanvas>

      <div style={{ position: "absolute", top: 16, left: 16, right: 16, zIndex: 5, display: "flex", flexDirection: "column", gap: 8 }}>
        <TripHeader floating />
        {placing ? (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", font: "500 12.5px/1.4 var(--font-sans)" }}>
            <span style={{ flex: 1 }}>
              Tap the map where <b>{placing.title}</b> is.
            </span>
            <button type="button" onClick={() => setPlacing(null)} style={{ color: "#fff", font: "600 12.5px var(--font-sans)" }}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      </div>

      {placing ? null : (
        <Sheet>
          {selectedRegion ? (
            <>
              <SheetHeader onClear={clearSelection}>In {selectedRegion.name}, no exact spot</SheetHeader>
              <ul aria-label={`Ideas in ${selectedRegion.name}`} style={{ listStyle: "none", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", maxHeight: 190, overflowY: "auto" }}>
                {selectedRegion.pins.map((pin, i) => (
                  <li key={pin.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i ? "1px solid var(--hairline)" : "none" }}>
                    <button type="button" onClick={() => openIdea(pin)} style={{ flex: 1, minWidth: 0, textAlign: "left", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
                      {pin.title}
                    </button>
                    {ideaAccess.canEditIdea(pin) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setNotice("");
                            setMoveOffer(null);
                            setFinding(pin);
                          }}
                          style={{ flex: "none", font: "500 12px var(--font-sans)", color: "var(--accent)" }}
                        >
                          Find on Google
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNotice("");
                            setPlacing(pin);
                          }}
                          style={{ flex: "none", font: "500 12px var(--font-sans)", color: "var(--accent)" }}
                        >
                          Pin a spot
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : stackedPins ? (
            <>
              <SheetHeader onClear={clearSelection}>{stackedPins.length} ideas at this spot</SheetHeader>
              <ul aria-label="Ideas at this spot" style={{ listStyle: "none", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", maxHeight: 190, overflowY: "auto" }}>
                {stackedPins.map((pin, i) => (
                  <li key={pin.id} style={{ borderTop: i ? "1px solid var(--hairline)" : "none" }}>
                    <button type="button" onClick={() => tapPin(pin)} style={{ width: "100%", padding: "9px 12px", textAlign: "left", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
                      {pin.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : selectedPin ? (
            <>
              <SheetHeader onClear={clearSelection}>{selectedPin.title}</SheetHeader>
              <SheetPhoto key={selectedPin.id} src={selectedPin.photoUrl} alt={selectedPin.title} />
              <SheetText>
                {notice || (selectedPin.region ? `${selectedPin.region} · exact spot` : "Exact spot")}
              </SheetText>
              {moveOffer?.pinId === selectedPin.id ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: "var(--radius-md)", border: "1px dashed var(--border-strong)", font: "400 12px/1.4 var(--font-sans)", color: "var(--text-secondary)" }}>
                  <span style={{ flex: 1 }}>
                    It’s in {moveOffer.region}, not {selectedPin.region}.
                  </span>
                  <button type="button" onClick={moveRegion} style={{ flex: "none", font: "600 12px var(--font-sans)", color: "var(--accent)" }}>
                    Move it there
                  </button>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                {canPlanTrips && selectedPin.lat != null ? (
                  <Button size="sm" onClick={() => navigate(`/trips/${trip.id}/map/trip?to=${selectedPin.id}`)}>
                    Directions
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => openIdea(selectedPin)}>
                  Open idea
                </Button>
              </div>
            </>
          ) : (
            <>
              <SheetTitle>
                {pinList.length ? `${pinList.length - unplaced} of ${pinList.length} ideas on the map` : "No ideas yet"}
              </SheetTitle>
              <SheetText>
                {notice ||
                  (pinList.length
                    ? summary(exact.length, areas.length ? pinList.length - unplaced - exact.length : 0, unplaced)
                    : "Ideas you add show up here, at their spot or in their region.")}
              </SheetText>
              {canPlanTrips && exact.length > 1 ? (
                <Button size="sm" onClick={() => navigate(`/trips/${trip.id}/map/trip`)}>
                  Plan a trip
                </Button>
              ) : null}
              {reviewable ? (
                <Button variant="secondary" size="sm" onClick={() => navigate(`/trips/${trip.id}/map/review`)}>
                  {reviewable === 1 ? "1 idea might be on Google Maps · Review" : `${reviewable} ideas might be on Google Maps · Review`}
                </Button>
              ) : null}
            </>
          )}
        </Sheet>
      )}
      {/* Room for the tab bar, which is fixed over the bottom of the screen. */}
      <div style={{ height: "var(--bottom-nav-height)", flex: "none" }} />
    </div>
  );
}

function summary(exactCount, regionCount, unplacedCount) {
  const parts = [`${exactCount} at an exact spot`, `${regionCount} shown by region`];
  if (unplacedCount) parts.push(`${unplacedCount} with no region`);
  return `${parts.join(" · ")}. Tap a region to see its ideas.`;
}

// Shows everything placeable, once: after that the camera is the person's.
function FitToContent({ exact, areas }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!map || fitted.current || (exact.length === 0 && areas.length === 0)) return;
    fitted.current = true;
    const lats = [...exact.map((p) => p.lat), ...areas.flatMap((a) => [a.south, a.north])];
    const lngs = [...exact.map((p) => p.lng), ...areas.flatMap((a) => [a.west, a.east])];
    map.fitBounds({ south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) }, FIT_PADDING);
  }, [map, exact, areas]);
  return null;
}

// Below the map, above the tab bar.
function Sheet({ children }) {
  return (
    <div
      style={{
        flex: "none",
        position: "relative",
        zIndex: 5,
        background: "var(--surface-card)",
        borderTop: "1px solid var(--hairline)",
        padding: "12px 16px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

// The selection's title, with ✕ to go back to the trip's summary. Always
// the same corner, whatever is selected.
function SheetHeader({ onClear, children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SheetTitle>{children}</SheetTitle>
      </div>
      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        style={{
          flex: "none",
          width: 30,
          height: 30,
          margin: "-4px -4px 0 0",
          borderRadius: "50%",
          background: "var(--surface-page)",
          color: "var(--text-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <FontAwesomeIcon icon={faXmark} style={{ fontSize: 13 }} />
      </button>
    </div>
  );
}

// The idea's own photo, the one its board card shows. No photo, or one that
// won't load (it can be hotlinked), and the band is left out rather than
// shown as a placeholder, so the map keeps the room.
function SheetPhoto({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ display: "block", width: "100%", height: 116, objectFit: "cover", borderRadius: "var(--radius-lg)", background: "var(--pattern-photo)" }}
    />
  );
}

function SheetTitle({ children }) {
  return (
    <div className="serif-place" style={{ fontSize: 19, lineHeight: 1.2, color: "var(--text-primary)" }}>
      {children}
    </div>
  );
}

function SheetText({ children }) {
  return <div style={{ font: "400 12.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{children}</div>;
}
