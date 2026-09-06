import PhotoPlaceholder from "../core/PhotoPlaceholder";

// Pin board masonry card. Left column photo height 112, right column 150 —
// that alternation is what produces the masonry rhythm (handoff README
// screen 2). Place-row dot is plum in the left column, teal in the right.
export default function PinCard({ pin, column, contributorInitial, onOpen }) {
  const photoHeight = column === 0 ? 112 : 150;
  const dotColor = column === 0 ? "var(--accent)" : "var(--geo)";
  return (
    <div
      className="tap"
      onClick={onOpen}
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--hairline)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <PhotoPlaceholder height={photoHeight} label="photo" />
      <div style={{ padding: "10px 11px 11px" }}>
        <div style={{ font: "600 13px/1.3 var(--font-sans)", color: "var(--text-primary)" }}>{pin.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, flex: "none" }} />
          <span style={{ font: "400 11px var(--font-sans)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pin.place}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <span className="mono-data-sm" style={{ letterSpacing: 0 }}>
            {pin.cost ? `$${pin.cost}` : "free"} · {fmtDur(pin.dur)}
          </span>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "var(--stone-200)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "600 9px var(--font-sans)",
              color: "var(--text-secondary)",
            }}
          >
            {contributorInitial}
          </span>
        </div>
      </div>
    </div>
  );
}

function fmtDur(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h${m}m` : `${h}h`;
}
