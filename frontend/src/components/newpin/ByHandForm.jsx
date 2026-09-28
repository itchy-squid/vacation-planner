import { useEffect, useMemo, useState } from "react";
import TextField from "../forms/TextField";
import Stepper from "../forms/Stepper";
import CostField from "../forms/CostField";
import Button from "../core/Button";
import MapCanvas from "../map/MapCanvas";
import RegionAreas from "../map/RegionAreas";
import PinDots from "../map/PinDots";
import { useMap } from "../map/mapContext";
import { useRegionLocations } from "../map/useRegionLocations";
import { NewPinHeader, AddModeSwitch, SourceTag } from "./NewPinChrome";
import { externalHref } from "../../lib/externalHref";
import { hintsFromLink } from "../../lib/linkHints";
import { isMapsConfigured } from "../../lib/googleMaps";
import { regionKey } from "../../lib/regions";
import { areaQueriesForTrip } from "../../lib/mapArea";
import { fmtMin } from "../../data/derive";

const DEFAULT_MINUTES = 60;
const MIN_MINUTES = 15;
// A typed region is looked up once the typing pauses.
const REGION_LOOKUP_DELAY_MS = 600;
const MAP_HEIGHT = 140;
const MAP_HEIGHT_PINNING = 230;
const FIT_PADDING = { top: 16, right: 16, bottom: 16, left: 16 };

