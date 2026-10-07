import { useEffect, useMemo, useRef, useState } from "react";
import MapCanvas from "../map/MapCanvas";
import ResultMarkers from "../map/ResultMarkers";
import { useMap } from "../map/mapContext";
import Button from "../core/Button";
import { NewPinHeader } from "./NewPinChrome";
import { MIN_QUERY_LENGTH } from "./usePlaceSearch";
import { areaLine, distanceKm, formatDistance, googleMapsPlaceUrl, otherTripRegion } from "../../lib/places";
import { areaQueriesForTrip } from "../../lib/mapArea";
import { looksLikeCost } from "../../lib/expenseTypes";

const LETTERS = "ABCDEFGHIJ";
// A search for one of these is probably for something bookable, which
// Google Maps usually doesn't list.
const TOUR_WORDS = /\b(tours?|viator|getyourguide|excursions?|experiences?)\b/i;
// While the search box has focus the keyboard covers the lower part of the
// screen, where the results are, so the map shrinks to a strip.
const MAP_HEIGHT = "45%";
const MAP_HEIGHT_TYPING = 150;
const FIT_PADDING = { top: 30, right: 30, bottom: 30, left: 30 };

/**
 * Searching Google Maps: the map on the top half and results below,
 * lettered to match their markers. `search` is usePlaceSearch() state kept
 * by whoever shows this, so going on and coming back keeps the results.
 *
 * Two uses:
 *   adding a pin (pages/NewPin.jsx): opens on the trip's area; a result is
 *     added with "Add this place", or opened if it's already an idea.
 *   `link` = { ideaTitle, region, knownRegions }: finding an existing
 *     idea's place (components/newpin/FindOnGoogle.jsx). Opens on the
 *     idea's region; "Link to this place" is offered even for a place
 *     that's already an idea (it may be another visit), with a note, and a
 *     result in another of the trip's regions says so.
 *
 *   existingByPlaceId  place ID -> an idea already on the board from it
 *   onPick(result)     "Add this place" / "Link to this place"
 *   onOpenIdea(pin)    "Open idea", for a place that's already one
 *   onManual()         "Add it by hand" / "Tap the map instead"
 *   onAddCost(query)   "Add as a cost": a ticket, pass or rental isn't a
 *                      place, so it goes to Expenses rather than the board
 *                      (components/expenses/CostSheet.jsx). Offered first
 *                      when the search reads like one, and always last.
 *                      Left out where costs can't be added.
 */
