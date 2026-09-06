// Duration stepper: 15-minute steps, floor 15 (design_system readme +
// handoff README screen 6 "Duration / Cost").
export default function Stepper({ label, valueLabel, onDown, onUp }) {
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
        }}
      >
        <button
          type="button"
          onClick={onDown}
          style={{ width: 40, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", font: "400 20px var(--font-sans)", color: "var(--text-secondary)" }}
        >
          −
        </button>
        <div style={{ flex: 1, textAlign: "center", font: "600 14px var(--font-sans)", color: "var(--text-primary)" }}>{valueLabel}</div>
        <button
          type="button"
          onClick={onUp}
          style={{ width: 40, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", font: "400 20px var(--font-sans)", color: "var(--text-secondary)" }}
        >
          +
        </button>
      </div>
    </div>
  );
}
