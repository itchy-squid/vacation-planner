// Honest placeholder texture, not an error state — see design_system
// readme "Backgrounds and imagery". Photography is intentionally
// unfinished for this pass (real photo-picker flow is not yet designed).
export default function PhotoPlaceholder({ height = 112, label = "photo", dark = false, radius, children }) {
  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: radius,
        overflow: "hidden",
        background: dark ? "var(--pattern-photo-dark)" : "var(--pattern-photo)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <span
        className="mono-caption"
        style={{ padding: "0 0 8px 10px", color: dark ? "rgba(255,255,255,.5)" : "var(--text-muted)" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
