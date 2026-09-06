import ConsensusMeter from "./ConsensusMeter";

// Block states — the left border rail carries the meaning. See handoff
// README screen 4. Block height is proportional to duration in the real
// timeline; the day-strip cards use a simpler fixed-height treatment.
export default function TimeBlock({ block, onOpen }) {
  if (block.type === "empty") {
    return (
      <div
        style={{
          height: 52,
          borderRadius: "var(--radius-md)",
          border: "1px dashed var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: "400 11px var(--font-sans)",
          color: "var(--text-faint)",
        }}
      >
        {`${minutesToClock(block.start)} — drop a pin here`}
      </div>
    );
  }

  if (block.type === "contested") {
    return (
      <div
        className="tap"
        onClick={onOpen}
        style={{
          borderRadius: "var(--radius-lg)",
          border: "2px dashed var(--accent)",
          background: "var(--plum-tint)",
          padding: "11px 12px 12px",
          cursor: "pointer",
          transition: `background var(--dur-base) var(--ease-standard)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ font: "600 12.5px var(--font-sans)", color: "var(--accent)" }}>{block.headline}</div>
          <div style={{ font: "600 11.5px var(--font-sans)", color: "var(--accent)" }}>Compare →</div>
        </div>
        <div style={{ font: "400 11px var(--font-sans)", lineHeight: 1.45, color: "var(--text-secondary)", marginTop: 4 }}>
          {minutesToClock(block.start)}–{minutesToClock(block.end)} · {block.conflictNames}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {block.setChips.map((c) => (
            <div
              key={c.key}
              style={{
                padding: "5px 9px",
                borderRadius: 999,
                background: "#fff",
                border: `1px solid ${c.color}`,
                font: "500 10px var(--font-sans)",
                color: c.color,
              }}
            >
              {c.label}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 11 }}>
          <ConsensusMeter votedCount={block.votedCount} totalCount={block.totalVoters} height={5} />
        </div>
      </div>
    );
  }

  if (block.type === "locked") {
    return (
      <div style={{ borderRadius: "var(--radius-lg)", background: "var(--surface-page)", borderLeft: "3px solid var(--accent)", padding: "10px 12px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ font: "600 12.5px var(--font-sans)", color: "var(--text-primary)" }}>{block.title}</div>
          <button type="button" onClick={onOpen} style={{ font: "600 11px var(--font-sans)", color: "var(--accent)" }}>
            Reopen
          </button>
        </div>
        <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 3 }}>{block.meta}</div>
      </div>
    );
  }

  // placed | pencilled
  const isPencilled = block.type === "pencilled";
  return (
    <div
      style={{
        borderRadius: "var(--radius-md)",
        background: isPencilled ? "var(--surface-page)" : "var(--teal-50)",
        borderLeft: `3px solid ${isPencilled ? "var(--stone-250)" : "var(--geo)"}`,
        padding: "7px 10px",
      }}
    >
      <div style={{ font: "600 12px var(--font-sans)", color: isPencilled ? "var(--text-secondary)" : "var(--text-primary)" }}>{block.title}</div>
      <div className="mono-data-sm" style={{ color: "var(--text-secondary)", marginTop: 2 }}>
        {minutesToClock(block.start)}–{minutesToClock(block.end)}{block.meta ? ` · ${block.meta}` : ""}
      </div>
    </div>
  );
}

function minutesToClock(m) {
  if (m == null) return "";
  const t = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
