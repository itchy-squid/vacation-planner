import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import PhotoPicker from "../components/photos/PhotoPicker";
import { TextArea, textFieldStyle } from "../components/forms/TextField";
import Stepper from "../components/forms/Stepper";
import CostField from "../components/forms/CostField";
import CostDays from "../components/forms/CostDays";
import KindField from "../components/forms/KindField";
import { tripDayNumbers } from "../lib/dayPlaces";
// import MapPlaceholder from "../components/planner/MapPlaceholder"; // map card removed for now, see below
import { usePlannerState, usePlannerDispatch, useIdeaAccess, usePinHeart } from "../state/PlannerContext";
import PinHearts from "../components/planner/PinHearts";
import { useGuardedNavigate, useNavGuard } from "../state/NavGuard";
import { api } from "../lib/api";
import { fmtMin } from "../data/derive";
import { dayIndexAndBandForPlan, tripMinute } from "../lib/planTime";
import { externalHref } from "../lib/externalHref";
import { isMapsConfigured } from "../lib/googleMaps";
import RegionPicker from "../components/forms/RegionPicker";
import WhereOnMap from "../components/map/WhereOnMap";
import { useRegionPreview } from "../components/map/useRegionPreview";
import { useKnownRegions } from "../components/map/useKnownRegions";
import FindOnGoogle from "../components/newpin/FindOnGoogle";
import { googleMapsPlaceUrl, otherTripRegion } from "../lib/places";
import { usePinPhoto } from "../components/photos/usePinPhoto";
import HomeButton from "../components/core/HomeButton";
import Button from "../components/core/Button";
import CoveredByPasses from "../components/expenses/CoveredByPasses";

// Screen 6 — "change one stop's details."
// Handoff README screen 6. "Where this pin is currently placed" is a plain
// scan over state.plans (any day, any status) via lib/planTime.js
// dayIndexAndBandForPlan — see docs/features/scheduling-feature-spec.md.
//
// Editing model: a local draft, committed by Save and thrown away by
// Cancel. This screen used to dispatch every keystroke and every grid tap
// straight into shared state and the API, which left its three "Cancel",
// "Save" and "Save changes" buttons all doing the identical thing —
// navigate back — with Cancel in particular a lie, since there was nothing
// left to cancel by the time it was tapped. Now:
//
//   • every field edits `draft` only, so nothing leaves the browser until
//     Save;
//   • Save writes the changed pin fields (one PATCH), then resizes this
//     pin's calendar slot if its duration changed, and only navigates away
//     once all of that lands;
//   • Cancel discards, and — like the ⌂ button and the bottom tab bar,
//     which route through the same guard (state/NavGuard.jsx) — asks first
//     when there's something to lose.
//
// The trade-off this accepts: other contributors no longer see an edit
// land keystroke by keystroke, only once it's saved. That's the point of
// having a Save at all, and the "all N contributors see the edit" footnote
// below now describes what Save does rather than what typing does.
const DISCARD_PROMPT = {
  title: "Discard these changes?",
  body: "This visit has edits that haven't been saved yet. Leaving now throws them away.",
  stayLabel: "Keep editing",
  leaveLabel: "Discard",
};

// Delete pin: double-tap-to-confirm, same window and pattern as
// components/planner/PlanDetailsSheet.jsx's "Delete permanently" — armed
// state reads "confirm?" and disarms itself if the second tap doesn't
// follow within this window.
const CONFIRM_WINDOW_MS = 3000;

