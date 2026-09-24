// Who a cost is for — a row of traveler-initial chips, used on the visit
// editor (pages/EditVisit.jsx), the custom-event form and the propose
// screen's stop form.
//
// Nothing selected means "whoever's on the plan": everyone, or on a day the
// group has split, the group the item is scheduled with
// (backend/app/derive.py item_money). That's the default, and it's better
// than every traveler pre-ticked: a stored list goes stale the moment
// someone is added to the trip, and it would ignore a split.
export default function HeadsPicker({ travelers, value = [], onChange, disabled = false }) {
  const selected = value ?? [];
  const whoever = selected.length === 0;

  function toggle(id) {
    if (disabled) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div>
      <div className="mono-caption">Who it&rsquo;s for</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        <button type="button" disabled={disabled} onClick={() => onChange([])} style={chipStyle(whoever)}>
          Whoever&rsquo;s on the plan
        </button>
        {travelers.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(t.id)}
            aria-pressed={selected.includes(t.id)}
            title={t.name}
            style={chipStyle(selected.includes(t.id))}
          >
            {t.initial}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 6, font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
        {whoever
          ? "Everyone on the plan it\u2019s scheduled in — the whole trip, or one group on a split day."
          : `Just ${selected.length} ${selected.length === 1 ? "person" : "people"}.`}
      </div>
    </div>
  );
}

function chipStyle(selected) {
  return {
    minWidth: 34,
    height: 34,
    padding: "0 11px",
    borderRadius: "var(--radius-pill)",
    font: "600 12px var(--font-sans)",
    background: selected ? "var(--accent)" : "var(--surface-card)",
    color: selected ? "#fff" : "var(--text-primary)",
    border: selected ? "none" : "1px solid var(--border-strong)",
    transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast)",
  };
}
