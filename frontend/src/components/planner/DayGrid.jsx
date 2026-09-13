import { forwardRef } from "react";
import { clockLabel } from "../../lib/planTime";
import { DAY_END_MIN, DAY_START_MIN, GRID_HEIGHT, GUTTER_W, topForMinute } from "../../lib/dayGrid";

// The hour rail and the ruled surface beside it — the calendar's frame,
// with nothing on it. pages/DaySchedule.jsx fills it with plan blocks;
// the proposal flow's hour picker fills it with desaturated copies of the
// same blocks plus a selection rectangle. One frame, so the two screens
// can't drift a pixel apart.
//
// The ref lands on the ruled surface, not the outer row: every screen
// using this converts a pointer's clientY into a minute against that
// surface's own top edge.
const DayGrid = forwardRef(function DayGrid(
  { highlightFrom = null, highlightTo = null, cursor, children, onClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, surfaceStyle },
  ref
) {
  const hourMarks = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hourMarks.push(m);

  const inHighlight = (minute) =>
    highlightFrom != null && highlightTo != null && minute >= highlightFrom && minute < highlightTo;

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ width: GUTTER_W, flex: "none", position: "relative", height: GRID_HEIGHT }}>
        {hourMarks.map((m) => (
          <div
            key={m}
            className="mono-data-sm"
            style={{
              position: "absolute",
              top: topForMinute(m) - 6,
              // Hours inside the claimed range take the accent, so the
              // rail says how far the selection reaches without needing to
              // read the pill.
              color: inHighlight(m) ? "var(--accent)" : "var(--text-faint)",
            }}
          >
            {clockLabel(m)}
          </div>
        ))}
      </div>
      <div
        ref={ref}
        style={{
          flex: 1,
          minWidth: 0,
          position: "relative",
          height: GRID_HEIGHT,
          borderLeft: "1px solid var(--hairline)",
          cursor,
          ...surfaceStyle,
        }}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {hourMarks.map((m) => (
          <div
            key={m}
            aria-hidden="true"
            style={{ position: "absolute", top: topForMinute(m), left: 0, right: 0, borderTop: "1px solid var(--hairline)" }}
          />
        ))}
        {children}
      </div>
    </div>
  );
});

export default DayGrid;