// The pin fields this screen edits, normalised so "no edits yet" compares
// equal to what's on screen (the backend sends null for an empty note or
// link; the inputs need a string).
function baselineFrom(pin) {
  if (!pin) return null;
  return {
    title: pin.title ?? "",
    region: pin.region ?? "",
    kind: pin.kind ?? "activity",
    dur: pin.dur,
    cost: pin.costCents == null ? null : pin.costCents / 100,
    costBasis: pin.costBasis ?? "per_head",
    costPer: pin.costPer ?? "once",
    // The first and last day of a per-day price ({ first, last }, days of
    // the trip), or null. A stay's days come from Where we'll be instead.
    costDays: pin.costStartDay != null ? { first: pin.costStartDay, last: pin.costEndDay } : null,
    notes: pin.notes ?? "",
    link: pin.link ?? "",
    photoUrl: pin.photoUrl ?? "",
    photoSourceUrl: pin.photoSourceUrl ?? "",
    // One of its Google place's photos instead (lib/placePhotos.js), or null.
    photoGoogleIndex: pin.photoGoogleIndex ?? null,
    // Its exact spot, if it has one: { lat, lng, placeId } (placeId when it
    // came from a place search). null means it shows in its region.
    location: pin.lat != null ? { lat: pin.lat, lng: pin.lng, placeId: pin.googlePlaceId ?? null } : null,
  };
}

// Every field compares by value; a location and a pair of days are
// objects, so they're compared by what's in them.
function sameFieldValue(key, a, b) {
  if (key === "costDays") return (a?.first ?? null) === (b?.first ?? null) && (a?.last ?? null) === (b?.last ?? null);
  if (key !== "location") return a === b;
  if (!a || !b) return !a && !b;
  return a.lat === b.lat && a.lng === b.lng && (a.placeId ?? null) === (b.placeId ?? null);
}

