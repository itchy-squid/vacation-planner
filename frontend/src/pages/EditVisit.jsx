import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import TextField, { TextArea, textFieldStyle } from "../components/forms/TextField";
import Stepper from "../components/forms/Stepper";
import AvailabilityGrid from "../components/planner/AvailabilityGrid";
// import MapPlaceholder from "../components/planner/MapPlaceholder"; // map card removed for now, see below
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";
import { useGuardedNavigate, useNavGuard } from "../state/NavGuard";
import { api } from "../lib/api";
import { fmtMin } from "../data/derive";
import { getTripDays } from "../data/trip";
import { dayIndexAndBandForPlan, isoForDayMinute } from "../lib/planTime";
import HomeButton from "../components/core/HomeButton";
import Button from "../components/core/Button";

// Screen 6 — "change one stop's details, and see when it can happen."
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
//   • every field and every availability-grid tap edits `draft` /
//     `overrideEdits` only, so nothing leaves the browser until Save;
//   • Save writes the changed pin fields (one PATCH), then one toggle call
//     per availability cell that actually differs from what's stored (the
//     endpoint is a toggle, not a set — see PlannerContext's
//     TOGGLE_OVERRIDE), then resizes this pin's calendar slot if its
//     duration changed, and only navigates away once all of that lands;
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
    dur: pin.dur,
    cost: pin.cost,
    notes: pin.notes ?? "",
    link: pin.link ?? "",
    photoUrl: pin.photoUrl ?? "",
  };
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
  const knownRegions = [...new Set(Object.values(state.pins).map((p) => p.region).filter(Boolean))];

  const [commentCount, setCommentCount] = useState(null);
  // null means "untouched" — the form then reads straight from the pin, so
  // a field nobody has typed in tracks the stored value rather than a copy
  // taken at mount.
  const [draft, setDraft] = useState(null);
  // key ("<pinId>|<day>-<band>") -> { day, band, overridden }: what this
  // session's taps want each cell to be, whether or not that differs from
  // what's stored. commitOverrides below sends only the ones that differ.
  const [overrideEdits, setOverrideEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [durationSyncNote, setDurationSyncNote] = useState("");
  // Whether the inline "paste a new photo URL" field is open — separate
  // from the draft itself, since showing the field is view state, not
  // something Save or the discard-guard need to know about.
  const [editingPhoto, setEditingPhoto] = useState(false);

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
    setOverrideEdits({});
    setSaving(false);
    setSaveError("");
    setDurationSyncNote("");
    setEditingPhoto(false);
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

  // Only what actually differs, in the shape PATCH_PIN expects — an
  // untouched field is never sent, so two people editing different fields
  // of the same pin don't overwrite each other.
  const changedFields = useMemo(() => {
    if (!form || !baseline) return {};
    const changed = {};
    Object.keys(baseline).forEach((key) => {
      if (form[key] !== baseline[key]) changed[key] = form[key];
    });
    return changed;
  }, [form, baseline]);

  // Cells whose drafted state differs from what the server holds — one
  // toggle call each on Save, and nothing at all for a cell that was
  // tapped twice back to where it started.
  const pendingOverrides = useMemo(
    () => Object.entries(overrideEdits).filter(([key, edit]) => edit.overridden !== Boolean(state.overrides[key])),
    [overrideEdits, state.overrides]
  );

  // What the grid should draw: stored overrides with this session's taps
  // laid over the top.
  const overrideView = useMemo(() => {
    const merged = { ...state.overrides };
    Object.entries(overrideEdits).forEach(([key, edit]) => {
      merged[key] = edit.overridden;
    });
    return merged;
  }, [state.overrides, overrideEdits]);

  const dirty = Object.keys(changedFields).length > 0 || pendingOverrides.length > 0;

  // Arms the confirmation in state/NavGuard.jsx for every in-app way off
  // this screen: Cancel and the ‹ back affordance below, the ⌂ home button,
  // and the bottom tab bar. Not armed mid-save — the draft is on its way to
  // the server at that point, and Save navigates by itself when it lands.
  useNavGuard(Boolean(pin) && dirty && !saving && !deleting, DISCARD_PROMPT);

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

  const rule = pin.availabilityRule;
  // Real trip dates (pages/TripSettings.jsx), same source
  // pages/DaySchedule.jsx already derives its day strip from, so the
  // "when this one can happen" grid tracks the trip's actual length and
  // start date instead of always showing a fixed calendar.
  const tripDays = getTripDays(state.trip.startDate, state.trip.endDate);
  const who = state.contributors.find((c) => c.id === pin.who);

  // Whichever Plan currently carries this pin, if any — a pin can only be
  // in one active plan at a time. Drives both the "placed" dot on the
  // availability grid and the contested-plan footnote below.
  const placingPlan = state.plans.find((p) => p.items.some((it) => it.pinId === pinId));
  // dayIndexAndBandForPlan's `dayIndex` is trip-relative (Oct 21 on a trip
  // that starts Oct 17 is day 5) — right for routing (destination() below,
  // DaySchedule's /schedule/:day) and for syncPlanDuration's math, but
  // AvailabilityGrid keys every cell by calendar day-of-month instead
  // (`d.n` from data/trip.js getTripDays — the same currency
  // pin.availabilityRule.days and the override keys already use). Building
  // placedDayBand straight from dayIndex compared trip-day numbers against
  // day-of-month keys and could never match, so no pin's current
  // placement — locked or not — ever lit up as "placed" here. Converting
  // through tripDays (already computed above) fixes that without
  // disturbing dayIndex's other, correct uses.
  const placedDayIndexAndBand = placingPlan ? dayIndexAndBandForPlan(placingPlan, state.trip.startDate) : null;
  const placedCalendarDay = placedDayIndexAndBand ? tripDays[placedDayIndexAndBand.dayIndex - 1]?.n ?? null : null;
  const placedDayBand = placedCalendarDay != null ? `${placedCalendarDay}-${placedDayIndexAndBand.band}` : null;
  // A locked plan's cell should read as "placed" on the grid below even
  // when it doesn't currently "work" per the rule/overrides — see
  // components/planner/AvailabilityGrid.jsx's placedLocked prop for why.
  const placedIsLocked = placingPlan?.status === "locked";

  function setField(key, value) {
    setSaveError("");
    setDraft((current) => ({ ...(current ?? baseline), [key]: value }));
  }

  function toggleOverride(day, band) {
    const key = `${pinId}|${day}-${band}`;
    setSaveError("");
    setOverrideEdits((current) => {
      const currentValue = key in current ? current[key].overridden : Boolean(state.overrides[key]);
      return { ...current, [key]: { day, band, overridden: !currentValue } };
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

  async function commitOverrides() {
    for (const [, edit] of pendingOverrides) {
      const result = await dispatch({ type: "TOGGLE_OVERRIDE", pinId, day: edit.day, band: edit.band });
      if (!result?.ok) return false;
    }
    return true;
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
    const endsAt = isoForDayMinute(
      state.trip.startDate,
      placedDayIndexAndBand.dayIndex,
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
    // Nothing to write — Save on an untouched form is just a way out.
    if (!dirty) {
      navigate(destination());
      return;
    }

    setSaving(true);
    const durationChanged = "dur" in changedFields;
    const nextDur = form.dur;

    if (Object.keys(changedFields).length > 0) {
      const result = await dispatch({ type: "PATCH_PIN", id: pinId, fields: changedFields });
      if (!result?.ok) {
        setSaving(false);
        setSaveError("Couldn't save those changes — they're still here, so try again.");
        return;
      }
    }

    if (!(await commitOverrides())) {
      setSaving(false);
      // The pin fields (if any) did land, and committed toggles stay
      // committed; what's left in overrideEdits is still drafted, so
      // tapping Save again retries exactly the cells that didn't make it.
      setSaveError("Saved the details, but couldn't update every availability square — try again.");
      return;
    }

    // Last, because it's the only step that can fail without anything being
    // wrong with the edit itself: the pin's new duration is saved either
    // way, and only its calendar slot is left at the old length.
    const calendarMatches = durationChanged ? await syncPlanDuration(nextDur) : true;

    // Committed — drop back to reading straight from the pin, so the form
    // shows what the server actually stored.
    setDraft(null);
    setOverrideEdits({});
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

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <HomeButton size={28} />
            <button onClick={handleCancel} disabled={saving || deleting} style={{ font: "500 13px var(--font-sans)", color: saving || deleting ? "var(--text-muted)" : "var(--accent)" }}>‹ Cancel</button>
          </div>
          {/* Single Save action now lives at the bottom of the form
              ("Save changes") — this header used to carry a second Save
              that did the identical thing, so the empty cell here just
              keeps the label centered. */}
          <span className="mono-caption">Edit visit</span>
          <div />
        </div>

        <PhotoPlaceholder height={150} label="photo placeholder" src={form.photoUrl} alt={pin.title}>
          <div style={{ marginLeft: "auto", marginRight: 14, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setEditingPhoto((open) => !open)}
              style={{ background: "rgba(255,255,255,.94)", borderRadius: 999, padding: "5px 10px", font: "600 10px var(--font-sans)", color: "var(--stone-700)" }}
            >
              {editingPhoto ? "Cancel" : "Replace"}
            </button>
          </div>
        </PhotoPlaceholder>

        {editingPhoto && (
          <div style={{ padding: "10px 16px 0" }}>
            <TextField
              label="Image URL"
              value={form.photoUrl}
              onChange={(e) => setField("photoUrl", e.target.value)}
              placeholder="Paste a new photo URL"
              mono
              size={12.5}
              autoFocus
            />
            <div style={{ marginTop: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => setEditingPhoto(false)}>
                Done
              </Button>
            </div>
          </div>
        )}

        <div style={{ padding: "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="mono-caption">Title</div>
            <input value={form.title} onChange={(e) => setField("title", e.target.value)} style={{ marginTop: 6, ...textFieldStyle({ weight: 600, size: 15 }) }} />
          </div>

          <div>
            <div className="mono-caption">Region</div>
            <input
              value={form.region}
              onChange={(e) => setField("region", e.target.value)}
              placeholder="e.g. Xiaoliuqiu"
              list="edit-visit-known-regions"
              style={{ marginTop: 6, ...textFieldStyle({ size: 13.5 }) }}
            />
            {knownRegions.length ? (
              <datalist id="edit-visit-known-regions">
                {knownRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            ) : null}
          </div>

          <div>
            <div className="mono-caption">Source link</div>
            <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={form.link}
                onChange={(e) => setField("link", e.target.value)}
                style={{ flex: 1, minWidth: 0, ...textFieldStyle({ mono: true, size: 12.5 }) }}
              />
              <button
                type="button"
                aria-label="Open link in new tab"
                disabled={!form.link}
                onClick={() => window.open(form.link, "_blank", "noopener,noreferrer")}
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

          <div style={{ background: "var(--surface-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "12px 13px 13px" }}>
            <AvailabilityGrid
              pinId={pinId}
              rule={rule.days ? rule : null}
              overrides={overrideView}
              placedDayBand={placedDayBand}
              placedLocked={placedIsLocked}
              days={tripDays}
              onToggle={toggleOverride}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Stepper
              label="Duration"
              valueLabel={fmtMin(form.dur)}
              onDown={() => changeDuration(form.dur - 15)}
              onUp={() => changeDuration(form.dur + 15)}
            />
            <div style={{ flex: 1 }}>
              <div className="mono-caption">Cost each</div>
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", background: "var(--surface-card)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", height: 46, padding: "0 13px" }}>
                <span style={{ font: "500 14px var(--font-sans)", color: "var(--text-muted)", marginRight: 4 }}>$</span>
                <input
                  value={form.cost}
                  onChange={(e) => {
                    const v = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
                    setField("cost", Number.isNaN(v) ? 0 : v);
                  }}
                  inputMode="numeric"
                  style={{ flex: 1, minWidth: 0, border: "none", outline: "none", fontSize: 14, fontWeight: 600, color: "var(--text-primary)", background: "transparent" }}
                />
              </div>
            </div>
          </div>

          {durationSyncNote && (
            <div style={{ font: "500 11px var(--font-sans)", color: "var(--warn, #a15c1a)" }}>{durationSyncNote}</div>
          )}

          <TextArea label="Notes for the group" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />

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

          {saveError && (
            <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{saveError}</div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || deleting}
            style={{ height: 48, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: "600 14px var(--font-sans)", opacity: saving || deleting ? 0.45 : 1 }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>
            {dirty && !saving ? "Unsaved changes · " : ""}{footnote}
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
        </div>
      </div>
    </div>
  );
}
