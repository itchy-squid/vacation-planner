// A − / value / + stepper in a single rounded field. Duration is the
// original use: 15-minute steps, floor 15 (design_system readme + handoff
// README screen 6 "Duration / Cost"), which is why the buttons default to
// "Shorter"/"Longer". Other steppers (forms/DayStepper.jsx) pass their own
// button labels, per-button disabled states, and `children` in place of
// `valueLabel` when the middle is more than plain text.
export default function Stepper({
  label,
  valueLabel,
  children,
  onDown,
  onUp,
  disabled = false,
  downDisabled = false,
  upDisabled = false,
  downLabel = "Shorter",
  upLabel = "Longer",
}) {
  return (
    <div>
      {label ? <div className="mono-caption">{label}</div> : null}
      <div
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          background: "var(--surface-card)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          height: 46,
          overflow: "hidden",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <StepButton onClick={onDown} disabled={disabled || downDisabled} endStop={!disabled && downDisabled} label={downLabel}>
          −
        </StepButton>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>
          {children ?? valueLabel}
        </div>
        <StepButton onClick={onUp} disabled={disabled || upDisabled} endStop={!disabled && upDisabled} label={upLabel}>
          +
        </StepButton>
      </div>
    </div>
  );
}

function StepButton({ onClick, disabled, endStop, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 40,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: "400 20px var(--font-sans)",
        color: "var(--text-secondary)",
        // Only an end-stop (Day 1, the last day) dims on its own; a
        // disabled stepper as a whole is already dimmed by its frame.
        opacity: endStop ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}
