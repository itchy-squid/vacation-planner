import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faLockOpen } from "@fortawesome/free-solid-svg-icons";
import { usePlannerState, usePlannerDispatch, useCurrentUser } from "../../state/PlannerContext";
import { getTripDays } from "../../data/trip";
import { fmtMin } from "../../data/derive";
import { dayIndexForDate, isoForDayMinute, clockLabel } from "../../lib/planTime";
import Stepper from "../forms/Stepper";

// Calendar item details — a bottom sheet overlaid on pages/DaySchedule.jsx,
// not a routed page. Rendered there next to the existing "Propose an
// alternative" sheet and built the same way (fixed backdrop + rounded-top
// panel sliding up from the bottom), so tapping a placed/pencilled plan
// opens this instead of navigating away.
//
// Sheet instead of a page (like pages/EditVisit.jsx) was a deliberate
// choice: routing to a page unmounts DaySchedule, which throws away the
// scroll position of its .screen-scroll grid (styles/global.css — that
// scroll lives on a plain div, not the window, so nothing in the browser
// or react-router restores it across a route change). A sheet keeps
// DaySchedule mounted underneath the whole time, so its scroll position is
// simply never touched by opening or closing this — nothing to save or
// restore.
const SNAP_MIN = 15;
const DAY_END_MIN = 1440;
const CONFIRM_WINDOW_MS = 3000;

function planDurationMinutes(plan) {
  if (plan.startDt && plan.endDt) {
    const d = (plan.endDt.minuteOfDay - plan.startDt.minuteOfDay + 1440) % 1440;
    if (d > 0) return d;
  }
  return plan.totalDurationMinutes || 60;
}

