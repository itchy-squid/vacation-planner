import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import TimeBlock from "../components/planner/TimeBlock";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import { usePlannerState } from "../state/PlannerContext";
import { getTripDays } from "../data/trip";
import { dayHeaderLabel } from "../data/schedule";
import { fmtMin } from "../data/derive";
import HomeButton from "../components/core/HomeButton";
import SettingsButton from "../components/core/SettingsButton";

// Screen 4 — "place pins into free-length blocks; surface conflicts."
// Handoff README screen 4. Day 5's 13:00-16:00 block is still the one
// modeled contested block that opens the compare screen (see
// contestedBlockView below); every other block on every day — placed,
// pencilled, or empty — now comes straight from the backend's Block table
// (backend/app/seed.py), not the old data/schedule.js mock.
export default function DaySchedule() {
  const navigate = useNavigate();
  const { day } = useParams();
  const dayIndex = Number(day) || 5;
  const state = usePlannerState();
  const { trip, day5Block, pins, draft, lockedSetKey, blocks: allBlocks } = state;

  // Region(s) this day already has scheduled, derived from its actual
  // Block rows (each carries the region of the pin scheduled into it, or
  // an explicit region for a still-empty block — see backend/app/seed.py)
  // rather than a fixed day->region map, so it stays right for any trip
  // length or pin mix instead of only the eight seeded days.
  const dayRegions = useMemo(() => {
    const set = new Set(allBlocks.filter((b) => b.dayIndex === dayIndex && b.region).map((b) => b.region));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allBlocks, dayIndex]);

  // Single region for the header/day-pill caption — the majority one, if
  // a day somehow mixes regions. A day with nothing scheduled at all yet
  // has no region to report, so this reads as the trip generically rather
  // than a region name that would never actually match a pin.
  const region = useMemo(() => {
    if (!dayRegions.length) return "Trip";
    if (dayRegions.length === 1) return dayRegions[0];
    const counts = new Map();
    allBlocks
      .filter((b) => b.dayIndex === dayIndex && b.region)
      .forEach((b) => counts.set(b.region, (counts.get(b.region) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [dayRegions, allBlocks, dayIndex]);

  // Every region that exists anywhere in the trip — the tray filter's
  // full option list, same source PinBoard's own region chips use.
  const allTripRegions = useMemo(() => {
    const set = new Set(Object.values(pins).map((p) => p.region).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [pins]);

  // Tray filter: which region(s) of unplaced pin show below the timeline.
  // Defaults to whatever this day already has scheduled (dayRegions) —
  // re-derived whenever the day itself changes — but the chips let the
  // user widen or narrow it to any other trip region, since a day with
  // nothing scheduled yet has no "already scheduled" region to default
  // to (that's the fix for the tray showing 0 unplaced on such days: the
  // old code matched pins against a region that could never be real).
  const [trayFilter, setTrayFilter] = useState(dayRegions);
  const autoFilterDay = useRef(null);
  useEffect(() => {
    if (autoFilterDay.current === dayIndex) return;
    autoFilterDay.current = dayIndex;
    setTrayFilter(dayRegions);
  }, [dayIndex, dayRegions]);

  function toggleTrayRegion(r) {
    setTrayFilter((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  const trayFilterIsDefault = useMemo(
    () => trayFilter.length === dayRegions.length && trayFilter.every((r) => dayRegions.includes(r)),
    [trayFilter, dayRegions]
  );

  // The day strip and header both read off the trip's real start_date/
  // end_date (see data/trip.js getTripDays) instead of a fixed calendar,
  // so editing a trip's dates (pages/TripSettings.jsx) is reflected here.
  const tripDays = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);

  // Day strip marquee: once a trip runs long enough that the day pills
  // overflow the screen width, this becomes a swipeable scroll region —
  // same idea as AvailabilityGrid's vertical week marquee (see
  // styles/global.css .week-marquee), sideways. Touch already swipes it
  // natively; canLeft/canRight also drive fade edges + hover-revealed
  // nudge buttons for pointers that don't.
  const dayStripRef = useRef(null);
  const dayRefs = useRef({});
  const holdRef = useRef({ timeout: null, interval: null });
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = dayStripRef.current;
    if (!el) return undefined;
    const updateScrollState = () => {
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    };
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [tripDays.length]);

  // Keep the selected day pill in view as the route param changes
  // (including on first load, when Day 5+ may start off scrolled past the
  // visible edge) — instant on mount, smooth after that.
  const didMountScroll = useRef(false);
  useEffect(() => {
    const el = dayRefs.current[dayIndex];
    if (!el) return;
    el.scrollIntoView({ behavior: didMountScroll.current ? "smooth" : "auto", inline: "center", block: "nearest" });
    didMountScroll.current = true;
  }, [dayIndex, tripDays.length]);

  useEffect(() => () => {
    clearTimeout(holdRef.current.timeout);
    clearInterval(holdRef.current.interval);
  }, []);

  function clearHold() {
    clearTimeout(holdRef.current.timeout);
    clearInterval(holdRef.current.interval);
  }

  function nudgeDayStrip(direction) {
    const el = dayStripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * (el.clientWidth * 0.7), behavior: "smooth" });
  }

  function startHold(direction) {
    nudgeDayStrip(direction);
    clearHold();
    holdRef.current.timeout = setTimeout(() => {
      holdRef.current.interval = setInterval(() => nudgeDayStrip(direction), 260);
    }, 380);
  }

  const contestedBlockView = useMemo(() => {
    if (!day5Block || day5Block.dayIndex !== dayIndex) return null;
    const realSets = day5Block.candidateSets;
    const setCount = realSets.length + (draft.length ? 1 : 0);
    const lockedTotals = lockedSetKey && lockedSetKey !== "C" ? realSets.find((s) => s.key === lockedSetKey) : null;

    const setChips = realSets.map((s) => ({
      key: s.key,
      color: s.color,
      label: `Set ${s.key} · ${s.stopPinIds.length} stop${s.stopPinIds.length === 1 ? "" : "s"} · ${fmtMin(s.slackMinutes)} slack`,
    }));
    if (draft.length) {
      setChips.push({ key: "C", color: "#6f7f3c", label: `Set C · ${draft.length} stop${draft.length === 1 ? "" : "s"} · your draft` });
    }

    const conflictNames = realSets
      .flatMap((s) => s.stopPinIds)
      .map((id) => pins[id]?.short)
      .filter(Boolean)
      .join(" · ");

    return {
      id: day5Block.id,
      type: lockedSetKey ? "locked" : "contested",
      start: day5Block.start,
      end: day5Block.end,
      headline: `${setCount} candidate set${setCount === 1 ? "" : "s"} want this block`,
      conflictNames,
      setChips,
      votedCount: day5Block.votedCount,
      totalVoters: day5Block.contributorCount,
      title: lockedSetKey ? `Set ${lockedSetKey} locked` : undefined,
      meta: lockedSetKey
        ? `${clock(day5Block.start)}–${clock(day5Block.end)} · ${
            lockedTotals ? `$${Math.round(lockedTotals.totalCostCents / 100)} each · ${fmtMin(lockedTotals.slackMinutes)} slack` : "your draft"
          }`
        : undefined,
    };
  }, [day5Block, dayIndex, draft, lockedSetKey, pins]);

  // Every non-contested block for this day — placed/pencilled/empty — read
  // straight off the real backend Block rows. A "placed"/"pencilled" block
  // is a single-stop CandidateSet (same shape day5Block's real sets use);
  // its title and cost come from that stop's pin, not from any
  // schedule-specific field.
  const simpleBlockItems = useMemo(() => {
    return allBlocks
      .filter((b) => b.dayIndex === dayIndex && b.status !== "contested" && b.status !== "locked")
      .map((b) => {
        if (b.status === "empty") {
          return { id: b.id, type: "empty", start: b.start, end: b.end };
        }
        const stopPinId = b.candidateSets[0]?.stopPinIds[0];
        const pin = stopPinId ? pins[stopPinId] : null;
        const cost = pin ? (pin.cost === 0 ? "free" : `$${pin.cost}`) : undefined;
        return {
          id: b.id,
          type: b.status, // "placed" | "pencilled"
          start: b.start,
          end: b.end,
          title: pin?.title ?? b.candidateSets[0]?.label ?? "Untitled",
          meta: b.status === "pencilled" && cost ? `${cost} · unconfirmed` : cost,
        };
      });
  }, [allBlocks, dayIndex, pins]);

  const timelineItems = useMemo(() => {
    const items = contestedBlockView ? [...simpleBlockItems, contestedBlockView] : simpleBlockItems;
    return [...items].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }, [simpleBlockItems, contestedBlockView]);

  // Tray: pins that aren't scheduled into any block yet, anywhere in the
  // trip — same "claimed" logic pages/CompareSets.jsx uses for its own
  // unclaimed pool — narrowed to whichever region(s) the tray filter
  // above has selected. An empty trayFilter means "All": every unplaced
  // pin in the trip, regardless of region.
  const unplacedPins = useMemo(() => {
    const placedIds = new Set();
    allBlocks.forEach((b) => b.candidateSets.forEach((cs) => cs.stopPinIds.forEach((id) => placedIds.add(id))));
    const regionSet = trayFilter.length ? new Set(trayFilter) : null;
    return Object.values(pins).filter((p) => !placedIds.has(p.id) && (!regionSet || regionSet.has(p.region)));
  }, [allBlocks, pins, trayFilter]);

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ padding: "20px var(--gutter-text) 12px", display: "flex", alignItems: "flex-end", gap: 10 }}>
          <HomeButton />
          <SettingsButton />
          <div>
            <div className="mono-caption">Scheduling · {region}</div>
            <div className="serif-place" style={{ fontSize: 24, marginTop: 2, color: "var(--text-primary)" }}>{dayHeaderLabel(dayIndex, trip.startDate, trip.endDate)}</div>
          </div>
        </div>

        <div className="day-marquee" style={{ position: "relative" }}>
          <div
            ref={dayStripRef}
            style={{
              display: "flex",
              gap: 6,
              padding: "0 var(--gutter-screen) 16px",
              overflowX: "auto",
              scrollSnapType: "x proximity",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {tripDays.map((d, i) => {
              const n = i + 1;
              const selected = n === dayIndex;
              return (
                <button
                  key={n}
                  ref={(el) => { dayRefs.current[n] = el; }}
                  onClick={() => navigate(`/trips/${trip.id}/schedule/${n}`)}
                  style={{
                    flex: "none",
                    width: 38,
                    padding: "6px 0",
                    borderRadius: "var(--radius-md)",
                    background: selected ? "var(--surface-inverse)" : "var(--surface-card)",
                    border: selected ? "none" : "1px solid var(--border)",
                    textAlign: "center",
                    scrollSnapAlign: "center",
                  }}
                >
                  <div className="mono-data-sm" style={{ color: selected ? "rgba(255,255,255,.6)" : "var(--text-faint)", letterSpacing: 0 }}>{d.dow}</div>
                  <div style={{ font: "600 14px var(--font-sans)", marginTop: 1, color: selected ? "#fff" : "var(--text-primary)" }}>{d.n}</div>
                </button>
              );
            })}
          </div>

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              bottom: 16,
              left: 0,
              width: 20,
              background: "linear-gradient(to right, var(--surface-page), transparent)",
              opacity: canLeft ? 1 : 0,
              transition: "opacity .15s ease",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              bottom: 16,
              right: 0,
              width: 20,
              background: "linear-gradient(to left, var(--surface-page), transparent)",
              opacity: canRight ? 1 : 0,
              transition: "opacity .15s ease",
              pointerEvents: "none",
            }}
          />

          {canLeft && (
            <button
              type="button"
              className="day-marquee-nudge"
              aria-label="Show earlier days"
              onMouseDown={() => startHold(-1)}
              onMouseUp={clearHold}
              onMouseLeave={clearHold}
              style={navButtonStyle("left")}
            >
              ‹
            </button>
          )}
          {canRight && (
            <button
              type="button"
              className="day-marquee-nudge"
              aria-label="Show later days"
              onMouseDown={() => startHold(1)}
              onMouseUp={clearHold}
              onMouseLeave={clearHold}
              style={navButtonStyle("right")}
            >
              ›
            </button>
          )}
        </div>

        <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", padding: "18px 16px 24px", minHeight: 420 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 44, flex: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {timelineItems.map((b) => (
                <div key={b.id} className="mono-data-sm" style={{ color: "var(--text-faint)", height: blockHeight(b) }}>
                  {clock(b.start)}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {timelineItems.map((b) => (
                <div key={b.id} style={{ minHeight: blockHeight(b) }}>
                  <TimeBlock block={b} onOpen={b.type === "contested" || b.type === "locked" ? () => navigate(`/trips/${trip.id}/compare`) : undefined} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "var(--surface-inverse)", padding: "12px 16px 40px", flex: "none" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="mono-caption" style={{ color: "rgba(255,255,255,.5)" }}>Tray · {unplacedPins.length} unplaced</span>
          {!trayFilterIsDefault && dayRegions.length > 0 && (
            <button type="button" onClick={() => setTrayFilter(dayRegions)} style={{ font: "500 11px var(--font-sans)", color: "rgba(255,255,255,.7)" }}>
              reset filter
            </button>
          )}
        </div>

        {allTripRegions.length > 1 && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 9 }}>
            {["All", ...allTripRegions].map((r) => {
              const selected = r === "All" ? trayFilter.length === 0 : trayFilter.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => (r === "All" ? setTrayFilter([]) : toggleTrayRegion(r))}
                  style={{
                    flex: "none",
                    padding: "5px 11px",
                    borderRadius: 999,
                    font: "500 11.5px var(--font-sans)",
                    background: selected ? "#fff" : "rgba(255,255,255,.08)",
                    color: selected ? "var(--surface-inverse)" : "rgba(255,255,255,.7)",
                    border: selected ? "none" : "1px solid rgba(255,255,255,.22)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 10 }}>
          {unplacedPins.length ? (
            unplacedPins.map((pin) => (
              <div key={pin.id} style={{ width: 96, flex: "none" }}>
                <PhotoPlaceholder height={54} radius={11} dark label="" style={{ background: "var(--ink-700)" }} />
                <div style={{ font: "600 10.5px var(--font-sans)", color: "var(--text-on-dark)", marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pin.title}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-on-dark-muted)", marginTop: 1 }}>{pin.dur}m</div>
              </div>
            ))
          ) : (
            <div className="mono-data-sm" style={{ color: "var(--text-on-dark-muted)", padding: "6px 0" }}>
              No unplaced pins {trayFilter.length ? "for this filter" : "left"}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function navButtonStyle(edge) {
  return {
    position: "absolute",
    top: "50%",
    [edge]: 2,
    transform: "translateY(-50%)",
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "var(--surface-card)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-raised)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "400 13px var(--font-sans)",
    color: "var(--text-primary)",
    zIndex: 3,
  };
}

function blockHeight(b) {
  if (b.type === "empty") return 52;
  if (!b.end) return 60;
  return Math.max(48, Math.round(((b.end - b.start) / 75) * 48));
}

function clock(m) {
  if (m == null) return "";
  const t = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
