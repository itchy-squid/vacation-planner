// Which calendar events come from ideas on the board (pins), which is what
// the pin mark shows (components/core/PinMark.jsx), so they read apart from
// custom events and rides.

/** Whether any item in a plan is an idea from the board. */
export function planHasIdea(plan, pins) {
  return (plan.items ?? []).some((it) => it.pinId != null && pins[it.pinId] != null);
}
