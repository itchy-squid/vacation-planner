// What an idea is: something to do, or somewhere to stay (backend
// models.py Pin.kind). A stay takes no time on the Plan tab — it's picked
// as where the group sleeps in Where we'll be — so it has no duration and
// can't be in a block. `lockedReason` says why it can't be changed to a
// stay right now (it's on the plan), and disables that choice.
const KINDS = [
  { value: "activity", label: "Something to do" },
  { value: "stay", label: "Somewhere to stay" },
];

export default function KindField({ value, onChange, disabled = false, lockedReason = "" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="mono-caption">What is it?</div>
      <div role="group" aria-label="What this idea is" style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2 }}>
        {KINDS.map((opt) => {
          const on = opt.value === value;
          const blocked = opt.value === "stay" && !on && Boolean(lockedReason);
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled || blocked}
              aria-pressed={on}
              onClick={() => onChange(opt.value)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: "calc(var(--radius-md) - 2px)",
                background: on ? "var(--surface-card)" : "transparent",
                boxShadow: on ? "var(--shadow-raised)" : "none",
                font: "600 12px var(--font-sans)",
                color: on ? "var(--text-primary)" : blocked ? "var(--text-faint)" : "var(--text-secondary)",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {lockedReason && value !== "stay" ? (
        <div style={{ font: "400 11.5px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{lockedReason}</div>
      ) : null}
    </div>
  );
}
