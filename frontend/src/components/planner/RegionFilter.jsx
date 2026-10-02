import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import Chip from "../core/Chip";

export const ALL_REGIONS = "All";

// The Ideas board's region filter (pages/PinBoard.jsx). A row of chips
// while they fit on one line; once they don't — many regions, or a few
// long ones — a single "Region: …" button that opens a sheet listing every
// region with its pin count. A scrolling chip row hid the overflow with no
// cue that it scrolled, and a mouse wheel can't scroll it sideways at all.
//
// "Fit" is measured, not guessed from a region count or name length: an
// invisible copy of the chip row is always rendered and compared with the
// room the real row has, so the switch follows fonts, the viewport and
// the actual labels. The copy stays mounted in picker mode too, so it can
// switch back (a trip's regions shrink, or the window grows) without
// flickering between the two.
//
//   regions: [{ name, count }]   sorted as they should appear
//   total:   pin count for "All"
export default function RegionFilter({ regions, total, value, onChange }) {
  const rowRef = useRef(null);
  const measureRef = useRef(null);
  const [fits, setFits] = useState(true);
  const [picking, setPicking] = useState(false);

  const options = [{ name: ALL_REGIONS, count: total }, ...regions];

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return undefined;
    const check = () => {
      const style = window.getComputedStyle(row);
      const room = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setFits(measure.scrollWidth <= room);
    };
    check();
    // Watching the copy as well as the row catches label changes and
    // late-loading fonts, which resize the copy but not the row.
    const observer = new ResizeObserver(check);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  }, []);

  const choose = (name) => {
    onChange(name);
    setPicking(false);
  };

  return (
    <>
      <div ref={rowRef} style={{ position: "relative", padding: "0 var(--gutter-screen) 16px" }}>
        {/* The copy is wider than the screen exactly when it matters, and
            even hidden it still counts toward the scroll width of
            .screen-scroll — which let a board with many regions be swiped
            sideways into blank space on a phone. This zero-height clip
            box keeps it out of the layout; its own scrollWidth is
            unaffected. */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 0, overflow: "hidden", visibility: "hidden", pointerEvents: "none" }}>
          <div
            ref={measureRef}
            aria-hidden="true"
            style={{ display: "flex", gap: 8, width: "max-content" }}
          >
            {options.map((o) => (
              <Chip key={o.name} label={o.name} selected={o.name === value} />
            ))}
          </div>
        </div>

        {fits ? (
          <div role="group" aria-label="Filter by region" style={{ display: "flex", gap: 8 }}>
            {options.map((o) => (
              <Chip key={o.name} label={o.name} selected={o.name === value} onClick={() => onChange(o.name)} />
            ))}
          </div>
        ) : (
          <RegionButton value={value} onClick={() => setPicking(true)} />
        )}
      </div>

      {/* Outside the row: the row is position: relative (for the measuring
          copy), and the sheet has to be positioned against .app-viewport. */}
      {picking && !fits ? (
        <RegionSheet options={options} value={value} onChoose={choose} onClose={() => setPicking(false)} />
      ) : null}
    </>
  );
}

// Filled once a region is picked, like a selected chip, so a filtered
// board reads as filtered at a glance.
function RegionButton({ value, onClick }) {
  const filtered = value !== ALL_REGIONS;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        maxWidth: "100%",
        padding: "6px 12px",
        borderRadius: "var(--radius-pill)",
        font: "500 12px var(--font-sans)",
        background: filtered ? "var(--surface-inverse)" : "var(--surface-card)",
        color: filtered ? "#fff" : "var(--text-primary)",
        border: filtered ? "none" : "1px solid var(--border)",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Region: {value}</span>
      <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: 10, flex: "none" }} aria-hidden="true" />
    </button>
  );
}

// Absolute, not fixed, like the app's other sheets (components/planner/
// AddSheet.jsx): fixed would spill past the 430px .app-viewport column on
// a desktop-width window.
function RegionSheet({ options, value, onChoose, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(27,26,31,.32)", display: "flex", alignItems: "flex-end", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filter by region"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxHeight: "80%",
          background: "var(--surface-card)",
          borderRadius: "20px 20px 0 0",
          boxShadow: "var(--shadow-sheet)",
          padding: "10px 16px 30px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", alignSelf: "center" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 4px" }}>
          <div className="serif-place" style={{ font: "var(--type-heading)", color: "var(--text-primary)" }}>
            Filter by region
          </div>
          <button
            type="button"
            className="hit-target"
            onClick={onClose}
            style={{ height: 44, font: "500 13px var(--font-sans)", color: "var(--accent)", flex: "none" }}
          >
            Done
          </button>
        </div>

        <div role="radiogroup" aria-label="Region" style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {options.map((o) => {
            const selected = o.name === value;
            return (
              <button
                key={o.name}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChoose(o.name)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minHeight: "var(--hit-min)",
                  padding: "10px 4px",
                  textAlign: "left",
                  borderBottom: "1px solid var(--hairline)",
                  font: selected ? "600 14px var(--font-sans)" : "400 14px var(--font-sans)",
                  color: "var(--text-primary)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{o.name}</span>
                <span className="mono-caption" style={{ flex: "none" }}>
                  {o.count} {o.count === 1 ? "pin" : "pins"}
                </span>
                <span style={{ width: 14, flex: "none", color: "var(--accent)" }}>
                  {selected ? <FontAwesomeIcon icon={faCheck} aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
