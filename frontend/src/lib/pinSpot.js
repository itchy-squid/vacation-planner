// Whether ideas have an exact spot on the map (a lat and lng), which is what
// the pin mark shows (components/core/PinMark.jsx).

export function hasSpot(pin) {
  return pin != null && pin.lat != null && pin.lng != null;
}

/**
 * For a plan on the calendar: "spot" when every idea in it has a spot,
 * "none" when any doesn't, null when it has no ideas (a ride, a custom
 * event), which gets no mark.
 */
export function planSpot(plan, pins) {
  const ideas = (plan.items ?? []).filter((it) => it.pinId != null && pins[it.pinId]);
  if (!ideas.length) return null;
  return ideas.every((it) => hasSpot(pins[it.pinId])) ? "spot" : "none";
}
