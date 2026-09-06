// Small status capsule — e.g. "IDEATION" cover badge, "LEADING" set badge.
export default function Badge({ children, tone = "dark" }) {
  const tones = {
    dark: { background: "rgba(255,255,255,.92)", color: "var(--plum-600)" },
    accent: { background: "var(--accent)", color: "#fff" },
  };
  const t = tones[tone] ?? tones.dark;
  return (
    <span
      className="mono-caption"
      style={{
        display: "inline-block",
        padding: "3px 6px",
        borderRadius: 4,
        letterSpacing: "var(--micro-tracking)",
        ...t,
      }}
    >
      {children}
    </span>
  );
}
