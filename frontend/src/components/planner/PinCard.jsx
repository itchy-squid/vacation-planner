import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTicket } from "@fortawesome/free-solid-svg-icons";
import PhotoPlaceholder from "../core/PhotoPlaceholder";
import HeartButton from "../core/HeartButton";
import { usePinHeart } from "../../state/PlannerContext";
import { usePinPhoto } from "../photos/usePinPhoto";

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
// The heart sits on the photo's top corner, where it costs the text rows
// nothing on a card this narrow; who hearted it is on the pin's own screen
// (pages/EditVisit.jsx), which has the room. `example` is for the faded
// sample cards on the empty board (EmptyBoard.jsx), which aren't real pins
// and so can't be hearted.
// `highlighted` outlines the card in plum: the pin that was just added
// (pages/PinBoard.jsx). `locationLabel` says where it is on the Map tab
// ("On the map" or "Shown in Cozumel"), teal for an exact spot.
// `pass` is a ticket that gets people into this place (a 5-day ticket on a
// Universal park — components/expenses/CostSheet.jsx): a teal badge says
// so, and when it covers everyone the price reads "With ticket" rather
// than a price nobody pays.
export default function PinCard({ pin, column, contributorInitial, onOpen, example = false, highlighted = false, locationLabel = null, pass = null, passCoversAll = false }) {
  const heart = usePinHeart(pin);
  const photo = usePinPhoto(pin);
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
        boxShadow: highlighted ? "0 0 0 2px var(--accent), var(--shadow-card)" : "var(--shadow-card)",
        overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <PhotoPlaceholder height={photoHeight} label="photo" src={photo.src} credit={photo.credit} referrerPolicy={photo.referrerPolicy} onError={photo.onError} alt={pin.title}>
        {pass ? (
          <div
            title={`Covered by ${pass.title}`}
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              maxWidth: "calc(100% - 64px)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: "var(--radius-pill)",
              background: "var(--geo)",
              color: "#fff",
              font: "600 9.5px var(--font-sans)",
              boxShadow: "var(--shadow-raised)",
            }}
          >
            <FontAwesomeIcon icon={faTicket} style={{ width: 9, height: 9, flex: "none" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pass.title}</span>
          </div>
        ) : null}
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <HeartButton
            overlay
            title={pin.title}
            count={heart.count}
            hearted={heart.hearted}
            canHeart={heart.canHeart && !example}
            onToggle={heart.toggle}
            busy={heart.busy}
          />
        </div>
      </PhotoPlaceholder>
      <div style={{ padding: "10px 11px 11px" }}>
        <div style={{ font: "600 13px/1.3 var(--font-sans)", color: "var(--text-primary)" }}>{pin.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: dotColor, flex: "none" }} />
          <span style={{ font: "400 11px var(--font-sans)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pin.region}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <span className="mono-data-sm" style={{ letterSpacing: 0 }}>
            {/* A stay takes no time on the plan, so it says what it is
                instead of how long it lasts. */}
            {pass && passCoversAll ? (
              <span style={{ color: "var(--geo)" }}>With ticket · </span>
            ) : pin.cost ? (
              `$${pin.cost}${pin.costPer === "day" ? "/day" : ""}${pin.costBasis === "group" ? "" : " each"} · `
            ) : (
              ""
            )}
            {pin.kind === "stay" ? "Stay" : fmtDur(pin.dur)}
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
        {locationLabel ? (
          <div className="mono-data-sm" style={{ marginTop: 6, fontSize: 8.5, letterSpacing: ".06em", textTransform: "uppercase", color: pin.lat != null ? "var(--geo)" : "var(--text-secondary)" }}>
            {locationLabel}
          </div>
        ) : null}
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
