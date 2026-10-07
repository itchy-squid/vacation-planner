import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import CostField from "../forms/CostField";
import { textFieldStyle } from "../forms/TextField";
import ModeIcon from "../trip/ModeIcon";
import { useTravelEstimate } from "./useTravelEstimate";
import { usePlannerDispatch, usePlannerState } from "../../state/PlannerContext";
import { getTripDays } from "../../data/trip";
import { clockLabel, tripMinute } from "../../lib/planTime";
import { nextDeparture } from "../../lib/routes";
import {
  TRAVEL_MODES,
  biasAround,
  clockValue,
  formatMinutes,
  minuteFromClock,
  minutesBetween,
  planName,
  pushesFor,
  travelTitle,
} from "../../lib/travel";

// Bus and train with no "leaves at" are timed for mid-morning.
const TRANSIT_DEFAULT_MIN = 10 * 60;

// Travel with just how long it takes (lib/travel.js): a flight, a drive, a
// train. A mode, a from and to, and a price are all optional; there's no
// need for an idea at either end, the way the Map tab's routes have.
//
// A flight asks when it leaves and lands, and goes straight onto the day
// at its departure. Anything else asks how long, plus when it leaves if
// you know; with no time it's armed, so a tap on the calendar places it.
// Opened from a gap between two blocks (`gap`, lib/travel.js travelGaps),
// the from and to are filled in and it leaves when the first block ends.
// If it doesn't fit before the next block, the blocks after it are pushed
// later (pushesFor, from `dayEntries`), and the form says which first.
//
// Google's time (useTravelEstimate.js) is asked for whenever the mode is
// one it can route and both ends are filled in: ideas on the map by
// their spot, anything typed by searching for it near the trip's places.
// It fills in the minutes until you type your own.
//
// No time zones: every time is the day's own clock, like the rest of the
// calendar.
export default function TravelForm({ dayIndex, gap = null, dayEntries = [], onDone, onError, header }) {
  const dispatch = usePlannerDispatch();
  const { trip, pins } = usePlannerState();
  const [draft, setDraft] = useState(() => ({
    mode: "car",
    from: gap?.from?.label ?? "",
    to: gap?.to?.label ?? "",
    minutes: "",
    leaves: gap ? clockValue(gap.startMin) : "",
    lands: "",
    cost: 0,
    costBasis: "per_head",
  }));
  const [busy, setBusy] = useState(false);
  // Typed minutes are yours; until then, Google's fill them in.
  const [minutesTyped, setMinutesTyped] = useState(false);
  const set = (fields) => setDraft((d) => ({ ...d, ...fields }));

  const flight = draft.mode === "flight";
  const leavesMin = minuteFromClock(draft.leaves);
  const landsMin = minuteFromClock(draft.lands);
  const duration = flight
    ? leavesMin != null && landsMin != null
      ? minutesBetween(leavesMin, landsMin)
      : null
    : Number(draft.minutes) > 0
      ? Math.round(Number(draft.minutes))
      : null;

  // Google's time. A gap's end keeps its idea's spot until it's retyped.
  const spot = (end, label) => (end?.point && end.label === label ? end.point : null);
  const bias = useMemo(
    () => biasAround([gap?.from?.point, gap?.to?.point].some(Boolean) ? [gap?.from?.point, gap?.to?.point] : Object.values(pins)),
    [gap, pins]
  );
  const weekday = trip?.startDate ? getTripDays(trip)[dayIndex - 1]?.weekday : null;
  const departMin = leavesMin ?? TRANSIT_DEFAULT_MIN;
  const departure = useMemo(() => (weekday == null ? undefined : nextDeparture(new Date(), weekday, departMin)), [weekday, departMin]);
  const ask = useTravelEstimate({
    mode: draft.mode,
    from: { label: draft.from, point: spot(gap?.from, draft.from) },
    to: { label: draft.to, point: spot(gap?.to, draft.to) },
    departure,
    bias,
  });
  const estimate = ask.status === "ready" ? ask.estimate : null;
  const usable = estimate?.available ? estimate : null;
  const usableMinutes = usable?.minutes ?? null;
  // Untyped minutes follow Google: another mode's time, or none when it
  // has no way, never sits there looking like this one's.
  const settled = ask.status !== "loading";
  useEffect(() => {
    if (!minutesTyped && settled) setDraft((d) => ({ ...d, minutes: usableMinutes != null ? String(usableMinutes) : "" }));
  }, [usableMinutes, minutesTyped, settled]);

  // Between two blocks, what has to move for it to fit.
  const push = useMemo(
    () => (gap && leavesMin != null && duration != null ? pushesFor(dayEntries, leavesMin, leavesMin + Math.max(5, duration)) : null),
    [gap, dayEntries, leavesMin, duration]
  );
  const moves = push?.moves ?? [];

  const title = travelTitle(draft.mode, draft.from, draft.to);
  const canSave = duration != null && !(flight && leavesMin == null) && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    onError("");
    const payload = {
      title,
      kind: "travel",
      mode: draft.mode,
      duration_minutes: Math.max(5, duration),
      cost_cents: Math.round((Number(draft.cost) || 0) * 100),
      cost_basis: draft.costBasis,
      from_label: draft.from.trim(),
      to_label: draft.to.trim(),
      ...(usable && Number(draft.minutes) === usable.minutes && usable.distanceMeters != null
        ? { distance_meters: usable.distanceMeters }
        : {}),
    };
    try {
      // Last first, so each block moves into room that's already free.
      for (const move of [...moves].reverse()) {
        const moved = await dispatch({
          type: "MOVE_PLAN",
          planId: move.plan.id,
          contestId: null,
          startsAt: tripMinute(dayIndex, move.startMin),
          endsAt: tripMinute(dayIndex, move.endMin),
        });
        if (!moved.ok) {
          onError(`Couldn’t push ${planName(move.plan)} later${moved.message ? ` (${moved.message})` : ""}. Nothing was added.`);
          setBusy(false);
          return;
        }
      }
      if (leavesMin != null) {
        const result = await dispatch({ type: "PLACE_TRAVEL_AT", payload, startsAt: tripMinute(dayIndex, leavesMin) });
        if (result.ok) onDone({});
        else if (result.armed) {
          onDone({ notice: `Couldn’t put it at ${clockLabel(leavesMin)}${result.error ? ` (${result.error})` : ""}. Tap a free time to place ${result.item.title}.` });
        }
        else {
          onError(result.error || "Couldn't add that. Try again.");
          setBusy(false);
        }
        return;
      }
      const item = await dispatch({ type: "CREATE_TRAVEL_ITEM", payload });
      // Hand over the item itself: the store hasn't re-rendered with it yet.
      dispatch({ type: "ARM_PLACE_TRAVEL", travelItemId: item.id, item });
      onDone({});
    } catch {
      onError("Couldn't add that. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      {header}
      <form onSubmit={submit} style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingTop: 12 }}>
        <div role="group" aria-label="How" style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 5 }}>
          {TRAVEL_MODES.map(({ mode, label }) => {
            const on = draft.mode === mode;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => set({ mode })}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 0 7px",
                  borderRadius: "var(--radius-lg)",
                  border: `1px solid ${on ? "var(--surface-inverse)" : "var(--border)"}`,
                  background: on ? "var(--surface-inverse)" : "var(--surface-card)",
                  color: on ? "#fff" : "var(--text-primary)",
                  font: "500 10.5px var(--font-sans)",
                }}
              >
                {mode ? (
                  <ModeIcon mode={mode} style={{ width: 14, height: 14 }} />
                ) : (
                  <FontAwesomeIcon icon={faEllipsis} style={{ width: 14, height: 14 }} />
                )}
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label="From">
            <input
              value={draft.from}
              onChange={(e) => set({ from: e.target.value })}
              placeholder={flight ? "Houston IAH" : "Optional"}
              maxLength={200}
              style={textFieldStyle()}
            />
          </Field>
          <Field label="To">
            <input
              value={draft.to}
              onChange={(e) => set({ to: e.target.value })}
              placeholder={flight ? "Orlando MCO" : "Optional"}
              maxLength={200}
              style={textFieldStyle()}
            />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label={flight ? "Departs" : "Leaves at"}>
            <input
              type="time"
              value={draft.leaves}
              onChange={(e) => set({ leaves: e.target.value })}
              aria-label={flight ? "Departs" : "Leaves at (optional)"}
              style={textFieldStyle({ mono: true })}
            />
          </Field>
          {flight ? (
            <Field label="Lands">
              <input
                type="time"
                value={draft.lands}
                onChange={(e) => set({ lands: e.target.value })}
                aria-label="Lands"
                style={textFieldStyle({ mono: true })}
              />
            </Field>
          ) : (
            <Field
              label={
                usable && !minutesTyped && Number(draft.minutes) === usable.minutes ? (
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    Minutes<span style={{ color: "var(--geo)" }}>From Google</span>
                  </span>
                ) : (
                  "Minutes"
                )
              }
            >
              <input
                type="number"
                min={5}
                inputMode="numeric"
                value={draft.minutes}
                onChange={(e) => {
                  setMinutesTyped(e.target.value !== "");
                  set({ minutes: e.target.value });
                }}
                placeholder="35"
                style={textFieldStyle({ mono: true })}
              />
            </Field>
          )}
        </div>

        <div style={{ font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)", marginTop: -6 }}>
          {flight
            ? duration != null
              ? `${formatMinutes(duration)}${leavesMin != null && landsMin != null && landsMin <= leavesMin ? ", landing the next day" : ""}. Use each airport's local time.`
              : "Use each airport's local time."
            : draft.leaves
              ? "Goes on the calendar at that time."
              : "No time? You'll tap the calendar to place it."}
        </div>

        {ask.status !== "off" && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 11px",
              borderRadius: "var(--radius-lg)",
              background: "var(--geo-quiet)",
              font: "400 12px/1.4 var(--font-sans)",
              color: "var(--text-secondary)",
            }}
          >
            <span style={{ minWidth: 0 }}>
              {ask.status === "loading" ? (
                "Asking Google how long…"
              ) : ask.status === "error" ? (
                "Couldn’t reach Google for a time."
              ) : ask.status === "missing" ? (
                `Google couldn’t find “${(ask.end === "from" ? draft.from : draft.to).trim()}”. Try a fuller name, or type the minutes.`
              ) : usable ? (
                <>
                  Google says <b style={{ color: "var(--text-primary)" }}>{formatMinutes(usable.minutes)}</b>
                  {usable.summary ? ` · ${usable.summary}` : ""}
                  {(ask.from.name !== draft.from.trim() || ask.to.name !== draft.to.trim()) && (
                    <span style={{ display: "block", color: "var(--text-muted)", fontSize: 11 }}>
                      {ask.from.name} → {ask.to.name}
                    </span>
                  )}
                </>
              ) : (
                estimate.reason
              )}
            </span>
            {usable && Number(draft.minutes) !== usable.minutes && (
              <button
                type="button"
                onClick={() => {
                  setMinutesTyped(false);
                  set({ minutes: String(usable.minutes) });
                }}
                style={{ font: "600 12px var(--font-sans)", color: "var(--geo)", flex: "none" }}
              >
                Use it
              </button>
            )}
          </div>
        )}

        {moves.length > 0 && (
          <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
            Doesn’t fit before {planName(moves[0].plan)}, so{" "}
            {moves.length === 1 ? "it moves" : `it and ${moves.length - 1} more after it move`} later, to start at{" "}
            {clockLabel(moves[0].startMin)}.
          </div>
        )}
        {push?.blocked && (
          <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
            {push.blocked} You’ll be asked to pick another time.
          </div>
        )}

        <CostField
          id="travel-cost"
          value={draft.cost}
          onChange={(cost) => set({ cost })}
          basis={draft.costBasis}
          onBasis={(costBasis) => set({ costBasis })}
        />

        <button
          type="submit"
          disabled={!canSave}
          style={{
            height: 46,
            flex: "none",
            borderRadius: "var(--radius-lg)",
            background: "var(--surface-inverse)",
            color: "#fff",
            font: "600 14px var(--font-sans)",
            opacity: canSave ? 1 : 0.45,
          }}
        >
          {leavesMin != null ? `Add ${title} at ${clockLabel(leavesMin)}` : `Add ${title} and place`}
        </button>
      </form>
    </>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <div className="mono-caption" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}
