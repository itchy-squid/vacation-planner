import { useEffect, useMemo, useRef, useState } from "react";
import { usePlannerState, usePlannerDispatch, useCan } from "../../state/PlannerContext";
import { isMapsConfigured } from "../../lib/googleMaps";
import { geocodeRegion, regionKey } from "../../lib/regions";

// Regions this page load has already asked the server to store, so two
// screens finding the same region don't both save it.
const saving = new Set();

/**
 * Where each of `names` is: region key -> { key, name, lat, lng, south,
 * west, north, east }. Regions the trip has stored come straight from
 * state; the rest are looked up on Google. Names that can't be found are
 * left out.
 *
 * With `save`, a region that was looked up is stored for the trip (for
 * people who can add ideas), so nobody has to look it up again. Leave it
 * off for names still being typed, which would store every half-word.
 * Pass a memoised `names` array.
 */
export function useRegionLocations(names, { save = false } = {}) {
  const { trip, regions } = usePlannerState();
  const dispatch = usePlannerDispatch();
  const can = useCan();
  const canSave = save && can("ideas:add");
  const [found, setFound] = useState({});
  const asked = useRef(new Set());
  // Lookups outlive re-renders (storing one region changes `regions`), so
  // only unmounting should stop their answers landing.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const wanted = useMemo(() => [...new Map(names.filter((n) => regionKey(n)).map((n) => [regionKey(n), n.trim()])).values()], [names]);

  useEffect(() => {
    if (!isMapsConfigured) return;
    wanted.forEach((name) => {
      const key = regionKey(name);
      if (regions[key] || asked.current.has(key)) return;
      asked.current.add(key);
      geocodeRegion(name).then((region) => {
        if (!mounted.current || !region) return;
        setFound((current) => ({ ...current, [key]: { ...region, key } }));
        if (canSave && !saving.has(`${trip.id}|${key}`)) {
          saving.add(`${trip.id}|${key}`);
          dispatch({ type: "SAVE_REGION", region });
        }
      });
    });
  }, [wanted, regions, canSave, dispatch, trip.id]);

  return useMemo(() => {
    const out = {};
    wanted.forEach((name) => {
      const key = regionKey(name);
      const region = regions[key] ?? found[key];
      if (region) out[key] = region;
    });
    return out;
  }, [wanted, regions, found]);
}
