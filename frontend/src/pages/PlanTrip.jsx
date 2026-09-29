import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MapCanvas from "../components/map/MapCanvas";
import Button from "../components/core/Button";
import DayStepper from "../components/forms/DayStepper";
import TripMapLayer from "../components/trip/TripMapLayer";
import TripTimeline from "../components/trip/TripTimeline";
import TripReview from "../components/trip/TripReview";
import TripNote from "../components/trip/TripNote";
import { useRideEstimates } from "../components/trip/useRideEstimates";
import { useCan, usePlannerDispatch, usePlannerState } from "../state/PlannerContext";
import { getTripDays, tripDayTitle } from "../data/trip";
import { lodgingFor, tripDates } from "../lib/dayPlaces";
import { clockLabel } from "../lib/planTime";
import { MODES, nextDeparture } from "../lib/routes";
import {
  blockingProblem,
  buildTrip,
  dayCalendar,
  legKey,
  lateMessage,
  proposalBody,
  rideItem,
  ridePlacements,
  tripName,
  tripStopIds,
} from "../lib/tripPlan";

const DEFAULT_LEAVE_MIN = 540; // 09:00
const LEAVE_STEP_MIN = 15;
// Transit is timed for mid-morning on the trip day's weekday (see
// lib/routes.js nextDeparture): one stable time per day, so moving the
// leave time doesn't ask Google again.
const TRANSIT_ESTIMATE_MIN = 600;

