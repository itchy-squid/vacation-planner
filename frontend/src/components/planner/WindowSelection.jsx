import { useRef, useState } from "react";
import DayGrid from "./DayGrid";
import { clockLabel } from "../../lib/planTime";
import { fmtMin } from "../../data/derive";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  clampToDay,
  minuteFromOffsetY,
  overlaps,
  snapToGrid,
  topForMinute,
} from "../../lib/dayGrid";

// Step 2 of the proposal flow: drag over the hours your plan should
// replace. Renders the real calendar grid (components/planner/DayGrid.jsx)
// with the day's existing plans desaturated underneath and a selection
// rectangle over the top — the plans stay visible and are never deleted
// here; claiming hours is a proposal, not an edit.
//
// One rule is load-bearing enough to state twice: a selection may not
// contain a locked plan, and clips at one. A locked plan is a pinned hour
// (the ferry, the handoff's gangway times), and the whole "stops pack end
// to end inside the block" guarantee depends on there being nothing
// immovable in the middle of the window (feature spec §6.5).
export default function WindowSelection({ dayEntries, selection, onChange, contestWindows }) {
  const surfaceRef = useRef(null);
  const dragRef = useRef(null); // { anchorMin, mode: "new" | "start" | "end" }
  const [dragging, setDragging] = useState(false);

  // Day entries, so a locked crossing that began last night still clips a
  // selection drawn over this morning (feature spec §6.5). Its span here
  // can start before 00:00; clipFromAnchor only cares where it ends.
  const lockedSpans = dayEntries
    .filter((e) => e.plan.status === "locked")
    .map((e) => ({ start: e.startMin, end: e.endMin }))
    .sort((a, b) => a.start - b.start);

  function minuteAt(clientY) {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return DAY_START_MIN;
    return clampToDay(snapToGrid(minuteFromOffsetY(clientY - rect.top)));
  }

  // Grow from `anchor` towards `moving`, stopping at the first pinned span
  // in the way. Clipping rather than refusing is what makes the drag feel
  // like the grid is holding the edge for you.
  function clipFromAnchor(anchor, moving) {
    let lo = Math.min(anchor, moving);
    let hi = Math.max(anchor, moving);
    for (const span of lockedSpans) {
      if (!overlaps(lo, hi, span.start, span.end)) continue;
      if (span.start >= anchor) hi = Math.min(hi, span.start);
      else lo = Math.max(lo, span.end);
    }
    return { startMin: lo, endMin: hi };
  }

  function beginDrag(e, mode) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const minute = minuteAt(e.clientY);
    const anchor =
      mode === "start" ? selection.endMin : mode === "end" ? selection.startMin : minute;
    dragRef.current = { anchorMin: anchor, mode };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (mode === "new") onChange(clipFromAnchor(anchor, minute));
  }

  function moveDrag(e) {
    const info = dragRef.current;
    if (!info) return;
    e.preventDefault();
    onChange(clipFromAnchor(info.anchorMin, minuteAt(e.clientY)));
  }

  function endDrag(e) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  const hasSelection = selection && selection.endMin > selection.startMin;
  const selectionMinutes = hasSelection ? selection.endMin - selection.startMin : 0;

  return (
    <DayGrid
      ref={surfaceRef}
      cursor={dragging ? "grabbing" : "crosshair"}
      highlightFrom={hasSelection ? selection.startMin : null}
      highlightTo={hasSelection ? selection.endMin : null}
      onPointerDown={(e) => beginDrag(e, "new")}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      surfaceStyle={{ touchAction: "none" }}
    >
      {dayEntries.map((entry) => {
        const { plan, startMin, endMin, continuesBefore, continuesAfter } = entry;
        const isLocked = plan.status === "locked";
        const inside = hasSelection && overlaps(startMin, endMin, selection.startMin, selection.endMin);
        // Clipped to the grid the same way pages/DaySchedule.jsx clips it,
        // so a crossing reads the same in both places.
        const top = Math.max(startMin, DAY_START_MIN);
        const bottom = Math.min(endMin, DAY_END_MIN);
        return (
          <div
            key={plan.id}
            style={{
              position: "absolute",
              top: topForMinute(top),
              height: Math.max(bottom - top, 20),
              left: 2,
              right: 2,
              borderRadius: "var(--radius-md)",
              borderTopLeftRadius: continuesBefore ? 0 : undefined,
              borderTopRightRadius: continuesBefore ? 0 : undefined,
              borderBottomLeftRadius: continuesAfter ? 0 : undefined,
              borderBottomRightRadius: continuesAfter ? 0 : undefined,
              // Desaturated, not hidden: these are what the proposal would
              // replace, and you can't judge a claim without seeing them.
              background: "var(--surface-sunken)",
              borderLeft: `3px solid ${isLocked ? "var(--text-faint)" : "var(--stone-300)"}`,
              padding: "6px 8px",
              overflow: "hidden",
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                font: "600 11.5px var(--font-sans)",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {plan.items.map((i) => i.title).join(" + ") || plan.label || "Untitled"}
            </div>
            {bottom - top >= 34 && (
              <div className="mono-data-sm" style={{ color: "var(--text-faint)", marginTop: 2 }}>
                {/* The real clock times, never the clipped ones — an
                    overnight crossing reads 22:00–10:00 on both days. */}
                {isLocked ? "Pinned" : inside ? "Inside selection" : `${clockLabel(startMin)}–${clockLabel(endMin)}`}
              </div>
            )}
          </div>
        );
      })}

      {/* Hours already out for a vote. Shown so a drag that has to be
          refused looks refusable before it's attempted. */}
      {contestWindows.map((w) => (
        <div
          key={w.contestId}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: topForMinute(w.startMin),
            height: w.endMin - w.startMin,
            left: 0,
            right: 0,
            borderTop: "1px dashed var(--accent)",
            borderBottom: "1px dashed var(--accent)",
            background: "var(--plum-tint)",
            pointerEvents: "none",
          }}
        />
      ))}

      {hasSelection && (
        <div
          style={{
            position: "absolute",
            top: topForMinute(selection.startMin),
            height: Math.max(selectionMinutes, 8),
            left: 0,
            right: 0,
            borderRadius: "var(--radius-md)",
            background: "var(--plum-tint-strong)",
            border: "2px dashed var(--accent)",
            boxSizing: "border-box",
          }}
        >
          {/* Anchored inside the selection's top-right so it never leaves
              the grid, even when the claim starts at 00:00. */}
          <div
            className="mono-data-sm"
            style={{
              position: "absolute",
              top: 10,
              right: 8,
              padding: "5px 12px",
              borderRadius: "var(--radius-xl)",
              background: "var(--accent)",
              color: "#fff",
              letterSpacing: ".08em",
              whiteSpace: "nowrap",
            }}
          >
            {clockLabel(selection.startMin)} – {clockLabel(selection.endMin)} · {fmtMin(selectionMinutes)}
          </div>

          <Handle
            position="start"
            onPointerDown={(e) => beginDrag(e, "start")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <Handle
            position="end"
            onPointerDown={(e) => beginDrag(e, "end")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      )}
    </DayGrid>
  );
}

function Handle({ position, ...handlers }) {
  const isStart = position === "start";
  return (
    <div
      role="slider"
      aria-label={isStart ? "Move the start of the claimed hours" : "Move the end of the claimed hours"}
      aria-valuemin={DAY_START_MIN}
      aria-valuemax={DAY_END_MIN}
      style={{
        position: "absolute",
        [isStart ? "top" : "bottom"]: -9,
        [isStart ? "left" : "right"]: -9,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "var(--surface-card)",
        border: "3px solid var(--accent)",
        cursor: "ns-resize",
        touchAction: "none",
      }}
      {...handlers}
    />
  );
}

