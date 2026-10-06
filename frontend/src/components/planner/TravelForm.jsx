import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import CostField from "../forms/CostField";
import { textFieldStyle } from "../forms/TextField";
import ModeIcon from "../trip/ModeIcon";
import { useRideEstimates } from "../trip/useRideEstimates";
import { usePlannerDispatch } from "../../state/PlannerContext";
import { clockLabel, tripMinute } from "../../lib/planTime";
import { MODES } from "../../lib/routes";
import { isMapsConfigured } from "../../lib/googleMaps";
import { TRAVEL_MODES, clockValue, formatMinutes, minuteFromClock, minutesBetween, travelTitle } from "../../lib/travel";

// Travel with just how long it takes (lib/travel.js): a flight, a drive, a
// train. A mode, a from and to, and a price are all optional; there's no
// need for an idea at either end, the way the Map tab's routes have.
//
// A flight asks when it leaves and lands, and goes straight onto the day
// at its departure. Anything else asks how long, plus when it leaves if
// you know; with no time it's armed, so a tap on the calendar places it.
// Opened from a gap between two blocks (`gap`, lib/travel.js travelGaps),
// the from and to are filled in, it leaves when the first block ends, and
// Google's estimate is offered when both ends are on the map.
//
// No time zones: every time is the day's own clock, like the rest of the
// calendar.
export default function TravelForm({ dayIndex, gap = null, onDone, onError, header }) {
  const dispatch = usePlannerDispatch();
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

  // Google's time, when both ends are ideas on the map and the mode is one
  // it can route (lib/routes.js MODES).
  const legs = useMemo(
    () =>
      isMapsConfigured && gap?.from?.point && gap?.to?.point ? [{ key: "gap", from: gap.from.point, to: gap.to.point }] : [],
    [gap]
  );
  const { estimates } = useRideEstimates(legs, null);
  const ask = legs.length && MODES.includes(draft.mode) ? estimates.gap : null;
  const estimate = ask?.status === "ready" ? ask.byMode[draft.mode] : null;
  const usable = estimate?.available ? estimate : null;

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
            <Field label="Minutes">
              <input
                type="number"
                min={5}
                inputMode="numeric"
                value={draft.minutes}
                onChange={(e) => set({ minutes: e.target.value })}
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

        {ask && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 11px",
              borderRadius: "var(--radius-lg)",
              background: "var(--geo-quiet)",
              font: "400 12px var(--font-sans)",
              color: "var(--text-secondary)",
            }}
          >
            <span>
              {ask.status === "loading"
                ? "Asking Google how long…"
                : ask.status === "error"
                  ? "Couldn’t reach Google for a time."
                  : usable
                  ? (
                    <>
                      Google says <b style={{ color: "var(--text-primary)" }}>{formatMinutes(usable.minutes)}</b>
                      {usable.summary ? ` · ${usable.summary}` : ""}
                    </>
                  )
                    : estimate.reason}
            </span>
            {usable && Number(draft.minutes) !== usable.minutes && (
              <button type="button" onClick={() => set({ minutes: String(usable.minutes) })} style={{ font: "600 12px var(--font-sans)", color: "var(--geo)", flex: "none" }}>
                Use it
              </button>
            )}
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
