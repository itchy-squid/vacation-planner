import { useMemo, useRef, useState } from "react";
import DayGrid from "./DayGrid";
import { clockLabel } from "../../lib/planTime";
import { fmtMin } from "../../data/derive";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  clampToDay,
  layoutDayPlans,
  minuteFromOffsetY,
  overlaps,
  snapToGrid,
  splitLanes,
  topForMinute,
} from "../../lib/dayGrid";
import { branchName } from "../../lib/splits";
import { claimBounds, clipFromAnchor, scopeForAnchor } from "../../lib/windowClaim";

// Step 2 of the proposal flow: drag over the hours your plan should
// replace. Renders the real calendar grid (components/planner/DayGrid.jsx)
// with the day's existing plans desaturated underneath and a selection
// rectangle over the top — the plans stay visible and are never deleted
// here; claiming hours is a proposal, not an edit.
//
// Where the group has split up, the split's hours are drawn as one lane
// per group, and a claim is for one audience (lib/windowClaim.js): start
// the drag in a group's split hours and the block is for that group
// (`branchId`), start it anywhere else and it's for everyone. Either way
// the drag clips at the edge of what that audience can claim, and only at
// its own pinned plans — another group's plans never stand in the way.
// `onChange(selection, branchId)` reports both.
//
// One rule is load-bearing enough to state twice: a selection may not
// contain a locked plan, and clips at one. A locked plan is a pinned hour
// (the ferry, the handoff's gangway times), and the whole "stops pack end
// to end inside the block" guarantee depends on there being nothing
// immovable in the middle of the window (feature spec §6.5).
export default function WindowSelection({
  dayEntries,
  daySplits,
  branchId,
  myTravelerId,
  travelers,
  selection,
  onChange,
  contestWindows,
}) {
  const surfaceRef = useRef(null);
  const dragRef = useRef(null); // { anchorMin, mode: "new" | "start" | "end", branchId, bounds }
  const [dragging, setDragging] = useState(false);

  const lanes = useMemo(() => splitLanes(daySplits), [daySplits]);
  const laidOut = useMemo(() => layoutDayPlans(dayEntries, lanes), [dayEntries, lanes]);
  const scopeLane = branchId != null ? lanes.find((l) => l.branch.id === branchId) : null;

  function minuteAt(clientY) {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return DAY_START_MIN;
    return clampToDay(snapToGrid(minuteFromOffsetY(clientY - rect.top)));
  }

  function beginDrag(e, mode) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const minute = minuteAt(e.clientY);
    const anchor = mode === "start" ? selection.endMin : mode === "end" ? selection.startMin : minute;
    // A fresh drag picks its audience from where it starts; moving an edge
    // of the selection keeps the audience it already has.
    const scope = mode === "new" ? scopeForAnchor(daySplits, minute, branchId, myTravelerId) : branchId;
    const bounds = claimBounds(dayEntries, daySplits, scope);
    dragRef.current = { anchorMin: anchor, mode, branchId: scope, bounds };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (mode === "new") onChange(clipFromAnchor(anchor, minute, bounds), scope);
  }

  function moveDrag(e) {
    const info = dragRef.current;
    if (!info) return;
    e.preventDefault();
    onChange(clipFromAnchor(info.anchorMin, minuteAt(e.clientY), info.bounds), info.branchId);
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
      {/* Each group's lane over its split's hours, named, with the lane
          this block is for picked out. */}
      {lanes.map((lane) => {
        const inScope = lane.branch.id === branchId;
        return (
          <div
            key={`lane-${lane.branch.id}`}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: topForMinute(Math.max(lane.startMin, DAY_START_MIN)),
              height: Math.min(lane.endMin, DAY_END_MIN) - Math.max(lane.startMin, DAY_START_MIN),
              left: `${lane.left * 100}%`,
              width: `${lane.width * 100}%`,
              borderLeft: lane.left > 0 ? "1px dashed var(--border-strong)" : undefined,
              borderTop: "1.5px dashed var(--border-strong)",
              borderBottom: "1.5px dashed var(--border-strong)",
              background: inScope ? "transparent" : "var(--surface-sunken)",
              boxSizing: "border-box",
              pointerEvents: "none",
            }}
          >
            <span
              className="mono-data-sm"
              style={{
                position: "absolute",
                left: 6,
                bottom: 4,
                color: inScope ? "var(--accent)" : "var(--text-faint)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "calc(100% - 12px)",
              }}
            >
              {branchName(lane.branch, travelers)}
            </span>
          </div>
        );
      })}

      {laidOut.map((entry) => {
        const { plan, startMin, endMin, continuesBefore, continuesAfter } = entry;
        const isLocked = plan.status === "locked";
        // Plans for someone else — another group, or everyone while this
        // block is for one group — can't be touched by this claim, so they
        // fade further back.
        const inScope = (plan.branchId ?? null) === (branchId ?? null);
        const inside = inScope && hasSelection && overlaps(startMin, endMin, selection.startMin, selection.endMin);
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
              left: `calc(${entry.left * 100}% + 2px)`,
              width: `calc(${entry.width * 100}% - 4px)`,
              borderRadius: "var(--radius-md)",
              borderTopLeftRadius: continuesBefore ? 0 : undefined,
              borderTopRightRadius: continuesBefore ? 0 : undefined,
              borderBottomLeftRadius: continuesAfter ? 0 : undefined,
              borderBottomRightRadius: continuesAfter ? 0 : undefined,
              // Desaturated, not hidden: these are what the proposal would
              // replace, and you can't judge a claim without seeing them.
              background: "var(--surface-sunken)",
              borderLeft: `3px solid ${isLocked ? "var(--text-faint)" : "var(--stone-300)"}`,
              opacity: inScope ? 1 : 0.45,
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
                {isLocked && inScope ? "Pinned" : inside ? "Inside selection" : `${clockLabel(startMin)}–${clockLabel(endMin)}`}
              </div>
            )}
          </div>
        );
      })}

      {/* Hours already out for a vote — this audience's votes only, so in
          this block's lane. Shown so a drag that has to be refused looks
          refusable before it's attempted. */}
      {contestWindows.map((w) => (
        <div
          key={w.contestId}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: topForMinute(w.startMin),
            height: w.endMin - w.startMin,
            left: scopeLane ? `${scopeLane.left * 100}%` : 0,
            width: scopeLane ? `${scopeLane.width * 100}%` : "100%",
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
            // A block for one group covers that group's lane, not the
            // whole day's width: the other groups' hours aren't claimed.
            left: scopeLane ? `${scopeLane.left * 100}%` : 0,
            width: scopeLane ? `${scopeLane.width * 100}%` : "100%",
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

