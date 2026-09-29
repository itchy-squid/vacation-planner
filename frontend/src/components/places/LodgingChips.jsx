import { useId } from "react";
import { samePlace } from "../../lib/dayPlaces";

/**
 * "Staying at": which idea the group sleeps at on a day with a stay — the
 * hotel. It's where trips planned on the map start and end
 * (pages/PlanTrip.jsx), so only ideas with an exact spot are offered, the
 * stay's own town first. Tap the chosen one again to clear it.
 *
 *   day        the day's places ({ stay, lodgingPinId })
 *   pins       every idea on the trip, by id
 *   lastNight  the idea the night before was at, offered as a one-tap copy
 *   onPick     (pinId | null)
 */
export default function LodgingChips({ day, pins, lastNight, onPick }) {
  const labelId = useId();
  const onMap = Object.values(pins).filter((p) => p.lat != null && p.lng != null);
  const inTown = onMap.filter((p) => samePlace(p.region, day.stay));
  const choices = inTown.length ? inTown : onMap;
  const chosen = pins[day.lodgingPinId] ?? null;
  // The chosen idea stays on offer even if it's in another town.
  const shown = chosen && !choices.some((p) => p.id === chosen.id) ? [chosen, ...choices] : choices;
  const offerLastNight = lastNight && lastNight.id !== day.lodgingPinId && shown.some((p) => p.id === lastNight.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div id={labelId} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 8px" }}>
        <span className="mono-caption">Staying at</span>
        <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>
          trips from the map start and end here · tap again to clear
        </span>
      </div>
      {shown.length ? (
        <div role="group" aria-labelledby={labelId} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {shown.map((pin) => {
            const on = pin.id === day.lodgingPinId;
            return (
              <button key={pin.id} type="button" aria-pressed={on} onClick={() => onPick(on ? null : pin.id)} style={chipStyle(on)}>
                {pin.title}
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ font: "400 12px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
          No idea has a spot on the map yet. Add where you’re staying as an idea, and pin it, to start trips there.
        </div>
      )}
      {offerLastNight ? (
        <button type="button" onClick={() => onPick(lastNight.id)} style={{ alignSelf: "flex-start", font: "600 12.5px var(--font-sans)", color: "var(--accent)" }}>
          Same as last night: {lastNight.title}
        </button>
      ) : null}
    </div>
  );
}

function chipStyle(on) {
  return {
    padding: "6px 12px",
    borderRadius: "var(--radius-pill)",
    font: "500 12.5px var(--font-sans)",
    border: on ? "1px solid var(--surface-inverse)" : "1px solid var(--border-strong)",
    background: on ? "var(--surface-inverse)" : "var(--surface-card)",
    color: on ? "#fff" : "var(--text-primary)",
  };
}
