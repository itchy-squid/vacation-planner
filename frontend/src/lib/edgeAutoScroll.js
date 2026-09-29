// Scrolling a grid while something is being dragged along it. On a phone
// the day grid is far taller than the screen, and a finger holding a
// selection's handle can't also scroll — so holding the handle near the
// top or bottom of the scrolling pane scrolls it, faster the closer to the
// edge, the way a calendar app does. Pure pieces here; the loop that runs
// them lives with the drag (components/planner/WindowSelection.jsx).

// How far in from the pane's edge (px) the scrolling starts, and the most
// it moves per animation frame, reached at the edge itself.
export const EDGE_ZONE_PX = 56;
export const MAX_STEP_PX = 16;

// Pixels to scroll this frame for a pointer at `clientY` over a pane whose
// visible part runs from `top` to `bottom` (client coordinates): negative
// scrolls up, positive down, 0 outside the edge zones. A pointer dragged
// past the edge counts as at the edge.
export function edgeScrollStep(clientY, top, bottom) {
  const zone = Math.min(EDGE_ZONE_PX, (bottom - top) / 3);
  if (zone <= 0) return 0;
  const intoTop = top + zone - clientY;
  if (intoTop > 0) return -Math.ceil(MAX_STEP_PX * Math.min(1, intoTop / zone));
  const intoBottom = clientY - (bottom - zone);
  if (intoBottom > 0) return Math.ceil(MAX_STEP_PX * Math.min(1, intoBottom / zone));
  return 0;
}

// The nearest ancestor of `el` that scrolls vertically, or null.
export function scrollParentOf(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}
