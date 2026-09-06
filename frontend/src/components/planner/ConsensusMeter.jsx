// Consensus bar + mono "n/6 VOTED" count. Fill colour is the accent
// (plum) — this is always about the decision, never geography.
export default function ConsensusMeter({ votedCount, totalCount, height = 7 }) {
  const pct = totalCount ? Math.min(100, (votedCount / totalCount) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ flex: 1, height, borderRadius: 999, background: "var(--surface-sunken)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width var(--dur-base) var(--ease-standard)",
          }}
        />
      </div>
      <span className="mono-data-sm" style={{ color: "var(--text-muted)" }}>
        {votedCount}/{totalCount} VOTED
      </span>
    </div>
  );
}
