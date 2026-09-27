import { PIN_ORDERS } from "../../lib/popularity";

// "Suggested | Most hearted" — how a list of ideas to pick from is sorted
// (lib/popularity.js). A small two-way segmented control: both options
// always visible, the chosen one filled, like the app's selected chips.
export default function PinOrderToggle({ value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Sort ideas"
      style={{
        display: "inline-flex",
        padding: 2,
        gap: 2,
        borderRadius: "var(--radius-pill)",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        flex: "none",
      }}
    >
      {PIN_ORDERS.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            style={{
              padding: "5px 11px",
              borderRadius: "var(--radius-pill)",
              font: "500 11px var(--font-sans)",
              whiteSpace: "nowrap",
              background: selected ? "var(--surface-inverse)" : "transparent",
              color: selected ? "#fff" : "var(--text-secondary)",
              transition: "background var(--dur-fast) var(--ease-standard)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
