import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import WindowSelection from "../components/planner/WindowSelection";
import StopList from "../components/planner/StopList";
import BudgetStrip from "../components/planner/BudgetStrip";
import ComparisonColumns, { summariseStops } from "../components/planner/ComparisonColumns";
import AvatarStack from "../components/planner/AvatarStack";
import HeadsPicker from "../components/planner/HeadsPicker";
import { usePlannerState, usePlannerDispatch } from "../state/PlannerContext";
import { useNavGuard, useGuardedNavigate } from "../state/NavGuard";
import { getTripDays } from "../data/trip";
import { fmtMin } from "../data/derive";
import { headcountFor, perHeadCents } from "../data/expenses";
import { clockLabel, dayIndexForDate, isoForDayMinute } from "../lib/planTime";
import {
  MIN_SELECTION_MIN,
  contestWindowsFrom,
  overlaps,
  planEndMinute,
  planStartMinute,
} from "../lib/dayGrid";

// Steps 2-4 of "propose a block": claim the hours, fill them, send them to
// a vote. Step 1 is the tray button on pages/DaySchedule.jsx that gets you
// here.
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
  const { trip, plans, pins, travelItems, contributors } = state;

  const reopenedDraftId = location.state?.draftPlanId ?? null;

  const dayPlans = useMemo(
    () =>
      plans.filter(
        (p) => p.status !== "draft" && p.startDt && dayIndexForDate(p.startDt, trip.startDate) === dayIndex
      ),
    [plans, trip.startDate, dayIndex]
  );
  const contestWindows = useMemo(() => contestWindowsFrom(dayPlans), [dayPlans]);
  const reopenedDraft = useMemo(
    () => (reopenedDraftId ? plans.find((p) => p.id === reopenedDraftId) : null),
    [plans, reopenedDraftId]
  );

  // Reopening a draft drops you straight into step 3 with its window and
  // stops — there's nothing to claim again.
  const [step, setStep] = useState(reopenedDraft ? 3 : 2);
  const [selection, setSelection] = useState(() =>
    reopenedDraft
      ? { startMin: planStartMinute(reopenedDraft), endMin: planEndMinute(reopenedDraft) }
      : null
  );
  const [stops, setStops] = useState(() =>
    reopenedDraft
      ? reopenedDraft.items.map((item) => ({
          key: nextStopKey(),
          kind: item.pinId ? "pin" : "travel",
          refId: item.pinId ?? item.travelItemId,
          title: item.title,
          baseDurationMinutes: item.baseDurationMinutes,
          durationMinutes: item.durationMinutes,
          costCents: item.costCents,
          heads: item.heads,
        }))
      : []
  );
  const [name, setName] = useState(reopenedDraft?.label ?? "");
  const [rationale, setRationale] = useState(reopenedDraft?.rationale ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingStop, setAddingStop] = useState(false);
  const [newStop, setNewStop] = useState({ title: "", dur: 60, cost: 0, heads: [] });

  const dirty = Boolean(selection) || stops.length > 0;
  useNavGuard(dirty && !busy, DISCARD_PROMPT);

  const windowMinutes = selection ? selection.endMin - selection.startMin : 0;
  const plannedMinutes = stops.reduce((sum, s) => sum + s.durationMinutes, 0);

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
    return dayPlans.filter(
      (p) => p.status !== "locked" && overlaps(planStartMinute(p), planEndMinute(p), selection.startMin, selection.endMin)
    );
  }, [dayPlans, selection]);

  const insideItems = useMemo(
    () => insidePlans.flatMap((p) => p.items.map((item) => ({ plan: p, item }))),
    [insidePlans]
  );

  const tripDays = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate]);
  const travellerCount = trip.travellerCount || contributors.length || 1;

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
      });
    });
    // Then the unplaced tray. Pins in a region this day is already about
    // come first — a block on the Xiaoliuqiu day is far more likely to
    // want a Xiaoliuqiu pin than a Tainan one — but nothing is hidden,
    // because a day with nothing scheduled yet has no region to sort by
    // and would otherwise offer an empty list.
    const dayRegions = new Set(
      dayPlans.flatMap((p) => p.items.map((it) => (it.pinId ? pins[it.pinId]?.region : null)).filter(Boolean))
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
        })
      );

    const seen = new Set();
    return options.filter((o) => {
      const key = `${o.kind}:${o.refId}`;
      if (seen.has(key) || usedRefs.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [plans, pins, travelItems, insideItems, dayPlans, stops]);

  function addStop(option) {
    setError("");
    setStops((current) => [...current, { ...option, key: nextStopKey() }]);
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

  function removeStop(index) {
    setStops((current) => current.filter((_, i) => i !== index));
  }

  async function createInlineStop(e) {
    e.preventDefault();
    if (!newStop.title.trim()) return;
    setBusy(true);
    try {
      // A stop invented here isn't a place anyone pinned, so it's a travel
      // item — the model's own name for "something on the schedule that
      // isn't a pin" (see backend/app/models.py TravelItem).
      const created = await dispatch({
        type: "CREATE_TRAVEL_ITEM",
        payload: {
          title: newStop.title.trim(),
          kind: "other",
          duration_minutes: Math.max(15, Number(newStop.dur) || 60),
          cost_cents: Math.round((Number(newStop.cost) || 0) * 100),
        },
      });
      if (newStop.heads.length) {
        await dispatch({ type: "PATCH_TRAVEL_ITEM", id: created.id, fields: { heads: newStop.heads } });
      }
      addStop({
        kind: "travel",
        refId: created.id,
        title: created.title,
        baseDurationMinutes: created.dur,
        durationMinutes: created.dur,
        costCents: created.costCents ?? Math.round((Number(newStop.cost) || 0) * 100),
        heads: newStop.heads,
      });
      setNewStop({ title: "", dur: 60, cost: 0, heads: [] });
      setAddingStop(false);
    } catch (err) {
      setError(err.message || "Couldn't add that stop.");
    } finally {
      setBusy(false);
    }
  }

  // ---- submission ---------------------------------------------------------
  function payloadItems() {
    return stops.map((s) => ({
      ...(s.kind === "pin" ? { pin_id: s.refId } : { travel_item_id: s.refId }),
      // Only send a trim when there is one: an untrimmed stop should keep
      // tracking its pin's duration rather than freezing today's value.
      ...(s.durationMinutes !== s.baseDurationMinutes ? { duration_minutes: s.durationMinutes } : {}),
    }));
  }

  function windowIso() {
    return {
      startsAt: isoForDayMinute(trip.startDate, dayIndex, selection.startMin),
      endsAt: isoForDayMinute(trip.startDate, dayIndex, selection.endMin),
    };
  }

  function handleConflict(result) {
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
    const { startsAt, endsAt } = windowIso();
    const result = reopenedDraftId
      ? await publishExistingDraft(startsAt, endsAt)
      : await dispatch({ type: "PROPOSE_BLOCK", startsAt, endsAt, label: name.trim(), rationale: rationale.trim(), items: payloadItems() });
    setBusy(false);
    if (result.ok) {
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
    if (result.ok) navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
    else setError(result.error || "Couldn't save that draft.");
  }

  async function discardDraft() {
    if (!reopenedDraftId || busy) return;
    setBusy(true);
    await dispatch({ type: "DISCARD_DRAFT", planId: reopenedDraftId });
    setBusy(false);
    navigate(`/trips/${trip.id}/schedule/${dayIndex}`, { replace: true });
  }

  function cancel() {
    guardedNavigate(`/trips/${trip.id}/schedule/${dayIndex}`);
  }

  const dayLabel = `Day ${dayIndex}`;
  const canFill = Boolean(selection) && windowMinutes >= MIN_SELECTION_MIN && !clashingContest;
  const canReview = stops.length > 0 && plannedMinutes <= windowMinutes;

  return (
    <div className="screen">
      {step === 2 && (
        <StepTwo
          dayLabel={dayLabel}
          tripDays={tripDays}
          dayIndex={dayIndex}
          dayPlans={dayPlans}
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
          pullInOptions={pullInOptions}
          onBack={() => setStep(2)}
          onReorder={reorder}
          onChangeDuration={changeDuration}
          onRemove={removeStop}
          onAdd={() => setAddingStop(true)}
          onPullIn={addStop}
          addingStop={addingStop}
          newStop={newStop}
          setNewStop={setNewStop}
          onCreateStop={createInlineStop}
          onCancelAdd={() => setAddingStop(false)}
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
          setLetter={predictSetLetter(matchingContest, insidePlans)}
          board={boardColumn(insideItems, selection, windowMinutes)}
          yours={yoursColumn(stops, selection, windowMinutes)}
          contributors={contributors}
          busy={busy}
          error={error}
          isDraft={Boolean(reopenedDraftId)}
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
function predictSetLetter(matchingContest, insidePlans) {
  if (matchingContest) return null; // the server counts existing options; don't guess
  return insidePlans.length > 0 ? "B" : "A";
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
  dayPlans,
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
        <WindowSelection dayPlans={dayPlans} selection={selection} onChange={onChange} contestWindows={contestWindows} />
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

function StepThree({
  selection,
  windowMinutes,
  plannedMinutes,
  stops,
  pullInOptions,
  onBack,
  onReorder,
  onChangeDuration,
  onRemove,
  onAdd,
  onPullIn,
  addingStop,
  newStop,
  setNewStop,
  onCreateStop,
  onCancelAdd,
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
            ‹ Hours
          </button>
        }
        title="Your block"
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
          onRemove={onRemove}
          onAdd={onAdd}
        />

        {addingStop && (
          <form
            onSubmit={onCreateStop}
            style={{
              background: "var(--surface-card)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius-lg)",
              padding: 13,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div className="mono-caption">New stop</div>
            <input
              value={newStop.title}
              autoFocus
              onChange={(e) => setNewStop((s) => ({ ...s, title: e.target.value }))}
              placeholder="What is it?"
              style={{ height: 44, padding: "0 12px", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", font: "400 13.5px var(--font-sans)" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min={15}
                step={15}
                value={newStop.dur}
                onChange={(e) => setNewStop((s) => ({ ...s, dur: e.target.value }))}
                aria-label="Minutes"
                style={{ flex: 1, minWidth: 0, height: 44, padding: "0 12px", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", font: "400 13.5px var(--font-sans)" }}
              />
              <input
                type="number"
                min={0}
                value={newStop.cost}
                onChange={(e) => setNewStop((s) => ({ ...s, cost: e.target.value }))}
                aria-label="Cost in total"
                style={{ flex: 1, minWidth: 0, height: 44, padding: "0 12px", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", font: "400 13.5px var(--font-sans)" }}
              />
            </div>
            <HeadsPicker
              contributors={contributors}
              value={newStop.heads}
              onChange={(heads) => setNewStop((s) => ({ ...s, heads }))}
              travellerCount={travellerCount}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onCancelAdd}
                style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", font: "600 13px var(--font-sans)", opacity: busy ? 0.5 : 1 }}
              >
                Add stop
              </button>
            </div>
          </form>
        )}

        <div>
          <div className="mono-caption">Pull in</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {pullInOptions.map((option) => (
              <button
                key={`${option.kind}-${option.refId}`}
                type="button"
                onClick={() => onPullIn(option)}
                style={{
                  padding: "7px 12px",
                  borderRadius: "var(--radius-xl)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border)",
                  font: "400 12px var(--font-sans)",
                  color: "var(--text-primary)",
                }}
              >
                {option.title} · {fmtMin(option.baseDurationMinutes)}
              </button>
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
          Stops snap end to end inside the block, so they can never overlap. Pinned times stay put.
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
            The block shows as contested on {dayLabel.toLowerCase()} until the trip owner picks a set.
          </div>
        </div>

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
          {busy ? "Sending…" : "Send to vote"}
        </button>
      </div>
    </>
  );
}