export default function PlanDetailsSheet({ planId, onClose }) {
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const currentUser = useCurrentUser();
  const { trip, plans } = state;

  const plan = plans.find((p) => p.id === planId);
  const tripDays = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);

  const [dayIndex, setDayIndex] = useState(1);
  const [startMinute, setStartMinute] = useState(540);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [error, setError] = useState("");

  // Two ways to lose this plan's placement: a plain single-tap "clear" on
  // Start time just unplaces (DELETE /api/plans/{id} — the pin/travel item
  // survives, unscheduled, in the tray), so it needs no confirmation —
  // it's the easily-undone action, exactly like clearing any other field.
  // "Delete permanently" actually deletes the pin/travel item itself
  // (DELETE /api/pins/{id} or /api/travel-items/{id}), unplacing it first
  // since the backend won't delete something still referenced by a
  // PlanItem — that one keeps the double-tap-to-confirm treatment because
  // it can't be undone from here.
  const [clearing, setClearing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteDisarmTimeoutRef = useRef(null);

  // Lock/reopen — a reversible toggle (see components/planner/PlanBlock.jsx
  // "locked" status + backend/app/routers/plans.py lock_plan), so unlike
  // "Delete permanently" it needs no armed/confirm state, just a busy flag
  // to keep the tap from double-firing while the request is in flight.
  const [lockBusy, setLockBusy] = useState(false);

  // Reset local editing state whenever a *different* plan's data arrives —
  // same convention the routed version used, just keyed off the prop
  // instead of a URL param.
  const syncedKey = useRef(null);
  useEffect(() => {
    if (!plan) return;
    const key = `${plan.id}:${plan.startsAt}:${plan.endsAt}`;
    if (syncedKey.current === key) return;
    syncedKey.current = key;
    setDayIndex(dayIndexForDate(plan.startDt, trip.startDate) ?? 1);
    setStartMinute(plan.startDt?.minuteOfDay ?? 540);
    setDurationMinutes(planDurationMinutes(plan));
  }, [plan, trip.startDate]);

  // Every open is a clean slate for both confirm states and any error,
  // whether it's the same plan reopened or a different one.
  useEffect(() => {
    setError("");
    setClearing(false);
    setDeleteArmed(false);
    setLockBusy(false);
    setDeleting(false);
    clearTimeout(deleteDisarmTimeoutRef.current);
  }, [planId]);

  useEffect(
    () => () => {
      clearTimeout(deleteDisarmTimeoutRef.current);
    },
    []
  );

  // The plan can vanish out from under an open sheet (someone else deleted
  // it, or a contest resolved around it) — nothing left to show, so close
  // instead of rendering a dead sheet.
  useEffect(() => {
    if (planId && !plan) onClose();
  }, [planId, plan, onClose]);

  if (!planId || !plan) return null;

  const title = plan.items.map((i) => i.title).join(" + ") || plan.label || "Untitled";
  const editable = plan.status === "placed" || plan.status === "pencilled";
  // Only reachable here for a plan with no contest — pages/DaySchedule.jsx
  // routes a contested/locked-via-contest plan to the compare screen
  // instead (see handlePlanTap there), so "locked" in this sheet always
  // means a direct lock (backend/app/routers/plans.py lock_plan), and
  // reopening it (routers/contests.py reopen_plan tolerates a null
  // contest_id) is always safe to offer right here.
  const isLocked = plan.status === "locked";
  const endMinute = startMinute + durationMinutes;
  const timeValue = `${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`;

  async function applyChange(nextDayIndex, nextStartMinute, nextDurationMinutes) {
    const clampedDuration = Math.max(15, nextDurationMinutes);
    const clampedStart = Math.min(Math.max(nextStartMinute, 0), DAY_END_MIN - 15);
    const startsAt = isoForDayMinute(trip.startDate, nextDayIndex, clampedStart);
    const endsAt = isoForDayMinute(trip.startDate, nextDayIndex, clampedStart + clampedDuration);

    const prev = { dayIndex, startMinute, durationMinutes };
    setDayIndex(nextDayIndex);
    setStartMinute(clampedStart);
    setDurationMinutes(clampedDuration);
    setError("");

    const result = await dispatch({ type: "MOVE_PLAN", planId: plan.id, startsAt, endsAt });
    if (!result.ok) {
      setDayIndex(prev.dayIndex);
      setStartMinute(prev.startMinute);
      setDurationMinutes(prev.durationMinutes);
      setError(result.occupied ? "That time is already taken — try another slot." : "Couldn't save that change — try again.");
    }
  }

  function handleDayChange(n) {
    if (!editable || n === dayIndex) return;
    applyChange(n, startMinute, durationMinutes);
  }
  function handleTimeChange(e) {
    if (!editable) return;
    const [h, m] = e.target.value.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const snapped = Math.round((h * 60 + m) / SNAP_MIN) * SNAP_MIN;
    applyChange(dayIndex, snapped, durationMinutes);
  }

  // The plan's own duration_minutes-shaped item (pin or travel item) — the
  // same field pages/EditVisit.jsx edits as "Duration" for a pin, and the
  // thing "Delete permanently" below actually deletes. Every plan the app
  // creates today has exactly one item, so this is always resolvable in
  // practice; the null case is just a defensive fallback for a
  // hypothetical multi-item plan, where no single field/item is "the" one.
  function soleItemRef() {
    if (plan.items.length !== 1) return null;
    const it = plan.items[0];
    if (it.pinId != null) return { kind: "pin", id: it.pinId };
    if (it.travelItemId != null) return { kind: "travel", id: it.travelItemId };
    return null;
  }

  // Changing duration here has to stay in lockstep with the pin/travel
  // item's own duration_minutes field, so it can't just reuse applyChange
  // (which only ever touches the plan's own starts_at/ends_at). Resize the
  // plan's window first — same overlap check and revert-on-409 as any
  // other move — and only once that succeeds, patch the item's own
  // duration to match. That order means a rejected resize (slot taken)
  // never leaves the item's stored duration out of sync with what's on
  // the calendar.
  async function stepDuration(delta) {
    if (!editable) return;
    const clampedDuration = Math.max(15, durationMinutes + delta);
    if (clampedDuration === durationMinutes) return;
    const clampedStart = Math.min(Math.max(startMinute, 0), DAY_END_MIN - 15);
    const startsAt = isoForDayMinute(trip.startDate, dayIndex, clampedStart);
    const endsAt = isoForDayMinute(trip.startDate, dayIndex, clampedStart + clampedDuration);

    const prevDuration = durationMinutes;
    setDurationMinutes(clampedDuration);
    setError("");

    const result = await dispatch({ type: "MOVE_PLAN", planId: plan.id, startsAt, endsAt });
    if (!result.ok) {
      setDurationMinutes(prevDuration);
      setError(result.occupied ? "That time is already taken — try another slot." : "Couldn't save that change — try again.");
      return;
    }

    const ref = soleItemRef();
    if (ref) {
      try {
        if (ref.kind === "pin") {
          // PATCH_PIN reports failure in its result rather than throwing
          // (see state/PlannerContext.jsx) — nothing to catch, and nothing
          // worth interrupting this sheet for: the move above is what the
          // user asked for, and this is the follow-on sync.
          await dispatch({ type: "PATCH_PIN", id: ref.id, fields: { dur: clampedDuration } });
        } else {
          // ...PATCH_TRAVEL_ITEM does throw, so guard it here instead.
          await dispatch({ type: "PATCH_TRAVEL_ITEM", id: ref.id, fields: { duration_minutes: clampedDuration } });
        }
      } catch (err) {
        console.error("syncing item duration failed", err);
      }
      // PATCH_PIN/PATCH_TRAVEL_ITEM only update state.pins/state.travelItems
      // — the duration cached on this plan's own item (and its
      // total_duration_minutes/slack_minutes) come from a separate fetch,
      // so refresh plans too or they'd show the old number until something
      // else happened to reload them.
      dispatch({ type: "REFRESH_PLANS_AND_ITEMS" });
    }
  }

  // The "clear" (x) on Start time — unplaces only, no confirmation needed.
  // The pin/travel item itself is untouched and lands back in the
  // unscheduled tray (spec "Moving / unplacing"); you can just place the
  // same item again, so this behaves like clearing any other field.
  function handleClearStart() {
    if (clearing || deleting || !editable) return;
    setClearing(true);
    setError("");
    dispatch({ type: "UNPLACE_PLAN", planId: plan.id }).then((result) => {
      if (result.ok) {
        onClose();
      } else {
        setClearing(false);
        setError("Couldn't remove this item from the schedule — try again.");
      }
    });
  }

  // Lock/reopen toggle — reversible either direction from this same
  // control, so (like the ✕-clear above) it needs no confirmation step,
  // unlike "Delete permanently" below.
  async function handleToggleLock() {
    if (lockBusy) return;
    setLockBusy(true);
    setError("");
    const result = await dispatch(isLocked ? { type: "REOPEN_PLAN", planId: plan.id } : { type: "LOCK_PLAN", planId: plan.id });
    setLockBusy(false);
    if (!result.ok) {
      setError(isLocked ? "Couldn't reopen this item — try again." : "Couldn't lock this item — try again.");
    }
  }

  // "Delete permanently" — actually deletes the underlying pin or travel
  // item, not just this scheduling of it. Unplace first: the backend
  // rejects deleting a pin/travel item that's still referenced by a
  // PlanItem (backend/app/routers/pins.py, routers/travel_items.py), and
  // this plan's sole item is exactly that reference.
  function handleDeleteTap() {
    if (deleting || clearing || !editable) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      clearTimeout(deleteDisarmTimeoutRef.current);
      deleteDisarmTimeoutRef.current = setTimeout(() => setDeleteArmed(false), CONFIRM_WINDOW_MS);
      return;
    }
    clearTimeout(deleteDisarmTimeoutRef.current);
    setDeleteArmed(false);
    setDeleting(true);
    setError("");
    deletePermanently();
  }

  async function deletePermanently() {
    const ref = soleItemRef();
    const unplaceResult = await dispatch({ type: "UNPLACE_PLAN", planId: plan.id });
    if (!unplaceResult.ok) {
      setDeleting(false);
      setError("Couldn't delete this item — try again.");
      return;
    }
    if (!ref) {
      // No single underlying item to delete (defensive — every plan the
      // app creates today has exactly one). Unplacing is the best this
      // sheet can do for a multi-item plan.
      onClose();
      return;
    }
    const result = await dispatch(
      ref.kind === "pin" ? { type: "DELETE_PIN", id: ref.id } : { type: "DELETE_TRAVEL_ITEM", id: ref.id }
    );
    if (result.ok) {
      onClose();
    } else {
      setDeleting(false);
      setError("Removed it from the schedule, but couldn't delete it permanently — try again from the tray.");
    }
  }

  // Absolute, not fixed: position:fixed is relative to the browser
  // viewport, which would let this sheet spill past the app's 430px
  // .app-viewport column on wider (desktop) screens — .app-viewport is
  // position:relative, so an absolutely positioned child is contained to
  // that same centered box instead, matching every other screen in the
  // app (see styles/global.css .app-viewport).
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div
        style={{ background: "var(--surface-card)", borderRadius: "20px 20px 0 0", padding: "10px 18px 28px", width: "100%", maxHeight: "88vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 16px" }} />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div className="mono-caption">{isLocked ? "Locked" : plan.status === "pencilled" ? "Unconfirmed" : "Scheduled"}</div>
            <div className="serif-place" style={{ fontSize: 19, marginTop: 3, color: "var(--text-primary)" }}>
              {title}
            </div>
            <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 3 }}>
              {clockLabel(startMinute)}–{clockLabel(endMinute)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flex: "none" }}>
            {currentUser.isOwner && (
              // Lock icon lives in the header, next to the status it
              // changes — not in the destructive-action footer below,
              // since this is a routine, reversible toggle rather than a
              // "you can't undo this" action like Delete permanently.
              <button
                type="button"
                onClick={handleToggleLock}
                disabled={lockBusy}
                aria-label={isLocked ? "Reopen — unlock this item" : "Lock this item in place"}
                title={isLocked ? "Reopen — unlock this item" : "Lock this item in place"}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: isLocked ? "var(--accent)" : "var(--surface-page)",
                  border: isLocked ? "none" : "1px solid var(--border)",
                  font: "400 13px var(--font-sans)",
                  color: isLocked ? "#fff" : "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {lockBusy ? (
                  "…"
                ) : (
                  // Open padlock when not locked (tap to lock), closed
                  // when locked (tap to reopen) — this toggle is the one
                  // place in the app that shows the unlocked state at
                  // all, so it's the only spot that needs faLockOpen;
                  // PlanBlock.jsx only ever renders a locked plan, so it
                  // stays on the closed faLock alone. Flat, monochrome
                  // (fill: currentColor), inheriting this button's own
                  // color (white when locked/filled, --text-secondary
                  // when outline).
                  <FontAwesomeIcon icon={isLocked ? faLock : faLockOpen} style={{ width: 13, height: 13 }} />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ flex: "none", width: 28, height: 28, borderRadius: "50%", background: "var(--surface-page)", border: "1px solid var(--border)", font: "400 13px var(--font-sans)", color: "var(--text-secondary)" }}
            >
              ✕
            </button>
          </div>
        </div>

        {!editable && (
          <div style={{ marginTop: 14, padding: "10px 13px", borderRadius: "var(--radius-lg)", background: "var(--plum-tint)", font: "500 12px var(--font-sans)", color: "var(--accent)" }}>
            {isLocked
              ? currentUser.isOwner
                ? "This item is locked — tap the lock icon above to reopen it."
                : "This item is locked in place by the trip owner."
              : `This item is ${plan.status} and cannot be edited from here.`}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 14, padding: "8px 13px", borderRadius: "var(--radius-lg)", background: "var(--warn-tint, #fdf1e6)", font: "500 12px var(--font-sans)", color: "var(--warn, #a15c1a)" }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="mono-caption">Day</div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 6, paddingBottom: 2 }}>
              {tripDays.map((d, i) => {
                const n = i + 1;
                const selected = n === dayIndex;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={!editable}
                    onClick={() => handleDayChange(n)}
                    style={{
                      flex: "none",
                      width: 44,
                      padding: "6px 0",
                      borderRadius: "var(--radius-md)",
                      background: selected ? "var(--surface-inverse)" : "var(--surface-page)",
                      border: selected ? "none" : "1px solid var(--border)",
                      textAlign: "center",
                      opacity: editable ? 1 : 0.6,
                    }}
                  >
                    <div className="mono-data-sm" style={{ color: selected ? "rgba(255,255,255,.6)" : "var(--text-faint)" }}>
                      {d.dow}
                    </div>
                    <div style={{ font: "600 13px var(--font-sans)", marginTop: 1, color: selected ? "#fff" : "var(--text-primary)" }}>{d.n}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="mono-caption">Start time</div>
              <div style={{ position: "relative", marginTop: 6 }}>
                <input
                  type="time"
                  step={900}
                  value={timeValue}
                  disabled={!editable}
                  onChange={handleTimeChange}
                  style={{
                    width: "100%",
                    height: 46,
                    padding: "0 34px 0 13px",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--border-strong)",
                    background: "var(--surface-page)",
                    font: "600 14px var(--font-sans)",
                    color: "var(--text-primary)",
                    opacity: editable ? 1 : 0.6,
                  }}
                />
                {editable && (
                  <button
                    type="button"
                    onClick={handleClearStart}
                    disabled={clearing || deleting}
                    aria-label="Clear start time — removes this item from the schedule"
                    title="Clear — removes this item from the schedule"
                    style={{
                      position: "absolute",
                      top: "50%",
                      right: 6,
                      transform: "translateY(-50%)",
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      border: "none",
                      background: "transparent",
                      color: "var(--text-muted)",
                      font: "600 15px var(--font-sans)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {clearing ? "…" : "✕"}
                  </button>
                )}
              </div>
            </div>
            <Stepper label="Duration" valueLabel={fmtMin(durationMinutes)} onDown={() => stepDuration(-15)} onUp={() => stepDuration(15)} />
          </div>
        </div>

        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <button
              type="button"
              onClick={handleDeleteTap}
              disabled={deleting || clearing || !editable}
              style={{
                width: "100%",
                height: 48,
                borderRadius: "var(--radius-lg)",
                background: deleteArmed ? "var(--danger, #b3261e)" : "var(--surface-page)",
                border: deleteArmed ? "none" : "1px solid var(--border-strong)",
                color: deleteArmed ? "#fff" : "var(--danger, #b3261e)",
                font: "600 14px var(--font-sans)",
                opacity: editable ? 1 : 0.6,
                transition: "background var(--dur-base, .15s) var(--ease-standard, ease)",
              }}
            >
              {deleting ? "Deleting…" : deleteArmed ? "confirm?" : "Delete permanently"}
            </button>
            <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingTop: 8 }}>
              {deleteArmed ? "Tap once more to confirm — this can't be undone." : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
