import { useEffect, useMemo, useState } from "react";
import { useRegionLocations } from "./useRegionLocations";
import { regionKey } from "../../lib/regions";

// A typed region is looked up once the typing pauses.
const LOOKUP_DELAY_MS = 600;

function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Where the region being picked on a form is (components/forms/
 * RegionPicker.jsx), for the "On the map" preview (components/map/
 * WhereOnMap.jsx). One of the trip's regions is looked up straight away;
 * anything typed waits until the typing pauses, and is never stored until
 * the form is saved (a half-typed name would otherwise become a region).
 *
 *   chosenChip  the trip region `region` names (its spelling), or null
 *   location    { key, name, lat, lng, south, west, north, east, id? } or
 *               null; `id` is set when the trip has already stored it
 *   lookingUp   a typed name is waiting to be looked up
 */
export function useRegionPreview(region, knownRegions) {
  const knownByKey = useMemo(() => Object.fromEntries(knownRegions.map((r) => [regionKey(r), r])), [knownRegions]);
  const chosenChip = knownByKey[regionKey(region)] ?? null;
  const settled = useDebounced(region, chosenChip ? 0 : LOOKUP_DELAY_MS);
  const names = useMemo(() => (settled.trim() ? [settled] : []), [settled]);
  const locations = useRegionLocations(names);
  const current = regionKey(settled) === regionKey(region);
  return {
    chosenChip,
    knownByKey,
    location: current ? locations[regionKey(region)] ?? null : null,
    lookingUp: Boolean(region.trim()) && !current,
  };
}
