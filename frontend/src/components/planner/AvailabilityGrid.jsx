import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BANDS } from "../../data/pins";

// Sunday-starting week grid, where each row is a calendar week and each
// week's 7 columns are Sun..Sat — callers pass `days` from data/trip.js
// getTripDays(trip.startDate, trip.endDate), whose `weekday` field (0=Sun)
// is what lines a real trip day up under the right column. Cell states:
// works (teal tint), ruled out (hatch), placed (solid plum with a white
// dot); a user override rings the cell. Always explain the hatching with
// its reason — see "why" chips below the grid (design_system readme
// "Content fundamentals": "Explain restrictions, never just assert them").
//
// Long trips get a LOT of weeks (a month-long trip is ~5 of them), so
// past VISIBLE_WEEKS the week list becomes a vertical marquee: it caps to
// three weeks tall and scrolls, which on a touchscreen is just a normal
// swipe (native overflow-y + momentum scrolling) and on desktop is a
// hover-to-reveal pair of up/down nudge buttons that repeat-scroll while
// held (see the .week-marquee-nudge rules in styles/global.css).
const DOW_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const VISIBLE_WEEKS = 3;
const WEEK_GAP = 16;

// Pads `days` with leading/trailing `null`s so it lines up into whole
// Sunday-starting weeks — exactly like a month calendar grays out the
// days from adjacent months that share its first/last row — then chunks
// the result into rows of 7.
function splitIntoWeeks(days) {
  if (!days.length) return [];
  const cells = [];
  for (let i = 0; i < days[0].weekday; i++) cells.push(null);
  for (const d of days) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// "Oct 5–11" (same month) or "Oct 26–Nov 1" (crosses a month boundary) —
// read off whichever real trip days a week actually contains, ignoring
// its null padding.
function weekRangeLabel(week) {
  const real = week.filter(Boolean);
  if (!real.length) return "";
  const first = real[0];
  const last = real[real.length - 1];
  if (first === last) return `${first.month} ${first.n}`.trim();
  const tail = first.month === last.month ? `${last.n}` : `${last.month} ${last.n}`;
  return `${first.month} ${first.n}–${tail}`.trim();
}

function cellStyle({ placed, works }) {
  const base = {
    height: 26,
    borderRadius: 5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "600 11px var(--font-sans)",
    color: "#fff",
    cursor: "pointer",
    transition: "var(--transition-select)",
  };
  if (placed) {
    return { ...base, background: "var(--accent)", border: "1px solid var(--accent)" };
  }
  if (works) {
    return { ...base, background: "var(--teal-tint)", border: "1px solid var(--teal-line)" };
  }
  return {
    ...base,
    background: "var(--pattern-ruled-out)",
    border: "1px solid rgba(27,26,31,.06)",
  };
}

function navButtonStyle(edge) {
  return {
    position: "absolute",
    [edge]: 6,
    left: "50%",
    transform: "translateX(-50%)",
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "var(--surface-card)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-raised)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "400 12px var(--font-sans)",
    color: "var(--text-primary)",
    zIndex: 3,
  };
}

export default function AvailabilityGrid({ pinId, rule, overrides, placedDayBand, onToggle, days }) {
  const okBase = (day, band) => !rule || (rule.days?.includes(day) && rule.bands?.includes(band));

  let workingCount = 0;
  for (const d of days) {
    for (const band of BANDS) {
      const key = `${pinId}|${d.n}-${band}`;
      const works = overrides[key] ? !okBase(d.n, band) : okBase(d.n, band);
      if (works) workingCount += 1;
    }
  }

  const weeks = useMemo(() => splitIntoWeeks(days), [days]);
  const scrollable = weeks.length > VISIBLE_WEEKS;

  const scrollRef = useRef(null);
  const firstWeekRef = useRef(null);
  const holdRef = useRef({ timeout: null, interval: null });
  const [maxHeight, setMaxHeight] = useState(null);
  const [canUp, setCanUp] = useState(false);
  const [canDown, setCanDown] = useState(false);

  // Cap the scroll area to exactly VISIBLE_WEEKS weeks tall, measured off
  // the real rendered height of one week block rather than a guessed
  // pixel constant, so it stays right if the row's content (or its type
  // size) ever changes.
  useLayoutEffect(() => {
    if (!scrollable) {
      setMaxHeight(null);
      return;
    }
    const el = firstWeekRef.current;
    if (!el) return;
    const measure = () => setMaxHeight(el.offsetHeight * VISIBLE_WEEKS + WEEK_GAP * (VISIBLE_WEEKS - 1));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollable, weeks.length]);

  useEffect(() => {
    if (!scrollable) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;
    const updateScrollState = () => {
      setCanUp(el.scrollTop > 1);
      setCanDown(el.scrollTop < el.scrollHeight - el.clientHeight - 1);
    };
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [scrollable, maxHeight]);

  useEffect(() => clearHold, []);

  function clearHold() {
    clearTimeout(holdRef.current.timeout);
    clearInterval(holdRef.current.interval);
  }

  function nudge(direction) {
    const el = scrollRef.current;
    if (!el) return;
    const step = (firstWeekRef.current?.offsetHeight ?? 140) + WEEK_GAP;
    el.scrollBy({ top: direction * step, behavior: "smooth" });
  }

  // Press-and-hold repeat: an immediate one-week nudge on press, then —
  // if still held after a beat — repeating nudges until release. A quick
  // click just does the single nudge.
  function startHold(direction) {
    nudge(direction);
    clearHold();
    holdRef.current.timeout = setTimeout(() => {
      holdRef.current.interval = setInterval(() => nudge(direction), 260);
    }, 380);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="mono-caption">When this one can happen</span>
        <span className="mono-data-sm" style={{ color: "var(--accent)" }}>
          {workingCount} OF {days.length * BANDS.length} BLOCKS
        </span>
      </div>

      <div style={{ marginTop: 11, display: "flex", gap: 4 }}>
        <div style={{ width: 30, flex: "none" }} />
        {DOW_INITIALS.map((letter, i) => (
          <div key={i} className="mono-data-sm" style={{ flex: 1, minWidth: 0, textAlign: "center", color: "var(--text-faint)" }}>
            {letter}
          </div>
        ))}
      </div>

      <div className="week-marquee" style={{ position: "relative", marginTop: 6 }}>
        <div
          ref={scrollRef}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: WEEK_GAP,
            overflowY: scrollable ? "auto" : "visible",
            maxHeight: scrollable ? maxHeight ?? undefined : undefined,
            scrollSnapType: scrollable ? "y proximity" : undefined,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {weeks.map((week, wi) => (
            <div
              key={wi}
              ref={wi === 0 ? firstWeekRef : undefined}
              style={{ flex: "none", scrollSnapAlign: scrollable ? "start" : undefined }}
            >
              <div className="mono-data-sm" style={{ color: "var(--text-faint)", marginBottom: 5 }}>
                {weekRangeLabel(week)}
              </div>

              <div style={{ display: "flex", gap: 4 }}>
                <div style={{ width: 30, flex: "none" }} />
                {week.map((d, di) => (
                  <div key={di} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                    {d ? <div style={{ font: "600 10px var(--font-sans)", color: "var(--text-secondary)" }}>{d.n}</div> : null}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 4 }}>
                {BANDS.map((band) => (
                  <div key={band} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <div className="mono-data-sm" style={{ width: 30, flex: "none", color: "var(--text-faint)" }}>{band}</div>
                    {week.map((d, di) => {
                      if (!d) return <div key={di} style={{ flex: 1, minWidth: 0, height: 26 }} />;
                      const key = `${pinId}|${d.n}-${band}`;
                      const overridden = Boolean(overrides[key]);
                      const works = overridden ? !okBase(d.n, band) : okBase(d.n, band);
                      const placed = placedDayBand === `${d.n}-${band}` && works;
                      return (
                        <div
                          key={key}
                          onClick={() => onToggle(d.n, band)}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            boxShadow: overridden ? "0 0 0 1.5px rgba(143,68,120,.55)" : "none",
                            borderRadius: 5,
                          }}
                        >
                          <div style={cellStyle({ placed, works })}>{placed ? "•" : ""}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {scrollable && (
          <>
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 18,
                borderRadius: "8px 8px 0 0",
                background: "linear-gradient(var(--surface-card), transparent)",
                opacity: canUp ? 1 : 0,
                transition: "opacity .15s ease",
                pointerEvents: "none",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: 18,
                borderRadius: "0 0 8px 8px",
                background: "linear-gradient(transparent, var(--surface-card))",
                opacity: canDown ? 1 : 0,
                transition: "opacity .15s ease",
                pointerEvents: "none",
              }}
            />

            {canUp && (
              <button
                type="button"
                className="week-marquee-nudge"
                aria-label="Show earlier weeks"
                onMouseDown={() => startHold(-1)}
                onMouseUp={clearHold}
                onMouseLeave={clearHold}
                style={navButtonStyle("top")}
              >
                ▲
              </button>
            )}
            {canDown && (
              <button
                type="button"
                className="week-marquee-nudge"
                aria-label="Show later weeks"
                onMouseDown={() => startHold(1)}
                onMouseUp={clearHold}
                onMouseLeave={clearHold}
                style={navButtonStyle("bottom")}
              >
                ▼
              </button>
            )}
          </>
        )}
      </div>

      {scrollable && (
        <div className="mono-caption" style={{ marginTop: 8, fontFamily: "var(--font-sans)", textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
          {weeks.length} weeks — swipe up or down to see them all
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Legend swatch="var(--accent)" label="placed" />
        <Legend swatch="var(--teal-tint)" border="var(--teal-line)" label="works" />
        <Legend swatch="var(--pattern-ruled-out)" label="ruled out" />
      </div>

      {rule?.why?.length ? (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: "1px solid var(--hairline)", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {rule.why.map((w) => (
            <div key={w} style={{ padding: "5px 9px", borderRadius: 7, background: "var(--surface-page)", font: "400 10.5px var(--font-sans)", color: "var(--text-secondary)" }}>
              {w}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mono-caption" style={{ marginTop: 9, fontFamily: "var(--font-sans)", textTransform: "none", letterSpacing: 0, lineHeight: 1.5, color: "var(--text-muted)" }}>
        Tap a square to override. Only squares that work show up as options when the group compares sets.
      </div>
    </div>
  );
}

function Legend({ swatch, border, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 11, height: 11, borderRadius: 3, background: swatch, border: border ? `1px solid ${border}` : undefined }} />
      <span style={{ font: "400 9.5px var(--font-sans)", color: "var(--text-secondary)" }}>{label}</span>
    </div>
  );
}
