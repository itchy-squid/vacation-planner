// A price and what it means: per person (the default — what one traveler
// pays) or for the group (one bill, like a van or a villa, divided among
// whoever shares it). See backend/app/derive.py item_money.
//
// `value` is in dollars as typed; `basis` is "per_head" or "group".
export default function CostField({ id, value, onChange, basis = "per_head", onBasis, disabled = false }) {
  const perHead = basis !== "group";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="mono-caption">Cost</div>
      <div
        role="group"
        aria-label="How the cost is counted"
        style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2 }}
      >
        {[
          { value: "per_head", label: "Per person" },
          { value: "group", label: "For the group" },
        ].map((opt) => {
          const on = (opt.value === "group") !== perHead;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onBasis?.(opt.value)}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: "calc(var(--radius-md) - 2px)",
                background: on ? "var(--surface-card)" : "transparent",
                boxShadow: on ? "var(--shadow-raised)" : "none",
                font: "600 11.5px var(--font-sans)",
                color: on ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={perHead ? "Cost per person, in dollars" : "Cost for the group, in dollars"}
          style={{
            width: "100%",
            height: 44,
            padding: "0 70px 0 13px",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-strong)",
            background: "var(--surface-page)",
            font: "600 14px var(--font-sans)",
            color: "var(--text-primary)",
            boxSizing: "border-box",
          }}
        />
        <span
          className="mono-data-sm"
          style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
        >
          {perHead ? "EACH" : "TOTAL"}
        </span>
      </div>
    </div>
  );
}
