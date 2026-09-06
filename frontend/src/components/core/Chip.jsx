// Filter/tag chip. Selected chips fill solid — never a tint plus a
// checkmark (design_system/readme.md "States").
export default function Chip({ label, selected = false, onClick, tone = "ink" }) {
  const fill = tone === "ink" ? "var(--surface-inverse)" : "var(--accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "none",
        padding: "6px 12px",
        borderRadius: "var(--radius-pill)",
        font: "500 12px var(--font-sans)",
        background: selected ? fill : "var(--surface-card)",
        color: selected ? "#fff" : "var(--text-primary)",
        border: selected ? "none" : "1px solid var(--border)",
        transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
