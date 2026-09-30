import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MapCanvas from "../components/map/MapCanvas";
import Button from "../components/core/Button";
import DayStepper from "../components/forms/DayStepper";
import TripMapLayer from "../components/trip/TripMapLayer";
import TripTimeline from "../components/trip/TripTimeline";
import TripReview from "../components/trip/TripReview";
import TripNote from "../components/trip/TripNote";
import DayStrip from "../components/trip/DayStrip";
import StartTimeSheet from "../components/trip/StartTimeSheet";
import AddStopSheet from "../components/trip/AddStopSheet";
import StopSheet from "../components/trip/StopSheet";
import { useRideEstimates } from "../components/trip/useRideEstimates";
import { useCan, useIdeaAccess, useMyTraveler, usePlannerDispatch, usePlannerState } from "../state/PlannerContext";
import { useGuardedNavigate, useNavGuard } from "../state/NavGuard";
import { getTripDays, tripDayTitle } from "../data/trip";
import { formatMoney } from "../data/expenses";
import { api } from "../lib/api";
import { lodgingFor, tripDates } from "../lib/dayPlaces";
import { clockLabel } from "../lib/planTime";
import { contestWindowsFrom, planStartMinute, plansOnDay } from "../lib/dayGrid";
import { branchName, branchesById, scopeForAnchor, splitsOnDay } from "../lib/splits";
import { MODES, nextDeparture } from "../lib/routes";
import {
  blockItems,
  blockingProblem,
  buildTrip,
  dayCalendar,
  legKey,
  lateMessage,
  openSlots,
  proposalBody,
  rideItem,
  rideLegsOf,
  ridePlacements,
  splitEdgeProblem,
  stopLetter,
  tripMoney,
  tripName,
  tripStopIds,
} from "../lib/tripPlan";

const DEFAULT_LEAVE_MIN = 540; // 09:00, when no open stretch of the day fits
const EARLIEST_SUGGESTION_MIN = 480; // quick picks start at 08:00
// Transit is timed for mid-morning on the trip day's weekday (see
// lib/routes.js nextDeparture): one stable time per day, so moving the
// start doesn't ask Google again.
const TRANSIT_ESTIMATE_MIN = 600;
// How long "Withdraw this proposal" stays armed for its second tap.
const WITHDRAW_CONFIRM_WINDOW_MS = 3000;

const DISCARD_PROMPT = {
  title: "Discard this proposal?",
  body: "You’ve started building a route. Leaving now throws it away.",
  stayLabel: "Keep going",
  leaveLabel: "Discard",
};
const DISCARD_EDITS_PROMPT = {
  title: "Discard these changes?",
  body: "Your set stays in the vote as it was. The changes you’ve made here are lost.",
  stayLabel: "Keep editing",
  leaveLabel: "Discard changes",
};

// Every proposal is built here: a route of stops on the map with a ride
// between each pair (lib/tripPlan.js has the rules), timed from when it
// starts. The ways in, all by query string so a reload lands in the same
// place:
//
//   ?to=<pin id>            an idea's "Directions" on the Map tab
//   ?day=<n>&from=schedule  the day view's "+ Add → Propose a route"
//   ?draft=<plan id>        reopening your own draft
//   ?contest=<id>           adding a set to a running vote — its hours fixed
//   ?contest=<id>&edit=<plan id>  changing your set in one
//
// A route whose stops are all already on the calendar puts its rides
// straight there; anything with a new stop goes to review and a vote.
export default function PlanTrip() {
  const { plans, pins, travelItems, trip, dayPlaces } = usePlannerState();
  const [params] = useSearchParams();
  const contestId = Number(params.get("contest")) || null;
  const editPlanId = Number(params.get("edit")) || null;
  const draftId = Number(params.get("draft")) || null;
  const [contest, setContest] = useState(null);
  const [contestError, setContestError] = useState("");

  useEffect(() => {
    if (!contestId) return undefined;
    let live = true;
    api
      .getContest(contestId)
      .then((c) => live && setContest(c))
      .catch((err) => live && setContestError(err.message || "Couldn’t load that vote."));
    return () => {
      live = false;
    };
  }, [contestId]);

  const draft = draftId ? plans.find((p) => p.id === draftId && p.status === "draft") ?? null : null;
  const frozen = useRef(null);

  if (contestId && !contest) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <p style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)" }}>
          {contestError ? `Couldn’t open that vote: ${contestError}` : "Loading the vote…"}
        </p>
      </div>
    );
  }

  // Where the planner starts is worked out once per URL. Saving changes
  // what it was worked out from — a sent draft stops existing — and the
  // planner mustn't restart (and throw away its custom events) under a
  // save that's still finishing.
  const search = params.toString();
  if (frozen.current?.search !== search) {
    frozen.current = { search, seed: seedFor({ params, contest, editPlanId, draft, plans, pins, travelItems, trip, dayPlaces }) };
  }
  const { seed } = frozen.current;
  return <Planner key={seed.key} seed={seed} />;
}

