// Who a cost is split between — a row of contributor-initial chips, used
// on the visit editor (pages/EditVisit.jsx) and the travel-item form.
//
// Nothing selected means everyone, and that's the default rather than
// "every contributor pre-ticked", for two reasons: it's the common case,
// and a stored list of every id would go stale the moment somebody joined
// the trip. "Everyone" is also the trip's traveller count rather than its
// contributor roster — the people going and the people planning are
// different numbers (see data/expenses.js headcountFor).
export default function HeadsPicker({ contributors, value = [], onChange, travellerCount, disabled = false }) {
  const selected = value ?? [];
  const everyone = selected.length === 0;

  function toggle(id) {
    if (disabled) return;
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div>
      <div className="mono-caption">Split between</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([])}
          style={chipStyle(everyone)}
        >
          Everyone
        </button>
        {contributors.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(c.id)}
            aria-pressed={selected.includes(c.id)}
            title={c.name}
            style={chipStyle(selected.includes(c.id))}
          >
            {c.initial}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 6, font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
        {everyone
          ? `Split ${travellerCount} ways — everyone on the trip.`
          : `Split ${selected.length} ${selected.length === 1 ? "way" : "ways"}.`}
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
