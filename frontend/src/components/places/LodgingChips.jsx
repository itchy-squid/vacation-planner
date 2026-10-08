import { useId } from "react";
import { samePlace } from "../../lib/dayPlaces";

/**
 * "Staying at": which idea the group sleeps at on a day with a stay — the
 * hotel. It's where trips planned on the map start and end
 * (pages/PlanTrip.jsx), so only ideas with an exact spot are offered, the
 * stay's own town first. Once the trip has ideas marked as stays, only
 * those are offered; until then, any idea is. An idea picked as where
 * you're staying on any night of the trip is always offered too, so
 * switching hotels doesn't lose the one you switched from. Tap the chosen
 * one again to clear it.
 *
 *   day        the day's places ({ stay, lodgingPinId })
 *   pins       every idea on the trip, by id
 *   lastNight  the idea the night before was at, offered as a one-tap copy
 *   stayedAt   ids of the ideas picked as where you're staying on any night
 *   onPick     (pinId | null)
 */
export default function LodgingChips({ day, pins, lastNight, stayedAt = [], onPick }) {
  const labelId = useId();
  const onMap = Object.values(pins).filter((p) => p.lat != null && p.lng != null);
  const stays = onMap.filter((p) => p.kind === "stay");
  const pool = stays.length ? stays : onMap;
  const inTown = pool.filter((p) => samePlace(p.region, day.stay));
  const choices = inTown.length ? inTown : pool;
  const chosen = pins[day.lodgingPinId] ?? null;
  // The chosen idea stays on offer even if it's in another town, and so
  // does any idea you're staying at on another night.
  const extra = [chosen, ...stayedAt.map((id) => pins[id])].filter((p, i, all) => p && all.findIndex((q) => q?.id === p.id) === i);
  const shown = [...extra.filter((p) => !choices.some((c) => c.id === p.id)), ...choices];
  const offerLastNight = lastNight && lastNight.id !== day.lodgingPinId && shown.some((p) => p.id === lastNight.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div id={labelId} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 8px" }}>
        <span className="mono-caption">Staying at</span>
        <span style={{ font: "400 11.5px var(--font-sans)", color: "var(--text-secondary)" }}>
          {stays.length ? "trips from the map start and end here · only ideas marked as a stay are listed · tap again to clear" : "trips from the map start and end here · mark an idea as a stay to list only those"}
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
          No idea has a spot on the map yet. Add where you’re staying as an idea, mark it as a stay, and pin it, to start trips there.
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
