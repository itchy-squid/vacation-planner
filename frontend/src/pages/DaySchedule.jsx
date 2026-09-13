import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PlanBlock from "../components/planner/PlanBlock";
import PlanDetailsSheet from "../components/planner/PlanDetailsSheet";
import PhotoPlaceholder from "../components/core/PhotoPlaceholder";
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";
import { getTripDays } from "../data/trip";
import { dayHeaderLabel } from "../data/schedule";
import { dayIndexForDate, isoForDayMinute, clockLabel } from "../lib/planTime";
import TripHeader from "../components/core/TripHeader";

// Screen 4 — tap-to-place calendar. Handoff README screen 4, rebuilt
// against the spec's Plan/PlanItem/Contest model (see docs/features/
// scheduling-feature-spec.md "Calendar grid" + "Direct placement" +
// "Propose an alternative"). Every day can have any number of open
// contests now — there's no more hardcoded "Day 5" special case (see
// state/PlannerContext.jsx normalizePlan/loadTripView).
//
// The grid uses true minute-to-pixel positioning (PX_PER_MIN below)
// instead of the old duration-heuristic block heights, so a 30-minute
// stop is visibly half the height of a 60-minute one. Overlapping plans
// (mainly: two contested Plans sharing the same slot) are laid out
// side-by-side via layoutDayPlans()'s column-packing sweep, the same
// technique most calendar UIs use.
const PX_PER_MIN = 1;
const DAY_START_MIN = 0; // 00:00 — grid always shows the full midnight-to-midnight day
const DAY_END_MIN = 1440; // 24:00
const GRID_HEIGHT = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN;
const SNAP_MIN = 15;
const GUTTER_W = 44;
const DRAG_THRESHOLD_PX = 5; // pointer travel (px) before a pointer-down on a block counts as a drag rather than a tap
const TRAY_DELETE_CONFIRM_WINDOW_MS = 3000; // matches components/planner/PlanDetailsSheet.jsx's double-tap-to-confirm window

function planStartMinute(plan) {
  return plan.startDt ? plan.startDt.minuteOfDay : 0;
}
function planDurationMinutes(plan) {
  if (plan.startDt && plan.endDt) {
    const d = (plan.endDt.minuteOfDay - plan.startDt.minuteOfDay + 1440) % 1440;
    if (d > 0) return d;
  }
  return plan.totalDurationMinutes || 60;
}
function planEndMinute(plan) {
  return planStartMinute(plan) + planDurationMinutes(plan);
}