export default function EditVisit() {
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  // Pin ids are plain integers now (see backend/app/models.py), but a URL
  // segment always comes back as a string — convert once here so every
  // comparison/lookup below (state.pins[pinId], plan item scans) is a
  // real number-to-number match.
  const pinId = Number(useParams().pinId);
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") || "schedule";
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const pin = state.pins[pinId];
  // A reader opens this screen to look: every field is read-only, and
  // Save / Delete / Replace aren't offered. So does a companion, on a pin
  // someone else added — on their own they edit it like a planner would.
  // Cost and its split are shown and editable for planners on any pin,
  // and for a companion only on their own (lib/roles.js).
  const ideaAccess = useIdeaAccess();
  const canEdit = ideaAccess.canEditIdea(pin ?? {});
  const canSeeCosts = ideaAccess.canSeeCost(pin ?? {});
  const canSetCosts = canEdit && ideaAccess.canSetCost(pin ?? {});
  const knownRegions = useKnownRegions();

  const [commentCount, setCommentCount] = useState(null);
  // null means "untouched" — the form then reads straight from the pin, so
  // a field nobody has typed in tracks the stored value rather than a copy
  // taken at mount.
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [durationSyncNote, setDurationSyncNote] = useState("");
  // Whether the photo picker is open — separate from the draft itself,
  // since showing it is view state, not something Save or the
  // discard-guard need to know about.
  const [editingPhoto, setEditingPhoto] = useState(false);
  // "Find it on Google Maps" (components/newpin/FindOnGoogle.jsx) takes
  // over the screen while it's open; the draft waits underneath. `pinNext`
  // is set when it's left with "Tap the map instead", so the map opens
  // ready for a tap.
  const [finding, setFinding] = useState(false);
  const [pinNext, setPinNext] = useState(false);
  // The place just linked, for the offers under the map (Google's name,
  // its region) until the draft is saved or the link is undone.
  const [linked, setLinked] = useState(null); // { placeId, name, previousTitle, elsewhere, previousRegion, filledLink }

  // Delete pin — double-tap-to-confirm, mirroring components/planner/
  // PlanDetailsSheet.jsx's "Delete permanently": the first tap only arms
  // it (disarming itself after CONFIRM_WINDOW_MS), the second within that
  // window actually deletes. Kept separate from `saving`/`saveError`
  // above since Save and Delete are distinct actions that can't overlap
  // but shouldn't share error text.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteDisarmTimeoutRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listPinComments(pinId)
      .then((comments) => {
        if (!cancelled) setCommentCount(comments.length);
      })
      .catch(() => {
        if (!cancelled) setCommentCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pinId]);

  // Routing from one pin's edit screen to another's without unmounting
  // (the itinerary's next/previous, say) has to start from a clean slate
  // rather than carry the last pin's half-typed draft onto this one.
  useEffect(() => {
    setDraft(null);
    setSaving(false);
    setSaveError("");
    setDurationSyncNote("");
    setEditingPhoto(false);
    setFinding(false);
    setPinNext(false);
    setLinked(null);
    setDeleteArmed(false);
    setDeleting(false);
    setDeleteError("");
    clearTimeout(deleteDisarmTimeoutRef.current);
  }, [pinId]);

  // Standard cleanup for the disarm timer — same convention as
  // PlanDetailsSheet.jsx's identical effect.
  useEffect(() => () => clearTimeout(deleteDisarmTimeoutRef.current), []);

  const baseline = useMemo(() => baselineFrom(pin), [pin]);
  const form = draft ?? baseline;
  // The photo as it stands in the form: a link photo, or a Google one looked up for its place.
  const photo = usePinPhoto({ photoUrl: form?.photoUrl, googlePlaceId: form?.location?.placeId, photoGoogleIndex: form?.photoGoogleIndex });

  // Only what actually differs, in the shape PATCH_PIN expects — an
  // untouched field is never sent, so two people editing different fields
  // of the same pin don't overwrite each other.
  const changedFields = useMemo(() => {
    if (!form || !baseline) return {};
    const changed = {};
    Object.keys(baseline).forEach((key) => {
      if (!sameFieldValue(key, form[key], baseline[key])) changed[key] = form[key];
    });
    return changed;
  }, [form, baseline]);

  const dirty = Object.keys(changedFields).length > 0;

  // Arms the confirmation in state/NavGuard.jsx for every in-app way off
  // this screen: Cancel and the ‹ back affordance below, the ⌂ home button,
  // and the bottom tab bar. Not armed mid-save — the draft is on its way to
  // the server at that point, and Save navigates by itself when it lands.
  useNavGuard(Boolean(pin) && dirty && !saving && !deleting, DISCARD_PROMPT);

  // Not part of the draft: a heart is yours rather than an edit to the
  // pin, so it lands the moment it's tapped, for readers of this screen
  // who can't edit anything else here too.
  const heart = usePinHeart(pin);

  // Where the region being picked is, for "On the map" and for storing a
  // region the trip hasn't placed yet when this is saved (the same as
  // adding by hand, components/newpin/ByHandForm.jsx).
  const regionPreview = useRegionPreview(form?.region ?? "", knownRegions);

  if (!pin) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <p>Pin not found.</p>
        <button onClick={() => navigate(-1)}>‹ Back</button>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => navigate("/")} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>Trips home</button>
        </div>
      </div>
    );
  }

  // Linking an idea to the place Google knows it as: its spot and place ID
  // go into the draft (nothing is saved until Save). The title and link
  // are left alone, except that an empty link becomes the place's Google
  // Maps page; Google's name and region are offered, not applied.
  function linkPlace(place) {
    const fillLink = !form.link.trim();
    setSaveError("");
    setDraft((current) => ({
      ...(current ?? baseline),
      location: { lat: place.lat, lng: place.lng, placeId: place.placeId },
      ...(fillLink ? { link: googleMapsPlaceUrl(place) } : {}),
    }));
    setLinked({
      placeId: place.placeId,
      name: place.name,
      previousTitle: form.title,
      previousRegion: form.region,
      elsewhere: otherTripRegion(place, form.region, knownRegions),
      filledLink: fillLink,
    });
    setFinding(false);
    setPinNext(false);
  }

  if (finding) {
    return (
      <FindOnGoogle
        pin={{ id: pin.id, title: form.title.trim() || pin.title, region: form.region }}
        onLink={linkPlace}
        onTapInstead={() => {
          setFinding(false);
          setPinNext(true);
        }}
        onBack={() => setFinding(false)}
      />
    );
  }

  // The same days by number, which is how Where we'll be and a per-day
  // price's first and last day are kept.
  const dayNumbers = tripDayNumbers(state.trip);
  const isStay = form.kind === "stay";
  const who = state.contributors.find((c) => c.id === pin.who);

  // Whichever Plan currently carries this pin, if any — a pin can only be
  // in one active plan at a time. Drives the contested-plan footnote below.
  const placingPlan = state.plans.find((p) => p.items.some((it) => it.pinId === pinId));
  // Which day it sits on, for the duration sync and where Cancel returns to.
  const placedDayIndexAndBand = placingPlan ? dayIndexAndBandForPlan(placingPlan) : null;

  function setField(key, value) {
    setSaveError("");
    setDraft((current) => {
      const before = current ?? baseline;
      const next = { ...before, [key]: value };
      // A Google photo is its place's: a different place (or none) can't
      // keep it. The backend drops it too (routers/pins.py _settle_photo).
      if (key === "location" && (value?.placeId ?? null) !== (before.location?.placeId ?? null)) next.photoGoogleIndex = null;
      return next;
    });
  }

  // Somewhere to stay is usually paid by the night, so becoming one starts
  // it on a per-day price; it can be put back to once.
  function changeKind(kind) {
    setSaveError("");
    setDraft((current) => {
      const base = current ?? baseline;
      return { ...base, kind, ...(kind === "stay" && base.kind !== "stay" ? { costPer: "day" } : {}) };
    });
  }

  // A per-day price on something that isn't a stay starts out covering the
  // whole trip, which the first and last day then narrow.
  function changeCostPer(costPer) {
    setSaveError("");
    setDraft((current) => {
      const base = current ?? baseline;
      const fill = costPer === "day" && base.kind !== "stay" && !base.costDays && dayNumbers.length > 0;
      return { ...base, costPer, ...(fill ? { costDays: { first: dayNumbers[0], last: dayNumbers[dayNumbers.length - 1] } } : {}) };
    });
  }

  // Duration floor is 15 minutes (components/forms/Stepper.jsx) — local
  // only now; the matching calendar resize happens in syncPlanDuration on
  // Save rather than on every tap of the stepper.
  function changeDuration(nextDur) {
    setField("dur", Math.max(15, nextDur));
  }

  function destination() {
    const base = `/trips/${state.trip.id}`;
    if (from === "compare" && placingPlan?.contestId) return `${base}/contests/${placingPlan.contestId}`;
    if (from === "board") return `${base}/board`;
    if (from === "itinerary") return `${base}/itinerary`;
    return `${base}/schedule/${placedDayIndexAndBand?.dayIndex ?? 1}`;
  }

  // Cancel, and the ‹ affordance that shares it: guarded, so it asks before
  // throwing away a draft and leaves silently when there's nothing to lose.
  function handleCancel() {
    guardedNavigate(destination());
  }

  // Duration is the same field on both screens (see
  // components/planner/PlanDetailsSheet.jsx's "Duration" stepper, which
  // does this sync the other way around): changing it here also resizes
  // this pin's calendar slot, if it currently has one, so the two never
  // drift apart. Only possible while that plan is placed/pencilled — a
  // contested/locked plan's window can't be resized (spec "Moving /
  // unplacing"); its slack just changes instead once this pin's new
  // duration is next fetched. Returns whether the calendar now matches.
  async function syncPlanDuration(nextDur) {
    if (
      !placingPlan ||
      !(placingPlan.status === "placed" || placingPlan.status === "pencilled") ||
      placingPlan.items.length !== 1 ||
      !placingPlan.startDt ||
      !placedDayIndexAndBand
    ) {
      return true;
    }
    const endsAt = tripMinute(placedDayIndexAndBand.dayIndex,
      placingPlan.startDt.minuteOfDay + nextDur
    );
    const result = await dispatch({ type: "MOVE_PLAN", planId: placingPlan.id, startsAt: placingPlan.startsAt, endsAt });
    return Boolean(result?.ok);
  }

  // A pin currently sitting in a contested or locked plan can't be
  // unplaced by a plain DELETE /api/plans/{id} (backend/app/routers/
  // plans.py only allows that on placed/pencilled — see spec "Moving /
  // unplacing"), so deleting it here would fail outright. Rather than let
  // the tap fail silently, disable the button and say why — same
  // reasoning as PlanDetailsSheet.jsx gating its own delete to `editable`.
  const placingPlanBlocksDelete = Boolean(placingPlan) && placingPlan.status !== "placed" && placingPlan.status !== "pencilled";

  function handleDeleteTap() {
    if (deleting || saving || placingPlanBlocksDelete) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      clearTimeout(deleteDisarmTimeoutRef.current);
      deleteDisarmTimeoutRef.current = setTimeout(() => setDeleteArmed(false), CONFIRM_WINDOW_MS);
      return;
    }
    clearTimeout(deleteDisarmTimeoutRef.current);
    setDeleteArmed(false);
    setDeleting(true);
    setDeleteError("");
    deletePermanently();
  }

  // Unplace first if it's currently on the calendar — the backend rejects
  // deleting a pin still referenced by a PlanItem (routers/pins.py), same
  // ordering as PlanDetailsSheet.jsx's deletePermanently.
  async function deletePermanently() {
    if (placingPlan) {
      const unplaceResult = await dispatch({ type: "UNPLACE_PLAN", planId: placingPlan.id });
      if (!unplaceResult.ok) {
        setDeleting(false);
        setDeleteError("Couldn't delete this pin — try again.");
        return;
      }
    }
    const result = await dispatch({ type: "DELETE_PIN", id: pinId });
    if (result.ok) {
      // Bypasses the discard-guard the same way handleSave's navigate
      // does below — there's nothing left to lose a confirmation over,
      // the pin itself is gone.
      navigate(destination());
    } else {
      setDeleting(false);
      setDeleteError(
        placingPlan
          ? "Removed it from the schedule, but couldn't delete it permanently — try again from the tray."
          : "Couldn't delete this pin — try again."
      );
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaveError("");
    setDurationSyncNote("");
    // Save is disabled on an untouched form; this just guards against a
    // stray call with nothing to write.
    if (!dirty) {
      navigate(destination());
      return;
    }

    setSaving(true);
    const durationChanged = "dur" in changedFields;
    const nextDur = form.dur;

    // A region the trip hasn't placed yet is stored first, so the idea shows
    // in it straight away. If that fails the edit still saves; the Map tab
    // looks the region up again.
    const newRegion = regionPreview.location && !regionPreview.location.id ? regionPreview.location : null;
    if ("region" in changedFields && newRegion) {
      await dispatch({ type: "SAVE_REGION", region: { ...newRegion, name: form.region.trim() } });
    }

    if (Object.keys(changedFields).length > 0) {
      const result = await dispatch({ type: "PATCH_PIN", id: pinId, fields: changedFields });
      if (!result?.ok) {
        setSaving(false);
        setSaveError("Couldn't save those changes — they're still here, so try again.");
        return;
      }
    }

    // Last, because it's the only step that can fail without anything being
    // wrong with the edit itself: the pin's new duration is saved either
    // way, and only its calendar slot is left at the old length.
    const calendarMatches = durationChanged ? await syncPlanDuration(nextDur) : true;

    // Committed — drop back to reading straight from the pin, so the form
    // shows what the server actually stored.
    setDraft(null);
    setSaving(false);

    if (!calendarMatches) {
      setDurationSyncNote("Saved — but its scheduled slot is already at capacity there, so the calendar didn't grow to match.");
      return;
    }
    navigate(destination());
  }

  const commentLabel = commentCount ? `${commentCount} comment${commentCount === 1 ? "" : "s"}` : "Comment";
  const inContestedPlan = placingPlan?.status === "contested";
  const footnote = inContestedPlan
    ? `Saving recomputes this plan's totals. All ${state.contributors.length} contributors see the edit.`
    : `All ${state.contributors.length} contributors see the edit once you save.`;
  const linkHref = externalHref(form.link);

  return (
    <div className="screen">
      {/* Fixed above the scrolling form, so Save is always in reach on a
          screen this long: Cancel on the left, Save on the right, as on the
          new-pin screens. Save only lights up once something has changed,
          which doubles as the "unsaved changes" signal. Problems saving
          show right under it, where the tap was. */}
      <div style={{ flex: "none", background: "var(--surface-page)", borderBottom: "1px solid var(--hairline)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={handleCancel} disabled={saving || deleting} style={{ font: "500 13px var(--font-sans)", color: saving || deleting ? "var(--text-muted)" : "var(--accent)" }}>
              {canEdit ? "‹ Cancel" : "‹ Back"}
            </button>
          </div>
          <span className="mono-caption">{canEdit ? "Edit visit" : "Visit"}</span>
          <div style={{ justifySelf: "end" }}>
            {canEdit ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving || deleting}
                aria-label={saving ? "Saving" : "Save changes"}
                style={{
                  height: 32,
                  padding: "0 14px",
                  borderRadius: "var(--radius-pill)",
                  font: "600 13px var(--font-sans)",
                  background: dirty && !deleting ? "var(--surface-inverse)" : "transparent",
                  color: dirty && !deleting ? "#fff" : "var(--text-muted)",
                  transition: "background var(--dur-fast, .12s) var(--ease-standard, ease)",
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            ) : null}
          </div>
        </div>
        {saveError || durationSyncNote ? (
          <div role="alert" style={{ padding: "0 16px 10px", font: "500 12px/1.4 var(--font-sans)", color: saveError ? "#b3423a" : "var(--warn, #a15c1a)" }}>
            {saveError || durationSyncNote}
          </div>
        ) : null}
      </div>

      <div className="screen-scroll" style={{ paddingBottom: 24 }}>

        <PhotoPlaceholder height={150} label="photo placeholder" src={photo.src} credit={photo.credit} referrerPolicy={photo.referrerPolicy} alt={pin.title}>
          {canEdit ? (
            // Positioned so it draws above the photo, which PhotoPlaceholder
            // lays over the whole box; otherwise the photo swallows the tap.
            <div style={{ position: "relative", marginLeft: "auto", marginRight: 14, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setEditingPhoto((open) => !open)}
                style={{ background: "rgba(255,255,255,.94)", borderRadius: 999, padding: "5px 10px", font: "600 10px var(--font-sans)", color: "var(--stone-700)" }}
              >
                {editingPhoto ? "Cancel" : "Replace"}
              </button>
            </div>
          ) : null}
        </PhotoPlaceholder>

        {editingPhoto && canEdit && (
          <div style={{ padding: "10px 16px 0" }}>
            <PhotoPicker
              tripId={state.trip.id}
              link={form.link}
              placeId={form.location?.placeId ?? null}
              photoUrl={form.photoUrl}
              googleIndex={form.photoGoogleIndex}
              current={baseline.photoUrl}
              onPick={(url, sourceUrl, origin, googleIndex) => {
                setField("photoUrl", url);
                setField("photoSourceUrl", sourceUrl ?? baseline.photoSourceUrl);
                setField("photoGoogleIndex", googleIndex ?? null);
              }}
            />
            <div style={{ marginTop: 10 }}>
              <Button variant="secondary" size="sm" onClick={() => setEditingPhoto(false)}>
                Done
              </Button>
            </div>
          </div>
        )}

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="mono-caption">Title</div>
            <input aria-label="Title" value={form.title} readOnly={!canEdit} onChange={(e) => setField("title", e.target.value)} style={{ marginTop: 6, ...textFieldStyle({ weight: 600, size: 15 }) }} />
          </div>

          {/* A stay can't be on the calendar (backend routers/plans.py
              validate_placement), so an idea that's on it comes off first. */}
          <KindField
            value={form.kind}
            onChange={changeKind}
            disabled={!canEdit || saving || deleting}
            lockedReason={placingPlan && baseline.kind !== "stay" ? "It’s on the plan. Take it off the plan to make it a place to stay." : ""}
          />

          {/* The same region picker and map preview as adding by hand.
              Both are part of the draft: nothing changes until Save. */}
          <RegionPicker
            knownRegions={knownRegions}
            value={form.region}
            chosenChip={regionPreview.chosenChip}
            onChange={(next) => setField("region", next)}
            readOnly={!canEdit}
          />

          {isMapsConfigured ? (
            <WhereOnMap
              trip={state.trip}
              regionName={form.region.trim()}
              location={regionPreview.location}
              lookingUp={regionPreview.lookingUp}
              newRegion={!regionPreview.chosenChip}
              spot={form.location}
              // A spot moved or placed by hand isn't the Google place any more.
              onSpot={(next) => setField("location", next ? { lat: next.lat, lng: next.lng, placeId: null } : null)}
              fromGoogle={Boolean(form.location?.placeId)}
              onFindOnGoogle={canEdit ? () => setFinding(true) : null}
              startPinning={pinNext}
              readOnly={!canEdit}
            >
              {linked && form.location?.placeId === linked.placeId ? (
                <LinkedOffers linked={linked} form={form} onField={setField} />
              ) : null}
            </WhereOnMap>
          ) : null}

          <div>
            <div className="mono-caption">Source link</div>
            <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={form.link}
                onChange={(e) => setField("link", e.target.value)}
                readOnly={!canEdit}
                style={{ flex: 1, minWidth: 0, ...textFieldStyle({ mono: true, size: 12.5 }) }}
              />
              <button
                type="button"
                aria-label="Open link in new tab"
                disabled={!linkHref}
                onClick={() => window.open(linkHref, "_blank", "noopener,noreferrer")}
                style={{
                  flex: "none",
                  width: 44,
                  height: 44,
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-lg)",
                  background: "var(--surface-card)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: form.link ? "var(--text-primary)" : "var(--text-muted)",
                  cursor: form.link ? "pointer" : "default",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Map card (place name/coords + "Move pin") removed for now —
              see EditVisit.jsx history to restore. */}

          {/* How long it takes is about time on the plan, which a stay
              never takes. */}
          {isStay ? null : (
            <div style={{ display: "flex", gap: 10 }}>
              <Stepper
                label="Duration"
                valueLabel={fmtMin(form.dur)}
                onDown={() => changeDuration(form.dur - 15)}
                onUp={() => changeDuration(form.dur + 15)}
                disabled={!canEdit}
              />
            </div>
          )}

          {/* Per person by default — what one traveler pays — or one price
              for the group, divided among whoever shares it
              (backend/app/derive.py item_money). Paid once, or by the day:
              n days from first to last is n - 1 days of it
              (lib/dailyCosts.js). */}
          {canSeeCosts && form.kind === "activity" ? <CoveredByPasses pinId={pinId} /> : null}
          {canSeeCosts ? (
            <CostField
              id="visit-cost"
              value={form.cost ?? 0}
              onChange={(v) => setField("cost", Math.max(0, Number(v) || 0))}
              basis={form.costBasis}
              onBasis={(b) => setField("costBasis", b)}
              per={form.costPer}
              onPer={changeCostPer}
              disabled={saving || deleting || !canSetCosts}
            >
              <CostDays
                pin={{
                  id: pinId,
                  kind: form.kind,
                  costPer: form.costPer,
                  costCents: Math.round((form.cost ?? 0) * 100),
                  costBasis: form.costBasis,
                  costStartDay: form.costDays?.first ?? null,
                  costEndDay: form.costDays?.last ?? null,
                }}
                trip={state.trip}
                dayPlaces={state.dayPlaces}
                headcount={state.travelers.length}
                onDays={(costDays) => setField("costDays", costDays)}
                onPlaces={() => guardedNavigate(`/trips/${state.trip.id}/places`)}
                disabled={saving || deleting || !canSetCosts}
              />
            </CostField>
          ) : null}

          <TextArea
            label="Notes for the group"
            value={form.notes}
            readOnly={!canEdit}
            onChange={(e) => setField("notes", e.target.value)}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 13px", background: "var(--surface-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: who?.tint ?? "var(--who-1)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px var(--font-sans)", color: "var(--stone-700)" }}>
                {who?.initial ?? pin.whoName?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div>
                <div style={{ font: "500 12px var(--font-sans)", color: "var(--text-primary)" }}>{pin.whoName}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-muted)" }}>pinned it · {pin.addedAgo}</div>
              </div>
            </div>
            <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--accent)" }}>{commentLabel}</span>
          </div>

          <PinHearts title={pin.title} heart={heart} contributors={state.contributors} currentUserId={state.currentUserId} />

          {canEdit ? (
            <>
              <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingTop: 4 }}>
                {footnote}
              </div>

              {/* Destructive zone, deliberately separated from Save above by
                  its own margin — double-tap-to-confirm like PlanDetailsSheet
                  .jsx's "Delete permanently", since this can't be undone from
                  here either. */}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={handleDeleteTap}
                  disabled={deleting || saving || placingPlanBlocksDelete}
                  style={{
                    width: "100%",
                    height: 48,
                    borderRadius: "var(--radius-lg)",
                    background: deleteArmed ? "var(--danger, #b3261e)" : "var(--surface-card)",
                    border: deleteArmed ? "none" : "1px solid var(--border-strong)",
                    color: deleteArmed ? "#fff" : "var(--danger, #b3261e)",
                    font: "600 14px var(--font-sans)",
                    opacity: placingPlanBlocksDelete ? 0.45 : 1,
                    transition: "background var(--dur-base, .15s) var(--ease-standard, ease)",
                  }}
                >
                  {deleting ? "Deleting…" : deleteArmed ? "confirm?" : "Delete pin"}
                </button>
                <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingTop: 8 }}>
                  {placingPlanBlocksDelete
                    ? `This pin is part of ${placingPlan.status === "contested" ? "an open contest" : "a locked plan"} — resolve that before deleting it.`
                    : deleteArmed
                    ? "Tap once more to confirm — this can't be undone."
                    : ""}
                </div>
                {deleteError && (
                  <div style={{ marginTop: 8, font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{deleteError}</div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// After linking a place: offer Google's name and the place's region rather
// than applying them, and say when the empty link was filled in.
function LinkedOffers({ linked, form, onField }) {
  const usingGoogleName = form.title === linked.name;
  const moved = linked.elsewhere && form.region === linked.elsewhere;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {linked.name !== linked.previousTitle ? (
        <Offer
          text={usingGoogleName ? "Using Google’s name." : <>Google calls it <b style={{ color: "var(--text-primary)" }}>“{linked.name}”</b>.</>}
          action={usingGoogleName ? "Keep mine" : "Use that name"}
          onClick={() => onField("title", usingGoogleName ? linked.previousTitle : linked.name)}
        />
      ) : null}
      {linked.elsewhere ? (
        <Offer
          text={moved ? `Moved to ${linked.elsewhere}.` : `It’s in ${linked.elsewhere}, not ${linked.previousRegion}.`}
          action={moved ? "Undo" : "Move it there"}
          onClick={() => onField("region", moved ? linked.previousRegion : linked.elsewhere)}
        />
      ) : null}
      {linked.filledLink ? <Offer text="The link was empty, so it’s now the Google Maps page." /> : null}
    </div>
  );
}

function Offer({ text, action, onClick }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: "var(--radius-md)",
        border: `1px ${action ? "dashed" : "solid"} var(--border-strong)`,
        background: action ? "transparent" : "var(--surface-inset)",
        font: "400 11.5px/1.4 var(--font-sans)",
        color: "var(--text-secondary)",
      }}
    >
      <span style={{ flex: 1 }}>{text}</span>
      {action ? (
        <button type="button" onClick={onClick} style={{ flex: "none", font: "600 11.5px var(--font-sans)", color: "var(--accent)" }}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
