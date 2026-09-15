import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import WindowSelection from "../components/planner/WindowSelection";
import StopList from "../components/planner/StopList";
import BudgetStrip from "../components/planner/BudgetStrip";
import ComparisonColumns, { summariseStops } from "../components/planner/ComparisonColumns";
import AvatarStack from "../components/planner/AvatarStack";
import HeadsPicker from "../components/planner/HeadsPicker";
import Stepper from "../components/forms/Stepper";
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";
import { api } from "../lib/api";
import { useNavGuard, useGuardedNavigate } from "../state/NavGuard";
import { getTripDays } from "../data/trip";
import { fmtMin } from "../data/derive";
import { headcountFor, perHeadCents } from "../data/expenses";
import { bandsForMinuteRange, clockLabel, isoForDayMinute } from "../lib/planTime";
import { reasonsFor, worksInAnyBand } from "../lib/availability";
import {
  MIN_SELECTION_MIN,
  contestWindowsFrom,
  overlaps,
  planEndMinute,
  planStartMinute,
  plansOnDay,
} from "../lib/dayGrid";

// Steps 2-4 of "propose a block": claim the hours, fill them, send them to
// a vote. Step 1 is the tray button on pages/DaySchedule.jsx that gets you
// here.
//
// There are three other ways in, and all of them skip step 2 because the
// hours are already settled:
//
//   - reopening your own draft            (state.draftPlanId)
//   - adding a set to a running decision  (state.contestId)
//   - editing a set already in one        (state.contestId + state.editPlanId)
//
// The third is the reason this file is the only place a block gets built.
// Editing a proposal is not a different job from making one: the same
// stops, the same pull-in chips, the same times, the same name and case
// for it — so it is the same two screens, and the only thing that changes
// is whether the footer creates a plan or rewrites one. A second screen
// that could only edit what already existed would drift from this one the
// first time either grew a field.
//
// Adding a set is not a special server path either: a proposal whose
// window matches an open contest's exactly joins it as another option,
// which is the rule that has always made a SET C possible (feature spec
// §6.2). What was missing was a way to ask for that without dragging out
// the same hours by hand and hoping they landed on the same two
// 15-minute boundaries.
//
// The step lives in component state rather than the URL. Backing out of
// "Review" has to land on the hour picker with the drag still there, and a
// URL step would mean rebuilding the selection from nothing every time —
// see the feature spec's §9. The draft is registered with the nav guard
// for the same reason pages/EditVisit.jsx registers its own: a stray tab
// tap shouldn't be able to throw away a block someone has just built.
const DISCARD_PROMPT = {
  title: "Discard this block?",
  body: "You've claimed hours and started filling them. Leaving now throws that away.",
  stayLabel: "Keep going",
  leaveLabel: "Discard",
};

// Editing an existing set is the same screen doing a different thing, and
// the prompt has to say which: nothing is being thrown away except the
// changes, and the set itself stays in the vote either way.
const DISCARD_EDITS_PROMPT = {
  title: "Discard these changes?",
  body: "Your set stays in the vote as it was. The changes you've made here are lost.",
  stayLabel: "Keep editing",
  leaveLabel: "Discard changes",
};

const STOP_STEP_MIN = 15;
const MIN_STOP_MIN = 15;

let stopKeySeed = 0;
function nextStopKey() {
  stopKeySeed += 1;
  return `stop-${stopKeySeed}`;
}

