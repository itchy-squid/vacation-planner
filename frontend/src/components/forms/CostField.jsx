// A price and what it means: per person (the default — what one traveler
// pays) or for the group (one bill, like a van or a villa, divided among
// whoever shares it). See backend/app/derive.py item_money.
//
// `value` is in dollars as typed; `basis` is "per_head" or "group".
// With `onPer`, a second choice says how often it's paid: `per` is "once"
// or "day" (a price per 24 hours — see lib/dailyCosts.js). `children` go
// under the amount: whatever says what the price comes to.
export default function CostField({ id, value, onChange, basis = "per_head", onBasis, per = "once", onPer, disabled = false, children }) {
  const perHead = basis !== "group";
  const daily = per === "day";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="mono-caption">Cost</div>
      <Segmented
        label="How the cost is counted"
        options={[
          { value: "per_head", label: "Per person" },
          { value: "group", label: "For the group" },
        ]}
        value={perHead ? "per_head" : "group"}
        onChange={onBasis}
        disabled={disabled}
      />
      {onPer ? (
        <Segmented
          label="How often it's paid"
          options={[
            { value: "once", label: "Once" },
            { value: "day", label: "Per day" },
          ]}
          value={daily ? "day" : "once"}
          onChange={onPer}
          disabled={disabled}
        />
      ) : null}
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
          aria-label={`${perHead ? "Cost per person" : "Cost for the group"}${daily ? " per day" : ""}, in dollars`}
          style={{
            width: "100%",
            height: 44,
            padding: daily ? "0 100px 0 13px" : "0 70px 0 13px",
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
          {daily ? " / DAY" : ""}
        </span>
      </div>
      {children}
    </div>
  );
}

function Segmented({ label, options, value, onChange, disabled }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2 }}>
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange?.(opt.value)}
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
  );
}
