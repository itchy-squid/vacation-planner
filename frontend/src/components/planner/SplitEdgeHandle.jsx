import { useRef } from "react";
import { DRAG_THRESHOLD_PX, PX_PER_MIN, topForMinute } from "../../lib/dayGrid";
import { clockLabel } from "../../lib/planTime";

// The grip on one edge of a split's outline on the day grid
// (pages/DaySchedule.jsx) — drag it and the split starts or ends at a
// different time, the way dragging a block moves a plan.
//
// This owns only the gesture: it reports how far the edge has been
// dragged, in minutes, and leaves snapping, clamping, checking and saving
// to the page, which knows about the rest of the day. A plain tap does
// nothing (and doesn't fall through to the grid, where it would place).
//
// The outline is drawn 3px outside the split's hours, so the grip sits on
// that line rather than on the hour itself — at the left, clear of the
// split's caption (top right) and of the line between two lanes (centre).
const OUTLINE_OFFSET_PX = 3;
const HIT_HEIGHT_PX = 18;

export default function SplitEdgeHandle({ edge, minute, active = false, onDrag, onDrop, onCancel }) {
  const gesture = useRef(null); // { pointerId, startClientY, moved }

  const deltaMinutes = (e) => (e.clientY - gesture.current.startClientY) / PX_PER_MIN;

  function handlePointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointerId: e.pointerId, startClientY: e.clientY, moved: false };
  }

  function handlePointerMove(e) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (!g.moved && Math.abs(e.clientY - g.startClientY) < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    e.preventDefault();
    onDrag(deltaMinutes(e));
  }

  function handlePointerUp(e) {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const delta = deltaMinutes(e);
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (g.moved) onDrop(delta);
  }

  function handlePointerCancel(e) {
    if (gesture.current?.pointerId !== e.pointerId) return;
    gesture.current = null;
    onCancel();
  }

  const lineY = topForMinute(minute) + (edge === "start" ? -OUTLINE_OFFSET_PX : OUTLINE_OFFSET_PX);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Split ${edge === "start" ? "starts" : "ends"} ${clockLabel(minute)}. Drag to change.`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: lineY - HIT_HEIGHT_PX / 2,
        height: HIT_HEIGHT_PX,
        left: 8,
        width: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "ns-resize",
        touchAction: "none",
        zIndex: 2,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 6,
          borderRadius: 99,
          background: active ? "var(--accent)" : "var(--border-strong)",
          boxShadow: "0 0 0 2px var(--surface-card)",
        }}
      />
    </div>
  );
}