// When nothing better is typed, a pasted link's host is the title
// placeholder, the way bookmarking tools name a link.
function hostOf(link) {
  const href = externalHref(link);
  if (!href) return null;
  try {
    return new window.URL(href).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Adding an idea Google Maps doesn't list: a tour from Viator, a friend's
 * tip, an article. It still goes on the map: in its region (pick
 * "Cozumel" and it shows in Cozumel), or at an exact spot if one is
 * pinned. The way to add ideas when there's no Maps key, too (without the
 * map preview).
 *
 *   knownRegions       the regions the trip already uses, offered as chips
 *   focusTitle         start in the title rather than the link
 *   onSearch           switch to place search; absent without a Maps key
 *   onSubmit({ payload, newRegion })
 *                      payload is the POST /api/trips/{id}/pins body;
 *                      newRegion is where a region the trip hasn't stored
 *                      yet was found, to store alongside it
 */
export default function ByHandForm({ trip, knownRegions, canSetCost, focusTitle, submitting, error, onCancel, onSearch, onSubmit }) {
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [region, setRegion] = useState("");
  const [hinted, setHinted] = useState({ title: null, region: null });
  const [spot, setSpot] = useState(null);
  const [pinning, setPinning] = useState(false);
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [cost, setCost] = useState("");
  const [costBasis, setCostBasis] = useState("per_head");

  const knownByKey = useMemo(() => Object.fromEntries(knownRegions.map((r) => [regionKey(r), r])), [knownRegions]);
  const chosenChip = knownByKey[regionKey(region)] ?? null;

  // Chips are looked up straight away; a typed name once typing pauses.
  const settledRegion = useDebounced(region, chosenChip ? 0 : REGION_LOOKUP_DELAY_MS);
  const lookupNames = useMemo(() => (settledRegion.trim() ? [settledRegion] : []), [settledRegion]);
  const locations = useRegionLocations(lookupNames);
  const location = regionKey(settledRegion) === regionKey(region) ? locations[regionKey(region)] ?? null : null;
  const lookingUp = Boolean(region.trim()) && regionKey(settledRegion) !== regionKey(region);

  function changeLink(next) {
    setLink(next);
    const hints = hintsFromLink(next);
    if (!hints) return;
    // Only fill fields the person hasn't typed in (or that the last link filled).
    if (hints.title && (!title.trim() || title === hinted.title)) setTitle(hints.title);
    const hintRegion = hints.place ? knownByKey[regionKey(hints.place)] ?? hints.place : null;
    if (hintRegion && (!region.trim() || region === hinted.region)) setRegion(hintRegion);
    setHinted({ title: hints.title, region: hintRegion });
  }

  const finalTitle = title.trim() || hostOf(link.trim()) || "";
  const canSubmit = (link.trim().length > 0 || title.trim().length > 0) && !submitting;

  function submit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    const name = finalTitle || "Untitled pin";
    const costCents = Math.round(Math.max(0, Number(cost) || 0) * 100);
    const regionName = region.trim();
    onSubmit({
      payload: {
        title: name,
        short: name.length > 28 ? `${name.slice(0, 27)}…` : name,
        place: regionName || name,
        region: regionName,
        link: link.trim(),
        duration_minutes: minutes,
        notes: "",
        tags: [],
        ...(spot ? { lat: spot.lat, lng: spot.lng } : {}),
        // Only sent when set: pricing needs its own permission.
        ...(canSetCost && costCents > 0 ? { cost_cents: costCents, cost_basis: costBasis } : {}),
      },
      newRegion: location && !location.id ? { ...location, name: regionName } : null,
    });
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <NewPinHeader
          backLabel="Cancel"
          onBack={onCancel}
          action={
            <button type="button" onClick={submit} disabled={!canSubmit} style={{ font: "600 13px var(--font-sans)", color: canSubmit ? "var(--text-primary)" : "var(--text-muted)" }}>
              {submitting ? "Adding…" : "Add"}
            </button>
          }
        />
        {onSearch ? <AddModeSwitch mode="link" onSearch={onSearch} /> : null}

        <form onSubmit={submit} style={{ padding: onSearch ? "0 16px" : "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <TextField
            label="Link"
            value={link}
            onChange={(e) => changeLink(e.target.value)}
            placeholder="Paste a link: Viator, Instagram, an article…"
            mono
            size={12.5}
            autoFocus={!focusTitle}
          />

          <Tagged tag={hinted.title && title === hinted.title ? <SourceTag tone="neutral">From the link</SourceTag> : null}>
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={hostOf(link.trim()) || "e.g. Snorkel and beach tour"}
              weight={600}
              size={15}
              autoFocus={focusTitle}
            />
          </Tagged>

          <RegionPicker
            knownRegions={knownRegions}
            value={region}
            chosenChip={chosenChip}
            fromLink={Boolean(hinted.region) && region === hinted.region}
            onChange={setRegion}
          />

          {isMapsConfigured ? (
            <OnTheMap
              trip={trip}
              regionName={region.trim()}
              location={location}
              lookingUp={lookingUp}
              spot={spot}
              pinning={pinning}
              onPinning={setPinning}
              onSpot={setSpot}
            />
          ) : null}

          <Stepper
            label="Time there"
            valueLabel={fmtMin(minutes)}
            onDown={() => setMinutes((m) => Math.max(MIN_MINUTES, m - 15))}
            onUp={() => setMinutes((m) => m + 15)}
          />
          {canSetCost ? <CostField id="by-hand-cost" value={cost} onChange={setCost} basis={costBasis} onBasis={setCostBasis} disabled={submitting} /> : null}

          {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}

          <Button variant="accent" type="submit" disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Adding…" : "Add to board"}
          </Button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>
            A photo link can be added on the idea afterwards.
          </div>
        </form>
      </div>
    </div>
  );
}

function Tagged({ tag, children }) {
  return (
    <div style={{ position: "relative" }}>
      {tag ? <div style={{ position: "absolute", top: 0, right: 0, lineHeight: 1 }}>{tag}</div> : null}
      {children}
    </div>
  );
}

// The trip's regions as one-tap chips, and a field for any other.
function RegionPicker({ knownRegions, value, chosenChip, fromLink, onChange }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="mono-caption" id="by-hand-region-label">
          Region
        </span>
        {fromLink ? <SourceTag tone="neutral">From the link</SourceTag> : null}
      </div>
      {knownRegions.length ? (
        <div role="group" aria-labelledby="by-hand-region-label" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {knownRegions.map((r) => {
            const on = chosenChip === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? "" : r)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "var(--radius-pill)",
                  font: "500 12.5px var(--font-sans)",
                  border: `1px solid ${on ? "var(--geo)" : "var(--border-strong)"}`,
                  background: on ? "var(--geo)" : "var(--surface-card)",
                  color: on ? "#fff" : "var(--text-primary)",
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      ) : null}
      <div style={{ marginTop: 8 }}>
        <TextField
          label={knownRegions.length ? "" : undefined}
          aria-label={knownRegions.length ? "Another region" : "Region"}
          value={chosenChip ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={knownRegions.length ? "Another region, e.g. Akumal" : "e.g. Cozumel"}
        />
      </div>
    </div>
  );
}

// Where the idea will show: in its region's area, or at the spot pinned.
function OnTheMap({ trip, regionName, location, lookingUp, spot, pinning, onPinning, onSpot }) {
  const { locationsLine, name } = trip;
  const [area] = useState(() => areaQueriesForTrip({ locationsLine, name }));
  const areas = useMemo(() => (location ? [{ ...location, count: 0 }] : []), [location]);
  const dots = useMemo(() => (spot ? [{ id: "spot", title: "Exact spot", lat: spot.lat, lng: spot.lng }] : []), [spot]);

  let caption;
  let actions;
  if (pinning) {
    caption = <><b>Tap where it happens</b>, like a tour’s meeting point.</>;
    actions = (
      <>
        {spot ? <LinkButton onClick={() => onSpot(null)}>Remove the spot</LinkButton> : <span />}
        <Button variant="secondary" size="sm" fullWidth={false} onClick={() => onPinning(false)} style={{ padding: "0 16px" }}>
          Done
        </Button>
      </>
    );
  } else if (spot) {
    caption = <><b>Exact spot set.</b> It shows as its own pin.</>;
    actions = (
      <>
        <LinkButton onClick={() => onPinning(true)}>Move it</LinkButton>
        <LinkButton onClick={() => onSpot(null)}>Remove it</LinkButton>
      </>
    );
  } else if (!regionName) {
    caption = "Pick a region and it will show there on the map.";
  } else if (lookingUp) {
    caption = `Finding ${regionName} on the map…`;
  } else if (!location) {
    caption = `Couldn’t find “${regionName}” on the map. It will still be on the board.`;
    actions = (
      <>
        <span />
        <LinkButton onClick={() => onPinning(true)}>Pin an exact spot instead</LinkButton>
      </>
    );
  } else {
    caption = (
      <>
        <b>Shown in {regionName}</b>, without an exact spot.{location.id ? "" : ` New region: found ${location.label ?? location.name}.`}
      </>
    );
    actions = (
      <>
        <span className="mono-caption">Optional</span>
        <LinkButton onClick={() => onPinning(true)}>Pin an exact spot ›</LinkButton>
      </>
    );
  }

  return (
    <div>
      <div className="mono-caption">On the map</div>
      <div style={{ marginTop: 6, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", overflow: "hidden", background: "var(--surface-card)" }}>
        <MapCanvas
          label="Where it will show"
          area={area}
          options={{ gestureHandling: "cooperative", zoomControl: false }}
          onClick={pinning ? onSpot : undefined}
          style={{ height: pinning ? MAP_HEIGHT_PINNING : MAP_HEIGHT, transition: "height var(--dur-base, .2s) var(--ease-standard, ease)", cursor: pinning ? "crosshair" : undefined }}
        >
          {spot ? <PinDots pins={dots} highlightedId="spot" /> : <RegionAreas regions={areas} variant="question" />}
          <FitTo region={location} spot={spot} />
        </MapCanvas>
        <div role="status" style={{ padding: "9px 11px", display: "grid", gap: 7, font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
          <span>{caption}</span>
          {actions ? <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

// Brings the chosen region into view. A pinned spot leaves the camera where
// the person put it.
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

function LinkButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{ font: "500 12px var(--font-sans)", color: "var(--accent)" }}>
      {children}
    </button>
  );
}