// Planning a trip from the Map tab: stops in order, with a ride between
// each pair (lib/tripPlan.js has the rules). Opened from an idea's
// "Directions" (?to=<pin id>, starting from where the group will be just
// before it) or from "Plan a trip" (starting from where the group is
// staying). A trip whose stops are all already on the calendar puts its
// rides straight there; one with a new stop goes to review and a vote.
export default function PlanTrip() {
  const navigate = useNavigate();
  const dispatch = usePlannerDispatch();
  const can = useCan();
  const { trip, pins, plans, dayPlaces } = usePlannerState();
  const [params] = useSearchParams();
  const back = `/trips/${trip.id}/map`;

  const dates = useMemo(() => tripDates(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const days = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const onMap = useMemo(() => Object.values(pins).filter((p) => p.lat != null && p.lng != null), [pins]);
  const spotted = useCallback((id) => (id != null && pins[id]?.lat != null ? id : null), [pins]);

  const [setup] = useState(() =>
    initialTrip({ toId: Number(params.get("to")) || null, pins, plans, dayPlaces, dates, startDate: trip.startDate, dayCount: days.length, spotted })
  );
  const [dayIndex, setDayIndex] = useState(setup.dayIndex);
  const [stopIds, setStopIds] = useState(setup.stopIds);
  const [endAtLodging, setEndAtLodging] = useState(setup.endAtLodging);
  const [picking, setPicking] = useState(setup.picking); // "from" (put first) | "start" (replace first) | "add" | null
  const [leaveMinute, setLeaveMinute] = useState(DEFAULT_LEAVE_MIN);
  const [visits, setVisits] = useState({}); // pin id -> minutes
  const [modes, setModes] = useState({}); // ride key -> mode
  const [openRide, setOpenRide] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [name, setName] = useState(null); // null: the trip's own name
  const [why, setWhy] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const lodging = dates.length ? lodgingFor(dayPlaces, dates, dayIndex - 1) : { start: null, end: null };
  const startLodging = spotted(lodging.start);
  const endLodging = spotted(lodging.end);
  const calendar = useMemo(() => dayCalendar(plans, trip.startDate, dayIndex), [plans, trip.startDate, dayIndex]);

  const stops = tripStopIds(stopIds, { endLodgingId: endLodging, endAtLodging })
    .map((id) => pins[id])
    .filter((p) => p?.lat != null);
  const rideLegs = stops.slice(1).map((to, i) => ({ key: legKey(stops[i].id, to.id), from: stops[i], to }));

  const weekday = trip.startDate ? days[dayIndex - 1]?.weekday : null;
  const departure = useMemo(() => (weekday == null ? undefined : nextDeparture(new Date(), weekday, TRANSIT_ESTIMATE_MIN)), [weekday]);
  const { estimates, retry } = useRideEstimates(rideLegs, departure);
  const choices = rideLegs.map((leg) => chooseRide(estimates[leg.key], modes[leg.key]));

  const model = buildTrip({
    stops,
    lodgingIds: [startLodging, endLodging].filter((id) => id != null),
    calendar,
    legMinutes: choices.map((c) => c?.minutes ?? null),
    leaveMinute,
    visitMinutes: visits,
  });
  const direct = model.direct && can("plans:write");
  const problem = !trip.startDate ? "Set the trip’s dates to put trips on the calendar." : blockingProblem(model);
  const anchored = model.stops.find((s) => s.role === "anchor" && !s.repeat) ?? null;

  function tapPin(pin) {
    setError("");
    setOpenRide(null);
    if (picking === "from") setStopIds((ids) => (ids[0] === pin.id ? ids : [pin.id, ...ids]));
    else if (picking === "start") setStopIds((ids) => [pin.id, ...ids.slice(1)]);
    else setStopIds((ids) => (ids[ids.length - 1] === pin.id ? ids : [...ids, pin.id]));
    setPicking(null);
  }

  const onStop = {
    visit: (pinId, minutes) => setVisits((v) => ({ ...v, [pinId]: minutes })),
    remove: (index) => {
      setOpenRide(null);
      setStopIds((ids) => ids.filter((_, i) => i !== index));
    },
    // The stop the "end at lodging" switch adds isn't the person's to remove.
    removable: (stop) => stop.index < stopIds.length,
    changeStart: () => setPicking((p) => (p === "start" ? null : "start")),
  };
  const onRide = {
    toggle: (index) => setOpenRide((open) => (open === index ? null : index)),
    pick: (index, mode) => setModes((m) => ({ ...m, [rideLegs[index].key]: mode })),
    retry,
  };

  async function submit(as) {
    setSending(true);
    setError("");
    const rides = model.legs.map((leg) => rideItem(leg, choices[leg.index], choices[leg.index].mode));
    const where = { startDate: trip.startDate, dayIndex };
    const label = (name ?? tripName(model)).trim();
    const body = as === "rides" ? (ids) => ridePlacements(model, ids, where) : (ids) => proposalBody(model, ids, { ...where, label, rationale: why.trim() });
    const result = await dispatch({ type: "SUBMIT_TRIP", as, rides, body });
    setSending(false);
    if (!result?.ok) {
      setError(result?.error ? `Couldn’t save the trip: ${result.error}` : "Couldn’t save the trip. Try again.");
      return;
    }
    if (as === "proposal") navigate(`/trips/${trip.id}/contests/${result.contestId}`, { replace: true });
    else navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
  }

  if (reviewing) {
    const planTitles = Object.fromEntries(calendar.busy.map((b) => [b.id, b.title]));
    return (
      <TripReview
        trip={model}
        choices={choices}
        dayIndex={dayIndex}
        planTitles={planTitles}
        name={name ?? tripName(model)}
        onName={setName}
        why={why}
        onWhy={setWhy}
        sending={sending}
        error={error}
        onBack={() => setReviewing(false)}
        onSend={() => submit("proposal")}
        onDraft={() => submit("draft")}
      />
    );
  }

  const ctaText = !model.legs.length
    ? "Add a stop to plan a trip"
    : direct
      ? `Add ${model.legs.length} ride${model.legs.length === 1 ? "" : "s"} to Day ${dayIndex}`
      : model.direct
        ? "Propose these rides"
        : "Review proposal";

  return (
    <div className="screen">
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <MapCanvas label="Trip map" style={{ position: "absolute", inset: 0 }}>
          <TripMapLayer
            pins={onMap}
            stops={model.stops}
            rides={rideLegs.map((leg, i) => ({ key: leg.key, mode: choices[i]?.mode, path: choices[i]?.path, open: openRide == null ? null : openRide === i }))}
            onTapPin={tapPin}
          />
        </MapCanvas>
        <div style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 5, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
          <div
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: "var(--radius-lg)",
              background: "var(--surface-card)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <button type="button" onClick={() => navigate(back)} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>
              ‹ Map
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="serif-place" style={{ fontSize: 17, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {model.legs.length ? tripName(model) : "Plan a trip"}
              </div>
              <div style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>
                {model.legs.length && model.ready ? `${stops.length} stops · ${clockLabel(model.windowStart)}–${clockLabel(model.windowEnd)}` : "Tap places on the map to add stops"}
              </div>
            </div>
          </div>
          {picking ? (
            <div role="status" style={{ alignSelf: "center", padding: "8px 14px", borderRadius: "var(--radius-pill)", background: "var(--surface-inverse)", color: "#fff", font: "500 12.5px var(--font-sans)" }}>
              {picking === "add" ? "Tap a place to add it as a stop" : "Tap where the trip starts"}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ flex: "none", maxHeight: "58%", display: "flex", flexDirection: "column", background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", zIndex: 5 }}>
        <div className="screen-scroll" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {days.length > 1 ? (
            <DayStepper value={dayIndex} count={days.length} detail={tripDayTitle(dayIndex, trip.startDate, trip.endDate)} onChange={setDayIndex} />
          ) : null}
          {model.legs.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36 }}>
              <span style={{ flex: 1, font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)" }}>
                {anchored
                  ? `Timed around ${anchored.pin.title} at ${clockLabel(anchored.index === 0 ? anchored.anchor.endMin : anchored.anchor.startMin)}`
                  : `Leave ${stops[0].title} at ${clockLabel(leaveMinute)}`}
              </span>
              {!anchored ? (
                <>
                  <StepButton label="Leave 15 minutes earlier" onClick={() => setLeaveMinute((m) => Math.max(0, m - LEAVE_STEP_MIN))}>
                    −
                  </StepButton>
                  <StepButton label="Leave 15 minutes later" onClick={() => setLeaveMinute((m) => Math.min(1425, m + LEAVE_STEP_MIN))}>
                    +
                  </StepButton>
                </>
              ) : null}
            </div>
          ) : null}

          {stops.length ? (
            <TripTimeline
              trip={model}
              dayIndex={dayIndex}
              rides={rideLegs.map((leg, i) => ({ estimate: estimates[leg.key], choice: choices[i], open: openRide === i }))}
              onStop={onStop}
              onRide={onRide}
              choosingStart={picking === "start"}
            />
          ) : (
            <div style={{ font: "400 12.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
              {onMap.length ? "Tap a place on the map to start from it." : "No ideas have a spot on the map yet. Pin a few, then plan a trip between them."}
            </div>
          )}

          {stops.length ? (
            <button
              type="button"
              aria-pressed={picking === "add"}
              onClick={() => setPicking((p) => (p === "add" ? null : "add"))}
              style={{
                minHeight: 44,
                borderRadius: "var(--radius-md)",
                border: `1px dashed ${picking === "add" ? "var(--accent)" : "var(--border-strong)"}`,
                color: picking === "add" ? "var(--accent)" : "var(--text-secondary)",
                background: picking === "add" ? "var(--accent-quiet)" : "transparent",
                font: "500 13px var(--font-sans)",
              }}
            >
              {picking === "add" ? "Tap a place on the map…" : "+ Add a stop"}
            </button>
          ) : null}

          {endLodging != null && stopIds.length > 1 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, font: "600 13.5px var(--font-sans)" }}>
              <input type="checkbox" checked={endAtLodging} onChange={(e) => setEndAtLodging(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
              End at {pins[endLodging].title}
            </label>
          ) : null}

          {model.ready && problem ? <TripNote tone="warn">{problem}</TripNote> : null}
          {model.ready && !problem && model.late.length ? <TripNote tone="warn">{lateMessage(model.late[0])}</TripNote> : null}
          {model.ready && !problem && !model.direct && model.clashes.length ? (
            <TripNote tone="warn">Overlaps {model.clashes.map((c) => c.title).join(" and ")}. If this goes to a vote, what’s on the board now joins it.</TripNote>
          ) : null}
          {model.ready && !problem && direct ? (
            <TripNote tone="geo">Everything here is already on Day {dayIndex}, so the rides just fill the gaps. No vote needed.</TripNote>
          ) : null}
          {error ? (
            <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
              {error}
            </div>
          ) : null}
          <div className="mono-caption" style={{ fontSize: 9 }}>
            Times from Google · traffic and timetables vary
          </div>
        </div>
        <div style={{ flex: "none", padding: "10px 16px 18px", borderTop: "1px solid var(--hairline)" }}>
          <Button disabled={!model.ready || Boolean(problem) || sending} onClick={() => (direct ? submit("rides") : setReviewing(true))}>
            {sending ? "Adding…" : ctaText}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The ride's chosen way, or the fastest there is: { mode, ...readRoute() } or null. */
function chooseRide(estimate, wanted) {
  if (estimate?.status !== "ready") return null;
  const options = MODES.filter((m) => estimate.byMode[m]?.available).map((m) => ({ mode: m, ...estimate.byMode[m] }));
  if (!options.length) return null;
  return options.find((o) => o.mode === wanted) ?? options.reduce((a, b) => (b.minutes < a.minutes ? b : a));
}

/**
 * Where a trip starts. Directions to an idea on the calendar open on its
 * day, from where the group will be just before it; otherwise from where
 * the group woke up that day. With nowhere known to start, the first tap
 * on the map picks it.
 */
function initialTrip({ toId, pins, plans, dayPlaces, dates, startDate, dayCount, spotted }) {
  let dayIndex = 1;
  let before = null;
  const target = toId != null && pins[toId]?.lat != null ? toId : null;
  if (target != null) {
    for (let d = 1; d <= dayCount; d += 1) {
      const calendar = dayCalendar(plans, startDate, d);
      const at = calendar.stops.get(target);
      if (!at) continue;
      dayIndex = d;
      let latest = -Infinity;
      calendar.stops.forEach((stop, pinId) => {
        if (pinId !== target && stop.endMin <= at.startMin && stop.endMin > latest && spotted(pinId) != null) {
          latest = stop.endMin;
          before = pinId;
        }
      });
      break;
    }
  }
  const lodging = dates.length ? lodgingFor(dayPlaces, dates, dayIndex - 1) : { start: null };
  const start = before ?? spotted(lodging.start);
  const stopIds = target == null ? (start != null ? [start] : []) : start != null && start !== target ? [start, target] : [target];
  return {
    dayIndex,
    stopIds,
    endAtLodging: start != null && start === spotted(lodging.start),
    picking: target != null ? (stopIds.length < 2 ? "from" : null) : "add",
  };
}

function StepButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border-strong)", background: "var(--surface-card)", font: "400 16px var(--font-sans)" }}
    >
      {children}
    </button>
  );
}
