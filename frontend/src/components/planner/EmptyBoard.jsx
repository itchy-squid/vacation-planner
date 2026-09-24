import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faLink, faPen, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import PinCard from "./PinCard";

// What the Ideas board shows before anyone has added an idea. A new trip
// used to open onto a caption ("Ideation · 0 pins") and a small "+" in the
// header, with nothing saying what the board is for or how to start. This
// says both in one sentence, offers the ways to start as full-width rows,
// and shows two faded example cards so people can see what an idea turns
// into before they add one. See the Ideas onboarding mockups (Concept 1)
// in the project docs.
//
// The rows are only the actions the viewer can take: adding needs
// ideas:add and inviting needs members:manage, so a companion sees two
// rows, the owner sees three, and a reader sees none and gets a line
// about who is collecting ideas instead.
//
// The examples are illustrations, not data: they are hidden from
// assistive tech and can't be tapped, and they go away with the rest of
// this screen once the first real idea exists (see pages/PinBoard.jsx).
const EXAMPLES = [
  { id: "example-1", title: "Vase Rock", region: "Xiaoliuqiu", cost: 12, costBasis: "per_head", dur: 60 },
  { id: "example-2", title: "Raohe Night Market", region: "Taipei", cost: null, dur: 120 },
];

export default function EmptyBoard({ canAdd, canInvite, ownerName, onAddLink, onAddPlace, onInvite }) {
  const actions = [
    canAdd && { key: "link", icon: faLink, title: "Paste a link", body: "Google Maps, Instagram, a blog post", onClick: onAddLink },
    canAdd && { key: "place", icon: faPen, title: "Type a place", body: "“Vase Rock” or “night market”", onClick: onAddPlace },
    canInvite && { key: "invite", icon: faUserPlus, title: "Invite people", body: "They can add their own ideas", onClick: onInvite },
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px var(--gutter-screen) 0" }}>
      <div style={{ padding: "0 4px" }}>
        {canAdd ? (
          <>
            <h2 style={{ font: "var(--type-title)", margin: 0, color: "var(--text-primary)", textWrap: "balance" }}>
              What might you do on this trip?
            </h2>
            <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "6px 0 0" }}>
              Collect places, food and activities here. Anyone on the trip can add them. When you have a few, arrange them
              into days on Plan.
            </p>
          </>
        ) : (
          <>
            <h2 style={{ font: "var(--type-title)", margin: 0, color: "var(--text-primary)" }}>Nothing here yet</h2>
            <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "6px 0 0" }}>
              {ownerName ?? "The owner"} is still collecting ideas for this trip. They’ll show up here as they’re added.
            </p>
          </>
        )}
      </div>

      {actions.length ? (
        <div
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--shadow-card)",
            overflow: "hidden",
          }}
        >
          {actions.map((a, i) => (
            <ActionRow key={a.key} {...a} first={i === 0} />
          ))}
        </div>
      ) : null}

      <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono-caption">Example</span>
          <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
        </div>
        <div style={{ display: "flex", gap: 10, opacity: 0.55, pointerEvents: "none", userSelect: "none" }}>
          {EXAMPLES.map((pin, i) => (
            <div key={pin.id} style={{ flex: 1, minWidth: 0 }}>
              <PinCard pin={pin} column={i} contributorInitial="A" onOpen={() => {}} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionRow({ icon, title, body, onClick, first }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        minHeight: 58,
        padding: "10px 14px",
        textAlign: "left",
        borderTop: first ? "none" : "1px solid var(--hairline)",
        color: "var(--text-primary)",
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          flex: "none",
          borderRadius: "var(--radius-md)",
          background: "var(--accent-quiet)",
          color: "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <FontAwesomeIcon icon={icon} style={{ width: 14, height: 14 }} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", font: "var(--type-label)" }}>{title}</span>
        <span style={{ display: "block", font: "var(--type-caption)", color: "var(--text-muted)", marginTop: 2 }}>{body}</span>
      </span>
      <FontAwesomeIcon icon={faChevronRight} style={{ width: 10, height: 10, color: "var(--text-faint)" }} />
    </button>
  );
}
