import { useMemo } from "react";
import { usePlannerState } from "../../state/PlannerContext";
import { tripPlaceNames } from "../../lib/tripPlaces";

/**
 * The trip's places, for region and place pickers and matching: every
 * region an idea is in, then every place set on a day (lib/tripPlaces.js).
 * A place drops out once no idea and no day uses it.
 */
export function useKnownRegions() {
  const { pins, dayPlaces } = usePlannerState();
  return useMemo(() => tripPlaceNames(pins, dayPlaces), [pins, dayPlaces]);
}
