import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import HomeButton from "../components/core/HomeButton";
import { useKnownRegions } from "../components/map/useKnownRegions";
import { usePlannerState, usePlannerDispatch, useIdeaAccess } from "../state/PlannerContext";
import { classifyMatches, otherTripRegion, searchPlaces } from "../lib/places";
import { regionKey } from "../lib/regions";

// Each idea is one paid search, so a review covers this many at most; the
// rest can be reviewed next time.
const MAX_IDEAS = 12;
const RESULTS_PER_IDEA = 3;
const SEARCHES_AT_ONCE = 2;

// "On Google Maps?": ideas shown by region (no exact spot) that might be
// places Google knows, each looked up once by its title inside its region.
// A confident match is offered on its own, an unsure one as a few choices,
// and no match (a booked tour, say) is left alone. Nothing changes until
// "Link n": then each accepted idea gets the place's spot and Google place,
// and nothing else (titles and links stay as typed). Opened from the Map
// tab's summary (pages/TripMap.jsx), and back there when done.
export default function LinkReview() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const ideaAccess = useIdeaAccess();
  const { trip, pins, regions } = usePlannerState();
  const knownRegions = useKnownRegions();
  const back = `/trips/${trip.id}/map`;

  // Read once: the list shouldn't reshuffle while it's being reviewed.
  const [ideas] = useState(() =>
    Object.values(pins)
      .filter((p) => p.lat == null && regions[regionKey(p.region)] && ideaAccess.canEditIdea(p))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, MAX_IDEAS)
  );
  const [found, setFound] = useState({}); // pin id -> classifyMatches() result, or { kind: "error" }
  const [decisions, setDecisions] = useState({}); // pin id -> "link" | "skip"
  const [choices, setChoices] = useState({}); // pin id -> index into choices
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const queue = [...ideas];
    async function work() {
      while (queue.length && !cancelled) {
        const pin = queue.shift();
        const region = regions[regionKey(pin.region)];
        const bounds = { south: region.south, west: region.west, north: region.north, east: region.east };
        let result;
        try {
          result = classifyMatches(pin.title, await searchPlaces(pin.title, { bias: bounds, max: RESULTS_PER_IDEA }), bounds);
        } catch {
          result = { kind: "error" };
        }
        if (!cancelled) setFound((current) => ({ ...current, [pin.id]: result }));
      }
    }
    for (let i = 0; i < SEARCHES_AT_ONCE; i += 1) work();
    return () => {
      cancelled = true;
    };
    // Once, for the ideas read on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingByPlaceId = useMemo(
    () => Object.fromEntries(Object.values(pins).filter((p) => p.googlePlaceId).map((p) => [p.googlePlaceId, p])),
    [pins]
  );

  function placeFor(pin) {
    const f = found[pin.id];
    if (f?.kind === "one") return f.match;
    if (f?.kind === "many" && choices[pin.id] != null) return f.choices[choices[pin.id]];
    return null;
  }
  const toLink = ideas.filter((p) => decisions[p.id] === "link" && placeFor(p));

  async function apply() {
    if (toLink.length === 0) {
      navigate(back);
      return;
    }
    setApplying(true);
    setError("");
    let failed = 0;
    for (const pin of toLink) {
      const place = placeFor(pin);
      const result = await dispatch({ type: "PATCH_PIN", id: pin.id, fields: { location: { lat: place.lat, lng: place.lng, placeId: place.placeId } } });
      if (!result?.ok) failed += 1;
    }
    const linked = toLink.length - failed;
    if (failed) {
      setApplying(false);
      setError(`Linked ${linked}, but ${failed} didn’t save. Try again.`);
      return;
    }
    navigate(back, { state: { notice: `${linked} idea${linked === 1 ? "" : "s"} linked to Google Maps.` } });
  }

  const decide = (id, value) => setDecisions((current) => ({ ...current, [id]: value }));
  const undo = (id) =>
    setDecisions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  return (
    <div className="screen">
      <div style={{ flex: "none", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 16px 12px", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <HomeButton size={28} />
          <button type="button" onClick={() => navigate(back)} disabled={applying} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>
            ‹ Map
          </button>
        </div>
        <span className="mono-caption">On Google Maps?</span>
        <button
          type="button"
          onClick={apply}
          disabled={applying}
          style={{
            justifySelf: "end",
            height: 32,
            padding: "0 14px",
            borderRadius: "var(--radius-pill)",
            font: "600 13px var(--font-sans)",
            background: toLink.length ? "var(--surface-inverse)" : "transparent",
            color: toLink.length ? "#fff" : "var(--text-primary)",
          }}
        >
          {applying ? "Linking…" : toLink.length ? `Link ${toLink.length}` : "Done"}
        </button>
      </div>

      <div className="screen-scroll" style={{ padding: "12px 16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        {error ? <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}
        <div style={{ font: "400 12.5px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
          {ideas.length
            ? "These ideas have no exact spot. Each was looked up by its title, inside its region. Link the right ones; nothing changes until you do."
            : "Nothing to review: every idea you can edit is either at its spot or has no region on the map."}
        </div>
        {ideas.map((pin) => (
          <Candidate
            key={pin.id}
            pin={pin}
            found={found[pin.id]}
            decision={decisions[pin.id]}
            choice={choices[pin.id]}
            existingByPlaceId={existingByPlaceId}
            knownRegions={knownRegions}
            onChoose={(i) => setChoices((current) => ({ ...current, [pin.id]: i }))}
            onLink={() => decide(pin.id, "link")}
            onSkip={() => decide(pin.id, "skip")}
            onUndo={() => undo(pin.id)}
          />
        ))}
      </div>
    </div>
  );
}

function Candidate({ pin, found, decision, choice, existingByPlaceId, knownRegions, onChoose, onLink, onSkip, onUndo }) {
  const linked = decision === "link";
  const skipped = decision === "skip";
  const place = found?.kind === "one" ? found.match : found?.kind === "many" && choice != null ? found.choices[choice] : null;
  const already = place ? existingByPlaceId[place.placeId] : null;
  const elsewhere = place ? otherTripRegion(place, pin.region, knownRegions) : null;

  return (
    <section
      aria-label={pin.title}
      style={{
        background: linked ? "var(--geo-quiet)" : "var(--surface-card)",
        border: `1px solid ${linked ? "var(--teal-line)" : "var(--hairline)"}`,
        borderRadius: "var(--radius-lg)",
        padding: "11px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity: skipped ? 0.55 : 1,
      }}
    >
      <div style={{ font: "600 13.5px var(--font-sans)", color: "var(--text-primary)" }}>
        {pin.title}
        <span className="mono-caption" style={{ marginLeft: 8 }}>
          {pin.region}
          {linked ? " · linked" : skipped ? " · left as is" : ""}
        </span>
      </div>

      {!found ? (
        <Line>Looking it up…</Line>
      ) : found.kind === "error" ? (
        <Line>Couldn’t look this one up. It stays in {pin.region}.</Line>
      ) : found.kind === "none" ? (
        <Line>No match on Google Maps. It stays in {pin.region}.</Line>
      ) : found.kind === "one" ? (
        <Line>
          → <b style={{ color: "var(--text-primary)" }}>{found.match.name}</b>
          <br />
          {found.match.address}
        </Line>
      ) : (
        <>
          <Line>A few places match. Which is it?</Line>
          <div role="radiogroup" aria-label={`Places for ${pin.title}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {found.choices.map((c, i) => (
              <button
                key={c.placeId}
                type="button"
                role="radio"
                aria-checked={choice === i}
                disabled={Boolean(decision)}
                onClick={() => onChoose(i)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${choice === i ? "var(--geo)" : "var(--border-strong)"}`,
                  background: choice === i ? "var(--geo-quiet)" : "var(--surface-card)",
                }}
              >
                <span style={{ display: "block", font: "500 12.5px var(--font-sans)", color: "var(--text-primary)" }}>{c.name}</span>
                <span className="mono-data-sm" style={{ color: "var(--text-muted)", letterSpacing: 0 }}>
                  {c.address}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {already || elsewhere ? (
        <div role="note" style={{ font: "400 11.5px/1.4 var(--font-sans)", color: "var(--warn)" }}>
          {already ? <div>Already an idea: {already.title}.</div> : null}
          {elsewhere ? <div>That place is in {elsewhere}, not {pin.region}. Linking leaves the region as it is.</div> : null}
        </div>
      ) : null}

      {found && (found.kind === "one" || found.kind === "many") ? (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          {decision ? (
            <Chip onClick={onUndo}>Undo</Chip>
          ) : (
            <>
              <Chip onClick={onSkip}>{found.kind === "many" ? "None of these" : "Not it"}</Chip>
              <Chip onClick={onLink} disabled={!place} go>
                Link
              </Chip>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Line({ children }) {
  return <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{children}</div>;
}

function Chip({ children, onClick, disabled = false, go = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 13px",
        borderRadius: "var(--radius-pill)",
        font: "600 12px var(--font-sans)",
        border: `1px solid ${go ? "var(--geo)" : "var(--border-strong)"}`,
        background: go ? "var(--geo)" : "var(--surface-card)",
        color: go ? "#fff" : "var(--text-primary)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}
