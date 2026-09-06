// Small metric tile used on trip cards and set cards: "24 pins", "cost
// each / moving / slack". Value 12-17px/600, mono uppercase caption below.
export default function MetricTile({ value, label, valueColor = "var(--text-primary)", size = 12 }) {
  return (
    <div style={{ flex: 1, background: "var(--surface-page)", borderRadius: "var(--radius-sm)", padding: "7px 8px" }}>
      <div style={{ font: `600 ${size}px var(--font-sans)`, color: valueColor }}>{value}</div>
      <div className="mono-caption">{label}</div>
    </div>
  );
}
