// Wrapping tag pills; selected fills ink (design_system readme "States":
// selected chips fill solid, never a tint plus a checkmark).
export const TAG_VOCABULARY = ["outdoors", "food", "swim", "hike", "sunset", "rainy-day", "kid-ok"];

export default function TagPicker({ label = "Tags", selectedTags, onToggle, vocabulary = TAG_VOCABULARY }) {
  return (
    <div>
      {label ? <div className="mono-caption">{label}</div> : null}
      <div style={{ marginTop: 7, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {vocabulary.map((tag) => {
          const selected = selectedTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onToggle(tag)}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-pill)",
                font: "500 12px var(--font-sans)",
                background: selected ? "var(--surface-inverse)" : "var(--surface-card)",
                color: selected ? "#fff" : "var(--text-primary)",
                border: selected ? "none" : "1px solid var(--border)",
                transition: "background var(--dur-fast) var(--ease-standard)",
              }}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