export default function PlaceSearchStep({ trip, search, existingByPlaceId, onCancel, onPick, onOpenIdea, onManual, onAddCost = null, link = null }) {
  const { query, setQuery, results, origin, status, selectedId, setSelectedId, viewRef } = search;
  const [typing, setTyping] = useState(false);
  const inputRef = useRef(null);
  const blurTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(blurTimerRef.current), []);

  const { locationsLine, name } = trip;
  const linkRegion = link?.region ?? "";
  const area = useMemo(
    () => (linkRegion ? { areas: [linkRegion], fallback: null } : areaQueriesForTrip({ locationsLine, name })),
    [linkRegion, locationsLine, name]
  );
  const markers = useMemo(
    () => results.map((r, i) => ({ ...r, letter: LETTERS[i], existing: Boolean(existingByPlaceId[r.placeId]) })),
    [results, existingByPlaceId]
  );

  const select = (placeId) => {
    inputRef.current?.blur();
    setSelectedId((current) => (current === placeId ? null : placeId));
  };

  return (
    <div className="screen">
      {link ? (
        <>
          <NewPinHeader backLabel="Back" onBack={onCancel} title="Find on Google Maps" />
          <div style={{ padding: "0 16px 10px", font: "400 12px/1.4 var(--font-sans)", color: "var(--text-secondary)" }}>
            For <b style={{ color: "var(--text-primary)" }}>{link.ideaTitle}</b>
            {link.region ? ` · results in ${link.region} first` : ""}
          </div>
        </>
      ) : (
        <NewPinHeader backLabel="Cancel" onBack={onCancel} />
      )}

      <div style={{ padding: "0 16px 10px", flex: "none" }}>
        <SearchBox
          inputRef={inputRef}
          value={query}
          onChange={setQuery}
          onFocus={() => {
            clearTimeout(blurTimerRef.current);
            setTyping(true);
          }}
          // Growing the map moves the results down. Waiting a moment lets
          // the tap that took focus away land on what was under the finger.
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setTyping(false), 180);
          }}
        />
      </div>

      <MapCanvas
        label="Search map"
        area={area}
        style={{
          height: typing ? MAP_HEIGHT_TYPING : MAP_HEIGHT,
          flex: "none",
          transition: "height var(--dur-base, .2s) var(--ease-standard, ease)",
          borderTop: "1px solid var(--hairline)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <ResultMarkers results={markers} selectedId={selectedId} onSelect={select} fitPadding={FIT_PADDING} />
        <ReportView viewRef={viewRef} />
      </MapCanvas>

      <div
        style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--surface-card)" }}
        // Scrolling the results means the person is reading, not typing:
        // put the keyboard away so the map grows back.
        onScroll={() => inputRef.current?.blur()}
      >
        {onAddCost && !link && looksLikeCost(query) ? <AddAsCost query={query} onAddCost={onAddCost} /> : null}
        <Results
          query={query}
          status={status}
          markers={markers}
          origin={origin}
          selectedId={selectedId}
          existingByPlaceId={existingByPlaceId}
          onSelect={select}
          onPick={onPick}
          onOpenIdea={onOpenIdea}
          link={link}
          onTry={(q) => {
            setQuery(q);
            inputRef.current?.blur();
          }}
        />
        <button
          type="button"
          onClick={onManual}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 16px", font: "500 12.5px/1.45 var(--font-sans)", color: "var(--accent)", background: "var(--surface-inset)" }}
        >
          {link ? "None of these? Tap the map instead ›" : query.trim().length >= MIN_QUERY_LENGTH ? "Not on Google Maps? Add it by hand ›" : "Add it by hand instead ›"}
          <span style={{ display: "block", font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
            {link
              ? "For somewhere Google lists under another name, or not at all."
              : TOUR_WORDS.test(query)
              ? "Tours booked on Viator or GetYourGuide usually aren’t on Google Maps. Paste the link and pick a region: it’ll show there on the map."
              : "For a link, a tour, or anywhere Google doesn’t list. It still shows on the map in its region."}
          </span>
        </button>
        {onAddCost && !link ? (
          <button
            type="button"
            onClick={() => onAddCost(query)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "0 16px 13px", font: "500 12.5px/1.45 var(--font-sans)", color: "var(--accent)", background: "var(--surface-inset)" }}
          >
            A ticket, pass or rental? Add it as a cost ›
            <span style={{ display: "block", font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
              Costs that aren’t places go in Expenses, not on the board.
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// First in the results when the search reads like a cost ("rental car",
// "5-day ticket"): those belong in Expenses. Google's results stay below
// it, since a rental counter is a real place.
function AddAsCost({ query, onAddCost }) {
  return (
    <button
      type="button"
      onClick={() => onAddCost(query)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "calc(100% - 32px)",
        margin: "12px 16px 4px",
        padding: "10px 12px",
        textAlign: "left",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border)",
        background: "var(--accent-quiet)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>Add “{query.trim()}” as a cost</span>
        <span style={{ display: "block", font: "400 11.5px/1.4 var(--font-sans)", color: "var(--text-secondary)", marginTop: 1 }}>
          Tickets, passes and rentals go in Expenses, not on the board.
        </span>
      </span>
      <span aria-hidden="true" style={{ color: "var(--accent)", font: "600 14px var(--font-sans)" }}>
        ›
      </span>
    </button>
  );
}

// Lets searches prefer the visible map and measure distance from its
// centre (see usePlaceSearch).
function ReportView({ viewRef }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return undefined;
    viewRef.current = () => {
      const center = map.getCenter();
      return { bounds: map.getBounds() ?? null, center: center ? { lat: center.lat(), lng: center.lng() } : null };
    };
    return () => {
      viewRef.current = null;
    };
  }, [map, viewRef]);
  return null;
}

function SearchBox({ inputRef, value, onChange, onFocus, onBlur }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 44,
        padding: "0 8px 0 12px",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-strong)",
        background: "var(--surface-card)",
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Search for a place"
        aria-label="Search for a place"
        autoComplete="off"
        // Only when starting out: coming back from the details form
        // shouldn't throw the keyboard up over the results.
        autoFocus={!value}
        style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", font: "400 16px var(--font-sans)", color: "var(--text-primary)" }}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="hit-target"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

const SUGGESTIONS = ["seafood", "tide pools", "temple", "night market"];

function Results({ query, status, markers, origin, selectedId, existingByPlaceId, onSelect, onPick, onOpenIdea, onTry, link }) {
  if (link && query.trim().length < MIN_QUERY_LENGTH) return <Hint>Type the place’s name as Google Maps might know it.</Hint>;
  if (query.trim().length < MIN_QUERY_LENGTH) {
    return (
      <Hint>
        <span>Search for a restaurant, a beach, a temple… Places near this trip come first.</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onTry(s)}
              style={{ padding: "5px 11px", borderRadius: "var(--radius-pill)", border: "1px dashed var(--border-strong)", font: "500 12px var(--font-sans)", color: "var(--text-primary)" }}
            >
              {s}
            </button>
          ))}
        </div>
      </Hint>
    );
  }
  if (status === "error") return <Hint>{link ? "Search isn’t working right now. You can still tap the map." : "Search isn’t working right now. You can still add it by hand."}</Hint>;
  if (status === "searching" && markers.length === 0) return <Hint>Searching…</Hint>;
  if (status === "done" && markers.length === 0) return <Hint>No places match “{query.trim()}” near here. Try another name, or add it by hand.</Hint>;

  return (
    <ul aria-label="Places found" style={{ listStyle: "none" }}>
      {markers.map((result) => (
        <ResultRow
          key={result.placeId}
          result={result}
          distance={origin ? formatDistance(distanceKm(origin, result)) : null}
          selected={result.placeId === selectedId}
          existingPin={existingByPlaceId[result.placeId]}
          onSelect={() => onSelect(result.placeId)}
          onPick={() => onPick(result)}
          onOpenIdea={() => onOpenIdea(existingByPlaceId[result.placeId])}
          link={link}
        />
      ))}
    </ul>
  );
}

