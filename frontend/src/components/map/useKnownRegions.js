import { useMemo } from "react";
import { usePlannerState } from "../../state/PlannerContext";
import { regionKey } from "../../lib/regions";

/**
 * The trip's regions, for region pickers and matching: every region an
 * idea is in, every region the trip has placed on the map, and the names
 * in the trip's own location line. One spelling per region (the first
 * seen), in that order.
 */
export function useKnownRegions() {
  const { pins, regions, trip } = usePlannerState();
  return useMemo(() => {
    const names = [
      ...Object.values(pins).map((p) => p.region),
      ...Object.values(regions ?? {}).map((r) => r.name),
      ...(trip?.regionLine ?? "").split("·"),
    ];
    const byKey = new Map();
    names.forEach((name) => {
      const key = regionKey(name);
      if (key && !byKey.has(key)) byKey.set(key, name.trim());
    });
    return [...byKey.values()];
  }, [pins, regions, trip?.regionLine]);
}
