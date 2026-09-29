import { useMemo } from "react";
import { usePlannerState } from "../../state/PlannerContext";
import { useKnownRegions } from "../map/useKnownRegions";
import { regionKey } from "../../lib/regions";

/**
 * The places a day can be set to: the trip's regions (useKnownRegions),
 * then any place already set on a day that no idea uses yet. One spelling
 * per place.
 */
export function usePlaceChoices() {
  const knownRegions = useKnownRegions();
  const { dayPlaces } = usePlannerState();
  return useMemo(() => {
    const byKey = new Map(knownRegions.map((name) => [regionKey(name), name]));
    Object.values(dayPlaces).forEach((day) =>
      [day.stay, ...day.visits].filter(Boolean).forEach((name) => {
        if (!byKey.has(regionKey(name))) byKey.set(regionKey(name), name);
      })
    );
    return [...byKey.values()];
  }, [knownRegions, dayPlaces]);
}
