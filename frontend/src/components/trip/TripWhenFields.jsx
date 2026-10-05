import TextField from "../forms/TextField";
import Stepper from "../forms/Stepper";
import { FULL_MONTH_NAMES, MONTH_NAMES, formatLength } from "../../lib/format";
import { LENGTH_PRESETS, MAX_LENGTH_DAYS, lengthOf, shortDate } from "../../lib/tripWhen";

// When the trip is (lib/tripWhen.js): its dates, or — "Not sure yet" — how
// long it is and, if you like, roughly which month. Used by a new trip
// (pages/NewTrip.jsx) and Trip settings (pages/TripSettings.jsx).
//
//   value     { mode: "dates" | "rough", startDate, endDate, lengthDays, roughMonth }
//   onChange  (next value)
//   hint      a line under the fields, in place of the default preview
export default function TripWhenFields({ value, onChange, hint = null }) {
  const set = (fields) => onChange({ ...value, ...fields });
  const rough = value.mode === "rough";
  const datesLength = lengthOf(value.startDate, value.endDate);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="mono-caption">When</div>
      <div role="group" aria-label="When the trip is" style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2, marginTop: -6 }}>
        <ModeButton on={!rough} onClick={() => set({ mode: "dates", lengthDays: datesLength ?? value.lengthDays })}>
          I have dates
        </ModeButton>
        <ModeButton on={rough} onClick={() => set({ mode: "rough", lengthDays: datesLength ?? value.lengthDays })}>
          Not sure yet
        </ModeButton>
      </div>

      {rough ? (
        <>
          <Stepper
            label="About how long?"
            valueLabel={value.lengthDays === 1 ? "1 day" : `${value.lengthDays} days`}
            onDown={() => set({ lengthDays: Math.max(1, value.lengthDays - 1) })}
            onUp={() => set({ lengthDays: Math.min(MAX_LENGTH_DAYS, value.lengthDays + 1) })}
            downDisabled={value.lengthDays <= 1}
            upDisabled={value.lengthDays >= MAX_LENGTH_DAYS}
            downLabel="One day fewer"
            upLabel="One day more"
          />
          <ChipRow label="Trip length">
            {LENGTH_PRESETS.map((p) => (
              <SmallChip key={p.days} on={value.lengthDays === p.days} onClick={() => set({ lengthDays: p.days })}>
                {p.label}
              </SmallChip>
            ))}
          </ChipRow>
          <div className="mono-caption">
            Roughly when? <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>Optional</span>
          </div>
          <ChipRow label="Roughly which month" style={{ marginTop: -6 }}>
            <SmallChip on={!value.roughMonth} onClick={() => set({ roughMonth: null })}>
              Don’t know
            </SmallChip>
            {MONTH_NAMES.map((name, i) => (
              <SmallChip key={name} on={value.roughMonth === i + 1} onClick={() => set({ roughMonth: i + 1 })}>
                {name}
              </SmallChip>
            ))}
          </ChipRow>
          <Preview>
            {hint ?? (
              <>
                <b>{value.lengthDays === 1 ? "Day 1" : `Day 1 – Day ${value.lengthDays}`}</b>
                {value.roughMonth ? ` · sometime in ${FULL_MONTH_NAMES[value.roughMonth - 1]}` : ` · ${formatLength(value.lengthDays).toLowerCase()}`}
              </>
            )}
          </Preview>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField type="date" label="Start date" value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField
                type="date"
                label="End date"
                value={value.endDate}
                onChange={(e) => set({ endDate: e.target.value })}
                min={value.startDate || undefined}
              />
            </div>
          </div>
          {hint || datesLength ? (
            <Preview>
              {hint ?? (
                <>
                  <b>{datesLength === 1 ? "1 day" : `${datesLength} days`}</b> · {shortDate(value.startDate)}
                  {value.endDate && value.endDate !== value.startDate ? ` – ${shortDate(value.endDate)}` : ""}
                </>
              )}
            </Preview>
          ) : null}
        </>
      )}
    </div>
  );
}

function ModeButton({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 0",
        borderRadius: "calc(var(--radius-md) - 2px)",
        background: on ? "var(--surface-card)" : "transparent",
        boxShadow: on ? "var(--shadow-raised)" : "none",
        font: "600 12px var(--font-sans)",
        color: on ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {children}
    </button>
  );
}

function ChipRow({ label, style, children }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", ...style }}>
      {children}
    </div>
  );
}

function SmallChip({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        flex: "none",
        height: 30,
        padding: "0 11px",
        borderRadius: "var(--radius-pill)",
        border: on ? "1.5px solid var(--accent)" : "1px solid var(--border-strong)",
        background: on ? "var(--accent-quiet)" : "var(--surface-card)",
        color: on ? "var(--accent)" : "var(--text-primary)",
        font: "600 11.5px var(--font-sans)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Preview({ children }) {
  return (
    <div
      aria-live="polite"
      style={{
        padding: "10px 12px",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface-inset)",
        border: "1px solid var(--hairline)",
        font: "500 12px/1.45 var(--font-sans)",
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </div>
  );
}