function Planner({ seed }) {
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const dispatch = usePlannerDispatch();
  const can = useCan();
  const ideaAccess = useIdeaAccess();
  const myTraveler = useMyTraveler();
  const { trip, pins, travelItems, plans, dayPlaces, splits, travelers } = usePlannerState();
  const { mode } = seed;
  const fixed = seed.window; // { start, end } of a running vote, or null

  const dates = useMemo(() => tripDates(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const days = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const onMap = useMemo(() => Object.values(pins).filter((p) => p.lat != null && p.lng != null), [pins]);
  const spotted = useCallback((id) => (id != null && pins[id]?.lat != null ? id : null), [pins]);

  const [dayIndex, setDayIndex] = useState(seed.dayIndex);
  const [stopRefs, setStopRefs] = useState(seed.stopRefs);
  const [endAtLodging, setEndAtLodging] = useState(seed.endAtLodging);
  const [picking, setPicking] = useState(seed.picking); // "from" (put first) | "start" (replace first) | "add" | null
  const [leaveMinute, setLeaveMinute] = useState(seed.leaveMinute); // null: the first open stretch that fits
  const [visits, setVisits] = useState(seed.visits); // stop id -> minutes
  const [modes, setModes] = useState(seed.modes); // ride key -> mode
  const [branchPref, setBranchPref] = useState(seed.branchId);
  const [openRide, setOpenRide] = useState(null);
  const [sheet, setSheet] = useState(null); // "start" | "add" | { stopIndex }
  const [reviewing, setReviewing] = useState(false);
  const [name, setName] = useState(seed.name); // null: the trip's own name
  const [why, setWhy] = useState(seed.why);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [withdrawArmed, setWithdrawArmed] = useState(false);

  // Custom events made here. They exist on the server from the moment
  // they're added, so a route that's abandoned, or a stop taken back out
  // before anything was saved, would otherwise leave them in the unplaced
  // list. Anything still here when the screen goes away without a save is
  // deleted (the server does the same for saved plans —
  // backend/app/custom_events.py).
  const createdHere = useRef(new Set());
  const committed = useRef(false);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(
    () => () => {
      if (committed.current) return;
      createdHere.current.forEach((id) => dispatchRef.current({ type: "DELETE_TRAVEL_ITEM", id }));
    },
    []
  );

  const baseline = useRef(signature({ dayIndex, stopRefs, endAtLodging, leaveMinute, visits, modes, name, why }));
  const dirty = signature({ dayIndex, stopRefs, endAtLodging, leaveMinute, visits, modes, name, why }) !== baseline.current;
  useNavGuard(dirty && !sending && (mode !== "new" || stopRefs.length > 1), mode === "edit" ? DISCARD_EDITS_PROMPT : DISCARD_PROMPT);

  // ---- the route ------------------------------------------------------------
  const lodging = dates.length ? lodgingFor(dayPlaces, dates, dayIndex - 1) : { start: null, end: null };
  const startLodging = spotted(lodging.start);
  const endLodging = spotted(lodging.end);
  const resolve = useCallback((ref) => stopFor(ref, pins, travelItems), [pins, travelItems]);
  const stops = tripStopIds(stopRefs, { endLodgingId: endLodging, endAtLodging }).map(resolve).filter(Boolean);
  const rideLegs = rideLegsOf(stops);

  const weekday = trip.startDate ? days[dayIndex - 1]?.weekday : null;
  const departure = useMemo(() => (weekday == null ? undefined : nextDeparture(new Date(), weekday, TRANSIT_ESTIMATE_MIN)), [weekday]);
  const { estimates, retry } = useRideEstimates(rideLegs, departure);
  const choices = rideLegs.map((leg) => chooseRide(estimates[leg.key], modes[leg.key]));

  const daySplits = useMemo(() => splitsOnDay(splits, trip.startDate, dayIndex), [splits, trip.startDate, dayIndex]);
  const branches = useMemo(() => branchesById(splits), [splits]);
  const groupName = useCallback((id) => (branches.get(id) ? branchName(branches.get(id), travelers) : "that group"), [branches, travelers]);

  const build = (calendar, leave) =>
    buildTrip({
      stops,
      lodgingIds: [startLodging, endLodging].filter((id) => id != null),
      calendar,
      legMinutes: choices.map((c) => c?.minutes ?? null),
      leaveMinute: leave,
      visitMinutes: visits,
    });

  // Who the block is for decides what's in its way, and what it's in the
  // way of decides who it's for: a block inside a split is for one group
  // (the one picked, else yours), anything else is for everyone. So it's
  // timed for everyone first, and again for the group if it lands in a
  // split. A running vote already says.
  const splitSpans = daySplits.map((s) => ({ startMin: s.startMin, endMin: s.endMin, title: "The group is split up" }));
  // A set in a running vote isn't in the way of the other sets in it.
  const others = useMemo(() => (seed.contestId ? plans.filter((p) => p.contestId !== seed.contestId) : plans), [plans, seed.contestId]);
  const everyone = dayCalendar(others, trip.startDate, dayIndex, null);
  let audience = fixed ? seed.branchId : null;
  let calendar = fixed ? dayCalendar(others, trip.startDate, dayIndex, audience) : everyone;
  let model = build(calendar, leaveMinute ?? DEFAULT_LEAVE_MIN);
  const anchored = model.stops.find((s) => s.role === "anchor" && !s.repeat) ?? null;
  const length = model.windowEnd - model.windowStart;
  const slotsFor = (busy, bounds) =>
    openSlots(busy, Math.max(length, 15), { from: Math.max(bounds.min, EARLIEST_SUGGESTION_MIN), to: bounds.max + Math.max(length, 15) });
  let autoLeave = null;
  if (leaveMinute == null && !anchored) {
    autoLeave = slotsFor([...everyone.busy, ...splitSpans], { min: 0, max: 1440 - length })[0]?.start ?? DEFAULT_LEAVE_MIN;
    model = build(calendar, autoLeave);
  }
  const leave = leaveMinute ?? autoLeave ?? DEFAULT_LEAVE_MIN;
  if (!fixed) {
    const home = model.seq.some((it) => it.inBlock)
      ? daySplits.find((s) => model.windowStart < s.endMin && model.windowEnd > s.startMin) ?? null
      : null;
    if (home) {
      audience = scopeForAnchor([home], Math.max(model.windowStart, home.startMin), branchPref, myTraveler?.id ?? null);
      calendar = dayCalendar(others, trip.startDate, dayIndex, audience);
      model = build(calendar, leave);
    }
  }
  const home = audience != null ? daySplits.find((s) => s.split.branches.some((b) => b.id === audience)) ?? null : null;
  const memberIds = audience != null ? branches.get(audience)?.travelerIds ?? [] : travelers.map((t) => t.id);

  // Only a new route from the Map tab or the day can skip the vote.
  const direct = mode === "new" && model.direct && can("plans:write");
  const hasBlock = model.seq.some((it) => it.inBlock);

  // Votes already running for this audience on this day: a new block
  // either matches one's hours exactly (and joins it) or stays clear.
  const runningVotes = useMemo(
    () =>
      contestWindowsFrom(
        plansOnDay(
          plans.filter((p) => p.status !== "draft" && (p.branchId ?? null) === (audience ?? null)),
          trip.startDate,
          dayIndex
        )
      ),
    [plans, trip.startDate, dayIndex, audience]
  );
  const joins = !fixed && !direct ? runningVotes.find((w) => w.startMin === model.windowStart && w.endMin === model.windowEnd) ?? null : null;
  const straddles = !fixed && !direct && !joins
    ? runningVotes.find((w) => model.windowStart < w.endMin && model.windowEnd > w.startMin) ?? null
    : null;

  const problem = (() => {
    if (!trip.startDate) return "Set the trip’s dates to put routes on the calendar.";
    const basic = blockingProblem({ ...model, direct });
    if (basic) return basic;
    if (fixed) {
      if (model.windowStart < fixed.start) return `This starts before the vote’s hours, ${clockLabel(fixed.start)}–${clockLabel(fixed.end)}. Start at ${clockLabel(fixed.start)} or later.`;
      if (model.windowEnd > fixed.end) {
        return `This runs ${model.windowEnd - fixed.end} min past the vote’s hours, ${clockLabel(fixed.start)}–${clockLabel(fixed.end)}. Start earlier, shorten a stop, or take one out.`;
      }
      return null;
    }
    if (!direct) {
      const edge = splitEdgeProblem({ daySplits, branchId: audience, start: model.windowStart, end: model.windowEnd, groupName, clock: clockLabel });
      if (edge) return edge;
    }
    if (straddles) {
      return `${clockLabel(straddles.startMin)}–${clockLabel(straddles.endMin)} is already out for a vote. Move the start so this stays clear of it, or add a set to that vote from its page.`;
    }
    return null;
  })();

  const money = tripMoney(model, choices.map((c) => c?.fareCents ?? null), memberIds);
  const seesAllCosts = can("costs:read");

  // ---- the start time -------------------------------------------------------
  // Any time of day can be picked (who it's for follows from when it
  // is); only a running vote's hours hold it in.
  const startBounds = fixed ? { min: fixed.start, max: Math.max(fixed.start, fixed.end - length) } : { min: 0, max: Math.max(0, 1440 - length) };
  const suggestions = useMemo(() => {
    if (fixed) return [{ start: fixed.start, why: `When the vote’s hours start, ${clockLabel(fixed.start)}–${clockLabel(fixed.end)}` }];
    const why = (s) => (s.after ? `After ${s.after}` : s.start < 720 ? "Morning, before anything else" : "Nothing else on yet");
    const together = slotsFor([...everyone.busy, ...splitSpans], startBounds).map((s) => ({ start: s.start, why: why(s) }));
    // Inside the split, the open time of the group it's for.
    const apart = home
      ? slotsFor(calendar.busy, { min: home.startMin, max: home.endMin - length })
          .filter((s) => s.start + length <= home.endMin)
          .map((s) => ({ start: s.start, why: `${groupName(audience)}’s time apart${s.after ? `, after ${s.after}` : ""}` }))
      : [];
    return [...together, ...apart]
      .filter((s) => s.start <= startBounds.max)
      .sort((a, b) => a.start - b.start)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixed, audience, dayIndex, length, plans, startBounds.max, daySplits]);

  // ---- editing the route ----------------------------------------------------
  function tapPin(pin) {
    setError("");
    setOpenRide(null);
    if (picking === "from") setStopRefs((ids) => (ids[0] === pin.id ? ids : [pin.id, ...ids]));
    else if (picking === "start") setStopRefs((ids) => [pin.id, ...ids.slice(1)]);
    else setStopRefs((ids) => (ids[ids.length - 1] === pin.id ? ids : [...ids, pin.id]));
    setPicking(null);
  }

  function removeAt(index) {
    setOpenRide(null);
    const ref = stopRefs[index];
    setStopRefs((ids) => ids.filter((_, i) => i !== index));
    // A custom event made here and taken straight back out has nothing
    // holding it, so it goes rather than landing in the unplaced list.
    const travelId = travelIdOf(ref);
    if (travelId != null && createdHere.current.has(travelId) && !stopRefs.some((r, i) => i !== index && r === ref)) {
      createdHere.current.delete(travelId);
      dispatch({ type: "DELETE_TRAVEL_ITEM", id: travelId });
    }
  }

  const onStop = {
    visit: (stopId, minutes) => setVisits((v) => ({ ...v, [stopId]: minutes })),
    remove: removeAt,
    edit: (stop) => setSheet({ stopIndex: stop.index }),
    // The stop the "end at lodging" switch adds isn't the person's to remove.
    removable: (stop) => stop.index < stopRefs.length,
    changeStart: () => setPicking((p) => (p === "start" ? null : "start")),
  };
  const onRide = {
    toggle: (index) => setOpenRide((open) => (open === index ? null : index)),
    pick: (index, m) => setModes((all) => ({ ...all, [rideLegs[index].key]: m })),
    retry,
  };

  // What the ideas list offers: anything not on the calendar yet and not
  // already a stop, custom events included (rides planned here aren't
  // ideas, so they're left out).
  const ideas = useMemo(() => {
    const scheduled = new Set();
    plans
      .filter((p) => p.status !== "draft")
      .forEach((p) => p.items.forEach((it) => scheduled.add(it.pinId != null ? it.pinId : `t${it.travelItemId}`)));
    const used = new Set(stopRefs);
    const out = [];
    Object.values(pins).forEach((p) => {
      if (!scheduled.has(p.id) && !used.has(p.id)) out.push({ ref: p.id, title: p.title, located: p.lat != null, dur: p.dur });
    });
    Object.values(travelItems).forEach((t) => {
      const ref = `t${t.id}`;
      if (t.mode == null && !scheduled.has(ref) && !used.has(ref)) out.push({ ref, title: t.title, located: false, dur: t.dur });
    });
    return out.sort((a, b) => Number(b.located) - Number(a.located) || a.title.localeCompare(b.title));
  }, [plans, pins, travelItems, stopRefs]);

  async function addCustom({ title, dur, costCents, costBasis }) {
    try {
      const created = await dispatch({
        type: "CREATE_TRAVEL_ITEM",
        payload: { title, kind: "other", duration_minutes: dur, cost_cents: costCents, cost_basis: costBasis },
      });
      createdHere.current.add(created.id);
      setStopRefs((ids) => [...ids, `t${created.id}`]);
      setSheet(null);
      return null;
    } catch (err) {
      return err.message || "Couldn’t add that event.";
    }
  }

  async function saveStop(item, { minutes, costCents, costBasis }) {
    const { pin } = item.stop;
    const canSet = ideaAccess.canSetCost(pin);
    if (canSet && (costCents !== (pin.costCents ?? 0) || costBasis !== (pin.costBasis ?? "per_head"))) {
      try {
        if (pin.travelItemId != null) {
          await dispatch({ type: "PATCH_TRAVEL_ITEM", id: pin.travelItemId, fields: { cost_cents: costCents, cost_basis: costBasis } });
        } else {
          const result = await dispatch({ type: "PATCH_PIN", id: pin.id, fields: { cost: costCents / 100, costBasis } });
          if (!result?.ok) return result?.error || "Couldn’t save that cost.";
        }
      } catch (err) {
        return err.message || "Couldn’t save that cost.";
      }
    }
    if (minutes !== item.minutes) setVisits((v) => ({ ...v, [pin.id]: minutes }));
    setSheet(null);
    return null;
  }

  // ---- saving ---------------------------------------------------------------
  const back = seed.back;
  const planTitles = Object.fromEntries(calendar.busy.map((b) => [b.id, b.title]));
  const label = () => (name ?? tripName(model)).trim();

  async function submit(as) {
    setSending(true);
    setError("");
    const rides = model.legs.map((leg) => rideItem(leg, choices[leg.index], choices[leg.index].mode));
    const where = { startDate: trip.startDate, dayIndex };
    const rationale = why.trim();
    let action;
    if (as === "rides") {
      action = { as: "rides", body: (ids) => ridePlacements(model, ids, where) };
    } else if (mode === "edit") {
      action = { as: "edit", planId: seed.editPlanId, body: (ids) => ({ label: label(), rationale, items: blockItems(model, ids, fixed.start) }) };
    } else {
      action = {
        as,
        replaceDraftId: seed.draftId,
        body: (ids) => ({ ...proposalBody(model, ids, { ...where, label: label(), rationale, window: fixed }), branch_id: audience ?? null }),
      };
    }
    const result = await dispatch({ type: "SUBMIT_TRIP", rides, ...action });
    setSending(false);
    if (!result?.ok) {
      setError(result?.error ? `Couldn’t save this: ${result.error}` : "Couldn’t save this. Try again.");
      return;
    }
    committed.current = true;
    if (as === "rides") navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
    else if (as === "draft") navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
    else if (mode === "edit") {
      const cleared = seed.voteCount;
      navigate(`/trips/${trip.id}/contests/${seed.contestId}`, {
        replace: true,
        state: {
          notice: cleared
            ? `Set updated. The ${cleared} vote${cleared === 1 ? "" : "s"} for it ${cleared === 1 ? "was" : "were"} cleared, so everyone votes on it as it now stands.`
            : "Set updated.",
        },
      });
    } else navigate(`/trips/${trip.id}/contests/${result.contestId}`, { replace: true });
  }

  async function discardDraft() {
    setSending(true);
    await dispatch({ type: "DISCARD_DRAFT", planId: seed.draftId });
    setSending(false);
    committed.current = true;
    navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
  }

  useEffect(() => {
    if (!withdrawArmed) return undefined;
    const t = setTimeout(() => setWithdrawArmed(false), WITHDRAW_CONFIRM_WINDOW_MS);
    return () => clearTimeout(t);
  }, [withdrawArmed]);

  async function withdraw() {
    if (!withdrawArmed) {
      setWithdrawArmed(true);
      return;
    }
    setWithdrawArmed(false);
    setSending(true);
    setError("");
    const result = await dispatch({ type: "WITHDRAW_PROPOSAL", planId: seed.editPlanId });
    setSending(false);
    if (!result.ok) {
      setError(result.error || "Couldn’t withdraw that set.");
      return;
    }
    committed.current = true;
    navigate(result.contestRemains ? `/trips/${trip.id}/contests/${seed.contestId}` : `/trips/${trip.id}/schedule/${dayIndex}`, {
      replace: true,
      state: result.contestRemains ? { notice: "Your set was withdrawn." } : undefined,
    });
  }

  if (reviewing) {
    const dayTitle = tripDayTitle(dayIndex, trip.startDate, trip.endDate);
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
        when={`${dayTitle || `Day ${dayIndex}`} · ${clockLabel(model.windowStart)}–${clockLabel(model.windowEnd)}`}
        onChangeStart={
          anchored
            ? null
            : () => {
                setReviewing(false);
                setSheet("start");
              }
        }
        money={seesAllCosts ? money : null}
        audience={audience != null ? groupName(audience) : null}
        sendLabel={mode === "edit" ? "Save changes" : mode === "join" ? `Add as another set` : "Send to vote"}
        footnote={
          mode === "edit"
            ? seed.voteCount
              ? `Saving clears the ${seed.voteCount} vote${seed.voteCount === 1 ? "" : "s"} for this set, so everyone votes on it as it now stands.`
              : "Your set changes in place. It stays in the vote."
            : mode === "join"
              ? `Joins the vote for ${clockLabel(fixed.start)}–${clockLabel(fixed.end)} as another set.`
              : joins
                ? `Matches the hours of a vote already running, ${clockLabel(joins.startMin)}–${clockLabel(joins.endMin)}, so it joins it as another set.`
                : undefined
        }
        onBack={() => setReviewing(false)}
        onSend={() => submit("proposal")}
        onDraft={mode === "new" || mode === "draft" ? () => submit("draft") : null}
      />
    );
  }

  const ctaText = !hasBlock && !model.legs.length
    ? "Add a stop to plan a route"
    : direct
      ? `Add ${model.legs.length} ride${model.legs.length === 1 ? "" : "s"} to Day ${dayIndex}`
      : mode === "edit"
        ? "Review changes"
        : mode === "join"
          ? "Review the new set"
          : "Review proposal";
  const lastTitle = stops.length ? stops[Math.min(stopRefs.length, stops.length) - 1]?.title : null;
  const editing = sheet && typeof sheet === "object" ? model.seq.find((it) => it.kind === "stop" && it.stop.index === sheet.stopIndex) ?? null : null;
  const lettered = model.stops.map((s) => ({ ...s, letter: stopLetter(model, s) }));
  const readyTimes = model.ready && hasBlock;
  const warnStrip = Boolean(readyTimes && (problem || (!direct && model.clashes.length)));

  return (
    <div className="screen" style={{ position: "relative" }}>
      {seed.banner ? (
        <div style={{ flex: "none", display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 14px", background: "var(--surface-inverse)", color: "#fff", font: "500 12px var(--font-sans)" }}>
          <span>{seed.banner}</span>
          {fixed ? <span>{`${clockLabel(fixed.start)}–${clockLabel(fixed.end)}`}</span> : null}
        </div>
      ) : null}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <MapCanvas label="Trip map" style={{ position: "absolute", inset: 0 }}>
          <TripMapLayer
            pins={onMap}
            stops={lettered}
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
            <button type="button" onClick={() => guardedNavigate(back.path)} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)", whiteSpace: "nowrap" }}>
              {back.label}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="serif-place" style={{ fontSize: 17, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {hasBlock || model.legs.length ? name ?? tripName(model) : "Plan a route"}
              </div>
              <div style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>
                {readyTimes ? `${stops.length} stop${stops.length === 1 ? "" : "s"} · ${clockLabel(model.windowStart)}–${clockLabel(model.windowEnd)}` : "Tap places on the map to add stops"}
              </div>
            </div>
          </div>
          {picking ? (
            <div role="status" style={{ alignSelf: "center", padding: "8px 14px", borderRadius: "var(--radius-pill)", background: "var(--surface-inverse)", color: "#fff", font: "500 12.5px var(--font-sans)" }}>
              {picking === "add" ? "Tap a place to add it as a stop" : "Tap where the route starts"}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ flex: "none", maxHeight: "60%", display: "flex", flexDirection: "column", background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", zIndex: 5 }}>
        <div className="screen-scroll" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            {days.length > 1 && !fixed ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <DayStepper value={dayIndex} count={days.length} detail={tripDayTitle(dayIndex, trip.startDate, trip.endDate)} onChange={setDayIndex} />
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 4px" }}>
                <span className="mono-caption">Day</span>
                <span style={{ font: "600 14px var(--font-sans)" }}>
                  Day {dayIndex}
                  {tripDayTitle(dayIndex, trip.startDate, trip.endDate) ? ` · ${tripDayTitle(dayIndex, trip.startDate, trip.endDate)}` : ""}
                </span>
              </div>
            )}
            <StartsField
              value={model.windowStart}
              ready={hasBlock}
              locked={Boolean(anchored)}
              onOpen={() => setSheet("start")}
            />
          </div>

          {!fixed && home ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: "var(--radius-md)", background: "var(--surface-inset)" }}>
              <span className="mono-caption">
                The group is split up {clockLabel(home.startMin)}–{clockLabel(home.endMin)}. This is for
              </span>
              <div role="group" aria-label="Which group this is for" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {home.split.branches.map((b) => {
                  const on = b.id === audience;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setBranchPref(b.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "var(--radius-xl)",
                        border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                        background: on ? "var(--accent-quiet)" : "var(--surface-card)",
                        font: "600 12px var(--font-sans)",
                        color: on ? "var(--accent)" : "var(--text-secondary)",
                      }}
                    >
                      {branchName(b, travelers)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {readyTimes ? (
            <div>
              <DayStrip busy={audience != null ? calendar.busy : [...calendar.busy, ...splitSpans]} start={model.windowStart} end={model.windowEnd} frame={fixed} warn={warnStrip} />
              {fixed ? (
                <div className="mono-data-sm" style={{ display: "flex", justifyContent: "space-between", marginTop: 2, letterSpacing: 0, color: model.windowEnd > fixed.end ? "var(--warn)" : "var(--geo)" }}>
                  <span style={{ color: "var(--text-secondary)" }}>
                    Vote’s hours {clockLabel(fixed.start)}–{clockLabel(fixed.end)}
                  </span>
                  <span>{model.windowEnd > fixed.end ? `${model.windowEnd - fixed.end} min over` : `${fixed.end - model.windowEnd} min to spare`}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {anchored && hasBlock ? (
            <TripNote tone="geo">
              Timed around {anchored.pin.title} at {clockLabel(anchored.index === 0 ? anchored.anchor.endMin : anchored.anchor.startMin)}, when it’s on the calendar. Remove it to pick your own start.
            </TripNote>
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
              {onMap.length ? "Tap a place on the map to start from it, or add a stop below." : "No ideas have a spot on the map yet. Add a stop from the ideas list, or a custom event."}
            </div>
          )}

          <button
            type="button"
            aria-pressed={picking === "add"}
            onClick={() => {
              setPicking(null);
              setSheet("add");
            }}
            style={{
              minHeight: 44,
              borderRadius: "var(--radius-md)",
              border: `1px dashed ${picking === "add" ? "var(--accent)" : "var(--border-strong)"}`,
              color: picking === "add" ? "var(--accent)" : "var(--text-secondary)",
              background: picking === "add" ? "var(--accent-quiet)" : "transparent",
              font: "500 13px var(--font-sans)",
            }}
          >
            {picking === "add" ? "Tap a place on the map, or add a stop another way" : "+ Add a stop"}
          </button>

          {endLodging != null && stopRefs.length > 1 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, font: "600 13.5px var(--font-sans)" }}>
              <input type="checkbox" checked={endAtLodging} onChange={(e) => setEndAtLodging(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
              End at {pins[endLodging].title}
            </label>
          ) : null}

          {readyTimes && !direct && money.totalCents ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, paddingTop: 8, borderTop: "1px solid var(--hairline)" }}>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="mono-caption">{seesAllCosts ? "Cost" : "Costs you can see"}</span>
                <span style={{ font: "600 14px var(--font-sans)" }}>About {formatMoney(money.perHeadCents)} each</span>
              </span>
              <span className="mono-data-sm" style={{ textAlign: "right", color: "var(--text-muted)", letterSpacing: 0 }}>
                {money.headcount} {money.headcount === 1 ? "person" : "people"} · {formatMoney(money.totalCents)}
                {money.unknownFares ? <br /> : null}
                {money.unknownFares ? "+ fares not known" : null}
              </span>
            </div>
          ) : null}

          {readyTimes && problem ? <TripNote tone="warn">{problem}</TripNote> : null}
          {readyTimes && !problem && model.late.length ? <TripNote tone="warn">{lateMessage(model.late[0])}</TripNote> : null}
          {readyTimes && !problem && !direct && model.clashes.length ? (
            <TripNote tone="warn">Overlaps {model.clashes.map((c) => c.title).join(" and ")}. If this goes to a vote, what’s on the board now joins it.</TripNote>
          ) : null}
          {readyTimes && !problem && joins ? (
            <TripNote tone="geo">
              These are the hours of a vote already running, {clockLabel(joins.startMin)}–{clockLabel(joins.endMin)}. This joins it as another set.
            </TripNote>
          ) : null}
          {readyTimes && !problem && direct ? (
            <TripNote tone="geo">Everything here is already on Day {dayIndex}, so the rides just fill the gaps. No vote needed.</TripNote>
          ) : null}
          {error ? (
            <div role="alert" style={{ font: "500 12.5px var(--font-sans)", color: "var(--warn)" }}>
              {error}
            </div>
          ) : null}
          {model.legs.length ? (
            <div className="mono-caption" style={{ fontSize: 9 }}>
              Times from Google · traffic and timetables vary
            </div>
          ) : null}
        </div>
        <div style={{ flex: "none", padding: "10px 16px 18px", borderTop: "1px solid var(--hairline)", display: "flex", flexDirection: "column", gap: 8 }}>
          <Button disabled={!model.ready || !hasBlock || Boolean(problem) || sending} onClick={() => (direct ? submit("rides") : setReviewing(true))}>
            {sending ? "Saving…" : ctaText}
          </Button>
          {mode === "draft" ? (
            <Button variant="secondary" onClick={discardDraft} disabled={sending} style={{ color: "var(--warn)" }}>
              Delete draft
            </Button>
          ) : null}
          {mode === "edit" ? (
            <Button
              variant={withdrawArmed ? "accent" : "secondary"}
              onClick={withdraw}
              disabled={sending}
              style={withdrawArmed ? { background: "var(--warn)", color: "#fff" } : { color: "var(--warn)" }}
            >
              {withdrawArmed ? "Tap again to withdraw" : "Withdraw this proposal"}
            </Button>
          ) : null}
        </div>
      </div>

      {sheet === "start" ? (
        <StartTimeSheet
          value={leave}
          length={length}
          suggestions={suggestions}
          busy={audience != null ? calendar.busy : [...calendar.busy, ...splitSpans]}
          bounds={startBounds}
          startsFrom={stops[0] && model.stops[0] && !model.stops[0].inBlock ? stops[0].title : null}
          onChange={setLeaveMinute}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === "add" ? (
        <AddStopSheet
          after={lastTitle}
          ideas={ideas}
          canSetCost={ideaAccess.canSetCost(null)}
          onMap={() => {
            setSheet(null);
            setPicking("add");
          }}
          onIdea={(ref) => {
            setStopRefs((ids) => [...ids, ref]);
            setSheet(null);
          }}
          onCustom={addCustom}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {editing ? (
        <StopSheet
          item={editing}
          headcount={memberIds.length}
          seeCost={ideaAccess.canSeeCost(editing.stop.pin)}
          setCost={ideaAccess.canSetCost(editing.stop.pin)}
          onDone={(values) => saveStop(editing, values)}
          onRemove={() => {
            setSheet(null);
            removeAt(editing.stop.index);
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

function StartsField({ value, ready, locked, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={locked || !ready}
      aria-label={locked ? `Starts at ${clockLabel(value)}, set by a stop already on the calendar` : `Starts at ${clockLabel(value)}. Change`}
      style={{
        flex: "none",
        width: 112,
        minHeight: 46,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        borderRadius: "var(--radius-lg)",
        border: locked || !ready ? "1px solid var(--border-strong)" : "1.5px solid var(--accent)",
        background: locked || !ready ? "var(--surface-sunken)" : "var(--accent-quiet)",
        textAlign: "left",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span className="mono-caption">Starts</span>
        <span style={{ font: "600 15px var(--font-sans)", color: locked || !ready ? "var(--text-primary)" : "var(--accent)" }}>{ready ? clockLabel(value) : "—"}</span>
      </span>
      <span aria-hidden="true" style={{ color: locked || !ready ? "var(--text-muted)" : "var(--accent)", fontSize: 12 }}>
        {locked ? "🔒" : "▾"}
      </span>
    </button>
  );
}

/** The ride's chosen way, or the fastest there is: { mode, ...readRoute() } or null. */
function chooseRide(estimate, wanted) {
  if (estimate?.status !== "ready") return null;
  const options = MODES.filter((m) => estimate.byMode[m]?.available).map((m) => ({ mode: m, ...estimate.byMode[m] }));
  if (!options.length) return null;
  return options.find((o) => o.mode === wanted) ?? options.reduce((a, b) => (b.minutes < a.minutes ? b : a));
}

// A stop is a pin (its id) or a custom event / other travel item ("t" +
// its id). Either way it comes out as what lib/tripPlan.js times: an id,
// a title, a length, a cost, and whether it has a place on the map.
function stopFor(ref, pins, travelItems) {
  const travelId = travelIdOf(ref);
  if (travelId != null) {
    const t = travelItems[travelId];
    if (!t) return null;
    return { id: ref, travelItemId: t.id, title: t.title, dur: t.dur, located: false, costCents: t.costCents, costBasis: t.costBasis, who: t.who };
  }
  const pin = pins[ref];
  if (!pin) return null;
  return { ...pin, located: pin.lat != null && pin.lng != null };
}

function travelIdOf(ref) {
  return typeof ref === "string" && ref.startsWith("t") ? Number(ref.slice(1)) : null;
}

function signature(state) {
  return JSON.stringify(state);
}

// ---- where the planner starts ---------------------------------------------

function seedFor({ params, contest, editPlanId, draft, plans, pins, travelItems, trip, dayPlaces }) {
  const dates = tripDates(trip.startDate, trip.endDate);
  const dayCount = getTripDays(trip.startDate, trip.endDate).length;
  const spotted = (id) => (id != null && pins[id]?.lat != null ? id : null);
  const lodgingOn = (d) => (dates.length ? lodgingFor(dayPlaces, dates, d - 1) : { start: null, end: null });
  // Only offer tapping the map first when there's something on it to tap.
  const hasSpots = Object.values(pins).some((p) => p.lat != null && p.lng != null);
  const base = { name: null, why: "", visits: {}, modes: {}, branchId: null, window: null, banner: null, draftId: null, editPlanId: null, contestId: null, voteCount: 0 };

  if (contest) {
    const start = minuteOfIso(contest.starts_at);
    let end = minuteOfIso(contest.ends_at);
    if (end <= start) end += 1440;
    const dayIndex = dayIndexOf(contest.starts_at, trip.startDate);
    const option = editPlanId ? contest.plans.find((p) => p.id === editPlanId) ?? null : null;
    const letter = option?.set_letter ?? setLetter(contest.plans.length);
    const loaded = option ? fromItems(option.items.map(rawItem), start, { pins, travelItems, lodging: lodgingOn(dayIndex), spotted }) : null;
    return {
      ...base,
      ...(loaded ?? { stopRefs: startingStops(lodgingOn(dayIndex), spotted), endAtLodging: Boolean(spotted(lodgingOn(dayIndex).start)), leaveMinute: start, visits: {}, modes: {} }),
      key: `contest-${contest.id}-${editPlanId ?? "new"}`,
      mode: option ? "edit" : "join",
      dayIndex,
      picking: option || !hasSpots ? null : "add",
      name: option?.label || null,
      why: option?.rationale ?? "",
      branchId: contest.branch_id ?? null,
      window: { start, end },
      banner: option ? `Editing Set ${letter} · ${option.label || "your set"}` : `Set ${letter} for these hours`,
      editPlanId: option?.id ?? null,
      contestId: contest.id,
      voteCount: option?.vote_count ?? 0,
      back: { label: "Cancel", path: `/trips/${trip.id}/contests/${contest.id}` },
    };
  }

  if (draft) {
    const dayIndex = draft.startDt ? dayIndexOf(draft.startsAt, trip.startDate) : 1;
    const loaded = fromItems(draft.items, planStartMinute(draft), { pins, travelItems, lodging: lodgingOn(dayIndex), spotted });
    return {
      ...base,
      ...loaded,
      key: `draft-${draft.id}`,
      mode: "draft",
      dayIndex,
      picking: null,
      name: draft.label || null,
      why: draft.rationale ?? "",
      branchId: draft.branchId ?? null,
      banner: "Draft · only you can see it",
      draftId: draft.id,
      back: { label: `‹ Day ${dayIndex}`, path: `/trips/${trip.id}/schedule/${dayIndex}` },
    };
  }

  const fromDay = Number(params.get("day")) || null;
  const toId = Number(params.get("to")) || null;
  const start = initialTrip({ toId, fromDay, pins, plans, dayPlaces, dates, startDate: trip.startDate, dayCount, spotted });
  const fromSchedule = params.get("from") === "schedule";
  return {
    ...base,
    ...start,
    key: `new-${toId ?? ""}-${fromDay ?? ""}`,
    mode: "new",
    // From a day, the stops menu is one tap away; don't start in map mode.
    picking: (fromSchedule || !hasSpots) && start.picking === "add" ? null : start.picking,
    leaveMinute: null,
    back: fromSchedule ? { label: `‹ Day ${start.dayIndex}`, path: `/trips/${trip.id}/schedule/${start.dayIndex}` } : { label: "‹ Map", path: `/trips/${trip.id}/map` },
  };
}

function startingStops(lodging, spotted) {
  const start = spotted(lodging.start);
  return start != null ? [start] : [];
}

/**
 * Where a new route starts. Directions to an idea on the calendar open on
 * its day, from where the group will be just before it; otherwise from
 * where the group woke up that day (the day asked for, or Day 1). With
 * nowhere known to start, the first tap on the map picks it.
 */
function initialTrip({ toId, fromDay, pins, plans, dayPlaces, dates, startDate, dayCount, spotted }) {
  let dayIndex = fromDay && fromDay <= dayCount ? fromDay : 1;
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
  const stopRefs = target == null ? (start != null ? [start] : []) : start != null && start !== target ? [start, target] : [target];
  return {
    dayIndex,
    stopRefs,
    endAtLodging: start != null && start === spotted(lodging.start),
    picking: target != null ? (stopRefs.length < 2 ? "from" : null) : "add",
  };
}

/**
 * A saved block (a draft, or a set in a vote) back as a route: its stops
 * in order, the rides between them as the way each leg goes, and when it
 * starts. Rides aren't stops. A block that opens with a ride left from
 * where the group was staying, and one that closes with a ride went back
 * there; a block made before routes existed has no rides, and starts at
 * its first stop.
 */
function fromItems(items, windowStart, { pins, travelItems, lodging, spotted }) {
  const sorted = [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const isRide = (it) => it.travelItemId != null && (it.mode ?? travelItems[it.travelItemId]?.mode) != null;
  const entries = []; // { ref, rideMode }: each stop, and how the ride into it went
  const visits = {};
  let pendingMode = null;
  sorted.forEach((it) => {
    if (isRide(it)) {
      pendingMode = it.mode ?? travelItems[it.travelItemId]?.mode;
      return;
    }
    const ref = it.pinId ?? `t${it.travelItemId}`;
    entries.push({ ref, rideMode: pendingMode });
    pendingMode = null;
    if (it.durationOverrideMinutes != null) visits[ref] = it.durationOverrideMinutes;
  });
  const startLodging = spotted(lodging.start);
  if (sorted.length && isRide(sorted[0]) && startLodging != null) entries.unshift({ ref: startLodging, rideMode: null });
  const endLodging = spotted(lodging.end);
  const endAtLodging = Boolean(pendingMode) && endLodging != null;
  if (endAtLodging) entries.push({ ref: endLodging, rideMode: pendingMode });

  // The way each ride went, keyed as the planner keys it: from the last
  // stop with a place before it.
  const modes = {};
  const located = (ref) => typeof ref !== "string" && pins[ref]?.lat != null;
  let from = null;
  entries.forEach(({ ref, rideMode }) => {
    if (!located(ref)) return;
    if (from != null && rideMode) modes[legKey(from, ref)] = rideMode;
    from = ref;
  });

  return {
    stopRefs: (endAtLodging ? entries.slice(0, -1) : entries).map((e) => e.ref),
    visits,
    modes,
    endAtLodging,
    leaveMinute: windowStart + (sorted[0]?.offsetMinutes ?? 0),
  };
}

// A contest option's item as the API sends it, in the shape plan items
// have everywhere else (state/PlannerContext.jsx normalizePlanItem).
function rawItem(it) {
  return {
    pinId: it.pin?.id ?? null,
    travelItemId: it.travel_item?.id ?? null,
    mode: it.travel_item?.mode ?? null,
    durationOverrideMinutes: it.duration_minutes ?? null,
    offsetMinutes: it.offset_minutes ?? null,
    position: it.position,
  };
}

function minuteOfIso(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function dayIndexOf(iso, startDate) {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "")?.[1];
  if (!day || !startDate) return 1;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
}

// A, B, C … then AA, AB — the same run the server letters sets with.
function setLetter(index) {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