// Column-packing sweep: groups overlapping plans into clusters, then
// greedily assigns each plan to the first column whose previous
// occupant has already ended — same idea as Google-Calendar-style
// side-by-side event layout. Returns { plan, col, numCols } per plan.
function layoutDayPlans(plans) {
  const items = plans
    .map((p) => ({ plan: p, start: planStartMinute(p), end: planEndMinute(p) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters = [];
  let current = [];
  let currentEnd = -Infinity;
  for (const it of items) {
    if (current.length && it.start >= currentEnd) {
      clusters.push(current);
      current = [];
      currentEnd = -Infinity;
    }
    current.push(it);
    currentEnd = Math.max(currentEnd, it.end);
  }
  if (current.length) clusters.push(current);

  const result = [];
  for (const cluster of clusters) {
    const columnEnds = [];
    const colOf = new Map();
    for (const it of cluster) {
      let idx = columnEnds.findIndex((endT) => endT <= it.start);
      if (idx === -1) {
        idx = columnEnds.length;
        columnEnds.push(it.end);
      } else {
        columnEnds[idx] = it.end;
      }
      colOf.set(it.plan.id, idx);
    }
    const numCols = columnEnds.length;
    for (const it of cluster) {
      result.push({ plan: it.plan, start: it.start, end: it.end, col: colOf.get(it.plan.id), numCols });
    }
  }
  return result;
}

export default function DaySchedule() {
  const navigate = useNavigate();
  const { day } = useParams();
  const dayIndex = Number(day) || 1;
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const { trip, pins, travelItems, plans, placing, proposeSheet } = state;

  const dayPlans = useMemo(
    () => plans.filter((p) => p.startDt && dayIndexForDate(p.startDt, trip.startDate) === dayIndex),
    [plans, trip.startDate, dayIndex]
  );

  const laidOut = useMemo(() => layoutDayPlans(dayPlans), [dayPlans]);

  // Region(s) this day already has scheduled — derived from the pins
  // behind this day's plan items (travel items have no region).
  const dayRegions = useMemo(() => {
    const set = new Set();
    dayPlans.forEach((p) =>
      p.items.forEach((it) => {
        const pin = it.pinId ? pins[it.pinId] : null;
        if (pin?.region) set.add(pin.region);
      })
    );
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [dayPlans, pins]);

  const region = useMemo(() => {
    if (!dayRegions.length) return "Trip";
    return dayRegions.length === 1 ? dayRegions[0] : dayRegions.join(" · ");
  }, [dayRegions]);

  const allTripRegions = useMemo(() => {
    const set = new Set(Object.values(pins).map((p) => p.region).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [pins]);

  const [trayFilter, setTrayFilter] = useState(dayRegions);
  const autoFilterDay = useRef(null);
  useEffect(() => {
    if (autoFilterDay.current === dayIndex) return;
    autoFilterDay.current = dayIndex;
    setTrayFilter(dayRegions);
  }, [dayIndex, dayRegions]);

  function toggleTrayRegion(r) {
    setTrayFilter((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }
  const trayFilterIsDefault = useMemo(
    () => trayFilter.length === dayRegions.length && trayFilter.every((r) => dayRegions.includes(r)),
    [trayFilter, dayRegions]
  );

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

  function findOverlap(startMinute, endMinute, excludePlanId) {
    return (
      dayPlans.find((p) => {
        if (p.id === excludePlanId) return false;
        const s = planStartMinute(p);
        const e = planEndMinute(p);
        return startMinute < e && endMinute > s;
      }) ?? null
    );
  }

  async function handleTapAt(rawMinute) {
    if (!placing) return;
    const snapped = Math.round(rawMinute / SNAP_MIN) * SNAP_MIN;
    const startMinute = Math.min(Math.max(snapped, DAY_START_MIN), DAY_END_MIN - 15);
    const endMinute = startMinute + placing.durationMinutes;
    const occupying = findOverlap(startMinute, endMinute, null);

    if (occupying) {
      dispatch({
        type: "OPEN_PROPOSE_FOR",
        proposeSheet: {
          targetPlanId: occupying.id,
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
    const offsetY = e.clientY - rect.top;
    const rawMinute = DAY_START_MIN + offsetY / PX_PER_MIN;
    handleTapAt(rawMinute);
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
    if (plan.status === "contested" || plan.status === "locked") {
      if (plan.contestId) navigate(`/trips/${trip.id}/contests/${plan.contestId}`);
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
    return Math.min(Math.max(snapped, DAY_START_MIN), DAY_END_MIN - info.durationMinutes);
  }

  function handlePlanPointerDown(e, plan) {
    if (placing) return;
    if (plan.status !== "placed" && plan.status !== "pencilled") return; // contested/locked aren't draggable
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragInfoRef.current = {
      pointerId: e.pointerId,
      planId: plan.id,
      startClientY: e.clientY,
      originStart: planStartMinute(plan),
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
    if (findOverlap(previewStart, endMinute, plan.id)) {
      setMoveError("That time is already taken — try another slot.");
      return;
    }

    const startsAt = isoForDayMinute(trip.startDate, dayIndex, previewStart);
    const endsAt = isoForDayMinute(trip.startDate, dayIndex, endMinute);
    const result = await dispatch({ type: "MOVE_PLAN", planId: plan.id, startsAt, endsAt });
    if (!result.ok) {
      setMoveError("That time is already taken — try another slot.");
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
    }
  }

  // ---- Tray: unplaced pins + travel items --------------------------------
  const unplacedPins = useMemo(() => {
    const placedIds = new Set();
    plans.forEach((p) => p.items.forEach((it) => it.pinId && placedIds.add(it.pinId)));
    const regionSet = trayFilter.length ? new Set(trayFilter) : null;
    return Object.values(pins).filter((p) => !placedIds.has(p.id) && (!regionSet || regionSet.has(p.region)));
  }, [plans, pins, trayFilter]);

  const unplacedTravelItems = useMemo(() => {
    const placedIds = new Set();
    plans.forEach((p) => p.items.forEach((it) => it.travelItemId && placedIds.add(it.travelItemId)));
    return Object.values(travelItems).filter((t) => !placedIds.has(t.id));
  }, [plans, travelItems]);

  // Deleting a tray item permanently (not just skipping placement — there
  // was never a "remove from schedule" version to begin with, since it's
  // already unplaced) uses the same double-tap-to-confirm language as
  // components/planner/PlanDetailsSheet.jsx's "Delete permanently": one
  // armed slot for the whole tray (trayDeleteArmedKey), since only one
  // item can plausibly be mid-confirm at a time.
  const [trayDeleteArmedKey, setTrayDeleteArmedKey] = useState(null);
  const [trayError, setTrayError] = useState("");
  const trayDeleteTimeoutRef = useRef(null);
  useEffect(() => () => clearTimeout(trayDeleteTimeoutRef.current), []);

  function trayItemKey(kind, id) {
    return `${kind}:${id}`;
  }

  function handleTrayDeleteTap(kind, id) {
    const key = trayItemKey(kind, id);
    if (trayDeleteArmedKey !== key) {
      setTrayDeleteArmedKey(key);
      clearTimeout(trayDeleteTimeoutRef.current);
      trayDeleteTimeoutRef.current = setTimeout(() => setTrayDeleteArmedKey(null), TRAY_DELETE_CONFIRM_WINDOW_MS);
      return;
    }
    clearTimeout(trayDeleteTimeoutRef.current);
    setTrayDeleteArmedKey(null);
    setTrayError("");
    dispatch({ type: kind === "pin" ? "DELETE_PIN" : "DELETE_TRAVEL_ITEM", id }).then((result) => {
      if (result.ok) {
        // The item might be the one currently armed for placement — clear
        // that too, or handleTapAt would go on trying to place something
        // that no longer exists.
        if (placing?.kind === kind && placing.refId === id) dispatch({ type: "CANCEL_PLACING" });
      } else {
        setTrayError("Couldn't delete that item — try again.");
      }
    });
  }

  const [showAddTravel, setShowAddTravel] = useState(false);
  const [newTravel, setNewTravel] = useState({ title: "", kind: "other", dur: 60, cost: 0 });

  async function submitNewTravel(e) {
    e.preventDefault();
    if (!newTravel.title.trim()) return;
    await dispatch({
      type: "CREATE_TRAVEL_ITEM",
      payload: {
        title: newTravel.title.trim(),
        kind: newTravel.kind,
        duration_minutes: Math.max(5, Number(newTravel.dur) || 60),
        cost_cents: Math.round((Number(newTravel.cost) || 0) * 100),
      },
    });
    setNewTravel({ title: "", kind: "other", dur: 60, cost: 0 });
    setShowAddTravel(false);
  }

  const hourMarks = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hourMarks.push(m);

  return (
    <div className="screen">
      <div style={{ flex: "none", background: "var(--surface-page)", borderBottom: "1px solid var(--hairline)" }}>
        <TripHeader />
        <div style={{ padding: "6px var(--gutter-text) 12px" }}>
          <div className="mono-caption">Scheduling · {region}</div>
          {/* Kept as this screen's heading: it's the day you're looking at,
              which the header's trip name doesn't say. */}
          <div className="serif-place" style={{ fontSize: 24, marginTop: 2, color: "var(--text-primary)" }}>
            {dayHeaderLabel(dayIndex, trip.startDate, trip.endDate)}
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
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: GUTTER_W, flex: "none", position: "relative", height: GRID_HEIGHT }}>
              {hourMarks.map((m) => (
                <div key={m} className="mono-data-sm" style={{ position: "absolute", top: (m - DAY_START_MIN) * PX_PER_MIN - 6, color: "var(--text-faint)" }}>
                  {clockLabel(m)}
                </div>
              ))}
            </div>
            <div
              style={{ flex: 1, minWidth: 0, position: "relative", height: GRID_HEIGHT, borderLeft: "1px solid var(--hairline)", cursor: placing ? "crosshair" : "default" }}
              onClick={handleGridClick}
            >
              {hourMarks.map((m) => (
                <div key={m} aria-hidden="true" style={{ position: "absolute", top: (m - DAY_START_MIN) * PX_PER_MIN, left: 0, right: 0, borderTop: "1px solid var(--hairline)" }} />
              ))}

              {laidOut.map(({ plan, start, numCols, col }) => {
                const draggable = plan.status === "placed" || plan.status === "pencilled";
                const isDragging = dragPreview?.planId === plan.id;
                const effectiveStart = isDragging ? dragPreview.previewStart : start;
                const top = (effectiveStart - DAY_START_MIN) * PX_PER_MIN;
                const height = planDurationMinutes(plan) * PX_PER_MIN;
                const width = `calc(${100 / numCols}% - 4px)`;
                const left = `calc(${(col / numCols) * 100}% + 2px)`;
                // While dragging, show the block's live candidate time (not
                // just its position) — duration is fixed, only the start
                // (and so the end) moves.
                const displayPlan = isDragging
                  ? {
                      ...plan,
                      startDt: plan.startDt ? { ...plan.startDt, minuteOfDay: dragPreview.previewStart } : plan.startDt,
                      endDt: plan.endDt ? { ...plan.endDt, minuteOfDay: dragPreview.previewStart + dragPreview.durationMinutes } : plan.endDt,
                    }
                  : plan;
                return (
                  <div
                    key={plan.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlanTap(plan);
                    }}
                    onPointerDown={(e) => handlePlanPointerDown(e, plan)}
                    onPointerMove={(e) => handlePlanPointerMove(e, plan)}
                    onPointerUp={(e) => handlePlanPointerUp(e, plan)}
                    onPointerCancel={(e) => handlePlanPointerCancel(e, plan)}
                    style={{
                      touchAction: draggable ? "none" : undefined,
                      cursor: draggable ? (isDragging ? "grabbing" : "grab") : undefined,
                      opacity: isDragging ? 0.85 : 1,
                    }}
                  >
                    <PlanBlock plan={displayPlan} rect={{ top, height, left, width }} onTap={() => {}} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: "var(--surface-inverse)", padding: "12px 16px 40px", flex: "none" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="mono-caption" style={{ color: "rgba(255,255,255,.5)" }}>
            Tray · {unplacedPins.length + unplacedTravelItems.length} unplaced
          </span>
          {!trayFilterIsDefault && dayRegions.length > 0 && (
            <button type="button" onClick={() => setTrayFilter(dayRegions)} style={{ font: "500 11px var(--font-sans)", color: "rgba(255,255,255,.7)" }}>
              reset filter
            </button>
          )}
        </div>

        {trayError && (
          <div style={{ marginTop: 8, font: "500 11px var(--font-sans)", color: "#ffb4a8" }}>{trayError}</div>
        )}

        {allTripRegions.length > 1 && (
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 9 }}>
            {["All", ...allTripRegions].map((r) => {
              const selected = r === "All" ? trayFilter.length === 0 : trayFilter.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => (r === "All" ? setTrayFilter([]) : toggleTrayRegion(r))}
                  style={{
                    flex: "none",
                    padding: "5px 11px",
                    borderRadius: 999,
                    font: "500 11.5px var(--font-sans)",
                    background: selected ? "#fff" : "rgba(255,255,255,.08)",
                    color: selected ? "var(--surface-inverse)" : "rgba(255,255,255,.7)",
                    border: selected ? "none" : "1px solid rgba(255,255,255,.22)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 10 }}>
          {unplacedTravelItems.map((item) => {
            const armed = placing?.kind === "travel" && placing.refId === item.id;
            const deleteKey = trayItemKey("travel", item.id);
            const deleteArmed = trayDeleteArmedKey === deleteKey;
            return (
              <div key={`t${item.id}`} style={{ position: "relative", width: 96, flex: "none" }}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "ARM_PLACE_TRAVEL", travelItemId: item.id })}
                  style={{ width: "100%", textAlign: "left", opacity: armed ? 0.6 : 1 }}
                >
                  <div style={{ height: 54, borderRadius: 11, background: "var(--ink-700)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 18px var(--font-sans)", color: "rgba(255,255,255,.6)" }}>
                    {travelIcon(item.kind)}
                  </div>
                  <div style={{ font: "600 10.5px var(--font-sans)", color: "var(--text-on-dark)", marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                  <div className="mono-data-sm" style={{ color: "var(--text-on-dark-muted)", marginTop: 1 }}>{item.dur}m</div>
                </button>
                {armed && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTrayDeleteTap("travel", item.id);
                    }}
                    aria-label={deleteArmed ? "Confirm delete" : "Delete"}
                    style={trayDeleteBadgeStyle(deleteArmed)}
                  >
                    {deleteArmed ? "!" : "×"}
                  </button>
                )}
              </div>
            );
          })}

          {unplacedPins.length ? (
            unplacedPins.map((pin) => {
              const armed = placing?.kind === "pin" && placing.refId === pin.id;
              const deleteKey = trayItemKey("pin", pin.id);
              const deleteArmed = trayDeleteArmedKey === deleteKey;
              return (
                <div key={pin.id} style={{ position: "relative", width: 96, flex: "none" }}>
                  <button type="button" onClick={() => dispatch({ type: "ARM_PLACE_PIN", pinId: pin.id })} style={{ width: "100%", textAlign: "left", opacity: armed ? 0.6 : 1 }}>
                    <PhotoPlaceholder height={54} radius={11} dark label="" style={{ background: "var(--ink-700)" }} />
                    <div style={{ font: "600 10.5px var(--font-sans)", color: "var(--text-on-dark)", marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pin.title}</div>
                    <div className="mono-data-sm" style={{ color: "var(--text-on-dark-muted)", marginTop: 1 }}>{pin.dur}m</div>
                  </button>
                  {armed && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrayDeleteTap("pin", pin.id);
                      }}
                      aria-label={deleteArmed ? "Confirm delete" : "Delete"}
                      style={trayDeleteBadgeStyle(deleteArmed)}
                    >
                      {deleteArmed ? "!" : "×"}
                    </button>
                  )}
                </div>
              );
            })
          ) : null}

          <button
            type="button"
            onClick={() => setShowAddTravel((v) => !v)}
            style={{ width: 96, flex: "none", height: 54, borderRadius: 11, border: "1px dashed rgba(255,255,255,.35)", display: "flex", alignItems: "center", justifyContent: "center", font: "400 22px var(--font-sans)", color: "rgba(255,255,255,.6)" }}
          >
            +
          </button>
        </div>

        {showAddTravel && (
          <form onSubmit={submitNewTravel} style={{ marginTop: 10, padding: 10, borderRadius: "var(--radius-lg)", background: "rgba(255,255,255,.06)", display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              value={newTravel.title}
              onChange={(e) => setNewTravel((t) => ({ ...t, title: e.target.value }))}
              placeholder="Travel item title (e.g. Flight to Hualien)"
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: "#fff", font: "400 12.5px var(--font-sans)" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={newTravel.kind}
                onChange={(e) => setNewTravel((t) => ({ ...t, kind: e.target.value }))}
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: "#fff", font: "400 12.5px var(--font-sans)" }}
              >
                <option value="flight">Flight</option>
                <option value="train">Train</option>
                <option value="ferry">Ferry</option>
                <option value="drive">Drive</option>
                <option value="other">Other</option>
              </select>
              <input
                type="number"
                min={5}
                value={newTravel.dur}
                onChange={(e) => setNewTravel((t) => ({ ...t, dur: e.target.value }))}
                placeholder="Minutes"
                style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: "#fff", font: "400 12.5px var(--font-sans)" }}
              />
              <input
                type="number"
                min={0}
                value={newTravel.cost}
                onChange={(e) => setNewTravel((t) => ({ ...t, cost: e.target.value }))}
                placeholder="Cost $"
                style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.08)", color: "#fff", font: "400 12.5px var(--font-sans)" }}
              />
            </div>
            <button type="submit" style={{ padding: "8px 0", borderRadius: 8, background: "#fff", color: "var(--surface-inverse)", font: "600 12.5px var(--font-sans)" }}>
              Add to tray
            </button>
          </form>
        )}
      </div>

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

function trayDeleteBadgeStyle(armed) {
  // Sized to var(--hit-min) (44px) rather than a decorative corner dot —
  // this badge only renders while the item is armed for placing, so it's
  // the one thing on the card the user is likely to deliberately tap next,
  // and it needs a real touch target rather than a tiny 20px circle.
  return {
    position: "absolute",
    top: -10,
    right: -10,
    width: "var(--hit-min, 44px)",
    height: "var(--hit-min, 44px)",
    borderRadius: "50%",
    background: armed ? "var(--danger, #b3261e)" : "rgba(0,0,0,.55)",
    border: "2px solid var(--surface-inverse)",
    color: "#fff",
    font: "700 18px var(--font-sans)",
    lineHeight: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  };
}

function travelIcon(kind) {
  if (kind === "flight") return "✈";
  if (kind === "train") return "🚆";
  if (kind === "ferry") return "⛴";
  if (kind === "drive") return "🚗";
  return "•";
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
