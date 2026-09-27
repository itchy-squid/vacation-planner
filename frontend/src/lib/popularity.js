import { useCallback, useState } from "react";

// Ordering ideas by how many people have hearted them (backend/app/
// models.py PinHeart), for the two places a pin gets picked: the "+ Add"
// sheet's list of unplaced pins (components/planner/AddSheet.jsx) and the
// propose screen's "Pull in" chips (pages/ProposeBlock.jsx).
//
// "Suggested" is each screen's own order, unchanged — the day's regions
// first, and so on. "Most hearted" re-sorts that by heart count, and
// because the sort is stable, pins with the same count keep their
// suggested order. Anything that can't be hearted (a custom event) counts
// as none, so it sinks below every hearted pin but isn't hidden.

export const PIN_ORDERS = [
  { value: "suggested", label: "Suggested" },
  { value: "hearts", label: "Most hearted" },
];

const DEFAULT_ORDER = "suggested";
const STORAGE_KEY = "vacationPlanner:pinOrder";

export function heartCount(pin) {
  return pin?.heartedBy?.length ?? 0;
}

// `countOf` reads the count off whatever the list holds: pins by default,
// or a screen's own option objects.
export function inPinOrder(list, order, countOf = heartCount) {
  if (order !== "hearts") return list;
  return [...list].sort((a, b) => countOf(b) - countOf(a));
}

// " · ♥ 3" for a row's meta line, nothing for an idea nobody has hearted.
export function heartsSuffix(count) {
  return count > 0 ? ` · ♥ ${count}` : "";
}

// Which order the viewer picked last, remembered per browser and shared by
// both screens, so choosing "Most hearted" once sticks. A per-person view
// preference, not trip data, so it lives in localStorage like the last-
// opened trip (state/PlannerContext.jsx); storage can throw (private
// browsing), in which case it just doesn't remember.
export function usePinOrder() {
  const [order, setOrderState] = useState(readOrder);
  const setOrder = useCallback((next) => {
    setOrderState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable — the choice lasts until the screen closes
    }
  }, []);
  return [order, setOrder];
}

function readOrder() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return PIN_ORDERS.some((o) => o.value === stored) ? stored : DEFAULT_ORDER;
  } catch {
    return DEFAULT_ORDER;
  }
}