export default function ProposeBlock() {
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const location = useLocation();
  const dayIndex = Number(useParams().day) || 1;
  const state = usePlannerState();
  const dispatch = usePlannerDispatch();
  const { trip, plans, pins, travelItems, contributors, overrides } = state;

  const reopenedDraftId = location.state?.draftPlanId ?? null;
  const contestId = location.state?.contestId ?? null;
  const editPlanId = location.state?.editPlanId ?? null;
  const editing = Boolean(editPlanId);
  const joining = Boolean(contestId) && !editing;
  // The decision in play, fetched rather than passed through navigation
  // state: it carries the window, the option already on the board to
  // compare against, how many options exist (which is what the next set
  // letter is), and — when editing — the set being rewritten.
  const [contest, setContest] = useState(null);
  const [contestError, setContestError] = useState("");
  // What the set looked like when it was loaded, so "has anything changed"
  // is a real question on the edit path rather than "does it have stops",
  // which is always yes.
  const [baseline, setBaseline] = useState(null);

  // Entries, not plans: an overnight crossing owns this morning's hours
  // even though it started yesterday, and the picker has to show it,
  // count it, and clip a selection at it (lib/dayGrid.js planOnDay).
  const dayEntries = useMemo(
    () => plansOnDay(plans.filter((p) => p.status !== "draft"), trip.startDate, dayIndex),
    [plans, trip.startDate, dayIndex]
  );
  const contestWindows = useMemo(() => contestWindowsFrom(dayEntries), [dayEntries]);
  const reopenedDraft = useMemo(
    () => (reopenedDraftId ? plans.find((p) => p.id === reopenedDraftId) : null),
    [plans, reopenedDraftId]
  );

  // Reopening a draft, or joining a running decision, drops you straight
  // into step 3 — in both cases the hours are already settled and there is
  // nothing to claim again.
  const [step, setStep] = useState(reopenedDraft || contestId ? 3 : 2);
  const [selection, setSelection] = useState(() =>
    reopenedDraft
      ? { startMin: planStartMinute(reopenedDraft), endMin: planEndMinute(reopenedDraft) }
      : null
  );
  const [stops, setStops] = useState(() =>
    reopenedDraft
      ? withGaps(
          reopenedDraft.items.map((item) => ({
            key: nextStopKey(),
            kind: item.pinId ? "pin" : "travel",
            refId: item.pinId ?? item.travelItemId,
            title: item.title,
            baseDurationMinutes: item.baseDurationMinutes,
            durationMinutes: item.durationMinutes,
            offsetMinutes: item.offsetMinutes,
            costCents: item.costCents,
            heads: item.heads,
          }))
        )
      : []
  );
  const [name, setName] = useState(reopenedDraft?.label ?? "");
  const [rationale, setRationale] = useState(reopenedDraft?.rationale ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The stop form below the list — one form for both ways a stop comes
  // in. `option` is set when pulling in something that already exists
  // (its title is fixed; its length, cost and start are still up for
  // setting here), and null for a new custom event. `gap` is the free time
  // in front of the new stop, which is what "Starts" edits — the same
  // reading StopList gives it for a stop already in the list.
  const [stopForm, setStopForm] = useState(null);

  // Custom events invented on this screen. They exist on the server from
  // the moment "Add stop" is tapped, so a proposal that is abandoned, or a
  // stop taken back out before anything was saved, would otherwise leave
  // them behind in the unplaced list. Anything still in here when the
  // screen goes away without a save is deleted (the server does the same
  // for saved plans — backend/app/custom_events.py).
  const createdHereRef = useRef(new Set());
  const committedRef = useRef(false);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  useEffect(
    () => () => {
      if (committedRef.current) return;
      const ids = [...createdHereRef.current];
      createdHereRef.current = new Set();
      ids.forEach((id) => dispatchRef.current({ type: "DELETE_TRAVEL_ITEM", id }));
    },
    []
  );

  // The contest's own window becomes the selection, to the minute —
  // anything less exact would land in the partial-overlap 409 rather than
  // on the decision it was meant for — and, when editing, its set becomes
  // the stops on screen.
  useEffect(() => {
    if (!contestId) return;
    let live = true;
    api
      .getContest(contestId)
      .then((c) => {
        if (!live) return;
        setContest(c);
        setSelection({ startMin: minuteOfIso(c.starts_at), endMin: minuteOfIso(c.starts_at) + contestWindowMinutes(c) });
        const target = editPlanId ? c.plans.find((p) => p.id === editPlanId) : null;
        if (!target) return;
        const loaded = stopsFromOption(target);
        setStops(loaded);
        setName(target.label ?? "");
        setRationale(target.rationale ?? "");
        setBaseline(signature(loaded, target.label ?? "", target.rationale ?? ""));
      })
      .catch((err) => live && setContestError(err.message || "Couldn't load that vote."));
    return () => {
      live = false;
    };
  }, [contestId, editPlanId]);

  const windowMinutes = selection ? selection.endMin - selection.startMin : 0;
  const plannedMinutes = stops.reduce((sum, s) => sum + s.durationMinutes, 0);
  // Where the last stop ends. Not the same as `plannedMinutes` once free
  // time is in play, and it is this one that has to fit inside the window.
  const spanMinutes = stops.reduce((sum, s) => sum + (s.gapBefore ?? 0) + s.durationMinutes, 0);

  // What counts as unsaved work depends on how you got here. A selection
  // you dragged is yours; one handed to you by the contest you are joining
  // is not. And a set you are editing arrives already full of stops, so
  // "are there stops" answers nothing — only a change from what was loaded
  // does.
  const dirty = baseline
    ? signature(stops, name, rationale) !== baseline
    : stops.length > 0 || (Boolean(selection) && !contestId);
  useNavGuard(dirty && !busy, editing ? DISCARD_EDITS_PROMPT : DISCARD_PROMPT);

  // The hours in the drag that are already out for a vote. An exactly
  // matching window is fine — that's how a further set joins an existing
  // decision — but a partial overlap has to be refused, and named
  // (feature spec §11).
  const clashingContest = useMemo(() => {
    if (!selection) return null;
    return (
      contestWindows.find(
        (w) =>
          overlaps(selection.startMin, selection.endMin, w.startMin, w.endMin) &&
          !(w.startMin === selection.startMin && w.endMin === selection.endMin)
      ) ?? null
    );
  }, [selection, contestWindows]);

  const matchingContest = useMemo(() => {
    if (!selection) return null;
    return contestWindows.find((w) => w.startMin === selection.startMin && w.endMin === selection.endMin) ?? null;
  }, [selection, contestWindows]);

  // Everything the claim would sweep up — the "on the board" side of the
  // comparison, and the source of the "N items sit in these hours" count.
  const insidePlans = useMemo(() => {
    if (!selection) return [];
    return dayEntries
      .filter((e) => e.plan.status !== "locked" && overlaps(e.startMin, e.endMin, selection.startMin, selection.endMin))
      .map((e) => e.plan);
  }, [dayEntries, selection]);

  const insideItems = useMemo(
    () => insidePlans.flatMap((p) => p.items.map((item) => ({ plan: p, item }))),
    [insidePlans]
  );

  const tripDays = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const travellerCount = trip.travellerCount || contributors.length || 1;

  // The availability question the claimed hours ask, in the currency
  // AvailabilityRule speaks: a calendar day-of-month and the AM/PM/EVE
  // bands the window touches. `dayIndex` is trip-relative, so it has to go
  // through tripDays first — the same conversion pages/EditVisit.jsx makes
  // for its "placed" cell, and for the same reason (a trip-day number
  // compared against a day-of-month key silently never matches).
  const calendarDay = tripDays[dayIndex - 1]?.n ?? null;
  const windowBands = useMemo(
    () => (selection ? bandsForMinuteRange(selection.startMin, selection.endMin) : []),
    [selection]
  );

  // ---- stop sources -------------------------------------------------------
  const pullInOptions = useMemo(() => {
    // A stop already in the list isn't offered again — an item can appear
    // at most once in a proposal (feature spec §11), and the server
    // enforces the same thing.
    const usedRefs = new Set(stops.map((s) => `${s.kind}:${s.refId}`));
    const scheduledPinIds = new Set();
    const scheduledTravelIds = new Set();
    plans
      .filter((p) => p.status !== "draft")
      .forEach((p) =>
        p.items.forEach((it) => {
          if (it.pinId) scheduledPinIds.add(it.pinId);
          if (it.travelItemId) scheduledTravelIds.add(it.travelItemId);
        })
      );

    // Does this pin's availability say "works" for the hours being
    // claimed? Anything with no availability concept at all — a travel
    // item, or a pin nothing has tied down yet — answers yes, so the
    // second group below means specifically "ruled out", not "unknown".
    const availability = (pinId) => {
      if (pinId == null || calendarDay == null || !windowBands.length) return { works: true, reasons: [] };
      const rule = pins[pinId]?.availabilityRule;
      return {
        works: worksInAnyBand(pinId, rule, overrides, calendarDay, windowBands),
        reasons: reasonsFor(rule),
      };
    };

    const options = [];
    // Items already inside the claimed hours: the proposal is about these
    // hours, so what's in them is the most likely thing to want back.
    insideItems.forEach(({ item }) => {
      options.push({
        kind: item.pinId ? "pin" : "travel",
        refId: item.pinId ?? item.travelItemId,
        title: item.title,
        baseDurationMinutes: item.baseDurationMinutes,
        durationMinutes: item.durationMinutes,
        costCents: item.costCents,
        heads: item.heads,
        ...availability(item.pinId),
      });
    });
    // Then the unplaced tray. Pins in a region this day is already about
    // come first — a block on the Xiaoliuqiu day is far more likely to
    // want a Xiaoliuqiu pin than a Tainan one — but nothing is hidden,
    // because a day with nothing scheduled yet has no region to sort by
    // and would otherwise offer an empty list.
    const dayRegions = new Set(
      dayEntries.flatMap(({ plan }) => plan.items.map((it) => (it.pinId ? pins[it.pinId]?.region : null)).filter(Boolean))
    );
    const unplacedPins = Object.values(pins).filter((pin) => !scheduledPinIds.has(pin.id));
    [...unplacedPins]
      .sort((a, b) => Number(dayRegions.has(b.region)) - Number(dayRegions.has(a.region)))
      .forEach((pin) =>
        options.push({
          kind: "pin",
          refId: pin.id,
          title: pin.short || pin.title,
          baseDurationMinutes: pin.dur,
          durationMinutes: pin.dur,
          costCents: pin.costCents,
          heads: pin.heads,
          ...availability(pin.id),
        })
      );
    Object.values(travelItems)
      .filter((t) => !scheduledTravelIds.has(t.id))
      .forEach((t) =>
        options.push({
          kind: "travel",
          refId: t.id,
          title: t.title,
          baseDurationMinutes: t.dur,
          durationMinutes: t.dur,
          costCents: t.costCents,
          heads: t.heads,
          works: true,
          reasons: [],
        })
      );

    const seen = new Set();
    return options.filter((o) => {
      const key = `${o.kind}:${o.refId}`;
      if (seen.has(key) || usedRefs.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [plans, pins, travelItems, insideItems, dayEntries, stops, overrides, calendarDay, windowBands]);

  // Two labelled groups rather than one filtered list. Hiding the
  // ruled-out pins would make "nothing tied this down yet" and "the ticket
  // office shuts at 16:30" look identical from in here — both simply
  // absent — and would hand a day with no matches an empty list, the same
  // reason the region sort above hides nothing either. Availability is a
  // strong hint, not a lock: overrides exist precisely so the group can
  // decide a rule is wrong.
  const pullInGroups = useMemo(() => {
    const works = pullInOptions.filter((o) => o.works);
    const ruledOut = pullInOptions.filter((o) => !o.works);
    return { works, ruledOut, ruledOutReasons: [...new Set(ruledOut.flatMap((o) => o.reasons))] };
  }, [pullInOptions]);

  function addStop(option, gapBefore = 0) {
    setError("");
    // A stop lands straight after the last one unless the form asked for
    // free time in front of it. Free time is something to ask for, not
    // something to inherit.
    setStops((current) => [...current, { ...option, gapBefore: Math.max(0, gapBefore), key: nextStopKey() }]);
  }

  function openNewStop() {
    setError("");
    setStopForm({ option: null, title: "", dur: 60, cost: 0, heads: [], gap: 0 });
  }

  function openPullIn(option) {
    setError("");
    setStopForm({
      option,
      title: option.title,
      dur: option.durationMinutes,
      cost: (option.costCents ?? 0) / 100,
      heads: option.heads ?? [],
      gap: 0,
    });
  }

  function reorder(from, to) {
    setStops((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function changeDuration(index, minutes) {
    setStops((current) => current.map((s, i) => (i === index ? { ...s, durationMinutes: minutes } : s)));
  }

  // Editing a stop's start time is editing the free time in front of it,
  // which is what keeps two stops from ever being able to overlap — see
  // components/planner/StopList.jsx.
  function changeGap(index, minutes) {
    setError("");
    setStops((current) => current.map((s, i) => (i === index ? { ...s, gapBefore: Math.max(0, minutes) } : s)));
  }

  function removeStop(index) {
    const removed = stops[index];
    setStops((current) => current.filter((_, i) => i !== index));
    // A custom event made on this screen and taken straight back out has
    // nothing holding it, so it goes rather than landing in the tray.
    if (removed?.kind === "travel" && createdHereRef.current.has(removed.refId)) {
      createdHereRef.current.delete(removed.refId);
      dispatch({ type: "DELETE_TRAVEL_ITEM", id: removed.refId });
    }
  }

  async function submitStopForm(e) {
    e.preventDefault();
    if (!stopForm || busy) return;
    const durationMinutes = Math.max(MIN_STOP_MIN, Math.round(Number(stopForm.dur) || 0));
    const costCents = Math.max(0, Math.round((Number(stopForm.cost) || 0) * 100));
    const gap = stopForm.gap;

    if (stopForm.option) {
      // Pulling in: the length is this stop's own (a trim, exactly as
      // StopList's "How long" makes one), but cost belongs to the pin or
      // event itself, so a changed cost is written back to it.
      const option = stopForm.option;
      setBusy(true);
      try {
        if (costCents !== (option.costCents ?? 0)) {
          if (option.kind === "pin") {
            const result = await dispatch({ type: "PATCH_PIN", id: option.refId, fields: { cost: costCents / 100 } });
            if (!result.ok) throw new Error(result.error || "Couldn't update that cost.");
          } else {
            await dispatch({ type: "PATCH_TRAVEL_ITEM", id: option.refId, fields: { cost_cents: costCents } });
          }
        }
        addStop({ ...option, durationMinutes, costCents }, gap);
        setStopForm(null);
      } catch (err) {
        setError(err.message || "Couldn't add that stop.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!stopForm.title.trim()) return;
    setBusy(true);
    try {
      // A stop invented here isn't a place anyone pinned, so it's a travel
      // item — the model's own name for "something on the schedule that
      // isn't a pin" (see backend/app/models.py TravelItem).
      const created = await dispatch({
        type: "CREATE_TRAVEL_ITEM",
        payload: {
          title: stopForm.title.trim(),
          kind: "other",
          duration_minutes: durationMinutes,
          cost_cents: costCents,
        },
      });
      createdHereRef.current.add(created.id);
      if (stopForm.heads.length) {
        await dispatch({ type: "PATCH_TRAVEL_ITEM", id: created.id, fields: { heads: stopForm.heads } });
      }
      addStop(
        {
          kind: "travel",
          refId: created.id,
          title: created.title,
          baseDurationMinutes: created.dur,
          durationMinutes: created.dur,
          costCents: created.costCents ?? costCents,
          heads: stopForm.heads,
        },
        gap
      );
      setStopForm(null);
    } catch (err) {
      setError(err.message || "Couldn't add that stop.");
    } finally {
      setBusy(false);
    }
  }

  // ---- submission ---------------------------------------------------------
  function payloadItems() {
    let cursor = 0; // where this stop actually starts, free time included
    let packed = 0; // where it would start if nothing had free time in front
    return stops.map((s) => {
      cursor += s.gapBefore ?? 0;
      const offset = cursor;
      cursor += s.durationMinutes;
      const packedOffset = packed;
      packed += s.durationMinutes;
      return {
        ...(s.kind === "pin" ? { pin_id: s.refId } : { travel_item_id: s.refId }),
        // Only send a trim when there is one: an untrimmed stop should keep
        // tracking its pin's duration rather than freezing today's value.
        ...(s.durationMinutes !== s.baseDurationMinutes ? { duration_minutes: s.durationMinutes } : {}),
        // And only send a time when it isn't simply "after the one before".
        // A set with no free time in it stays NULL-offset all the way
        // down, which is what lets it reflow if a pin's own duration
        // changes later.
        ...(offset !== packedOffset ? { offset_minutes: offset } : {}),
      };
    });
  }

  function windowIso() {
    return {
      startsAt: isoForDayMinute(trip.startDate, dayIndex, selection.startMin),
      endsAt: isoForDayMinute(trip.startDate, dayIndex, selection.endMin),
    };
  }

  function handleConflict(result) {
    // Backing out to step 2 only makes sense when there is a step 2 to go
    // back to. On the contest paths the hours were never up for
    // negotiation, so the message belongs where the reader already is.
    if (contestId && (result.conflict === "contest" || result.conflict === "locked")) {
      setError(result.message || "Those hours are no longer available.");
      return true;
    }
    if (result.conflict === "contest") {
      setStep(2);
      setError(
        result.contestStartsAt
          ? `${clockLabel(minuteOfIso(result.contestStartsAt))}–${clockLabel(
              minuteOfIso(result.contestEndsAt)
            )} is already out for a vote. Claim hours that match it exactly, or stay clear of it.`
          : "Some of those hours are already out for a vote."
      );
      return true;
    }
    if (result.conflict === "locked") {
      setStep(2);
      setError("Those hours contain a pinned item. Drag up to its edge instead.");
      return true;
    }
    return false;
  }

  async function sendToVote() {
    if (busy || !selection) return;
    setBusy(true);
    setError("");

    if (editing) {
      const votesCleared = editedOption?.vote_count ?? 0;
      const result = await dispatch({
        type: "EDIT_PROPOSAL",
        planId: editPlanId,
        label: name.trim(),
        rationale: rationale.trim(),
        items: payloadItems(),
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error || "Couldn't save those changes.");
        return;
      }
      committedRef.current = true;
      // The notice travels with the navigation rather than being raised
      // here: the sentence is about the vote tally, and the vote tally is
      // on the screen being returned to.
      navigate(`/trips/${trip.id}/contests/${contestId}`, {
        replace: true,
        state: {
          notice: votesCleared
            ? `Set updated. The ${votesCleared} vote${votesCleared === 1 ? "" : "s"} for it ${
                votesCleared === 1 ? "was" : "were"
              } cleared, so everyone votes on it as it now stands.`
            : "Set updated.",
        },
      });
      return;
    }

    const { startsAt, endsAt } = windowIso();
    const result = reopenedDraftId
      ? await publishExistingDraft(startsAt, endsAt)
      : await dispatch({ type: "PROPOSE_BLOCK", startsAt, endsAt, label: name.trim(), rationale: rationale.trim(), items: payloadItems() });
    setBusy(false);
    if (result.ok) {
      committedRef.current = true;
      navigate(`/trips/${trip.id}/contests/${result.contestId}`, { replace: true });
      return;
    }
    if (!handleConflict(result)) setError(result.error || "Couldn't send that to a vote.");
  }

  // Publishing a reopened draft goes through the draft's own endpoint so
  // the draft is consumed rather than left behind as a second copy — but
  // only when nothing about it changed here. An edited draft is saved
  // first, so what gets published is what's on screen.
  async function publishExistingDraft(startsAt, endsAt) {
    const saved = await dispatch({
      type: "SAVE_DRAFT",
      replaceDraftId: reopenedDraftId,
      startsAt,
      endsAt,
      label: name.trim(),
      rationale: rationale.trim(),
      items: payloadItems(),
    });
    if (!saved.ok) return saved;
    return dispatch({ type: "PUBLISH_DRAFT", planId: saved.planId });
  }

  async function saveDraft() {
    if (busy || !selection) return;
    setBusy(true);
    setError("");
    const { startsAt, endsAt } = windowIso();
    const result = await dispatch({
      type: "SAVE_DRAFT",
      replaceDraftId: reopenedDraftId,
      startsAt,
      endsAt,
      label: name.trim(),
      rationale: rationale.trim(),
      items: payloadItems(),
    });
    setBusy(false);
    if (result.ok) {
      committedRef.current = true;
      navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
    } else setError(result.error || "Couldn't save that draft.");
  }

  async function discardDraft() {
    if (!reopenedDraftId || busy) return;
    setBusy(true);
    await dispatch({ type: "DISCARD_DRAFT", planId: reopenedDraftId });
    setBusy(false);
    navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
  }

  function cancel() {
    // Back where you came from: the decision you were adding to, or the
    // day you were looking at.
    guardedNavigate(
      contestId ? `/trips/${trip.id}/contests/${contestId}` : `/trips/${trip.id}/schedule/${dayIndex}`
    );
  }

  const dayLabel = `Day ${dayIndex}`;
  const canFill = Boolean(selection) && windowMinutes >= MIN_SELECTION_MIN && !clashingContest;
  // The last stop has to end inside the block — which, once free time
  // exists, is a stricter question than whether the stops add up to less
  // than the window.
  const canReview = stops.length > 0 && spanMinutes <= windowMinutes;
  const editedOption = editing ? contest?.plans.find((p) => p.id === editPlanId) ?? null : null;

  if (contestId && !contest) {
    return (
      <div className="screen" style={{ padding: 24 }}>
        <p style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)" }}>
          {contestError ? `Couldn't open that vote — ${contestError}` : "Loading those hours…"}
        </p>
        {contestError && (
          <button type="button" onClick={cancel} style={{ marginTop: 12, font: "600 13px var(--font-sans)", color: "var(--accent)" }}>
            ‹ Back
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      {step === 2 && (
        <StepTwo
          dayLabel={dayLabel}
          tripDays={tripDays}
          dayIndex={dayIndex}
          dayEntries={dayEntries}
          contestWindows={contestWindows}
          selection={selection}
          onChange={(next) => {
            setError("");
            setSelection(next);
          }}
          insideCount={insideItems.length}
          matchingContest={matchingContest}
          clashingContest={clashingContest}
          error={error}
          canFill={canFill}
          onCancel={cancel}
          onFill={() => {
            setError("");
            setStep(3);
          }}
        />
      )}

      {step === 3 && selection && (
        <StepThree
          selection={selection}
          windowMinutes={windowMinutes}
          plannedMinutes={plannedMinutes}
          stops={stops.map((s) => {
            const headcount = headcountFor(s, trip, contributors);
            return { ...s, headcount, perHeadCents: perHeadCents(s, headcount) };
          })}
          pullInGroups={pullInGroups}
          title={editing ? "Edit this set" : "Your block"}
          backLabel={contestId ? "Cancel" : "‹ Hours"}
          onBack={() => (contestId ? cancel() : setStep(2))}
          onReorder={reorder}
          onChangeDuration={changeDuration}
          onChangeGap={changeGap}
          onRemove={removeStop}
          onAdd={openNewStop}
          onPullIn={openPullIn}
          stopForm={stopForm}
          setStopForm={setStopForm}
          onSubmitStop={submitStopForm}
          onCancelStop={() => setStopForm(null)}
          nextStartMin={selection.startMin + spanMinutes}
          contributors={contributors}
          travellerCount={travellerCount}
          busy={busy}
          error={error}
          canReview={canReview}
          onReview={() => {
            setError("");
            setStep(4);
          }}
        />
      )}

      {step === 4 && selection && (
        <StepFour
          dayLabel={dayLabel}
          dayIndex={dayIndex}
          name={name}
          setName={setName}
          rationale={rationale}
          setRationale={setRationale}
          setLetter={editedOption ? editedOption.set_letter : predictSetLetter(contest, matchingContest, insidePlans)}
          board={
            // With a contest in hand, "on the board" is the option already
            // on it — the one the group would be keeping — and, when
            // editing, explicitly not the set being edited. Falling back to
            // every stop in the window would merge every candidate's stops
            // into one unreadable column.
            contest
              ? boardColumnFromOption(
                  contest.plans.find((p) => p.id !== editPlanId) ?? null,
                  windowMinutes
                )
              : boardColumn(insideItems, selection, windowMinutes)
          }
          yours={yoursColumn(stops, selection, windowMinutes)}
          contributors={contributors}
          busy={busy}
          error={error}
          isDraft={Boolean(reopenedDraftId)}
          joining={joining}
          editing={editing}
          votesAtStake={editedOption?.vote_count ?? 0}
          onBack={() => setStep(3)}
          onSaveDraft={saveDraft}
          onDiscardDraft={discardDraft}
          onSend={sendToVote}
        />
      )}
    </div>
  );
}

// ---- derived helpers ------------------------------------------------------

function minuteOfIso(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// Options are lettered by creation order with the incumbent first, so the
// next free letter is knowable before the proposal exists. Joining an
// existing decision means taking the letter after its current options; a
// fresh contest means A (the incumbent) then B, or A alone on an empty
// stretch of day.
//
// `matchingContest` — hours that happen to coincide with a running vote,
// spotted from the day's plans rather than fetched — stays a "don't
// guess": all it knows is that a contest is there, not how many options
// it holds. `contest` is that same situation with the decision in hand,
// so the letter is simply the next one.
function predictSetLetter(contest, matchingContest, insidePlans) {
  if (contest) return setLetter(contest.plans.length);
  if (matchingContest) return null;
  return insidePlans.length > 0 ? "B" : "A";
}

// A, B, C … then AA, AB — the same spreadsheet-style run the server uses
// (backend/app/routers/contests.py::_set_letter), so the letter shown on
// the review card is the letter the card comes back with.
function setLetter(index) {
  let letter = "";
  let n = index;
  for (;;) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
    if (n < 0) return letter;
  }
}

// An ordered stop list, re-expressed as "how much free time sits in front
// of each one". That is the form the editor works in (see
// components/planner/StopList.jsx): it keeps overlap unwritable while
// still letting a stop be given a time, and it survives a reorder, which
// an absolute offset would not.
//
// A stop with no offset of its own simply follows the one before it, which
// is the same rule backend/app/derive.py packs by. The clamp at zero is
// for data this editor could not have produced — two captured plans can't
// overlap, so it should never fire, and if it ever did, silently showing a
// negative gap would be worse than closing it.
function withGaps(items) {
  let cursor = 0;
  let packed = 0;
  return items.map((item) => {
    const offset = item.offsetMinutes ?? packed;
    const gapBefore = Math.max(0, offset - cursor);
    cursor += gapBefore + item.durationMinutes;
    packed += item.durationMinutes;
    return { ...item, gapBefore };
  });
}

// One option from a fetched contest, in the shape the editor holds stops
// in. The API's own item shape is read here rather than PlannerContext's
// normalized one because a contest is fetched fresh on this screen — it
// carries vote counts and set letters that the trip-wide plan list has no
// reason to hold (see pages/CompareSets.jsx's header comment).
function stopsFromOption(option) {
  return withGaps(
    [...option.items]
      .sort((a, b) => a.position - b.position)
      .map((it) => {
        const source = it.pin ?? it.travel_item;
        return {
          key: nextStopKey(),
          kind: it.pin ? "pin" : "travel",
          refId: source?.id,
          title: source?.title ?? "Untitled",
          baseDurationMinutes: source?.duration_minutes ?? 0,
          durationMinutes: it.duration_minutes ?? source?.duration_minutes ?? 0,
          offsetMinutes: it.offset_minutes,
          costCents: source?.cost_cents ?? 0,
          heads: source?.heads ?? [],
        };
      })
  );
}

// Everything about a set that a person could have changed, as one string.
// Cheaper to compare than to diff, and it is only ever asked "is this
// still what was loaded" — which is the question the discard prompt needs
// answered, and the one `stops.length > 0` cannot answer on a set that
// arrived with stops in it.
function signature(stops, name, rationale) {
  return JSON.stringify([
    stops.map((s) => [s.kind, s.refId, s.gapBefore ?? 0, s.durationMinutes]),
    name.trim(),
    rationale.trim(),
  ]);
}

// A contest's window, in minutes. Both ends are wall-clock on the same
// day — a claimed window may not cross midnight (feature spec §11) — so
// this is a plain subtraction, with the wrap only there to keep a bad row
// from producing a negative window.
function contestWindowMinutes(contest) {
  const minutes = minuteOfIso(contest.ends_at) - minuteOfIso(contest.starts_at);
  return minutes > 0 ? minutes : minutes + 1440;
}

// The "on the board" column when joining a running decision: the option
// already on it, read off the server's own start_minute_of_day so the
// column agrees with the compare screen it was just read from.
function boardColumnFromOption(option, windowMinutes) {
  if (!option) return { lines: [], summary: summariseStops(0, windowMinutes), totalCents: 0 };
  const lines = [...option.items]
    .sort((a, b) => a.start_minute_of_day - b.start_minute_of_day)
    .map((it) => `${clockLabel(it.start_minute_of_day)} · ${(it.pin ?? it.travel_item)?.title ?? "Untitled"}`);
  return {
    lines,
    summary: summariseStops(option.items.length, option.slack_minutes),
    totalCents: option.total_cost_cents,
  };
}

function boardColumn(insideItems, selection, windowMinutes) {
  const lines = insideItems.map(
    ({ item }) => `${clockLabel(item.startMinuteOfDay ?? selection.startMin)} · ${item.title}`
  );
  const planned = insideItems.reduce((sum, { item }) => sum + item.durationMinutes, 0);
  return {
    lines,
    summary: summariseStops(insideItems.length, windowMinutes - planned),
    totalCents: insideItems.reduce((sum, { item }) => sum + (item.costCents ?? 0), 0),
  };
}

function yoursColumn(stops, selection, windowMinutes) {
  // Clock times, not offsets: the column beside this one shows "09:30 ·
  // National Palace Museum", and two columns meant to be compared at a
  // glance can't be measuring from different zeroes.
  let cursor = selection.startMin;
  const lines = stops.map((s) => {
    cursor += s.gapBefore ?? 0;
    const at = cursor;
    cursor += s.durationMinutes;
    return `${clockLabel(at)} · ${s.title}`;
  });
  const planned = stops.reduce((sum, s) => sum + s.durationMinutes, 0);
  return {
    lines,
    summary: summariseStops(stops.length, windowMinutes - planned),
    totalCents: stops.reduce((sum, s) => sum + (s.costCents ?? 0), 0),
  };
}

// ---- steps ----------------------------------------------------------------

function ModalHeader({ left, title, right }) {
  return (
    <div
      style={{
        flex: "none",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 10,
        padding: "18px var(--gutter-text) 10px",
        background: "var(--surface-page)",
      }}
    >
      <div>{left}</div>
      <div className="serif-place" style={{ fontSize: 18, color: "var(--text-primary)" }}>
        {title}
      </div>
      <div style={{ textAlign: "right" }}>{right}</div>
    </div>
  );
}

function StepTwo({
  dayLabel,
  tripDays,
  dayIndex,
  dayEntries,
  contestWindows,
  selection,
  onChange,
  insideCount,
  matchingContest,
  clashingContest,
  error,
  canFill,
  onCancel,
  onFill,
}) {
  return (
    <>
      <ModalHeader
        left={
          <button type="button" onClick={onCancel} style={{ font: "500 14px var(--font-sans)", color: "var(--accent)" }}>
            Cancel
          </button>
        }
        title="Which hours?"
        right={<span className="mono-caption">{dayLabel}</span>}
      />
      <div style={{ flex: "none", padding: "0 var(--gutter-text) 10px" }}>
        <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)" }}>
          Drag over the hours your plan should replace.
        </div>
        {/* The day strip repeats, disabled: a proposal is one day, and
            showing where you are without offering to move is clearer than
            hiding the strip you were just using. */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", opacity: 0.45 }} aria-hidden="true">
          {tripDays.map((d, i) => {
            const selected = i + 1 === dayIndex;
            return (
              <div
                key={i}
                style={{
                  flex: "none",
                  width: 38,
                  padding: "6px 0",
                  borderRadius: "var(--radius-md)",
                  background: selected ? "var(--surface-inverse)" : "var(--surface-card)",
                  border: selected ? "none" : "1px solid var(--border)",
                  textAlign: "center",
                }}
              >
                <div className="mono-data-sm" style={{ color: selected ? "rgba(255,255,255,.6)" : "var(--text-faint)", letterSpacing: 0 }}>
                  {d.dow}
                </div>
                <div style={{ font: "600 14px var(--font-sans)", marginTop: 1, color: selected ? "#fff" : "var(--text-primary)" }}>
                  {d.n}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="screen-scroll" style={{ background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", padding: "18px 16px 24px" }}>
        <WindowSelection dayEntries={dayEntries} selection={selection} onChange={onChange} contestWindows={contestWindows} />
      </div>

      <div style={{ flex: "none", background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", padding: "14px 16px 22px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <div style={{ font: "400 13px var(--font-sans)", color: "var(--text-secondary)" }}>
            {selection
              ? `${insideCount} item${insideCount === 1 ? "" : "s"} sit${insideCount === 1 ? "s" : ""} in these hours`
              : "Nothing claimed yet"}
          </div>
          {/* States the behaviour; it isn't a toggle. */}
          <span className="mono-caption" style={{ color: "var(--accent)" }}>
            Snap to 15m
          </span>
        </div>

        {matchingContest && !clashingContest && (
          <div style={{ marginTop: 8, font: "400 12px var(--font-sans)", color: "var(--accent)" }}>
            These hours already have a vote running — your block joins it as another set.
          </div>
        )}
        {clashingContest && (
          <div style={{ marginTop: 8, font: "500 12px var(--font-sans)", color: "var(--warn)" }}>
            {clockLabel(clashingContest.startMin)}–{clockLabel(clashingContest.endMin)} is already out for a vote. Claim
            those hours exactly, or stay clear of them.
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8, font: "500 12px var(--font-sans)", color: "var(--warn)" }}>{error}</div>
        )}
        {selection && selection.endMin - selection.startMin < MIN_SELECTION_MIN && (
          <div style={{ marginTop: 8, font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>
            A block needs at least 30 minutes.
          </div>
        )}

        <button
          type="button"
          disabled={!canFill}
          onClick={onFill}
          style={{
            width: "100%",
            marginTop: 12,
            height: 48,
            borderRadius: "var(--radius-md)",
            background: "var(--surface-inverse)",
            color: "#fff",
            font: "600 15px var(--font-sans)",
            opacity: canFill ? 1 : 0.4,
          }}
        >
          Fill these hours
        </button>
      </div>
    </>
  );
}

// A ruled-out chip stays tappable, just quieter. Availability is the
// group's own note about a place, not a constraint the server enforces —
// someone who knows the shop opens late should be able to pull the pin in
// and argue for it in the proposal's "Why", rather than finding the chip
// disabled with no way through.
function PullInChip({ option, onPullIn, muted = false }) {
  return (
    <button
      type="button"
      onClick={() => onPullIn(option)}
      title={muted && option.reasons.length ? option.reasons.join(" · ") : undefined}
      style={{
        padding: "7px 12px",
        borderRadius: "var(--radius-xl)",
        background: muted ? "transparent" : "var(--surface-card)",
        border: `1px ${muted ? "dashed" : "solid"} var(--border)`,
        font: "400 12px var(--font-sans)",
        color: muted ? "var(--text-faint)" : "var(--text-primary)",
      }}
    >
      {option.title} · {fmtMin(option.baseDurationMinutes)}
    </button>
  );
}

function StepThree({
  selection,
  windowMinutes,
  plannedMinutes,
  stops,
  pullInGroups,
  title,
  backLabel,
  onBack,
  onReorder,
  onChangeDuration,
  onChangeGap,
  onRemove,
  onAdd,
  onPullIn,
  stopForm,
  setStopForm,
  onSubmitStop,
  onCancelStop,
  nextStartMin,
  contributors,
  travellerCount,
  busy,
  error,
  canReview,
  onReview,
}) {
  return (
    <>
      <ModalHeader
        left={
          <button type="button" onClick={onBack} style={{ font: "500 14px var(--font-sans)", color: "var(--accent)" }}>
            {backLabel}
          </button>
        }
        title={title}
        right={
          <span className="mono-caption" style={{ color: "var(--accent)" }}>
            {clockLabel(selection.startMin)}–{clockLabel(selection.endMin)}
          </span>
        }
      />
      <div className="screen-scroll" style={{ padding: "4px var(--gutter-screen) 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <BudgetStrip claimedMinutes={windowMinutes} plannedMinutes={plannedMinutes} />

        <StopList
          stops={stops}
          windowStartMin={selection.startMin}
          windowMinutes={windowMinutes}
          onReorder={onReorder}
          onChangeDuration={onChangeDuration}
          onChangeGap={onChangeGap}
          onRemove={onRemove}
          onAdd={onAdd}
        />

        {stopForm && (
          <StopForm
            form={stopForm}
            setForm={setStopForm}
            onSubmit={onSubmitStop}
            onCancel={onCancelStop}
            startMin={nextStartMin}
            windowEndMin={selection.endMin}
            contributors={contributors}
            travellerCount={travellerCount}
            busy={busy}
          />
        )}

        <div>
          {/* Pins the group has said "works" for this day and these bands
              come first, under their own label; the rest stay visible
              below it rather than being filtered away. See the
              pullInGroups comment above for why nothing is hidden. */}
          <div className="mono-caption">Pull in · works these hours</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {pullInGroups.works.map((option) => (
              <PullInChip key={`${option.kind}-${option.refId}`} option={option} onPullIn={onPullIn} />
            ))}
            <button
              type="button"
              onClick={onAdd}
              style={{
                padding: "7px 12px",
                borderRadius: "var(--radius-xl)",
                background: "var(--surface-card)",
                border: "1px dashed var(--border-strong)",
                font: "400 12px var(--font-sans)",
                color: "var(--text-secondary)",
              }}
            >
              New stop
            </button>
          </div>
        </div>

        {pullInGroups.ruledOut.length > 0 && (
          <div>
            <div className="mono-caption" style={{ color: "var(--text-faint)" }}>
              Ruled out these hours
            </div>
            {/* Never assert a restriction without explaining it
                (design_system readme, "Content fundamentals") — the same
                rule that puts "why" chips under the availability grid. */}
            {pullInGroups.ruledOutReasons.length > 0 && (
              <div style={{ marginTop: 4, font: "400 11px/1.4 var(--font-sans)", color: "var(--text-faint)" }}>
                {pullInGroups.ruledOutReasons.join(" · ")}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {pullInGroups.ruledOut.map((option) => (
                <PullInChip key={`${option.kind}-${option.refId}`} option={option} onPullIn={onPullIn} muted />
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            background: "var(--accent-quiet)",
            border: "1px solid var(--plum-tint-strong)",
            borderRadius: "var(--radius-md)",
            padding: "11px 13px",
            font: "400 12px/1.5 var(--font-sans)",
            color: "var(--accent-press)",
          }}
        >
          {/* Not "gangway times stay pinned": a pinned item is never inside
              a claimed window at all — the hour picker clips at one — so
              that wording would promise something about a case that can't
              arise (feature spec §6.5). */}
          Tap a stop to set when it starts and how long it runs. A stop always begins after the one before
          it, so two of them can never overlap — drag the handle to change the order.
        </div>

        {error && <div style={{ font: "500 12px var(--font-sans)", color: "var(--warn)" }}>{error}</div>}
      </div>

      <div style={{ flex: "none", background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", padding: "14px 16px 22px" }}>
        <button
          type="button"
          disabled={!canReview}
          onClick={onReview}
          style={{
            width: "100%",
            height: 48,
            borderRadius: "var(--radius-md)",
            background: "var(--surface-inverse)",
            color: "#fff",
            font: "600 15px var(--font-sans)",
            opacity: canReview ? 1 : 0.4,
          }}
        >
          Review proposal
        </button>
      </div>
    </>
  );
}

const fieldStyle = {
  width: "100%",
  height: 46,
  marginTop: 6,
  padding: "0 12px",
  borderRadius: "var(--radius-lg)",
  border: "1px solid var(--border-strong)",
  font: "400 13.5px var(--font-sans)",
};

// Adding a stop, whether it's new or pulled in. "Starts" works the way it
// does on a stop already in the list (components/planner/StopList.jsx): it
// edits the free time in front of the stop, so it can never be set earlier
// than where the last stop ends and two stops still can't overlap.
function StopForm({ form, setForm, onSubmit, onCancel, startMin, windowEndMin, contributors, travellerCount, busy }) {
  const ref = useRef(null);
  const pulling = Boolean(form.option);
  const formKey = pulling ? `${form.option.kind}:${form.option.refId}` : "new";
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [formKey]);

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const startsAt = startMin + form.gap;
  const duration = Math.max(MIN_STOP_MIN, Math.round(Number(form.dur) || 0));
  const endsAt = startsAt + duration;
  const pastEnd = endsAt > windowEndMin;
  const canSubmit = !busy && (pulling || form.title.trim());

  return (
    <form
      ref={ref}
      onSubmit={onSubmit}
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-lg)",
        padding: 13,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {pulling ? (
        <div>
          <div className="mono-caption">Add stop</div>
          <div style={{ marginTop: 4, font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{form.title}</div>
        </div>
      ) : (
        <label style={{ display: "block" }}>
          <div className="mono-caption">New stop</div>
          <input
            value={form.title}
            autoFocus
            onChange={(e) => set("title")(e.target.value)}
            placeholder="What is it?"
            style={fieldStyle}
          />
        </label>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Stepper
            label="Starts"
            valueLabel={clockLabel(startsAt)}
            onDown={() => set("gap")(Math.max(0, form.gap - STOP_STEP_MIN))}
            onUp={() => set("gap")(form.gap + STOP_STEP_MIN)}
          />
        </div>
        <label style={{ flex: 1, minWidth: 0 }}>
          <div className="mono-caption">How long (min)</div>
          <input
            type="number"
            min={MIN_STOP_MIN}
            step={STOP_STEP_MIN}
            value={form.dur}
            onChange={(e) => set("dur")(e.target.value)}
            style={fieldStyle}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ flex: 1, minWidth: 0 }}>
          <div className="mono-caption">Cost, in total ($)</div>
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.cost}
            onChange={(e) => set("cost")(e.target.value)}
            style={fieldStyle}
          />
        </label>
        <div style={{ flex: 1, minWidth: 0 }} />
      </div>

      <div className="mono-data-sm" style={{ color: pastEnd ? "var(--warn)" : "var(--text-faint)" }}>
        {pastEnd
          ? `Ends ${clockLabel(endsAt)} — past the end of the block at ${clockLabel(windowEndMin)}`
          : `Ends ${clockLabel(endsAt)}`}
        {form.gap > 0 ? ` · ${fmtMin(form.gap)} free before it` : ""}
      </div>
      {pulling && (
        <div style={{ marginTop: -6, font: "400 11px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>
          Changing the cost changes it for this {form.option.kind === "pin" ? "pin" : "event"} everywhere it&rsquo;s used.
        </div>
      )}

      {!pulling && (
        <HeadsPicker contributors={contributors} value={form.heads} onChange={set("heads")} travellerCount={travellerCount} />
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", font: "600 13px var(--font-sans)", opacity: canSubmit ? 1 : 0.5 }}
        >
          Add stop
        </button>
      </div>
    </form>
  );
}

function StepFour({
  dayLabel,
  name,
  setName,
  rationale,
  setRationale,
  setLetter,
  board,
  yours,
  contributors,
  busy,
  error,
  isDraft,
  joining,
  editing,
  votesAtStake,
  onBack,
  onSaveDraft,
  onDiscardDraft,
  onSend,
}) {
  return (
    <>
      <ModalHeader
        left={
          <button type="button" onClick={onBack} style={{ font: "500 14px var(--font-sans)", color: "var(--accent)" }}>
            ‹ Block
          </button>
        }
        title="Review"
        right={<span className="mono-caption">{dayLabel}</span>}
      />
      <div className="screen-scroll" style={{ padding: "4px var(--gutter-screen) 24px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span className="mono-caption">Name this set</span>
            {/* Derived from creation order, never stored, so it can shift
                if an option is removed — which is why it's shown as a hint
                rather than typed into the name. */}
            {setLetter && (
              <span className="mono-caption" style={{ color: "var(--accent)" }}>
                Set {setLetter}
              </span>
            )}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ruins first, beach after"
            className="serif-place"
            style={{
              width: "100%",
              marginTop: 8,
              padding: "4px 0 6px",
              border: "none",
              borderBottom: "2px solid var(--accent)",
              background: "transparent",
              fontSize: 20,
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
        </div>

        <ComparisonColumns board={board} yours={yours} />

        <div style={{ background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 14 }}>
          <div className="mono-caption">Why (optional)</div>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            placeholder="The tide is wrong for the pools before four."
            style={{
              width: "100%",
              marginTop: 8,
              border: "none",
              outline: "none",
              resize: "vertical",
              background: "transparent",
              font: "400 13px/1.5 var(--font-sans)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        <div style={{ background: "var(--surface-card)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>Goes to a vote</span>
            <span className="mono-caption">
              {contributors.length} planner{contributors.length === 1 ? "" : "s"}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <AvatarStack contributors={contributors.slice(0, 4)} overflowCount={Math.max(0, contributors.length - 4)} size={26} />
          </div>
          {/* Amended from the handoff's "until a majority picks a set":
              nothing here resolves on a tally. The owner locks, and a
              majority is shown as a state rather than an outcome (feature
              spec decision 4). */}
          <div style={{ marginTop: 10, font: "400 12px var(--font-sans)", color: "var(--text-muted)" }}>
            {editing
              ? "Your set stays in the vote already running for these hours. Nothing changes on the calendar until the trip owner picks one."
              : joining
              ? "Your set joins the vote already running for these hours. Nothing changes on the calendar until the trip owner picks one."
              : `The block shows as proposed on ${dayLabel.toLowerCase()} until the trip owner picks a set.`}
          </div>
        </div>

        {/* Said before the save, not after it: a vote is someone else's,
            and clearing it is the kind of thing to be warned about while
            there is still the option of not doing it. */}
        {editing && votesAtStake > 0 && (
          <div
            style={{
              background: "var(--plum-tint)",
              border: "1px solid var(--plum-tint-strong)",
              borderRadius: "var(--radius-md)",
              padding: "11px 13px",
              font: "400 12px/1.5 var(--font-sans)",
              color: "var(--accent-press)",
            }}
          >
            {votesAtStake} {votesAtStake === 1 ? "person has" : "people have"} voted for this set. Saving changes
            clears {votesAtStake === 1 ? "that vote" : "those votes"}, so nobody ends up backing a set they never saw.
          </div>
        )}

        {error && <div style={{ font: "500 12px var(--font-sans)", color: "var(--warn)" }}>{error}</div>}

        {isDraft && (
          <button
            type="button"
            onClick={onDiscardDraft}
            disabled={busy}
            style={{ alignSelf: "flex-start", font: "600 12px var(--font-sans)", color: "var(--warn)" }}
          >
            Discard this draft
          </button>
        )}
      </div>

      <div style={{ flex: "none", background: "var(--surface-card)", borderTop: "1px solid var(--hairline)", padding: "14px 16px 22px", display: "flex", gap: 10 }}>
        {/* No draft on this path. A draft is hours nobody has claimed yet;
            these hours are already out for a vote, and saving a private
            copy of a set for a decision that may be locked before you
            publish it is a way to lose work, not to keep it. */}
        {!joining && !editing && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            style={{
              padding: "14px 16px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-strong)",
              font: "600 15px var(--font-sans)",
              color: "var(--text-secondary)",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Save draft
          </button>
        )}
        <button
          type="button"
          onClick={onSend}
          disabled={busy}
          style={{
            flex: 1,
            borderRadius: "var(--radius-md)",
            background: "var(--accent)",
            color: "#fff",
            font: "600 15px var(--font-sans)",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Saving…" : editing ? "Save changes" : joining ? "Add to the vote" : "Send to vote"}
        </button>
      </div>
    </>
  );
}
