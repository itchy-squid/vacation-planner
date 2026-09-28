import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePlannerState, usePlannerDispatch, useIdeaAccess } from "../state/PlannerContext";
import { isMapsConfigured } from "../lib/googleMaps";
import PlaceSearchStep from "../components/newpin/PlaceSearchStep";
import PlaceDetailsForm from "../components/newpin/PlaceDetailsForm";
import ByHandForm from "../components/newpin/ByHandForm";
import { usePlaceSearch } from "../components/newpin/usePlaceSearch";

// Adding a pin. Two ways in, as the project's "add a pin by search"
// mockup lays out:
//
//   search   The board's "+" lands here: a search box, the map on the top
//            half and results below (PlaceSearchStep). Picking a place
//            opens the new-pin form already filled in (PlaceDetailsForm),
//            and adding it goes back to the board with the new card
//            outlined.
//   link     Adding by hand (ByHandForm), for what Google Maps doesn't
//            list: a Viator tour, a friend's tip, an article. It goes on
//            the map in its region, or at an exact spot if one is pinned,
//            and also ends back on the board. It's the only way without a
//            Maps key.
//
// The step lives in component state rather than the URL, like the
// proposal flow (pages/ProposeBlock.jsx), so "‹ Search" from the form
// returns to the same results rather than a fresh, re-billed search.
//
// ?mode=link opens the link form (the empty board's "Paste a link");
// ?focus=title starts it in the title when there's no search to offer
// (the empty board's "Type a place" without a Maps key).
export default function NewPin() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const { pins, trip } = usePlannerState();
  const ideaAccess = useIdeaAccess();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState(() => (isMapsConfigured && searchParams.get("mode") !== "link" ? "search" : "link"));
  const [picked, setPicked] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const search = usePlaceSearch();

  const pinList = useMemo(() => Object.values(pins), [pins]);
  const knownRegions = useMemo(
    () => [...new Set([...pinList.map((p) => p.region), ...(trip.regionLine ?? "").split("·").map((r) => r.trim())].filter(Boolean))],
    [pinList, trip.regionLine]
  );
  // Ideas added through search, by the place they came from, so searching
  // for one again offers it instead of a duplicate.
  const existingByPlaceId = useMemo(
    () => Object.fromEntries(pinList.filter((p) => p.googlePlaceId).map((p) => [p.googlePlaceId, p])),
    [pinList]
  );

  const board = `/trips/${trip.id}/board`;
  const goTo = (next) => {
    setError(null);
    setStep(next);
  };

  async function create(payload, whenCreated) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const pin = await dispatch({ type: "CREATE_PIN", payload });
      whenCreated(pin);
    } catch (err) {
      setError(err.message || "Couldn't add that pin. Try again.");
      setSubmitting(false);
    }
  }

  if (step === "search") {
    return (
      <PlaceSearchStep
        trip={trip}
        search={search}
        existingByPlaceId={existingByPlaceId}
        onCancel={() => navigate(board)}
        onPick={(place) => {
          setPicked(place);
          goTo("details");
        }}
        onOpenIdea={(pin) => navigate(`/trips/${trip.id}/edit/${pin.id}?from=board`)}
        onManual={() => goTo("link")}
      />
    );
  }

  if (step === "details" && picked) {
    return (
      <PlaceDetailsForm
        // A different place starts a fresh form rather than keeping edits
        // made to the last one.
        key={picked.placeId}
        place={picked}
        knownRegions={knownRegions}
        canSetCost={ideaAccess.canSetCost(null)}
        submitting={submitting}
        error={error}
        onBack={() => goTo("search")}
        onLink={() => goTo("link")}
        onSubmit={(payload) => create(payload, (pin) => navigate(board, { state: { addedPinId: pin.id } }))}
      />
    );
  }

  return (
    <ByHandForm
      trip={trip}
      knownRegions={knownRegions}
      canSetCost={ideaAccess.canSetCost(null)}
      focusTitle={searchParams.get("focus") === "title"}
      submitting={submitting}
      error={error}
      onCancel={() => navigate(board)}
      onSearch={isMapsConfigured ? () => goTo("search") : null}
      onSubmit={async ({ payload, newRegion }) => {
        // A region the trip hasn't placed yet is stored first, so the new
        // idea shows in it straight away. If that fails the idea is still
        // added; the Map tab looks the region up again.
        if (newRegion) await dispatch({ type: "SAVE_REGION", region: newRegion });
        create(payload, (pin) => navigate(board, { state: { addedPinId: pin.id } }));
      }}
    />
  );
}
