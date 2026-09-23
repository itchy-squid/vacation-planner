import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faPlus } from "@fortawesome/free-solid-svg-icons";
import PlanBlock from "../components/planner/PlanBlock";
import PlanDetailsSheet from "../components/planner/PlanDetailsSheet";
import DayGrid from "../components/planner/DayGrid";
import AddSheet from "../components/planner/AddSheet";
import { usePlannerState, usePlannerDispatch, useCurrentUser, useCan, useMyTraveler } from "../state/PlannerContext";
import { getTripDays } from "../data/trip";
import { dayHeaderLabel } from "../data/schedule";
import { dayIndexForDate, isoForDayMinute, clockLabel } from "../lib/planTime";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  PX_PER_MIN,
  SNAP_MIN,
  contestWindowsFrom,
  layoutDayPlans,
  plansOnDay,
  splitBandsFrom,
  minuteFromOffsetY,
  planDurationMinutes,
  planStartMinute,
  planEndMinute,
  topForMinute,
} from "../lib/dayGrid";
import TripHeader from "../components/core/TripHeader";
import { membersOf, namesOf, partiesMeet, planIncludes, takesNewcomers } from "../lib/party";

// Screen 4 — tap-to-place calendar. Handoff README screen 4, rebuilt
// against the spec's Plan/PlanItem/Contest model (see docs/features/
// scheduling-feature-spec.md "Calendar grid" + "Direct placement" +
// "Propose an alternative"). Every day can have any number of open
// contests now — there's no more hardcoded "Day 5" special case (see
// state/PlannerContext.jsx normalizePlan/loadTripView).
//
// The grid itself — its geometry, its snapping, and the column-packing
// sweep that lays overlapping plans side by side — lives in
// lib/dayGrid.js and components/planner/DayGrid.jsx, because the proposal
// flow's hour picker renders the same grid with a selection layer over it
// rather than a lookalike of it (see pages/ProposeBlock.jsx).
const DRAG_THRESHOLD_PX = 5; // pointer travel (px) before a pointer-down on a block counts as a drag rather than a tap