function ResultRow({ result, distance, selected, existingPin, onSelect, onPick, onOpenIdea, link }) {
  const elsewhere = selected && link ? otherTripRegion(result, link.region, link.knownRegions) : null;
  const color = existingPin ? "var(--geo)" : "var(--accent)";
  return (
    <li style={{ borderBottom: "1px solid var(--hairline)", background: selected ? (existingPin ? "var(--geo-quiet)" : "var(--accent-quiet)") : "transparent" }}>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        style={{ width: "100%", display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 10, alignItems: "start", padding: "11px 16px", textAlign: "left" }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: `2px solid ${color}`,
            background: selected ? color : "transparent",
            color: selected ? "#fff" : color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "700 10px var(--font-sans)",
            boxSizing: "border-box",
          }}
        >
          {existingPin ? "✓" : result.letter}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", font: "600 13.5px/1.3 var(--font-sans)", color: "var(--text-primary)" }}>{result.name}</span>
          <span className="mono-data-sm" style={{ display: "block", marginTop: 2, color: "var(--text-muted)", letterSpacing: 0 }}>
            {selected ? result.address : areaLine(result)}
          </span>
        </span>
        {existingPin ? (
          <span className="mono-data-sm" style={{ padding: "2px 6px", borderRadius: 6, background: "var(--geo-quiet)", color: "var(--geo)", fontSize: 8.5, letterSpacing: ".06em" }}>
            AN IDEA
          </span>
        ) : distance ? (
          <span className="mono-data-sm" style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {distance}
          </span>
        ) : (
          <span />
        )}
      </button>
      {selected && link && (existingPin || elsewhere) ? (
        <div role="note" style={{ padding: "0 16px 8px 50px", display: "grid", gap: 4, font: "400 11.5px/1.4 var(--font-sans)", color: "var(--warn)" }}>
          {existingPin ? <span>Already an idea: {existingPin.title}. Linking this one too is fine if it’s another visit.</span> : null}
          {elsewhere ? <span>In {elsewhere}, not {link.region}. You can move the idea there after linking.</span> : null}
        </div>
      ) : null}
      {selected ? (
        <div style={{ display: "flex", gap: 8, padding: "0 16px 12px 50px" }}>
          {link ? (
            <Button variant="accent" size="sm" onClick={onPick}>
              Link to this place
            </Button>
          ) : existingPin ? (
            <Button variant="secondary" size="sm" onClick={onOpenIdea}>
              Open idea
            </Button>
          ) : (
            <Button variant="accent" size="sm" onClick={onPick}>
              Add this place
            </Button>
          )}
          <a
            href={googleMapsPlaceUrl(result)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${result.name} in Google Maps`}
            style={{
              flex: "none",
              width: 40,
              height: 40,
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border-strong)",
              background: "var(--surface-card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-primary)",
            }}
          >
            ↗
          </a>
        </div>
      ) : null}
    </li>
  );
}

function Hint({ children }) {
  return <div style={{ padding: "14px 16px", display: "grid", gap: 10, font: "400 12.5px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>{children}</div>;
}
