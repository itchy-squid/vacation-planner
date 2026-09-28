import { useMemo, useState } from "react";
import PlaceSearchStep from "./PlaceSearchStep";
import { usePlaceSearch } from "./usePlaceSearch";
import { useKnownRegions } from "../map/useKnownRegions";
import { usePlannerState } from "../../state/PlannerContext";
import { regionKey } from "../../lib/regions";

/**
 * Finding an existing idea's place on Google Maps, for an idea added by
 * hand (or before place search) that Google does know. The same search
 * screen as adding a place, starting with the idea's title and preferring
 * results in its region. Used from the idea's screen (pages/EditVisit.jsx)
 * and the Map tab's region list (pages/TripMap.jsx).
 *
 *   pin              the idea: { id, title, region }
 *   onLink(result)   a lib/places.js result was picked
 *   onTapInstead()   none fit: place it by tapping the map instead
 *   onBack()
 */
export default function FindOnGoogle({ pin, onLink, onTapInstead, onBack }) {
  const { trip, pins, regions } = usePlannerState();
  const knownRegions = useKnownRegions();
  const region = regions[regionKey(pin.region)] ?? null;
  // Fixed for the life of this screen.
  const [bias] = useState(() => (region ? { south: region.south, west: region.west, north: region.north, east: region.east } : null));
  const search = usePlaceSearch({ initialQuery: pin.title, bias });

  // Other ideas already linked to a place, so a result that's one says so.
  const existingByPlaceId = useMemo(
    () => Object.fromEntries(Object.values(pins).filter((p) => p.googlePlaceId && p.id !== pin.id).map((p) => [p.googlePlaceId, p])),
    [pins, pin.id]
  );
  const link = useMemo(() => ({ ideaTitle: pin.title, region: pin.region, knownRegions }), [pin.title, pin.region, knownRegions]);

  return (
    <PlaceSearchStep
      trip={trip}
      search={search}
      existingByPlaceId={existingByPlaceId}
      onCancel={onBack}
      onPick={onLink}
      onOpenIdea={() => {}}
      onManual={onTapInstead}
      link={link}
    />
  );
}
