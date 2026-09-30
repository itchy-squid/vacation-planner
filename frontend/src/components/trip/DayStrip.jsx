const FROM = 360; // 06:00
const TO = 1440;
const pct = (m) => `${(Math.max(0, Math.min(1, (m - FROM) / (TO - FROM))) * 100).toFixed(2)}%`;
const width = (a, b) => `${(Math.max(0, (Math.min(b, TO) - Math.max(a, FROM)) / (TO - FROM)) * 100).toFixed(2)}%`;

/**
 * The day at a glance, 06:00–24:00: what's already on (grey), the hours a
 * vote is fixed to (dashed frame), and where this trip lands (plum, or
 * rust when it doesn't fit).
 */
export default function DayStrip({ busy, start, end, frame = null, warn = false }) {
  return (
    <div aria-hidden="true">
      <div style={{ position: "relative", height: 22, borderRadius: 6, background: "var(--surface-sunken)", overflow: "hidden" }}>
        {frame ? (
          <span
            style={{ position: "absolute", top: 0, bottom: 0, left: pct(frame.start), width: width(frame.start, frame.end), border: "1.5px dashed var(--accent)", borderRadius: 6, background: "var(--accent-quiet)" }}
          />
        ) : null}
        {busy.map((b, i) => (
          <span key={i} style={{ position: "absolute", top: 0, bottom: 0, left: pct(b.startMin), width: width(b.startMin, b.endMin), background: "var(--stone-300)" }} />
        ))}
        {end > start ? (
          <span
            style={{ position: "absolute", top: 3, bottom: 3, left: pct(start), width: width(start, end), borderRadius: 4, background: warn ? "var(--warn)" : "var(--accent)" }}
          />
        ) : null}
      </div>
      <div className="mono-data-sm" style={{ display: "flex", justifyContent: "space-between", marginTop: 3, color: "var(--text-faint)", letterSpacing: 0 }}>
        {["06", "09", "12", "15", "18", "21", "24"].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </div>
  );
}
