import PhotoPlaceholder from "../core/PhotoPlaceholder";

// The two photo heights the masonry rhythm alternates between (handoff
// README screen 2). Exported so anything elsewhere that wants to preview
// a photo "the way it'll look on the board" has a real answer rather than
// guessing a number — see pages/NewPin.jsx's photo-picker marquee, which
// uses BOARD_PHOTO_HEIGHT_PRIMARY as its one representative height, since
// a picker showing several photos side by side has no "column" of its
// own to alternate by.
export const BOARD_PHOTO_HEIGHT_PRIMARY = 112;
export const BOARD_PHOTO_HEIGHT_SECONDARY = 150;

// Pin board masonry card. Left column photo height 112, right column 150 —
// that alternation is what produces the masonry rhythm (handoff README
// screen 2). Place-row dot is plum in the left column, teal in the right.
export default function PinCard({ pin, column, contributorInitial, onOpen }) {
  const photoHeight = column === 0 ? BOARD_PHOTO_HEIGHT_PRIMARY : BOARD_PHOTO_HEIGHT_SECONDARY;
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
      <PhotoPlaceholder height={photoHeight} label="photo" src={pin.photoUrl} alt={pin.title} />
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
            {pin.cost ? `$${pin.cost} · ` : ""}{fmtDur(pin.dur)}
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
