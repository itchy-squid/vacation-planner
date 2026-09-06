// Base card surface. Selection is a border + shadow change — never a
// background change (design_system/readme.md "Cards").
export default function Card({ children, selected = false, accentColor = "var(--accent)", onClick, style, as: As = "div" }) {
  return (
    <As
      onClick={onClick}
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-2xl)",
        border: selected ? `1.5px solid ${accentColor}` : "1px solid var(--hairline)",
        boxShadow: selected ? "var(--shadow-select)" : "var(--shadow-card)",
        transition: "var(--transition-select)",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </As>
  );
}
