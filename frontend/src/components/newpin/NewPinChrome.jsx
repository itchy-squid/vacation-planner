import HomeButton from "../core/HomeButton";

// The header every step of the new-pin screen shares (pages/NewPin.jsx):
// a way back on the left, "New pin" in the middle, and the step's own
// action, if it has one, on the right.
export function NewPinHeader({ backLabel, onBack, action = null }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "20px 16px 12px", flex: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <HomeButton size={28} />
        <button type="button" onClick={onBack} style={{ font: "500 13px var(--font-sans)", color: "var(--accent)" }}>
          ‹ {backLabel}
        </button>
      </div>
      <span className="mono-caption">New pin</span>
      <div style={{ justifySelf: "end" }}>{action}</div>
    </div>
  );
}

// "Search a place" or "Paste a link": the two ways to add a pin, shown
// above the forms so either can switch to the other.
export function AddModeSwitch({ mode, onSearch, onLink }) {
  const options = [
    { key: "search", label: "Search a place", onClick: onSearch },
    { key: "link", label: "Paste a link", onClick: onLink },
  ];
  return (
    <div
      role="group"
      aria-label="How to add it"
      style={{ display: "flex", background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: 2, margin: "0 16px 14px" }}
    >
      {options.map((opt) => {
        const on = opt.key === mode;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={on}
            onClick={on ? undefined : opt.onClick}
            style={{
              flex: 1,
              padding: "7px 0",
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

// Marks a field that was filled in from the search, so it's clear what
// came from Google and what the person typed.
export function SourceTag({ children, tone = "geo" }) {
  return (
    <span
      className="mono-data-sm"
      style={{
        fontSize: 8.5,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 6,
        background: tone === "geo" ? "var(--geo-quiet)" : "var(--surface-sunken)",
        color: tone === "geo" ? "var(--geo)" : "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}