export default function DaySchedule() {
  const navigate = useNavigate();
  const { day } = useParams();
  const dayIndex = Number(day) || 1;
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const { trip, pins, travelItems, plans, placing, proposeSheet, travelers } = state;
  // Groups are made of travelers; "just me" is the traveler you are.
  const myTraveler = useMyTraveler();
  const myTravelerId = myTraveler?.id ?? null;

  const currentUser = useCurrentUser();
  // Readers see the day but can't place, drag or propose. Companions can
  // propose a block (plans:propose) but not place or drag (plans:write).
  const can = useCan();
  const canPlan = can("plans:write");
  const canPropose = can("plans:propose");

  // Drafts are excluded from the grid, from the overlap checks and from
  // the tray's "unplaced" reckoning: a draft block claims no time and is
  // visible to its author alone (feature spec §6.4). The API already
  // filters out *other* people's; this filters out your own, which you're
  // meant to see in the tray rather than on the calendar.
  // Every plan *touching* this day, not every plan starting on it — an
  // overnight ferry owns tomorrow morning's hours too (lib/dayGrid.js
  // planOnDay). Entries carry the plan plus its minutes relative to this
  // day, which is what everything below lays out and tests against.
  const dayEntries = useMemo(
    () => plansOnDay(plans.filter((p) => p.status !== "draft"), trip.startDate, dayIndex),
    [plans, trip.startDate, dayIndex]
  );

  // "N blocks open" — hours on this day already out for a vote.
  const openBlocks = useMemo(() => contestWindowsFrom(dayEntries), [dayEntries]);

  const myDrafts = useMemo(
    () =>
      plans.filter(
        (p) =>
          p.status === "draft" &&
          p.createdById === currentUser.id &&
          p.startDt &&
          dayIndexForDate(p.startDt, trip.startDate) === dayIndex
      ),
    [plans, currentUser.id, trip.startDate, dayIndex]
  );

  // Split-party plans (lib/party.js). Where the group has split, the grid
  // brackets those hours and says how; "Just me" then drops the branches
  // you're not on, so the day reads as your day. The brackets always come
  // from the whole day — a split you're on one side of is still a split.
  const splitBands = useMemo(() => splitBandsFrom(dayEntries), [dayEntries]);
  const dayHasSplit = splitBands.length > 0 || dayEntries.some((e) => !e.plan.forEveryone);
  const [justMe, setJustMe] = useState(false);
  const showJustMe = justMe && dayHasSplit && myTravelerId != null;
  const visibleEntries = useMemo(
    () => (showJustMe ? dayEntries.filter((e) => planIncludes(e.plan, myTravelerId)) : dayEntries),
    [showJustMe, dayEntries, myTravelerId]
  );
  const laidOut = useMemo(() => layoutDayPlans(visibleEntries), [visibleEntries]);

  // Region(s) this day already has scheduled — derived from the pins
  // behind this day's plan items (travel items have no region).
  const dayRegions = useMemo(() => {
    const set = new Set();
    dayEntries.forEach(({ plan }) =>
      plan.items.forEach((it) => {
        const pin = it.pinId ? pins[it.pinId] : null;
        if (pin?.region) set.add(pin.region);
      })
    );
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [dayEntries, pins]);

  const region = useMemo(() => {
    if (!dayRegions.length) return "Trip";
    return dayRegions.length === 1 ? dayRegions[0] : dayRegions.join(" · ");
  }, [dayRegions]);

  const allTripRegions = useMemo(() => {
    const set = new Set(Object.values(pins).map((p) => p.region).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [pins]);

  const tripDays = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);

  // Day strip marquee (unchanged behaviour from the original screen).
  const dayStripRef = useRef(null);
  const dayRefs = useRef({});
  const holdRef = useRef({ timeout: null, interval: null });
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = dayStripRef.current;
    if (!el) return undefined;
    const updateScrollState = () => {
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    };
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [tripDays.length]);

  const didMountScroll = useRef(false);
  useEffect(() => {
    const el = dayRefs.current[dayIndex];
    if (!el) return;
    el.scrollIntoView({ behavior: didMountScroll.current ? "smooth" : "auto", inline: "center", block: "nearest" });
    didMountScroll.current = true;
  }, [dayIndex, tripDays.length]);

  useEffect(
    () => () => {
      clearTimeout(holdRef.current.timeout);
      clearInterval(holdRef.current.interval);
    },
    []
  );

  function clearHold() {
    clearTimeout(holdRef.current.timeout);
    clearInterval(holdRef.current.interval);
  }
  function nudgeDayStrip(direction) {
    const el = dayStripRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * (el.clientWidth * 0.7), behavior: "smooth" });
  }
  function startHold(direction) {
    nudgeDayStrip(direction);
    clearHold();
    holdRef.current.timeout = setTimeout(() => {
      holdRef.current.interval = setInterval(() => nudgeDayStrip(direction), 260);
    }, 380);
  }

  // ---- Placement (tap-to-place) ----------------------------------------
  const [moveError, setMoveError] = useState("");
  const [detailsPlanId, setDetailsPlanId] = useState(null);

  // Returns the day *entry* in the way, not the plan — the caller needs
  // both the plan (to target a proposal at it) and the hours it occupies
  // on this particular day.
  //
  // `forPlan` is the plan being moved (null for something new, which is
  // for everyone); only a plan someone would be on twice is in the way,
  // the same rule the server applies (backend/app/party.py).
  function findOverlap(startMinute, endMinute, excludePlanId, forPlan = null) {
    return (
      dayEntries.find(
        (e) =>
          e.plan.id !== excludePlanId &&
          startMinute < e.endMin &&
          endMinute > e.startMin &&
          partiesMeet(e.plan, forPlan)
      ) ?? null
    );
  }

  async function handleTapAt(rawMinute) {
    if (!placing) return;
    const snapped = Math.round(rawMinute / SNAP_MIN) * SNAP_MIN;
    const startMinute = Math.min(Math.max(snapped, DAY_START_MIN), DAY_END_MIN - 15);
    const endMinute = startMinute + placing.durationMinutes;
    const occupying = findOverlap(startMinute, endMinute, null);

    if (occupying) {
      // A locked plan can't be proposed against — reopening it first is
      // required (spec "Calendar grid": "Tapping time occupied by a
      // locked plan is a no-op"; backend/app/routers/contests.py
      // propose_alternative 403s the same case). Placing stays armed so
      // the person can just tap a different slot instead of losing their
      // in-progress placement over a tap that landed wrong.
      if (occupying.plan.status === "locked") {
        setMoveError("That time is locked — ask the owner to reopen it first.");
        return;
      }
      dispatch({
        type: "OPEN_PROPOSE_FOR",
        proposeSheet: {
          targetPlanId: occupying.plan.id,
          // Proposing against a branch is a decision for that branch.
          party: occupying.plan.party ?? [],
          partyMode: occupying.plan.partyMode ?? "only",
          dayIndex,
          startMinute,
          kind: placing.kind,
          refId: placing.refId,
          durationMinutes: placing.durationMinutes,
          label: placing.label,
        },
      });
      return;
    }

    setMoveError("");
    const startsAt = isoForDayMinute(trip.startDate, dayIndex, startMinute);
    const endsAt = isoForDayMinute(trip.startDate, dayIndex, endMinute);
    await dispatch({ type: "PLACE_AT", startsAt, endsAt, dayIndex, startMinute });
  }

  function handleGridClick(e) {
    if (e.target !== e.currentTarget) return; // block taps handle their own onClick
    if (!placing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    handleTapAt(minuteFromOffsetY(e.clientY - rect.top));
  }

  const suppressClickRef = useRef(false);
  function handlePlanTap(plan) {
    if (placing) return; // ignore taps on existing plans while armed — cancel first
    if (suppressClickRef.current) {
      // A drag just ended on this block — browsers still fire the trailing
      // click, but it shouldn't also navigate to the item's details page.
      suppressClickRef.current = false;
      return;
    }
    // Contested plans, and locked plans that won a contest, go to the
    // compare screen — that's where the contest's other side and the
    // reopen action live. A plan locked directly (no contest — see
    // components/planner/PlanDetailsSheet.jsx's lock button) has no
    // contest to show, so it opens the same details sheet as placed/
    // pencilled plans, just in its read-only + reopen state.
    if (plan.status === "contested" || (plan.status === "locked" && plan.contestId)) {
      navigate(`/trips/${trip.id}/contests/${plan.contestId}`);
      return;
    }
    // Placed/pencilled plans open a details sheet (not a routed page —
    // see components/planner/PlanDetailsSheet.jsx for why) where the date,
    // time, and duration can be adjusted and the item can be deleted
    // (double-tap-to-confirm).
    setDetailsPlanId(plan.id);
  }

  function cancelPlacing() {
    setMoveError("");
    dispatch({ type: "CANCEL_PLACING" });
  }

  // ---- Drag-to-reschedule -------------------------------------------------
  // Dragging a placed/pencilled block changes only its start time — the
  // duration is fixed, so the block just slides up/down the grid and the
  // end time follows along. This replaces the old tap-to-arm "Move" flow;
  // contested/locked plans still only respond to a tap (which opens the
  // compare screen). dragInfoRef holds the in-progress gesture (kept out
  // of state so pointermove doesn't need a state read on every event);
  // dragPreview is the bit of it the render actually needs.
  const dragInfoRef = useRef(null); // { pointerId, planId, startClientY, originStart, durationMinutes, moved }
  const [dragPreview, setDragPreview] = useState(null); // { planId, previewStart, durationMinutes }

  function planPreviewStart(info, clientY) {
    const deltaMinutes = (clientY - info.startClientY) / PX_PER_MIN;
    const raw = info.originStart + deltaMinutes;
    const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
    // Clamped by the block's START, not by where its end would land: a
    // 12h item used to be undraggable past noon, and it simply stopped
    // following your finger with no explanation. Its tail is allowed to
    // run into tomorrow now (lib/planTime.js isoForDayMinute carries it).
    return Math.min(Math.max(snapped, DAY_START_MIN), DAY_END_MIN - SNAP_MIN);
  }

  function handlePlanPointerDown(e, plan, entry) {
    if (placing || !canPlan) return;
    if (plan.status !== "placed" && plan.status !== "pencilled") return; // contested/locked aren't draggable
    // A plan is moved from the day it begins on. Dragging the morning
    // tail of last night's crossing would be moving a block whose start
    // isn't on screen, which is not something to reason about mid-drag.
    if (entry?.continuesBefore) return;
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragInfoRef.current = {
      pointerId: e.pointerId,
      planId: plan.id,
      startClientY: e.clientY,
      originStart: entry.startMin,
      durationMinutes: planDurationMinutes(plan),
      moved: false,
    };
  }

  function handlePlanPointerMove(e, plan) {
    const info = dragInfoRef.current;
    if (!info || info.pointerId !== e.pointerId || info.planId !== plan.id) return;
    if (!info.moved) {
      if (Math.abs(e.clientY - info.startClientY) < DRAG_THRESHOLD_PX) return;
      info.moved = true;
      suppressClickRef.current = true;
      setMoveError("");
    }
    e.preventDefault();
    setDragPreview({ planId: plan.id, durationMinutes: info.durationMinutes, previewStart: planPreviewStart(info, e.clientY) });
  }

  async function handlePlanPointerUp(e, plan) {
    const info = dragInfoRef.current;
    if (!info || info.pointerId !== e.pointerId || info.planId !== plan.id) return;
    dragInfoRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!info.moved) return; // a plain tap — the click handler opens the item's details page

    const previewStart = planPreviewStart(info, e.clientY);
    setDragPreview(null);
    if (previewStart === info.originStart) return; // dropped back where it started

    const endMinute = previewStart + info.durationMinutes;
    const inTheWay = findOverlap(previewStart, endMinute, plan.id, plan);
    if (inTheWay) {
      const clash = !plan.forEveryone || !inTheWay.plan.forEveryone
        ? membersOf(inTheWay.plan, travelers).filter((t) => planIncludes(plan, t.id))
        : [];
      setMoveError(
        clash.length
          ? `${namesOf(clash)} ${clash.length === 1 ? "is" : "are"} already busy then — try another slot.`
          : "That time is already taken — try another slot."
      );
      return;
    }

    const startsAt = isoForDayMinute(trip.startDate, dayIndex, previewStart);
    const endsAt = isoForDayMinute(trip.startDate, dayIndex, endMinute);
    const result = await dispatch({ type: "MOVE_PLAN", planId: plan.id, startsAt, endsAt });
    if (!result.ok) {
      setMoveError(result.message && result.message !== "That time is already occupied." ? result.message : "That time is already taken — try another slot.");
    }
  }

  function handlePlanPointerCancel(e, plan) {
    const info = dragInfoRef.current;
    if (!info || info.pointerId !== e.pointerId || info.planId !== plan.id) return;
    dragInfoRef.current = null;
    setDragPreview(null);
  }

  // ---- Propose sheet -----------------------------------------------------
  const targetPlan = proposeSheet ? plans.find((p) => p.id === proposeSheet.targetPlanId) : null;
  const targetLabel = targetPlan ? targetPlan.items.map((i) => i.title).join(" + ") || targetPlan.label : "that slot";

  async function confirmPropose() {
    if (!proposeSheet) return;
    const startsAt = isoForDayMinute(trip.startDate, proposeSheet.dayIndex, proposeSheet.startMinute);
    const endsAt = isoForDayMinute(trip.startDate, proposeSheet.dayIndex, proposeSheet.startMinute + proposeSheet.durationMinutes);
    const result = await dispatch({ type: "CONFIRM_PROPOSE", startsAt, endsAt });
    if (result.ok && result.contestId) {
      navigate(`/trips/${trip.id}/contests/${result.contestId}`);
      return;
    }
    // Those hours already have a vote running: the useful move is to show
    // it, not to report a failure — this proposal is a set that belongs on
    // that decision.
    if (result.conflict === "contest" && result.contestId) {
      dispatch({ type: "CLOSE_PROPOSE" });
      navigate(`/trips/${trip.id}/contests/${result.contestId}`);
      return;
    }
    dispatch({ type: "CLOSE_PROPOSE" });
    setMoveError(
      result.conflict === "locked"
        ? "That time is pinned — ask the owner to reopen it first."
        : "Couldn't propose that — try again."
    );
  }

  // ---- Unplaced pins + travel items --------------------------------------
  // Unfiltered: the bar below counts everything not on the calendar, and
  // the region filter now lives inside the picker that shows them
  // (components/planner/AddSheet.jsx), not out here.
  const unplacedPins = useMemo(() => {
    const placedIds = new Set();
    plans
      .filter((p) => p.status !== "draft")
      .forEach((p) => p.items.forEach((it) => it.pinId && placedIds.add(it.pinId)));
    return Object.values(pins).filter((p) => !placedIds.has(p.id));
  }, [plans, pins]);

  const unplacedTravelItems = useMemo(() => {
    const placedIds = new Set();
    plans
      .filter((p) => p.status !== "draft")
      .forEach((p) => p.items.forEach((it) => it.travelItemId && placedIds.add(it.travelItemId)));
    return Object.values(travelItems).filter((t) => !placedIds.has(t.id));
  }, [plans, travelItems]);

  // "+ Add" opens components/planner/AddSheet.jsx, which owns everything
  // the dark tray used to lay out in full: the unplaced items, the region
  // filter over them, the two-tap delete, and the custom-event form.
  const [addOpen, setAddOpen] = useState(false);
  const unplacedCount = unplacedPins.length + unplacedTravelItems.length;

  return (
    <div className="screen">
      <div style={{ flex: "none", background: "var(--surface-page)", borderBottom: "1px solid var(--hairline)" }}>
        <TripHeader />
        <div style={{ padding: "6px var(--gutter-text) 12px" }}>
          <div className="mono-caption">Scheduling · {region}</div>
          {/* Kept as this screen's heading: it's the day you're looking at,
              which the header's trip name doesn't say. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="serif-place" style={{ flex: 1, minWidth: 0, fontSize: 24, marginTop: 2, color: "var(--text-primary)" }}>
              {dayHeaderLabel(dayIndex, trip.startDate, trip.endDate)}
            </div>
            {/* Hidden at zero — an empty "0 blocks open" would be chrome
                announcing nothing. Goes to the first of them; the Compare
                tab is how you reach any others. */}
            {openBlocks.length > 0 && (
              <button
                type="button"
                onClick={() => navigate(`/trips/${trip.id}/contests/${openBlocks[0].contestId}`)}
                style={{
                  flex: "none",
                  padding: "5px 11px",
                  borderRadius: "var(--radius-xl)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border)",
                  font: "500 11px var(--font-sans)",
                  color: "var(--text-secondary)",
                }}
              >
                {openBlocks.length} block{openBlocks.length === 1 ? "" : "s"} open
              </button>
            )}
          </div>
        </div>

        <div className="day-marquee" style={{ position: "relative" }}>
          <div
            ref={dayStripRef}
            style={{ display: "flex", gap: 6, padding: "0 var(--gutter-screen) 16px", overflowX: "auto", scrollSnapType: "x proximity", WebkitOverflowScrolling: "touch" }}
          >
            {tripDays.map((d, i) => {
              const n = i + 1;
              const selected = n === dayIndex;
              return (
                <button
                  key={n}
                  ref={(el) => {
                    dayRefs.current[n] = el;
                  }}
                  onClick={() => navigate(`/trips/${trip.id}/schedule/${n}`)}
                  style={{
                    flex: "none",
                    width: 38,
                    padding: "6px 0",
                    borderRadius: "var(--radius-md)",
                    background: selected ? "var(--surface-inverse)" : "var(--surface-card)",
                    border: selected ? "none" : "1px solid var(--border)",
                    textAlign: "center",
                    scrollSnapAlign: "center",
                  }}
                >
                  <div className="mono-data-sm" style={{ color: selected ? "rgba(255,255,255,.6)" : "var(--text-faint)", letterSpacing: 0 }}>{d.dow}</div>
                  <div style={{ font: "600 14px var(--font-sans)", marginTop: 1, color: selected ? "#fff" : "var(--text-primary)" }}>{d.n}</div>
                </button>
              );
            })}
          </div>

          <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 16, left: 0, width: 20, background: "linear-gradient(to right, var(--surface-page), transparent)", opacity: canLeft ? 1 : 0, transition: "opacity .15s ease", pointerEvents: "none" }} />
          <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 16, right: 0, width: 20, background: "linear-gradient(to left, var(--surface-page), transparent)", opacity: canRight ? 1 : 0, transition: "opacity .15s ease", pointerEvents: "none" }} />

          {canLeft && (
            <button type="button" className="day-marquee-nudge" aria-label="Show earlier days" onMouseDown={() => startHold(-1)} onMouseUp={clearHold} onMouseLeave={clearHold} style={navButtonStyle("left")}>
              ‹
            </button>
          )}
          {canRight && (
            <button type="button" className="day-marquee-nudge" aria-label="Show later days" onMouseDown={() => startHold(1)} onMouseUp={clearHold} onMouseLeave={clearHold} style={navButtonStyle("right")}>
              ›
            </button>
          )}
        </div>

        {/* Whose day to show. Pinned to the header with the day strip so it
            stays in reach wherever the grid is scrolled — inside the scroll
            body it sat above 00:00 and meant scrolling to midnight to use. */}
        {dayHasSplit && myTraveler && (
          <div
            role="group"
            aria-label="Whose day to show"
            style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2, margin: "0 var(--gutter-screen) 12px" }}
          >
            {[
              { value: false, label: "Everyone" },
              { value: true, label: `Just me · ${myTraveler.name}` },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                aria-pressed={justMe === opt.value}
                onClick={() => setJustMe(opt.value)}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: "calc(var(--radius-md) - 2px)",
                  background: justMe === opt.value ? "var(--surface-card)" : "transparent",
                  boxShadow: justMe === opt.value ? "var(--shadow-raised)" : "none",
                  font: "600 11.5px var(--font-sans)",
                  color: justMe === opt.value ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {/* Pinned to the header (not the .screen-scroll body below) so it
            stays visible the whole time placing mode is armed, even once
            the user has scrolled the grid down to find a slot — it used to
            live inside .screen-scroll and would scroll out of view along
            with everything else, taking the only way to cancel with it. */}
        {placing && (
          <div style={{ margin: "10px var(--gutter-screen) 14px", padding: "10px 13px", borderRadius: "var(--radius-lg)", background: "var(--plum-tint)", border: "1px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ font: "500 12px var(--font-sans)", color: "var(--accent)" }}>
              {`Placing ${placing.label} — tap the calendar`}
            </div>
            <button type="button" onClick={cancelPlacing} style={{ font: "600 12px var(--font-sans)", color: "var(--accent)", flex: "none" }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="screen-scroll" style={{ paddingTop: 12, paddingBottom: 24 }}>
        {moveError && (
          <div style={{ margin: "0 var(--gutter-screen) 12px", padding: "8px 13px", borderRadius: "var(--radius-lg)", background: "var(--warn-tint, #fdf1e6)", font: "500 12px var(--font-sans)", color: "var(--warn, #a15c1a)" }}>
            {moveError}
          </div>
        )}

        <div style={{ background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", padding: "18px 16px 24px" }}>
          <DayGrid cursor={placing ? "crosshair" : "default"} onClick={handleGridClick}>
            {splitBands.map((band) => {
              const top = topForMinute(Math.max(band.startMin, DAY_START_MIN));
              const height = (Math.min(band.endMin, DAY_END_MIN) - Math.max(band.startMin, DAY_START_MIN)) * PX_PER_MIN;
              const elsewhere = band.groups
                .filter((g) => !planIncludes(g, myTravelerId))
                .flatMap((g) => membersOf(g, travelers));
              const counts = band.groups.map((g) => membersOf(g, travelers).length).join(" + ");
              return (
                <div
                  key={`split-${band.startMin}`}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: top - 3,
                    height: height + 6,
                    left: -3,
                    right: -3,
                    border: "1.5px dashed var(--border-strong)",
                    borderRadius: "var(--radius-md)",
                    pointerEvents: "none",
                  }}
                >
                  <span
                    className="mono-data-sm"
                    style={{
                      position: "absolute",
                      right: 8,
                      top: -8,
                      padding: "0 5px",
                      background: "var(--surface-card)",
                      color: "var(--text-secondary)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {showJustMe && elsewhere.length ? `${namesOf(elsewhere)} elsewhere` : `Group split · ${counts}`}
                  </span>
                </div>
              );
            })}
            {laidOut.map((entry) => {
                const { plan, numCols, col } = entry;
                const isDragging = dragPreview?.planId === plan.id;
                const draggable =
                  canPlan && (plan.status === "placed" || plan.status === "pencilled") && !entry.continuesBefore;
                // The block's span on THIS day, which can start before
                // 00:00 or end after 24:00. The rectangle is clipped to
                // the grid; the arrows say which way it runs on.
                const startMin = isDragging ? dragPreview.previewStart : entry.startMin;
                const endMin = startMin + planDurationMinutes(plan);
                const clippedStart = Math.max(startMin, DAY_START_MIN);
                const clippedEnd = Math.min(endMin, DAY_END_MIN);
                const top = topForMinute(clippedStart);
                const height = (clippedEnd - clippedStart) * PX_PER_MIN;
                const width = `calc(${100 / numCols}% - 4px)`;
                const left = `calc(${(col / numCols) * 100}% + 2px)`;
                // While dragging, show the block's live candidate time (not
                // just its position) — duration is fixed, only the start
                // (and so the end) moves. `% 1440` here is the clock face,
                // not the span: a tail dragged past midnight reads 01:30,
                // and the arrow below says it belongs to tomorrow.
                const wrapClock = (m) => ((m % 1440) + 1440) % 1440;
                const displayPlan = isDragging
                  ? {
                      ...plan,
                      startDt: plan.startDt ? { ...plan.startDt, minuteOfDay: wrapClock(startMin) } : plan.startDt,
                      endDt: plan.endDt ? { ...plan.endDt, minuteOfDay: wrapClock(endMin) } : plan.endDt,
                    }
                  : plan;
                return (
                  <div
                    key={plan.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlanTap(plan);
                    }}
                    onPointerDown={(e) => handlePlanPointerDown(e, plan, entry)}
                    onPointerMove={(e) => handlePlanPointerMove(e, plan)}
                    onPointerUp={(e) => handlePlanPointerUp(e, plan)}
                    onPointerCancel={(e) => handlePlanPointerCancel(e, plan)}
                    style={{
                      touchAction: draggable ? "none" : undefined,
                      cursor: draggable ? (isDragging ? "grabbing" : "grab") : undefined,
                      opacity: isDragging ? 0.85 : 1,
                    }}
                  >
                    <PlanBlock
                      plan={displayPlan}
                      rect={{ top, height, left, width }}
                      continuesBefore={startMin < DAY_START_MIN}
                      continuesAfter={endMin > DAY_END_MIN}
                      onTap={() => {}}
                      faces={plan.forEveryone ? null : membersOf(plan, travelers)}
                      newcomers={takesNewcomers(plan)}
                      tightFaces={numCols >= 3}
                    />
                  </div>
                );
            })}
          </DayGrid>
        </div>
      </div>

      {/* The whole tray, collapsed to one row. It used to stack five
          things here — a caption, a region-filter rail, a horizontal strip
          of unplaced cards, "Propose a block", and any drafts — roughly
          300px of a 874pt phone, which is most of a day's worth of grid.
          Everything but the drafts moved behind "+ Add"
          (components/planner/AddSheet.jsx); see
          docs/features/scheduling-feature-spec.md "Tray". */}
      <div style={{ background: "var(--surface-inverse)", padding: "12px 16px 40px", flex: "none" }}>
        {!canPropose ? (
          // Readers: the bar keeps its place (and the room it leaves for
          // the tab bar) but says why there's nothing to add.
          <div style={{ minHeight: 46, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ font: "500 13px var(--font-sans)", color: "var(--text-on-dark)" }}>View only</span>
            <span style={{ font: "400 12px var(--font-sans)", color: "var(--text-on-dark-muted)", textAlign: "right" }}>
              Ask {trip.owner?.name ?? "the owner"} if you need to make changes
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              style={{
                flex: 1,
                height: 46,
                borderRadius: "var(--radius-lg)",
                background: "var(--accent)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                font: "600 14px var(--font-sans)",
              }}
            >
              <FontAwesomeIcon icon={faPlus} style={{ width: 13, height: 13 }} />
              Add
            </button>
            {/* The count was the one genuinely useful thing the tray caption
                said, so it survives as a second target straight into the
                picker rather than as dead text. */}
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              disabled={unplacedCount === 0}
              style={{
                flex: "none",
                height: 46,
                padding: "0 13px",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--border-on-dark)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                font: "500 12px var(--font-sans)",
                color: "var(--text-on-dark-muted)",
                opacity: unplacedCount === 0 ? 0.45 : 1,
              }}
            >
              {unplacedCount} unplaced
              <FontAwesomeIcon icon={faChevronRight} style={{ width: 9, height: 9 }} />
            </button>
          </div>
        )}

        {/* Your own unpublished drafts for this day stay on the surface.
            Nobody else can see these, which is exactly why they need
            somewhere to be seen — an invisible draft with no way back
            into it is just lost work. */}
        {myDrafts.map((draft) => (
          <button
            key={draft.id}
            type="button"
            onClick={() =>
              navigate(`/trips/${trip.id}/schedule/${dayIndex}/propose`, { state: { draftPlanId: draft.id } })
            }
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px 13px",
              borderRadius: "var(--radius-md)",
              border: "1px dashed rgba(255,255,255,.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              textAlign: "left",
            }}
          >
            <span style={{ font: "500 12px var(--font-sans)", color: "var(--text-on-dark)" }}>
              {draft.label || "Draft block"} ·{" "}
              {clockLabel(planStartMinute(draft))}–{clockLabel(planEndMinute(draft))}
            </span>
            <span className="mono-data-sm" style={{ color: "var(--text-on-dark-muted)", flex: "none" }}>
              Draft
            </span>
          </button>
        ))}
      </div>

      {addOpen && canPropose && (
        <AddSheet
          dayIndex={dayIndex}
          canPlace={canPlan}
          onClose={() => setAddOpen(false)}
          unplacedPins={unplacedPins}
          unplacedTravelItems={unplacedTravelItems}
          dayRegions={dayRegions}
          allTripRegions={allTripRegions}
        />
      )}

      <PlanDetailsSheet planId={detailsPlanId} onClose={() => setDetailsPlanId(null)} />

      {proposeSheet && (
        // Absolute, not fixed — see components/planner/PlanDetailsSheet.jsx's
        // comment on why: fixed would let this sheet spill past the app's
        // 430px .app-viewport column on wider screens instead of staying
        // inside it like every other screen.
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={() => dispatch({ type: "CLOSE_PROPOSE" })}>
          <div
            style={{ background: "var(--surface-card)", borderRadius: "20px 20px 0 0", padding: "18px 18px 28px", width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 14px" }} />
            <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>Propose an alternative</div>
            <div style={{ marginTop: 8, font: "400 13px var(--font-sans)", lineHeight: 1.5, color: "var(--text-secondary)" }}>
              That time already has <strong>{targetLabel}</strong>. Propose <strong>{proposeSheet.label}</strong> at{" "}
              {clockLabel(proposeSheet.startMinute)}–{clockLabel(proposeSheet.startMinute + proposeSheet.durationMinutes)} instead? The group will vote, and the trip owner locks one.
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button type="button" onClick={() => dispatch({ type: "CLOSE_PROPOSE" })} style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}>
                Cancel
              </button>
              <button type="button" onClick={confirmPropose} style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", font: "600 13px var(--font-sans)" }}>
                Propose
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function navButtonStyle(edge) {
  return {
    position: "absolute",
    top: "50%",
    [edge]: 2,
    transform: "translateY(-50%)",
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "var(--surface-card)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-raised)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "400 13px var(--font-sans)",
    color: "var(--text-primary)",
    zIndex: 3,
  };
}
