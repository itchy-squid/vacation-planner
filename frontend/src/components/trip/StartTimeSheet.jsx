import BottomSheet from "../core/BottomSheet";
import Button from "../core/Button";
import { clockLabel } from "../../lib/planTime";

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06–23
const MINUTES = [0, 15, 30, 45];

/**
 * When the proposal starts: quick picks from the open stretches of the
 * day, then any hour and quarter. Every pick applies straight away, so the
 * planner behind the sheet re-times as you go; Done just closes it.
 *
 *   value        minute of day
 *   length       how long the trip runs, for "ends 15:37"
 *   suggestions  [{ start, why }] — see lib/tripPlan.js openSlots
 *   busy         [{ startMin, endMin }] — hours with something on, underlined
 *   bounds       { min, max } — the latest start that still fits is max
 *   startsFrom   what the trip leaves ("the hotel"), for the heading
 */
export default function StartTimeSheet({ value, length, suggestions, busy, bounds, startsFrom, onChange, onClose }) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  const allowed = (m) => m >= bounds.min && m <= bounds.max;
  const pick = (m) => {
    if (allowed(m)) onChange(m);
  };

  return (
    <BottomSheet label="When this starts" onClose={onClose}>
      <div className="screen-scroll" style={{ padding: "8px 18px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <span className="serif-place" style={{ fontSize: 19 }}>
            {startsFrom ? `Leave ${startsFrom} at` : "Starts at"}
          </span>
          <span style={{ font: "600 24px var(--font-sans)", color: "var(--accent)" }}>{clockLabel(value)}</span>
        </div>

        {suggestions.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="mono-caption">Open that day</span>
            {suggestions.map((s) => {
              const on = s.start === value;
              return (
                <button
                  key={s.start}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(s.start)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minHeight: 44,
                    padding: "8px 12px",
                    textAlign: "left",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                    background: on ? "var(--accent-quiet)" : "var(--surface-card)",
                  }}
                >
                  <span style={{ font: "600 13px var(--font-sans)", width: 44 }}>{clockLabel(s.start)}</span>
                  <span style={{ flex: 1, font: "400 12.5px var(--font-sans)", color: on ? "var(--accent)" : "var(--text-secondary)" }}>{s.why}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <span className="mono-caption">Hour</span>
        <div role="group" aria-label="Hour" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5 }}>
          {HOURS.map((h) => {
            const target = h * 60 + minute;
            const on = h === hour;
            const booked = busy.some((b) => h * 60 < b.endMin && h * 60 + 60 > b.startMin);
            const ok = allowed(target);
            return (
              <button
                key={h}
                type="button"
                aria-pressed={on}
                disabled={!ok}
                aria-label={`${String(h).padStart(2, "0")}:00${booked ? ", something's on" : ""}`}
                onClick={() => pick(target)}
                style={{
                  position: "relative",
                  height: 34,
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${on ? "var(--surface-inverse)" : "var(--border)"}`,
                  background: on ? "var(--surface-inverse)" : "var(--surface-page)",
                  color: on ? "#fff" : "var(--text-primary)",
                  opacity: ok ? 1 : 0.35,
                  font: "600 12px var(--font-sans)",
                  boxShadow: booked && !on ? "inset 0 -3px 0 var(--stone-300)" : "none",
                }}
              >
                {String(h).padStart(2, "0")}
              </button>
            );
          })}
        </div>

        <span className="mono-caption">Minute</span>
        <div role="group" aria-label="Minute" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
          {MINUTES.map((m) => {
            const on = m === minute;
            const ok = allowed(hour * 60 + m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                disabled={!ok}
                onClick={() => pick(hour * 60 + m)}
                style={{ height: 38, font: "600 13px var(--font-sans)", background: on ? "var(--accent)" : "transparent", color: on ? "#fff" : "var(--text-primary)", opacity: ok ? 1 : 0.35 }}
              >
                :{String(m).padStart(2, "0")}
              </button>
            );
          })}
        </div>

        <Button onClick={onClose}>Done · ends {clockLabel(value + length)}</Button>
      </div>
    </BottomSheet>
  );
}
